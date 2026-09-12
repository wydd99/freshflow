/**
 * 本地规则订单解析器（智能录单兜底，无需 GLM Key）
 * 规则与 ai/prompts/order_parse_text.md 一致：切段 → 摘数量(中文数字) → 归一单位 → 清洗品名
 */

const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const UNIT_SRC = '公斤|千克|斤|克|件|箱|瓶|袋|桶|包|份|把|个|盒|板|条|听|罐'
const UNIT_RE = `(${UNIT_SRC})`
const NUM_RE = '(\\d+(?:\\.\\d+)?|[一二两三四五六七八九十半]+)'
const VERB_RE = /^(给|帮我|帮|请|来点|来|要|买|上|发|订|送)+/

export function cnToNumber(s) {
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s)
  if (s === '半') return 0.5
  if (s === '十') return 10
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    const tens = a ? (CN_NUM[a] ?? 1) : 1
    const ones = b ? (CN_NUM[b] ?? 0) : 0
    return tens * 10 + ones
  }
  if (CN_NUM[s] != null) return CN_NUM[s]
  return null
}

function cleanName(raw) {
  return raw.replace(VERB_RE, '').replace(/[的了]{1,2}$/, '').trim()
}

/** 解析一段：优先 品名+数量+单位（防"五花肉/二荆条"类品名被数量分支劫持），再 数量(半)+单位+品名，再 品名+单位（数量=1） */
function parseSegment(seg) {
  let s = seg.trim()
  if (!s) return null
  // 品名在前："五花肉一斤半" / "土豆两斤" / "海天生抽2瓶"（分组：1=品名 2=数量 3=单位 4=半）
  let m = s.match(new RegExp(`^(.+?)\\s*${NUM_RE}\\s*${UNIT_RE}(半)?$`))
  if (m) {
    const qty = cnToNumber(m[2])
    const name = cleanName(m[1])
    if (qty != null && name) return { name, qty: qty + (m[4] ? 0.5 : 0), unit: m[3] }
  }
  // 数量在前："一斤半五花肉" / "2瓶海天生抽" / "半斤白菜"（分组：1=数量 2=单位 3=半 4=品名）
  m = s.match(new RegExp(`^${NUM_RE}\\s*${UNIT_RE}?(半)?\\s*(.+)$`))
  if (m) {
    const qty = cnToNumber(m[1])
    const name = cleanName(m[4])
    if (qty != null && name) return { name, qty: qty + (m[3] ? 0.5 : 0), unit: m[2] || '斤' }
  }
  // 无数量有单位："来点香菜" → 数量 1
  m = s.match(new RegExp(`^(.+?)\\s*${UNIT_RE}$`))
  if (m) {
    const name = cleanName(m[1])
    if (!name) return null
    return { name, qty: 1, unit: m[2] }
  }
  return null
}

/**
 * 解析整段文本：{ customer_hint, items: [{raw, name, qty, unit}] }
 * 首段无数量无单位的纯文字 → 视为客户名提示
 */
export function parseOrderText(text) {
  const out = { customer_hint: null, items: [] }
  const segments = String(text || '')
    .split(/[\n,，、;；：:]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (let i = 0; i < segments.length; i++) {
    // 段内按"单位+空格"再切（如 "奶白菜一斤 土豆两斤"）；非捕获 lookbehind 防 split 吐捕获组
    const parts = segments[i].split(new RegExp(`(?<=(?:${UNIT_SRC}))\\s+`))
    for (const part of parts) {
      const parsed = parseSegment(part)
      if (parsed) {
        out.items.push({ raw: part, ...parsed })
      } else if (!out.customer_hint && i === 0) {
        const cleaned = cleanName(part.replace(/^(给|帮我|帮|请|发|送|订)+/, '').replace(/(发|下单|订货|要货)$/, ''))
        if (cleaned && cleaned.length <= 20 && !/\d/.test(cleaned) && !/^[斤公斤克个瓶包箱袋桶份把盒板条听罐]$/.test(cleaned)) {
          out.customer_hint = cleaned
        }
      }
    }
  }
  return out
}
