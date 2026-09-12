/**
 * FreshFlow 打印模板引擎（T1.18）
 * 三件套与 print\ 静态稿同版式；数据来自 orderApi.getWithItems()
 * 口径：数量/单价/金额取实拣（sorted_*），未分拣回退下单（order_*）——见 docs/STATE_AND_AMOUNT.md
 */

export function rmbUpper(amount) {
  const DIG = '零壹贰叁肆伍陆柒捌玖'
  const U = ['', '拾', '佰', '仟']
  const BIG = ['', '万', '亿']
  const n = Math.round(Number(amount) * 100)
  if (n === 0) return '零元整'
  const ints = Math.floor(n / 100)
  const jiao = Math.floor((n % 100) / 10)
  const fen = n % 10
  let s = ''
  if (ints > 0) {
    const g = String(ints)
    const groups = []
    for (let i = g.length; i > 0; i -= 4) groups.unshift(g.slice(Math.max(0, i - 4), i))
    let out = ''
    groups.forEach((grp, gi) => {
      const big = BIG[groups.length - 1 - gi] || ''
      let part = ''
      let needZero = false
      let nonzero = false
      for (let i = 0; i < grp.length; i++) {
        const d = Number(grp[i])
        if (d === 0) {
          needZero = true
        } else {
          if (needZero && part) part += '零'
          needZero = false
          part += DIG[d] + U[grp.length - 1 - i]
          nonzero = true
        }
      }
      if (nonzero) out += part + big
    })
    s = out + '元'
  }
  if (jiao === 0 && fen === 0) return s + '整'
  if (ints > 0 && jiao === 0 && fen > 0) s += '零'
  if (jiao > 0) s += DIG[jiao] + '角'
  if (fen > 0) s += DIG[fen] + '分'
  return s
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** 打印行数据归一：实拣优先，回退下单；附行状态备注 */
function normItems(items) {
  return items
    .filter((i) => i.status !== 'void')
    .map((i) => ({
      name: i.goods_name,
      unit: i.unit,
      qty: Number(i.sorted_qty ?? i.order_qty ?? 0),
      price: Number(i.sorted_price ?? i.order_price ?? 0),
      amount: Number(i.amount ?? 0),
      note: i.status === 'short' ? '缺货' : (Number(i.sorted_qty ?? 0) !== Number(i.order_qty) && i.sorted_qty != null ? '按实称' : ''),
    }))
}

export function buildPeihuoA4(order, items, meta = {}) {
  const rows = normItems(items)
  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>配货单</title>
<style>
  @page { size: A4 portrait; margin: 14mm 16mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "SimHei", sans-serif; color: #000; }
  .head { text-align: center; margin-bottom: 6mm; }
  .head .cust { font-size: 26pt; font-weight: 700; letter-spacing: 2px; }
  .head .meta { font-size: 12pt; margin-top: 3mm; color: #222; }
  .items { margin-top: 4mm; }
  .line { display: flex; align-items: baseline; font-size: 17pt; line-height: 2.05; }
  .line .name { flex: 0 0 46%; font-weight: 600; }
  .line .dots { flex: 1; border-bottom: 1px dotted #999; margin: 0 4mm; transform: translateY(-4px); }
  .line .qty { flex: 0 0 auto; font-weight: 700; font-size: 18pt; min-width: 34mm; text-align: right; }
  .foot { margin-top: 10mm; padding-top: 3mm; border-top: 1px solid #bbb; font-size: 10.5pt; color: #333; display: flex; justify-content: space-between; }
</style></head><body>
<div class="head">
  <div class="cust">${esc(order.customerName || meta.customerName || '')}</div>
  <div class="meta">发货日期：${esc(order.delivery_date)}${order.time_slot ? '　时段：' + esc(order.time_slot) : ''}　共 ${rows.length} 个品 / ${totalQty.toFixed(2)}　单号 ${esc(order.order_no)}</div>
</div>
<div class="items">
${rows.map((r) => `<div class="line"><span class="name">${esc(r.name)}</span><span class="dots"></span><span class="qty">${r.qty} ${esc(r.unit)}</span></div>`).join('\n')}
</div>
<div class="foot">
  <span>打印时间：${esc(meta.printedAt || '')}${meta.printNo ? `　第 ${meta.printNo} 次打印` : ''}</span>
  <span>鲜配 · 配货单（装货用，数量以实际称重为准）</span>
</div>
</body></html>`
}

export function buildChukuA4(order, items, meta = {}) {
  const rows = normItems(items)
  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>送货单</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", sans-serif; color: #000; font-size: 11pt; }
  .title { text-align: center; font-size: 20pt; font-weight: 700; letter-spacing: 8px; }
  .sub { text-align: center; font-size: 10pt; color: #444; margin-top: 1mm; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 8mm; margin: 4mm 0 3mm; font-size: 11pt; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 1.6mm 2mm; font-size: 10.5pt; }
  th { background: #f2f2f2; font-weight: 700; }
  td.r, th.r { text-align: right; } td.c, th.c { text-align: center; }
  tr.total td { font-weight: 700; background: #fafafa; }
  .cap { margin-top: 2.5mm; font-size: 11pt; }
  .sign { display: flex; justify-content: space-between; margin-top: 10mm; font-size: 11pt; }
  .sign span { display: inline-block; width: 30%; border-bottom: 1px solid #000; height: 8mm; }
  .foot { margin-top: 6mm; padding-top: 2mm; border-top: 1px dashed #888; font-size: 9.5pt; color: #333; display: flex; justify-content: space-between; }
</style></head><body>
<div class="title">送 货 单</div>
<div class="sub">鲜配 · 示例商家A　电话 138-XXXX-XXXX</div>
<div class="meta">
  <div>客户：${esc(order.customerName || meta.customerName || '')}</div>
  <div>单号：${esc(order.order_no)}</div>
  <div>收货地址：${esc(order.address_snapshot || '＿＿＿＿')}</div>
  <div>发货日期：${esc(order.delivery_date)}</div>
  <div>送货人：＿＿＿＿　电话：＿＿＿＿</div>
  <div>打印时间：${esc(meta.printedAt || '')}${meta.printNo ? `（第 ${meta.printNo} 次打印）` : ''}</div>
</div>
<table>
  <thead><tr>
    <th class="c" style="width:8mm">序</th><th>品名</th><th class="c" style="width:16mm">单位</th>
    <th class="r" style="width:20mm">数量</th><th class="r" style="width:20mm">单价</th>
    <th class="r" style="width:24mm">金额</th><th style="width:30mm">备注</th>
  </tr></thead>
  <tbody>
${rows.map((r, i) => `    <tr><td class="c">${i + 1}</td><td>${esc(r.name)}</td><td class="c">${esc(r.unit)}</td><td class="r">${r.qty.toFixed(2)}</td><td class="r">${r.price.toFixed(2)}</td><td class="r">${r.amount.toFixed(2)}</td><td>${esc(r.note)}</td></tr>`).join('\n')}
    <tr class="total"><td class="c" colspan="3">合计</td><td class="r">${totalQty.toFixed(2)}</td><td class="c">—</td><td class="r">${total.toFixed(2)}</td><td></td></tr>
  </tbody>
</table>
<div class="cap">人民币大写：${rmbUpper(total)}　　（实收数量如有出入，请在签收时注明，当日联系调整）</div>
<div class="sign"><div>制单：＿＿＿＿</div><div>送货人签字：</div><div>客户签字：</div></div>
<div class="foot">
  <span>第一联：客户存根（红）　第二联：客户结算（白）　第三联：司机留存</span>
  <span>鲜配 · 出库单</span>
</div>
</body></html>`
}

export function buildReceipt80(order, items, meta = {}) {
  const rows = normItems(items)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>送货单(小票)</title>
<style>
  @page { size: 80mm auto; margin: 2.5mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 75mm; font-family: "SimSun", "Microsoft YaHei", monospace; color: #000; font-size: 10.5pt; }
  .shop { text-align: center; font-size: 13pt; font-weight: 700; }
  .sub { text-align: center; font-size: 9pt; }
  .meta { font-size: 9.5pt; margin: 2mm 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 1.5mm 0; }
  .meta div { display: flex; justify-content: space-between; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { border-bottom: 1px dashed #000; text-align: left; font-weight: 400; }
  td { line-height: 1.55; } td.r { text-align: right; }
  tr.total td { border-top: 1px dashed #000; font-weight: 700; font-size: 11pt; }
  .cap { font-size: 9.5pt; margin-top: 1mm; }
  .foot { text-align: center; font-size: 9pt; margin-top: 2.5mm; }
</style></head><body>
<div class="shop">鲜配 · 送货单</div>
<div class="sub">示例商家A　138-XXXX-XXXX</div>
<div class="meta">
  <div><span>客户</span><span>${esc(order.customerName || meta.customerName || '')}</span></div>
  <div><span>单号</span><span>${esc(order.order_no)}</span></div>
  <div><span>日期</span><span>${esc(meta.printedAt || order.delivery_date)}</span></div>
</div>
<table>
  <thead><tr><th>品名</th><th class="r">数量</th><th class="r">单价</th><th class="r">金额</th></tr></thead>
  <tbody>
${rows.map((r) => `    <tr><td>${esc(r.name)}</td><td class="r">${r.qty}${esc(r.unit)}</td><td class="r">${r.price.toFixed(2)}</td><td class="r">${r.amount.toFixed(2)}</td></tr>`).join('\n')}
    <tr class="total"><td class="r" colspan="3">合计（实拣）</td><td class="r">${total.toFixed(2)}</td></tr>
  </tbody>
</table>
<div class="cap">大写：${rmbUpper(total)}</div>
<div class="foot">数量以实际称重为准，有异议当日联系<br>客户签字：＿＿＿＿＿＿　谢谢惠顾</div>
</body></html>`
}

export const TEMPLATES = {
  peihuo_a4: { label: '配货单（A4 纯文字）', build: buildPeihuoA4, width: '800px' },
  chuku_a4: { label: '出库单（A4 表格）', build: buildChukuA4, width: '840px' },
  receipt80: { label: '小票送货单（80mm）', build: buildReceipt80, width: '420px' },
}

export function printHtml(html) {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)
  iframe.srcdoc = html
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } finally {
      setTimeout(() => iframe.remove(), 1000)
    }
  }
}
