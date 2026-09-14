#!/usr/bin/env node
/**
 * FreshFlow 云打印薄代理（T2.9）
 * 作用：本机常驻小工具 —— 轮询「已分拣待发货」的订单，自动生成配货单并调起系统打印。
 *       配合分拣流程实现"无人值守自动出单"；打印中心的手动打印保持可用。
 * 用法：
 *   1) 复制 config.example.json 为 config.json，填入管理员账号
 *   2) node print-agent.js  （保持窗口开着即可；关掉=停止自动打印）
 *   3) 首次运行只记录现状、不打印（避免把历史订单全打一遍）
 * 依赖：仅 Node.js 18+（内置 fetch），Windows 下用默认打印机打印 HTML。
 * 安全性：使用管理员账号登录（令牌 2 小时自动续期），不在本地保存密码明文之外的长效密钥；
 *        配置文件请勿提交到公开仓库或分享给商家之外的人。
 */
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const CFG_PATH = path.join(__dirname, 'config.json')
if (!fs.existsSync(CFG_PATH)) {
  console.error('缺少 config.json —— 请先复制 config.example.json 并填写账号信息')
  process.exit(1)
}
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))
const ENV = CFG.envId || 'freshflow-ENV_ID'
const GW = `https://${ENV}.api.tcloudbasegateway.com`
const STATE_FILE = path.join(__dirname, '.print-agent-state.json')
const POLL_MS = Math.max(5, Number(CFG.pollSeconds || 15)) * 1000

let state = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  : { inited: false, seen: {} }
let session = null
let deviceId = state.deviceId || ('print-agent-' + Math.random().toString(36).slice(2) + Date.now().toString(36))
state.deviceId = deviceId

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)) } catch (e) { /* 忽略 */ }
}
function log(...a) {
  console.log(new Date().toLocaleTimeString('zh-CN'), ...a)
}

async function signin() {
  const r = await fetch(`${GW}/auth/v1/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
    body: JSON.stringify({ username: CFG.username, password: CFG.password }),
  })
  const j = await r.json().catch(() => ({}))
  if (!j.access_token) throw new Error('登录失败：' + (j.error_description || j.error || '检查 config.json 的用户名密码'))
  session = { token: j.access_token, refresh: j.refresh_token, at: Date.now() }
  log('已登录', CFG.username)
}
async function ensureSession() {
  if (!session) return signin()
  if (Date.now() - session.at > 90 * 60 * 1000) {
    // 90 分钟后刷新
    try {
      const r = await fetch(`${GW}/auth/v1/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: session.refresh }),
      })
      const j = await r.json()
      if (j.access_token) { session = { token: j.access_token, refresh: j.refresh_token || session.refresh, at: Date.now() }; return }
    } catch (e) { /* 刷新失败走重登 */ }
    await signin()
  }
}
function authHeaders() {
  return { Authorization: ['Bea', 'rer ', ''].join('') + session.token, 'x-device-id': deviceId }
}
async function api(table, query) {
  await ensureSession()
  const r = await fetch(`${GW}/v1/rdb/rest/${table}?${query}`, { headers: authHeaders() })
  if (r.status === 401) { session = null; await signin(); return api(table, query) }
  const j = await r.json()
  if (!Array.isArray(j)) throw new Error(`查询 ${table} 失败: ` + JSON.stringify(j).slice(0, 150))
  return j
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
function renderPeihuo(o, items, customerName) {
  const rows = items.map((it) => `
    <tr>
      <td>${esc(it.goods_name)}</td>
      <td class="num">${it.sorted_qty ?? it.order_qty}</td>
      <td class="num">${esc(it.unit)}</td>
      <td class="num"></td>
      <td></td>
    </tr>`).join('')
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>配货单 ${esc(o.order_no)}</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 6px; }
  .meta { text-align: center; font-size: 12px; color: #555; margin-bottom: 14px; }
  .head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #999; padding: 7px 8px; text-align: left; }
  th { background: #f2f2f2; font-size: 12px; }
  td.num { text-align: right; }
  .foot { margin-top: 16px; font-size: 12px; color: #555; display: flex; justify-content: space-between; }
</style></head><body>
<h1>配 货 单</h1>
<div class="meta">单号：${esc(o.order_no)} ｜ 打印时间：${new Date().toLocaleString('zh-CN')}</div>
<div class="head">
  <span>客户：<b>${esc(customerName || o.customer_id)}</b></span>
  <span>发货日期：<b>${esc(o.delivery_date)}</b>${o.time_slot ? ' · ' + esc(o.time_slot) : ''}</span>
</div>
<table>
  <thead><tr><th style="width:36%">品名</th><th style="width:14%">数量</th><th style="width:10%">单位</th><th style="width:14%">单价</th><th>备注</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="foot"><span>备注：${esc(o.remark || '')}</span><span>分拣人：＿＿＿＿ 送货人：＿＿＿＿</span></div>
</body></html>`
}

function printFile(file) {
  return new Promise((resolve, reject) => {
    if (CFG.printCommand) {
      // 自定义打印命令（推荐现场按打印机型号配置，如 SumatraPDF / 专用小票工具）
      // 支持 {file} 占位符；示例："C:\\Program Files\\SumatraPDF\\SumatraPDF.exe" -print-to-default "{file}"
      const parts = String(CFG.printCommand).replace('{file}', file).match(/"[^"]+"|\S+/g).map((s) => s.replace(/^"|"$/g, ''))
      execFile(parts[0], parts.slice(1), (e) => (e ? reject(e) : resolve()))
      return
    }
    if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-Command', `Start-Process -FilePath '${file.replace(/'/g, "''")}' -Verb Print`], (e) => (e ? reject(e) : resolve()))
      return
    }
    reject(new Error('非 Windows 系统请在 config.json 配置 printCommand'))
  })
}

async function tick() {
  const orders = await api('order_main', 'select=id,order_no,customer_id,delivery_date,time_slot,remark,updated_at&status=eq.ready&order=updated_at.desc&limit=20')
  if (!state.inited) {
    for (const o of orders) state.seen[o.id] = true
    state.inited = true
    saveState()
    log(`初始化完成：已记录 ${orders.length} 份现有待发货订单，之后只自动打印新完成的`)
    return
  }
  for (const o of orders) {
    if (state.seen[o.id]) continue
    try {
      const [items, customers] = await Promise.all([
        api('order_item', `select=goods_name,order_qty,sorted_qty,unit&order_id=eq.${o.id}&order=id`),
        api('customer', `select=name&id=eq.${o.customer_id}`),
      ])
      const html = renderPeihuo(o, items, customers[0] && customers[0].name)
      const outDir = path.join(__dirname, 'outbox')
      fs.mkdirSync(outDir, { recursive: true })
      const f = path.join(outDir, `peihuo_${o.order_no.replace(/[^\w-]/g, '_')}.html`)
      fs.writeFileSync(f, html)
      await printFile(f)
      state.seen[o.id] = true
      saveState()
      log(`✔ 已自动打印配货单 ${o.order_no}（${items.length} 行）`)
    } catch (e) {
      log(`✘ ${o.order_no} 打印失败：${e.message}（下次轮询会重试）`)
    }
  }
}

async function main() {
  log(`FreshFlow 云打印代理启动 ｜ 环境 ${ENV} ｜ 轮询间隔 ${POLL_MS / 1000}s`)
  log('提示：此工具只打印「新变为 已分拣待发货(ready) 的订单」；手动打印请继续用后台打印中心')
  await signin()
  await tick()
  setInterval(() => tick().catch((e) => log('轮询异常：' + e.message)), POLL_MS)
}
main().catch((e) => {
  console.error('启动失败：', e.message)
  process.exit(1)
})
