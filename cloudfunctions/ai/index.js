// FreshFlow · 云函数 ai：LLM 智能录单解析（文本/图片/语音 → 结构化订单行 JSON）
// 双通道架构（供应商可按通道配置，均为 OpenAI 兼容协议）：
//   图片通道 → 智谱 glm-4.5v（2026-09-12 A/B 实测：潦草手写四行数字全对且 low 标记真实执行，
//              显著优于 deepseek-flash 的臆造小数不标记；样张与结论见 ai/test/识别率实测报告.md）
//   文本/语音通道 → 按 LLM_ENDPOINT 决定供应商（当前 DeepSeek）
// 环境变量：
//   GLM_API_KEY（图片通道必配）  智谱密钥（bigmodel.cn 申请）
//   LLM_API_KEY（文本/语音必配） DeepSeek 密钥（api.deepseek.com 申请）
//   LLM_ENDPOINT（可选）     含 deepseek 字样走 DeepSeek，否则默认智谱（仅影响文本/语音）
//   LLM_MODEL_TEXT（可选）   默认 glm-4.5；DeepSeek 填 deepseek-flash
//   LLM_MODEL_IMAGE（可选）  默认 glm-4.5v（图片通道恒走智谱，此变量可换其它智谱视觉模型）
//   TENCENT_SECRET_ID/KEY    腾讯云子账号密钥（仅 ASR 语音识别权限），语音转文字用
// 安全：只返回解析结果，绝不回显 event/env/headers；
// 所有出站请求目标均为字面量官方域名（构造上杜绝 SSRF）。
const LLM_URL_ZHIPU = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const LLM_URL_DEEPSEEK = 'https://api.deepseek.com/chat/completions'
const ASR_URL = 'https://asr.tencentcloudapi.com/'

const TEXT_PROMPT = `你是生鲜批发订单解析器。把用户输入的自然语言订货内容解析为 JSON。
【输出格式】严格输出 JSON，不要任何解释文字：
{"customer_hint":"开头出现的客户名，没有则为 null","delivery_date_hint":"出现的发货日期，没有则为 null","items":[{"raw":"原文片段","name":"品名","qty":数量,"unit":"单位"}]}
【规则】按换行/顿号/逗号/空格切分；中文数字转阿拉伯数字（四斤→4，两瓶→2，半斤→0.5，1斤半→1.5）；数量缺省=1；单位归一到 斤/公斤/克/件/箱/瓶/袋/桶/包/份/把；去掉动词敬语留核心名词；规格词并入品名；不确定保留原样放 raw，禁止编造数量单位。`

const IMAGE_PROMPT = `你是生鲜订货单图片转录器。输入一张手写或打印的订货单照片，输出 JSON。
【输出格式】严格 JSON，不要解释：
{"doc_type":"handwrite|print|unknown","customer_hint":"客户名或 null","date_hint":"日期或 null","items":[{"raw":"该行原文","name":"品名","qty":数量或 null,"unit":"单位或 null","price":价格或 null,"confidence":"high|medium|low"}]}
【规则】
1. 逐行转录一行一条；不要合并同一品名的多行；微信截图按行转录，忽略头像/时间戳/按钮文字。
2. 表格单据：数量为空的行=未订货，直接跳过不要输出；表头/分类名（如"赣菜""员工餐""面点"）是分类不是商品，不要输出。
3. 备注列或括号里出现的"品名+数量"（如"绿豆饼5斤""面粉10斤"）也要作为独立条目输出。
4. 宁缺勿造：数字完全无法辨认的行 qty=null 且 confidence="low"；勉强可辨取最可能值标 medium——禁止臆造小数。
5. 品名尽量对应常见蔬菜/食材名；字迹潦草时选最接近的常用名并降低 confidence。
6. 单位照抄单据原文单位（把/盒/板/棵/包等），不要统一改成斤。
7. 中文数字转阿拉伯；数量缺省=1（标 medium）；有价格列转录进 price，没有就是 null 不估算。`

function extractJson(text) {
  if (!text) return null
  let s = String(text).replace(/```json|```/gi, '').trim()
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)) } catch (e) { return null }
      }
    }
  }
  return null
}

// ---------- 腾讯云一句话识别（TC3-HMAC-SHA256 签名，无 SDK 依赖） ----------
const crypto = require('crypto')

async function tc3Asr(base64Audio, voiceFormat) {
  const secretId = process.env.TENCENT_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('未配置 TENCENT_SECRET_ID/KEY')

  const audioBuf = Buffer.from(base64Audio, 'base64')
  const payload = JSON.stringify({
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: '16k_zh',
    VoiceFormat: voiceFormat || 'mp3',
    UsrAudioKey: 'ff' + Date.now(),
    SourceType: 1,
    Data: base64Audio,
    DataLen: audioBuf.length,
  })

  const service = 'asr'
  const host = 'asr.tencentcloudapi.com'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

  // 官方 TC3 写法：数组 join('\n')，canonicalHeaders 自带尾换行 → 头块后是双换行（少一个即 SignatureFailure）
  const canonicalRequest = ['POST', '/', '',
    'content-type:application/json; charset=utf-8\nhost:' + host + '\nx-tc-action:sentencerecognition\n',
    'content-type;host;x-tc-action',
    crypto.createHash('sha256').update(payload).digest('hex')].join('\n')
  const stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + date + '/' + service + '/tc3_request\n' +
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')

  const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest()
  const kDate = hmac('TC3' + secretKey, date)
  const kService = hmac(kDate, service)
  const kSigning = hmac(kService, 'tc3_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const r = await fetch(ASR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': 'SentenceRecognition',
      'X-TC-Version': '2019-06-14',
      'X-TC-Timestamp': String(timestamp),
      Authorization: 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + date + '/' + service + '/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=' + signature,
    },
    body: payload,
  })
  return r.json()
}

async function callLLM(provider, key, model, content) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }
  const body = JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0.1 })
  // 目标为字面量白名单域名（智谱/DeepSeek 二选一），不存在可变 URL
  if (provider === 'deepseek') {
    return fetch(LLM_URL_DEEPSEEK, { method: 'POST', headers, body }).then((r) => r.json().catch(() => ({})))
  }
  return fetch(LLM_URL_ZHIPU, { method: 'POST', headers, body }).then((r) => r.json().catch(() => ({})))
}

function llmProvider() {
  const ep = String(process.env.LLM_ENDPOINT || '')
  return ep.includes('deepseek') ? 'deepseek' : 'zhipu'
}

exports.main = async (event) => {
  // 兼容网关 HTTP 访问：event 可能是 {body:'{...}'} 包装
  let src = event
  if (src && typeof src.body === 'string' && src.mode === undefined) {
    try { src = JSON.parse(src.body) } catch (e) { /* 保持原样 */ }
  }

  const mode = src && src.mode === 'image' ? 'image' : src && src.mode === 'audio' ? 'audio' : 'text'
  // 图片恒走智谱视觉通道；文本/语音按 LLM_ENDPOINT 选供应商
  const provider = mode === 'image' ? 'zhipu' : llmProvider()
  const key = (provider === 'deepseek' ? process.env.LLM_API_KEY : process.env.GLM_API_KEY) || ''
  if (!key || key === 'PENDING') {
    return { ok: false, error: (provider === 'deepseek' ? 'LLM_API_KEY(DeepSeek)' : 'GLM_API_KEY(智谱)') + ' 未配置' }
  }
  const model = mode === 'image'
    ? (process.env.LLM_MODEL_IMAGE || 'glm-4.5v')
    : (process.env.LLM_MODEL_TEXT || 'glm-4.5')

  let content
  let voiceText = null
  if (mode === 'image') {
    const img = String((src && src.imageBase64) || '')
    if (!img.startsWith('data:image/')) return { ok: false, error: '缺少图片（imageBase64 需为 data:image/... 格式）' }
    content = [
      { type: 'image_url', image_url: { url: img } },
      { type: 'text', text: IMAGE_PROMPT },
    ]
  } else if (mode === 'audio') {
    let audioB64 = String((src && src.audioBase64) || '')
    if (audioB64.startsWith('data:')) audioB64 = audioB64.slice(audioB64.indexOf(',') + 1)
    if (!audioB64) return { ok: false, error: '缺少录音（audioBase64）' }
    const fmt = (src && src.audioFormat) || 'mp3'
    if (audioB64.length > 6 * 1024 * 1024) return { ok: false, error: '录音过大（>4.5MB），请说短一点' }
    try {
      const asr = await tc3Asr(audioB64, fmt)
      if (asr.Response && asr.Response.Error) {
        return { ok: false, error: '语音识别失败：' + asr.Response.Error.Message }
      }
      voiceText = (asr.Response && asr.Response.Result) || ''
    } catch (e) {
      return { ok: false, error: '语音识别调用异常：' + String((e && e.message) || e) }
    }
    if (!voiceText.trim()) return { ok: false, error: '没听清内容，请靠近一点再说一次' }
    // 语音→文字后走同一套 LLM 结构化
    if (src && src.skipLLM) return { ok: true, mode: 'audio', text: voiceText, items: null }
    content = TEXT_PROMPT + '\n\n【输入】\n' + voiceText
  } else {
    const text = String((src && src.text) || '').trim()
    if (!text) return { ok: false, error: '缺少文本内容' }
    if (text.length > 4000) return { ok: false, error: '文本过长（>4000 字符），请分段识别' }
    content = TEXT_PROMPT + '\n\n【输入】\n' + text
  }

  try {
    const data = await callLLM(provider, key, model, content)
    if (data && data.error) {
      const msg = (data.error && data.error.message) || 'HTTP 错误'
      return { ok: false, error: 'LLM 调用失败：' + msg, ...(mode === 'audio' ? { text: voiceText } : {}) }
    }
    const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''
    const parsed = extractJson(text)
    if (!parsed || !Array.isArray(parsed.items)) return { ok: false, error: '模型未返回可解析的 JSON', raw: text.slice(0, 500) }
    return {
      ok: true,
      mode,
      items: parsed.items,
      customer_hint: parsed.customer_hint || null,
      delivery_date_hint: parsed.delivery_date_hint || null,
      ...(mode === 'audio' ? { text: voiceText } : {}),
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}
