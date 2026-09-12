// A/B 对比脚本：GLM-4.5V vs DeepSeek（DeepSeek 基线取自 dsresp3/dsresp5 存档）
// 用法：GLM_KEY=xxx node ab_glm.js
// 提示词从 ../../cloudfunctions/ai/index.js 实时提取，保证与线上一致
const fs = require('fs')
const path = require('path')

const fnSrc = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/ai/index.js'), 'utf8')
function extractConst(name) {
  const m = fnSrc.match(new RegExp('const ' + name + ' = `(.*?)`', 's'))
  if (!m) throw new Error('云函数中未找到 ' + name)
  return m[1]
}
const IMAGE_PROMPT = extractConst('IMAGE_PROMPT')

const KEY = process.env.GLM_KEY
if (!KEY) { console.error('缺少 GLM_KEY 环境变量'); process.exit(1) }
const URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const MODEL = process.env.GLM_MODEL || 'glm-4.5v'

const SAMPLES = [
  ['shou01_四栏潦草手写', 'C:/Users/dev/Desktop/菜单测试图片/手写菜单/012bdb7c6e45db42ce3cc3713b71cb31.jpg'],
  ['print01_打印表格单', 'C:/Users/dev/Desktop/菜单测试图片/123.jpg'],
  ['shou02_手写', 'C:/Users/dev/Desktop/菜单测试图片/手写菜单/f9fe83150b8d1d8a283a3316f1d5ff4b.jpg'],
  ['shou03_手写', 'C:/Users/dev/Desktop/菜单测试图片/手写菜单/b328741ab45fea39e25a8644aa3026d3.jpg'],
]

const outDir = path.join(__dirname, 'glm_results')
fs.mkdirSync(outDir, { recursive: true })

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
      if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)) } catch (e) { return null } }
    }
  }
  return null
}

async function run() {
  for (const [label, file] of SAMPLES) {
    const b64 = fs.readFileSync(file).toString('base64')
    const ext = path.extname(file).slice(1).toLowerCase()
    const dataUrl = `data:image/${ext};base64,` + b64
    const t0 = Date.now()
    process.stdout.write(`[${label}] 请求中... `)
    try {
      const r = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: IMAGE_PROMPT },
          ] }],
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(180000),
      })
      const data = await r.json().catch(() => ({}))
      const msg = data && data.choices && data.choices[0] && data.choices[0].message
      const parsed = extractJson(msg && msg.content)
      const dt = ((Date.now() - t0) / 1000).toFixed(1)
      if (!parsed) {
        console.log(`FAIL (${dt}s) HTTP ${r.status}`)
        fs.writeFileSync(path.join(outDir, label + '.raw.json'), JSON.stringify(data, null, 1))
        continue
      }
      fs.writeFileSync(path.join(outDir, label + '.json'), JSON.stringify(parsed, null, 1))
      const items = parsed.items || []
      const lows = items.filter((i) => i.confidence === 'low').length
      console.log(`OK ${dt}s | ${items.length} 行 | customer=${parsed.customer_hint} | low=${lows} | usage=${JSON.stringify(data.usage || {})}`)
    } catch (e) {
      console.log('ERROR', String((e && e.message) || e).slice(0, 200))
    }
  }
}
run()
