/**
 * T3.2 退货退款 + 改单留痕（需求#10/#18，STATE_AND_AMOUNT 口径）
 * 退货口径（以 STATE_AND_AMOUNT.md 为准）：
 *   - 行级退货：order_item.status → 'void'（整行退，该行不再计金额）或 sorted_qty 扣减（部分退）
 *   - edit_log 追加 {f:'refund',...} 留痕（需求#8）
 *   - amount_aftersale 累加退货金额（订单五卡之一）
 *   - 已发货订单退货：payment_ledger 写 adjust 流水冲应收（减欠款）；未发货不动账
 *   - 库存按退货量回补（inventory_log 流水 + stock_qty）
 */
import { db, auth, CLOUDBASE_ENV_ID } from '@/lib/cloudbase'

function unwrap(res) {
  const r = res ?? {}
  if (r.error) throw new Error(r.error.message || String(r.error))
  if (res === undefined || res === null) throw new Error('请求无响应（会话可能已过期），请刷新重新登录')
  return r.data
}

async function gw(method, table, query, body) {
  const { data } = await auth.getSession()
  const tk = data?.session?.access_token
  if (!tk) throw new Error('会话失效，请重新登录')
  const r = await fetch(`https://${CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest/${table}${query ? '?' + query : ''}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: '***' + tk,
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    throw new Error(b.message || (method + ' ' + table + ' 失败 HTTP ' + r.status))
  }
  return r.json().catch(() => [])
}

async function getTenantId() {
  const rows = (unwrap(await db.from('tenant').select('id').limit(1))) || []
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row?.id) throw new Error('租户信息读取失败')
  return row.id
}

export const refundApi = {
  /** 订单明细行退货：qty=null 整行退，否则部分退 */
  async refundItem(order, item, { qty = null, reason = '' } = {}) {
    const tid = await getTenantId()
    const rowQty = Number(item.sorted_qty ?? item.order_qty ?? 0)
    const refundQty = qty == null ? rowQty : Math.min(Number(qty), rowQty)
    if (refundQty <= 0) throw new Error('该行没有可退数量')
    const price = Number(item.sorted_price ?? item.order_price ?? 0)
    const refundAmount = Math.round(refundQty * price * 100) / 100

    // 1) 行状态
    const full = refundQty >= rowQty
    if (full) {
      await gw('PATCH', 'order_item', `id=eq.${item.id}`, { status: 'void', amount: 0 })
    } else {
      const restQty = Math.round((rowQty - refundQty) * 1000) / 1000
      await gw('PATCH', 'order_item', `id=eq.${item.id}`, {
        sorted_qty: restQty, amount: Math.round(restQty * price * 100) / 100,
      })
    }

    // 2) edit_log 留痕
    const log = Array.isArray(item.edit_log) ? [...item.edit_log] : []
    log.push({ f: 'refund', o: rowQty, n: refundQty, amt: refundAmount, by: '管理员', at: new Date().toISOString(), reason: reason || null })
    await gw('PATCH', 'order_item', `id=eq.${item.id}`, { edit_log: log })

    // 3) 订单金额重算 + 售后累计
    const items = (unwrap(await db.from('order_item').select('id,amount').eq('order_id', order.id))) || []
    const amountConfigured = items.reduce((s, i) => s + Number(i.amount ?? 0), 0)
    const aftersaleRows = (unwrap(await db.from('order_main').select('amount_aftersale').eq('id', order.id))) || []
    const prevAftersale = Number((Array.isArray(aftersaleRows) ? aftersaleRows[0] : aftersaleRows)?.amount_aftersale ?? 0)
    await gw('PATCH', 'order_main', `id=eq.${order.id}`, {
      amount_configured: Math.round(amountConfigured * 100) / 100,
      amount_aftersale: Math.round((prevAftersale + refundAmount) * 100) / 100,
    })

    // 4) 已发货：adjust 流水冲应收
    if (order.status === 'shipped' || order.status === 'done') {
      const ledRows = (unwrap(await db.from('payment_ledger').select('direction,amount').eq('customer_id', order.customer_id))) || []
      const balance = ledRows.reduce((s, r) => s + (r.direction === 'receivable' ? Number(r.amount) : -Number(r.amount)), 0)
      await gw('POST', 'payment_ledger', '', {
        tenant_id: tid, customer_id: order.customer_id, order_id: order.id,
        direction: 'received', amount: refundAmount, biz_type: 'adjust',
        balance_after: Math.round((balance - refundAmount) * 100) / 100,
      })
    }

    // 5) 库存回补
    try {
      if (refundQty > 0) {
        const cur = (unwrap(await db.from('goods').select('stock_qty').eq('id', item.goods_id))) || []
        const curQty = Number((Array.isArray(cur) ? cur[0] : cur)?.stock_qty ?? 0)
        const next = Math.round((curQty + refundQty) * 1000) / 1000
        await gw('PATCH', 'goods', `id=eq.${item.goods_id}`, { stock_qty: next })
        await gw('POST', 'inventory_log', '', {
          tenant_id: tid, goods_id: item.goods_id, delta: refundQty,
          reason: 'refund_in', ref_id: order.id, note: `退货 ${order.order_no} ${item.goods_name}`,
        })
      }
    } catch (e) { /* 库存回补失败不阻断退货 */ }

    return { refundQty, refundAmount, full }
  },

  /** 全部改单留痕（时间线） */
  async itemLogs(orderId) {
    const items = (unwrap(await db.from('order_item').select('id,goods_name,edit_log,adjust_note').eq('order_id', orderId).order('id'))) || []
    const events = []
    for (const it of items) {
      for (const e of (Array.isArray(it.edit_log) ? it.edit_log : [])) {
        events.push({ ...e, goodsName: it.goods_name, itemId: it.id })
      }
    }
    return events.sort((a, b) => (a.at || '').localeCompare(b.at || ''))
  },
}
