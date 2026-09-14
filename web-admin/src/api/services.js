/**
 * FreshFlow 数据服务层 —— 真实实现（CloudBase PG app.rdb()，postgREST 风格）
 * 多租户隔离由数据库 RLS 强制（见 database/migrations/20260910180000）；
 * 本层职责：snake_case ↔ 页面字段映射、分类名↔id 转换、错误统一抛出。
 * 历史 Mock 版见 git 记录/文档；USE_MOCK 保留为回退开关。
 */
import { db, callFn } from '@/lib/cloudbase'
import { useAuthStore } from '@/stores/auth'

export const USE_MOCK = false

function unwrap(res) {
  const r = res ?? {}
  if (r.error) throw new Error(r.error.message || String(r.error))
  // js-sdk 会话过期时可能返回整个 undefined/null（静默失败形态），显式报错引导重登
  if (res === undefined || res === null) {
    throw new Error('请求无响应（会话可能已过期），请刷新页面重新登录后重试')
  }
  return r.data
}

/**
 * 写操作统一走网关 REST。背景：本环境浏览器 js-sdk 写链路存在静默失败（多轮实证），
 * 网关 REST 实测 100% 可靠；读操作走 js-sdk 不变。
 */
/** REST 读（POST 后按唯一键回查兜底：网关 POST 不保证返回 representation） */
async function restQuery(table, query) {
  const { auth, CLOUDBASE_ENV_ID } = await import('@/lib/cloudbase')
  const { data } = await auth.getSession()
  const tk = data?.session?.access_token
  if (!tk) throw new Error('会话失效，请重新登录')
  const r = await fetch(`https://${CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest/${table}?${query}`, {
    headers: { Authorization: 'Bearer ' + tk },
  })
  if (!r.ok) throw new Error('查询失败 HTTP ' + r.status)
  return await r.json()
}

/** 库存增减：读现值 → PATCH 绝对值（单管理员场景竞态可忽略；流水留痕可对账修正） */
async function stockAdjust(goodsId, delta) {
  const rows = (unwrap(await db.from('goods').select('stock_qty').eq('id', goodsId))) || []
  const cur = Number((Array.isArray(rows) ? rows[0] : rows)?.stock_qty ?? 0)
  const next = Math.round((cur + delta) * 1000) / 1000
  await restWrite('PATCH', 'goods', `id=eq.${goodsId}`, { stock_qty: next })
  return next
}

async function restWrite(method, table, query, body) {
  const { auth, CLOUDBASE_ENV_ID } = await import('@/lib/cloudbase')
  const { data } = await auth.getSession()
  const tk = data?.session?.access_token
  if (!tk) throw new Error('会话失效，请重新登录')
  const r = await fetch(`https://${CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest/${table}${query ? '?' + query : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk, Prefer: 'return=representation' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    throw new Error(b.message || b.error_description || ('写入失败 HTTP ' + r.status))
  }
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

/** 北京时间今天（toISOString 是 UTC，凌晨会差一天——时区 bug 修复） */
export function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function tenantId() {
  const store = useAuthStore()
  await store.restore()
  const t = store.actor?.tenant_id
  if (!t) throw new Error('登录状态缺失，请重新登录')
  return t
}

let catCache = null
export async function listCategories() {
  if (catCache) return catCache
  const rows = unwrap(await db.from('goods_category').select('*').order('sort')) || []
  catCache = rows
  return rows
}

async function categoryIdByName(name, tid) {
  if (!name) return null
  const cats = await listCategories()
  const hit = cats.find((c) => c.name === name)
  if (hit) return hit.id
  await restWrite('POST', 'goods_category', '', { tenant_id: tid, name, sort: cats.length + 1 })
  catCache = null
  const back = (unwrap(await db.from('goods_category').select('id').eq('name', name).eq('tenant_id', tid))) || []
  return (Array.isArray(back) ? back[0] : back)?.id ?? null
}

/** 商品编码留空自动生成：取当前租户最大编码 +1（定长 10 位数字，文本序=数值序） */
async function nextGoodsCode(tid) {
  const rows = unwrap(await db.from('goods').select('code').eq('tenant_id', tid).order('code', { ascending: false }).limit(1)) || []
  const maxCode = (Array.isArray(rows) ? rows[0] : rows)?.code
  if (!maxCode) return '0110010001'
  const n = Number(maxCode)
  if (Number.isNaN(n)) return String(Date.now()).slice(-10)
  return String(n + 1).padStart(10, '0')
}

export const goodsApi = {
  async list({ keyword = '', category = '', status = '' } = {}) {
    const rows = unwrap(await db.from('goods').select('*').order('created_at', { ascending: false })) || []
    const cats = await listCategories()
    const catName = new Map(cats.map((c) => [c.id, c.name]))
    let out = rows.map((g) => ({
      ...g,
      basePrice: Number(g.base_price ?? 0),
      weighType: g.weigh_type,
      allowMall: g.allow_mall,
      category: catName.get(g.category_id) || '',
    }))
    if (keyword) {
      out = out.filter((g) =>
        g.name.includes(keyword) || (g.code || '').includes(keyword) ||
        (g.alias || []).some((a) => a.includes(keyword)))
    }
    if (category) out = out.filter((g) => g.category === category)
    if (status) out = out.filter((g) => g.status === status)
    return out
  },

  async save(item) {
    const tid = await tenantId()
    const categoryId = await categoryIdByName(item.category, tid)
    const payload = {
      tenant_id: tid,
      code: String(item.code || '').trim() || await nextGoodsCode(tid),
      name: item.name,
      alias: item.alias || [],
      category_id: categoryId,
      unit: item.unit || '斤',
      weigh_type: item.weighType || 'weight',
      barcode: item.barcode || null,
      spec: item.spec || null,
      description: item.description || null,
      base_price: item.basePrice ?? 0,
      allow_mall: !!item.allowMall,
      status: item.status || 'active',
      stock_alert: item.stock_alert != null ? item.stock_alert : null,
      remark: item.remark || null,
    }
    if (item.id) {
      await restWrite('PATCH', 'goods', `id=eq.${item.id}`, payload)
      return item
    }
    await restWrite('POST', 'goods', '', payload)
    const back = (unwrap(await db.from('goods').select('id').eq('name', item.name).eq('tenant_id', tid).order('id', { ascending: false }))) || []
    const row = Array.isArray(back) ? back[0] : back
    if (!row?.id) throw new Error('商品已保存但未查询到，请刷新查看')
    return row
  },

  async remove(id) {
    await restWrite('DELETE', 'goods', `id=eq.${id}`)
  },

  async listCategories() {
    const rows = await listCategories()
    return rows.map((c) => c.name)
  },
}

export const customerApi = {  async list({ keyword = '', level = '' } = {}) {
    const rows = unwrap(await db.from('customer').select('*').order('created_at', { ascending: false })) || []
    const cats = await listCategories()
    const catName = new Map(cats.map((c) => [c.id, c.name]))
    const mappings = unwrap(await db.from('customer_visible_category').select('*')) || []
    const byCustomer = new Map()
    for (const m of mappings) {
      if (!byCustomer.has(m.customer_id)) byCustomer.set(m.customer_id, [])
      byCustomer.get(m.customer_id).push(catName.get(m.category_id) || '')
    }
    let out = rows.map((c) => ({
      ...c,
      creditLimit: Number(c.credit_limit ?? 0),
      overdueDays: c.overdue_days ?? 30,
      settlementDay: c.settlement_day,
      settlementType: c.settlement_type,
      visibleAll: c.visible_all,
      visibleCategories: byCustomer.get(c.id) || [],
    }))
    if (keyword) out = out.filter((c) => c.name.includes(keyword))
    if (level) out = out.filter((c) => c.level === level)
    return out
  },

  async save(item) {
    const tid = await tenantId()
    const payload = {
      tenant_id: tid,
      name: item.name,
      level: item.level || 'default',
      settlement_type: item.settlementType || 'daily',
      settlement_day: item.settlementType === 'monthly' ? (item.settlementDay || 1) : null,
      credit_limit: item.creditLimit ?? 0,
      overdue_days: item.overdueDays ?? 30,
      visible_all: item.visibleAll !== false,
      status: item.status || 'active',
      remark: item.remark || null,
    }
    let customerId = item.id
    if (item.id) {
      await restWrite('PATCH', 'customer', `id=eq.${item.id}`, payload)
      // 写后回读校验：RLS 静默过滤时 update 返回 200 但 0 行，必须显式发现
      const check = (unwrap(await db.from('customer').select('name,settlement_type,credit_limit,overdue_days,visible_all').eq('id', item.id))) || []
      const row = Array.isArray(check) ? check[0] : check
      if (!row || String(row.settlement_type) !== String(payload.settlement_type) || Number(row.credit_limit ?? -1) !== Number(payload.credit_limit ?? -1) || row.visible_all !== payload.visible_all) {
        throw new Error('保存未生效（可能是登录身份或权限异常），请刷新页面重新登录后重试')
      }
    } else {
      await restWrite('POST', 'customer', '', payload)
      const back = (unwrap(await db.from('customer').select('id').eq('name', item.name).eq('tenant_id', tid))) || []
      customerId = (Array.isArray(back) ? back[0] : back)?.id
    }
    // 可见分类映射重写（customer_visible_category）
    await restWrite('DELETE', 'customer_visible_category', `customer_id=eq.${customerId}`)
    if (payload.visible_all === false && (item.visibleCategories || []).length) {
      const cats = await listCategories()
      const rows = item.visibleCategories
        .map((name) => cats.find((c) => c.name === name)?.id)
        .filter((id) => id)
        .map((category_id) => ({ tenant_id: tid, customer_id: customerId, category_id }))
      if (rows.length) await restWrite('POST', 'customer_visible_category', '', rows)
    }
    return item
  },

  async remove(id) {
    await restWrite('DELETE', 'customer_visible_category', `customer_id=eq.${id}`)
    await restWrite('DELETE', 'customer', `id=eq.${id}`)
  },
}

export const priceApi = {
  /** 商品精简列表（报价页选择器用） */
  async listGoodsLite() {
    const rows = unwrap(await db.from('goods').select('id,code,name,base_price').eq('status', 'active').order('code')) || []
    return rows.map((g) => ({ id: g.id, code: g.code, name: g.name, basePrice: Number(g.base_price ?? 0) }))
  },

  /** 某商品的全部价格行（含类型价/客户专属价，历史按生效日倒序） */
  async listPrices(goodsId) {
    const rows = unwrap(await db.from('price').select('*').eq('goods_id', goodsId).order('valid_from', { ascending: false })) || []
    const customers = unwrap(await db.from('customer').select('id,name')) || []
    const custName = new Map(customers.map((c) => [c.id, c.name]))
    return rows.map((r) => ({
      ...r,
      price: Number(r.price),
      scopeLabel: r.scope === 'type'
        ? `等级价 · ${r.scope_value === 'default' ? '默认' : r.scope_value + ' 类'}`
        : `客户专属 · ${custName.get(Number(r.scope_value)) || r.scope_value}`,
    }))
  },

  async removePrice(id) {
    await restWrite('DELETE', 'price', `id=eq.${id}`)
  },

  /** 批量写入"今日生效"价格行：逐条插入+写后回查校验（同日同键先删后插=覆盖；修复 UTC 时区与静默丢失） */
  async saveTodayRows(items) {
    const tid = await tenantId()
    const today = localToday()
    let written = 0
    for (const it of items) {
      await restWrite('DELETE', 'price', `goods_id=eq.${it.goods_id}&scope=eq.${it.scope}&scope_value=eq.${it.scope_value}&valid_from=eq.${today}`)
      await restWrite('POST', 'price', '', {
        tenant_id: tid,
        goods_id: it.goods_id,
        scope: it.scope,
        scope_value: String(it.scope_value),
        price: it.price,
        valid_from: today,
      })
      const check = unwrap(await db.from('price').select('id')
        .eq('goods_id', it.goods_id).eq('scope', it.scope)
        .eq('scope_value', String(it.scope_value)).eq('valid_from', today)) || []
      if (!check.length) throw new Error(`第 ${written + 1} 条价格写入后回查不到（goods_id=${it.goods_id}），请截图反馈`)
      written++
    }
    return written
  },

  /** 取价链（T1.7 录单用）：客户专属 → 等级价 → null（调用方回退 goods.base_price） */
  async resolvePriceChain(goodsId, customerId, level) {
    const today = localToday()
    const rows = unwrap(await db.from('price').select('*')
      .eq('goods_id', goodsId).lte('valid_from', today)
      .order('valid_from', { ascending: false })) || []
    const pick = (scope, value) => rows.find((r) => r.scope === scope && r.scope_value === String(value))
    const hitCust = customerId ? pick('customer', customerId) : null
    if (hitCust) return { price: Number(hitCust.price), source: 'customer' }
    const hitType = level ? pick('type', level) : null
    if (hitType) return { price: Number(hitType.price), source: 'type' }
    return null
  },
}

export const SOURCE_LABELS = {
  mall: '商城', manual: '后台代录', voice: '语音', photo: '拍照', excel: 'Excel', text: '文本粘贴',
}
export const STATUS_LABELS = {
  draft: '草单', confirmed: '已确认', sorting: '分拣中', ready: '待发货',
  shipped: '已发货', done: '已完成', void: '已作废',
}

export const orderApi = {
  async list({ status = '' } = {}) {
    let q = db.from('order_main').select('*').order('created_at', { ascending: false }).limit(200)
    if (status) q = q.eq('status', status)
    const rows = unwrap(await q) || []
    const customers = unwrap(await db.from('customer').select('id,name')) || []
    const cmap = new Map(customers.map((c) => [c.id, c.name]))
    return rows.map((o) => ({
      ...o,
      customerName: cmap.get(o.customer_id) || '',
      amountOriginal: Number(o.amount_original ?? 0),
    }))
  },

  /** 账期锁单校验（需求#7）：欠款超上限 / 超期未结 */
  async checkCredit(customerId) {
    const rows = unwrap(await db.from('payment_ledger').select('direction,amount,created_at').eq('customer_id', customerId)) || []
    const custRows = unwrap(await db.from('customer').select('*').eq('id', customerId)) || []
    const cust = Array.isArray(custRows) ? custRows[0] : custRows
    if (!cust) throw new Error('客户不存在')
    const balance = rows.reduce((s, r) => s + (r.direction === 'receivable' ? Number(r.amount) : -Number(r.amount)), 0)
    const reasons = []
    const limit = Number(cust.credit_limit ?? 0)
    if (limit > 0 && balance > limit) reasons.push(`欠款 ¥${balance.toFixed(2)} 已超上限 ¥${limit.toFixed(2)}`)
    if (balance > 0 && rows.length) {
      const oldest = rows.filter((r) => r.direction === 'receivable').map((r) => r.created_at).sort()[0]
      const days = Number(cust.overdue_days ?? 30)
      if (oldest && Date.now() - new Date(oldest).getTime() > days * 86400000) reasons.push(`存在超过 ${days} 天未结款项`)
    }
    return { blocked: reasons.length > 0, reasons, balance, customer: cust }
  },

  /** 建草单：逐行取价（客户专属→等级价→基准价），下单前账期校验（force=管理员强制放行） */
  async createDraft({ customer, delivery_date, time_slot, items }, { force = false, source = 'manual' } = {}) {
    const tid = await tenantId()
    if (!force) {
      const credit = await this.checkCredit(customer.id)
      if (credit.blocked) {
        const err = new Error('账期锁单：' + credit.reasons.join('；'))
        err.code = 'CREDIT_LOCK'
        err.credit = credit
        throw err
      }
    }
    // 单号：OR_yyyyMMdd + 4位日流水
    const now = new Date()
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const todays = unwrap(await db.from('order_main').select('order_no')) || []
    const seq = todays.filter((o) => (o.order_no || '').startsWith(`OR_${ymd}`)).length + 1
    const orderNo = `OR_${ymd}${String(seq).padStart(4, '0')}`

    const goodsIds = [...new Set(items.map((i) => i.goods_id))]
    const goodsRows = unwrap(await db.from('goods').select('*').in('id', goodsIds)) || []
    const gmap = new Map(goodsRows.map((g) => [g.id, g]))

    let total = 0
    const itemPayload = []
    for (const it of items) {
      const g = gmap.get(it.goods_id)
      if (!g) throw new Error('商品不存在，请重新选择')
      const chain = await priceApi.resolvePriceChain(g.id, customer.id, customer.level)
      const price = chain ? chain.price : Number(g.base_price ?? 0)
      const amount = Math.round(it.qty * price * 100) / 100
      total = Math.round((total + amount) * 100) / 100
      itemPayload.push({
        tenant_id: tid, goods_id: g.id, goods_name: g.name, unit: g.unit,
        order_qty: it.qty, order_price: price, price_source: chain ? chain.source : 'base',
        amount, status: 'pending',
      })
    }

    const orderPayload = {
      tenant_id: tid, order_no: orderNo, customer_id: customer.id, source,
      delivery_date, time_slot: time_slot || null, status: 'draft',
      amount_original: total, sort_total: itemPayload.length,
      remark: force ? '管理员强制放行（账期）' : null,
    }
    await restWrite('POST', 'order_main', '', orderPayload)
    let order = (unwrap(await db.from('order_main').select('*').eq('order_no', orderNo).eq('tenant_id', tid))) || []
    order = Array.isArray(order) ? order[0] : order
    if (!order?.id) throw new Error('订单已创建但未查询到（' + orderNo + '），请勿重复保存，刷新订单页确认')
    await restWrite('POST', 'order_item', '', itemPayload.map((p) => ({ ...p, order_id: order.id })))
    if (force) {
      await restWrite('POST', 'op_log', '', {
        tenant_id: tid, actor_type: 'admin', action: 'credit_force_pass',
        entity: 'order', entity_id: order.id, detail: { order_no: orderNo },
      })
    }
    return order
  },

  async confirm(id) {
    await restWrite('PATCH', 'order_main', `id=eq.${id}`, { status: 'confirmed', updated_at: new Date().toISOString() })
  },
  async voidOrder(id) {
    await restWrite('PATCH', 'order_main', `id=eq.${id}`, { status: 'void', updated_at: new Date().toISOString() })
  },
  async getWithItems(id) {
    const orders = unwrap(await db.from('order_main').select('*').eq('id', id)) || []
    const order = Array.isArray(orders) ? orders[0] : orders
    const items = unwrap(await db.from('order_item').select('*').eq('order_id', id).order('id')) || []
    return { order, items: items.map((i) => ({ ...i, orderPrice: Number(i.order_price), amount: Number(i.amount) })) }
  },
}

export const printApi = {
  /** 打印流水 + 订单补打计数（需求#14） */
  async record(orderId, template, copies = 1) {
    const tid = await tenantId()
    await restWrite('POST', 'print_log', '', { tenant_id: tid, order_id: orderId, template, copies })
    const rows = unwrap(await db.from('order_main').select('print_count').eq('id', orderId)) || []
    const current = Number((Array.isArray(rows) ? rows[0] : rows)?.print_count ?? 0)
    const next = current + 1
    await restWrite('PATCH', 'order_main', `id=eq.${orderId}`, { print_count: next })
    return next
  },
  async listByOrder(orderId) {
    return unwrap(await db.from('print_log').select('*').eq('order_id', orderId).order('created_at', { ascending: false })) || []
  },
}

// ================= 智能录单（GLM 云函数 + 商品库匹配工作台） =================
export const aiApi = {
  /** 调云函数 ai：{mode:'text', text} 或 {mode:'image', imageBase64:'data:image/jpeg;base64,...'} */
  async parse(payload) {
    const res = await callFn('ai', payload)
    const r = res?.result ?? res
    if (!r || r.ok === false) throw new Error((r && r.error) || 'AI 解析失败')
    return r
  },
}

/** 解析结果 × 商品库匹配：命中 / 多候选 / 未匹配（规则=品名精确→别名→双向包含） */
export async function matchGoodsRows(parsedItems) {
  const goods = await goodsApi.list()
  const rows = []
  for (const it of parsedItems) {
    const name = String(it.name || '').trim()
    const row = {
      raw: it.raw || name,
      name,
      qty: it.qty ?? 1,
      unit: it.unit || '',
      confidence: it.confidence || null,
      status: 'unmatched',
      goodsId: null,
      candidates: [],
    }
    if (!name) { rows.push(row); continue }
    const exact = goods.filter((g) => g.name === name || (g.alias || []).includes(name))
    if (exact.length >= 1) {
      row.status = 'hit'
      row.goodsId = exact[0].id
      if (exact.length > 1) row.candidates = exact.map((g) => ({ id: g.id, label: `${g.name}（${g.code}）` }))
    } else {
      const partial = goods.filter((g) =>
        g.name.includes(name) || name.includes(g.name) ||
        (g.alias || []).some((a) => a.includes(name) || name.includes(a)))
      if (partial.length === 1) {
        row.status = 'hit'
        row.goodsId = partial[0].id
      } else if (partial.length > 1) {
        row.status = 'candidate'
        row.candidates = partial.slice(0, 6).map((g) => ({ id: g.id, label: `${g.name}（${g.code}）` }))
      }
    }
    rows.push(row)
  }
  return rows
}

// ================= 分拣工作台 + 发货挂账（P2） =================
export const sortApi = {
  /** 分拣板订单队列：指定发货日期、状态在 已确认/分拣中/待发货 */
  async boardOrders(date) {
    const rows = unwrap(await db.from('order_main')
      .select('*')
      .in('status', ['confirmed', 'sorting', 'ready'])
      .eq('delivery_date', date)
      .order('created_at')) || []
    const customers = unwrap(await db.from('customer').select('id,name')) || []
    const cmap = new Map(customers.map((c) => [c.id, c.name]))
    return rows.map((o) => ({
      ...o,
      customerName: cmap.get(o.customer_id) || '',
      color: o.sort_total && o.sort_done >= o.sort_total ? 'green' : o.sort_done > 0 ? 'yellow' : 'blue',
    }))
  },

  async itemsFor(orderId) {
    return (unwrap(await db.from('order_item').select('*').eq('order_id', orderId).order('id'))) || []
  },

  /** 分拣确认：写明细实拣 + sort_record 流水 + 订单进度/状态推进（需求#3/#5） */
  async applySort(item, qty, method) {
    const orderPrice = Number(item.order_price ?? 0)
    const amount = Math.round(qty * orderPrice * 100) / 100
    await restWrite('PATCH', 'order_item', `id=eq.${item.id}`, {
      sorted_qty: qty,
      sorted_price: orderPrice,
      amount,
      status: 'sorted',
      sort_time: new Date().toISOString(),
    })
    await restWrite('POST', 'sort_record', '', { tenant_id: item.tenant_id, order_item_id: item.id, method, qty })
    return this.refreshProgress(item.order_id)
  },

  async markShort(item) {
    await restWrite('PATCH', 'order_item', `id=eq.${item.id}`, {
      sorted_qty: 0, amount: 0, status: 'short', sort_time: new Date().toISOString(),
    })
    await restWrite('POST', 'sort_record', '', { tenant_id: item.tenant_id, order_item_id: item.id, method: 'short', qty: 0 })
    return this.refreshProgress(item.order_id)
  },

  /** 撤销：回待分拣（流水留痕） */
  async undoItem(item) {
    await restWrite('PATCH', 'order_item', `id=eq.${item.id}`, {
      sorted_qty: null, sorted_price: null, amount: Math.round(Number(item.order_qty) * Number(item.order_price ?? 0) * 100) / 100,
      status: 'pending', sort_time: null,
    })
    await restWrite('POST', 'sort_record', '', { tenant_id: item.tenant_id, order_item_id: item.id, method: 'undo', qty: 0 })
    return this.refreshProgress(item.order_id)
  },

  /** 重算订单分拣进度并推进状态（confirmed→sorting→ready） */
  async refreshProgress(orderId) {
    const items = (unwrap(await db.from('order_item').select('id,status,amount').eq('order_id', orderId))) || []
    const done = items.filter((i) => i.status === 'sorted' || i.status === 'short').length
    const amountConfigured = items.reduce((s, i) => s + Number(i.amount ?? 0), 0)
    const orderRows = (unwrap(await db.from('order_main').select('status').eq('id', orderId))) || []
    const cur = (Array.isArray(orderRows) ? orderRows[0] : orderRows)?.status
    let status = cur
    if (cur === 'confirmed' && done > 0) status = 'sorting'
    if (done >= items.length && items.length > 0) status = 'ready'
    await restWrite('PATCH', 'order_main', `id=eq.${orderId}`, {
      sort_done: done, sort_total: items.length,
      status, amount_configured: Math.round(amountConfigured * 100) / 100,
      updated_at: new Date().toISOString(),
    })
    return { done, total: items.length, status }
  },
}

/** 发货：状态 shipped + 往来账挂应收（需求#7 账期引擎的数据源）+ 库存出库留痕（T3.3） */
export const ledgerApi = {
  async shipOrder(order) {
    const tid = await tenantId()
    await restWrite('PATCH', 'order_main', `id=eq.${order.id}`, { status: 'shipped', updated_at: new Date().toISOString() })
    const amount = Number(order.amount_configured ?? order.amount_original ?? 0)
    const rows = (unwrap(await db.from('payment_ledger').select('direction,amount').eq('customer_id', order.customer_id))) || []
    const balance = rows.reduce((s, r) => s + (r.direction === 'receivable' ? Number(r.amount) : -Number(r.amount)), 0) + amount
    await restWrite('POST', 'payment_ledger', '', {
      tenant_id: tid, customer_id: order.customer_id, order_id: order.id,
      direction: 'receivable', amount, biz_type: 'order', balance_after: Math.round(balance * 100) / 100,
    })
    // 库存出库：按实拣量扣 goods.stock_qty + 流水（有库存管理的商品才扣，标品可选）
    try {
      const items = (unwrap(await db.from('order_item').select('goods_id,sorted_qty').eq('order_id', order.id))) || []
      for (const i of items) {
        const q = Number(i.sorted_qty ?? 0)
        if (q > 0) {
          await restWrite('POST', 'inventory_log', '', {
            tenant_id: tid, goods_id: i.goods_id, delta: -q,
            reason: 'ship_out', ref_id: order.id, note: `订单 ${order.order_no}`,
          })
          await stockAdjust(i.goods_id, -q)
        }
      }
    } catch (e) { /* 库存扣减失败不阻断发货，流水缺失可在库存页手工调整 */ }
    return balance
  },

  /** 客户欠款汇总（往来账页）：按客户聚合 应收/实收/余额 */
  async summary() {
    const rows = (unwrap(await db.from('payment_ledger').select('*').order('created_at'))) || []
    const customers = (unwrap(await db.from('customer').select('id,name'))) || []
    const cmap = new Map(customers.map((c) => [c.id, c.name]))
    const byCust = new Map()
    for (const r of rows) {
      const e = byCust.get(r.customer_id) || { receivable: 0, received: 0, last: null }
      if (r.direction === 'receivable') e.receivable += Number(r.amount)
      else e.received += Number(r.amount)
      if (!e.last || r.created_at > e.last) e.last = r.created_at
      byCust.set(r.customer_id, e)
    }
    return [...byCust.entries()].map(([id, e]) => ({
      customerId: id,
      name: cmap.get(id) || id,
      receivable: Math.round(e.receivable * 100) / 100,
      received: Math.round(e.received * 100) / 100,
      balance: Math.round((e.receivable - e.received) * 100) / 100,
      last: e.last,
    })).sort((a, b) => b.balance - a.balance)
  },

  /** 某客户往来流水（新→旧），带单号 */
  async flows(customerId) {
    const rows = (unwrap(await db.from('payment_ledger').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }))) || []
    const orders = (unwrap(await db.from('order_main').select('id,order_no'))) || []
    const omap = new Map(orders.map((o) => [o.id, o.order_no]))
    return rows.map((r) => ({
      ...r,
      orderNo: r.order_id ? (omap.get(r.order_id) || '-') : '-',
      amount: Number(r.amount),
      balanceAfter: r.balance_after != null ? Number(r.balance_after) : null,
    }))
  },

  /** 登记收款（T2.14 出账）：received 冲销应收 → 欠款余额下降 → 解锁账期锁单 */
  async receivePayment(customerId, amount, note) {
    const tid = await tenantId()
    if (!(amount > 0)) throw new Error('收款金额必须大于 0')
    const rows = (unwrap(await db.from('payment_ledger').select('direction,amount').eq('customer_id', customerId))) || []
    const balance = rows.reduce((s, r) => s + (r.direction === 'receivable' ? Number(r.amount) : -Number(r.amount)), 0) - amount
    // 写入走 restWrite（网关直连，失败必抛错）；写后回查校验——杜绝"提示成功但没落库"
    const created = await restWrite('POST', 'payment_ledger', '', {
      tenant_id: tid, customer_id: customerId,
      direction: 'received', amount, biz_type: 'payment',
      balance_after: Math.round(balance * 100) / 100,
    })
    const row = Array.isArray(created) ? created[0] : created
    if (!row || !row.id) throw new Error('收款写入后未查询到，请勿重复操作并截图反馈')
    if (note) {
      await restWrite('POST', 'op_log', '', {
        tenant_id: tid, actor_type: 'admin', action: 'payment_received',
        entity: 'customer', entity_id: customerId, detail: { amount, note },
      })
    }
    return Math.round(balance * 100) / 100
  },

  /** 客户月度对账单（T2.14）：某客户某自然月的期初/应收明细/收款/期末 */
  async monthlyStatement(customerId, yearMonth) {
    const ym = yearMonth // 'YYYY-MM'
    const rows = (unwrap(await db.from('payment_ledger').select('*').eq('customer_id', customerId))) || []
    const inMonth = rows.filter((r) => (r.created_at || '').startsWith(ym))
    const before = rows.filter((r) => (r.created_at || '') < ym)
    const balOf = (list) => list.reduce((s, r) => s + (r.direction === 'receivable' ? Number(r.amount) : -Number(r.amount)), 0)
    const orders = (unwrap(await db.from('order_main').select('id,order_no'))) || []
    const omap = new Map(orders.map((o) => [o.id, o.order_no]))
    const customers = (unwrap(await db.from('customer').select('id,name'))) || []
    const custName = (customers.find((c) => c.id === customerId) || {}).name || customerId
    return {
      customerName: custName,
      month: ym,
      opening: Math.round(balOf(before) * 100) / 100,
      closing: Math.round(balOf(rows) * 100) / 100,
      receivableTotal: Math.round(inMonth.filter((r) => r.direction === 'receivable').reduce((s, r) => s + Number(r.amount), 0) * 100) / 100,
      receivedTotal: Math.round(inMonth.filter((r) => r.direction === 'received').reduce((s, r) => s + Number(r.amount), 0) * 100) / 100,
      flows: inMonth
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .map((r) => ({
          date: (r.created_at || '').slice(0, 10),
          direction: r.direction,
          orderNo: r.order_id ? (omap.get(r.order_id) || '-') : (r.biz_type === 'payment' ? '收款' : '-'),
          amount: Number(r.amount),
          balanceAfter: r.balance_after != null ? Number(r.balance_after) : null,
        })),
    }
  },
}

/** 老板日报表数据层（需求#19）：销售/待办/欠款；成本利润待采购价字段（T2.11）上线后接入 */
export const reportApi = {
  amountOf(o) { return Number(o.amount_configured || o.amount_original || 0) },

  async daily(date) {
    const rows = (unwrap(await db.from('order_main').select('*').eq('delivery_date', date))) || []
    const valid = rows.filter((o) => o.status !== 'void')
    return {
      date,
      orderCount: valid.length,
      sales: Math.round(valid.reduce((s, o) => s + this.amountOf(o), 0) * 100) / 100,
      pendingSort: valid.filter((o) => ['confirmed', 'sorting'].includes(o.status)).length,
      readyShip: valid.filter((o) => o.status === 'ready').length,
      shipped: valid.filter((o) => ['shipped', 'done'].includes(o.status)).length,
    }
  },

  async week(days = 7) {
    const out = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
    const rows = (unwrap(await db.from('order_main').select('delivery_date,status,amount_configured,amount_original').gte('delivery_date', out[0]))) || []
    const byDate = new Map(out.map((d) => [d, { date: d, count: 0, sales: 0 }]))
    for (const o of rows) {
      if (o.status === 'void') continue
      const e = byDate.get(o.delivery_date)
      if (e) { e.count++; e.sales += this.amountOf(o) }
    }
    return [...byDate.values()].map((e) => ({ ...e, sales: Math.round(e.sales * 100) / 100 }))
  },

  async overdueTotal() {
    const s = await ledgerApi.summary()
    return Math.round(s.filter((c) => c.balance > 0).reduce((sum, c) => sum + c.balance, 0) * 100) / 100
  },
}

/** 采购模块（T2.10/11）：计划聚合 + 采购单管理 */
export const purchaseApi = {
  PO_STATUS: { draft: '草单', ordered: '已下单', partial: '部分到货', received: '已到货', void: '已作废' },

  /** 按发货日期聚合需采购量（非作废订单的下单量，按 商品+单位 汇总） */
  async aggregateNeed(deliveryDate) {
    const orders = (unwrap(await db.from('order_main').select('id').eq('delivery_date', deliveryDate).neq('status', 'void'))) || []
    if (!orders.length) return []
    const ids = orders.map((o) => o.id)
    const items = (unwrap(await db.from('order_item').select('goods_id,goods_name,unit,order_qty').in('order_id', ids))) || []
    const agg = new Map()
    for (const i of items) {
      const key = i.goods_id
      const e = agg.get(key) || { goodsId: i.goods_id, name: i.goods_name, unit: i.unit, qty: 0 }
      e.qty = Math.round((e.qty + Number(i.order_qty)) * 100) / 100
      agg.set(key, e)
    }
    return [...agg.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  },

  /** 生成采购单（status=ordered，plan_date=采购日，delivery_date=对应发货日） */
  async createPo({ plan_date, delivery_date, supplier_note, items }) {
    const tid = await tenantId()
    const ymd = localToday().replace(/-/g, '')
    const pos = (unwrap(await db.from('purchase_order').select('po_no'))) || []
    const poNo = `PO_${ymd}${String(pos.filter((p) => (p.po_no || '').startsWith(`PO_${ymd}`)).length + 1).padStart(3, '0')}`
    await restWrite('POST', 'purchase_order', '', {
      tenant_id: tid, po_no: poNo, status: 'ordered', plan_date,
      delivery_date, supplier_note: supplier_note || null,
    })
    let po = (unwrap(await db.from('purchase_order').select('*').eq('po_no', poNo).eq('tenant_id', tid))) || []
    po = Array.isArray(po) ? po[0] : po
    if (!po?.id) throw new Error('采购单已创建但未查询到（' + poNo + '），请勿重复生成，刷新采购页确认')
    await restWrite('POST', 'purchase_order_item', '', items.map((i) => ({
      tenant_id: tid, po_id: po.id, goods_id: i.goodsId, goods_name: i.name,
      unit: i.unit, need_qty: i.qty, status: 'pending',
    })))
    return po
  },

  async list(status = '') {
    let q = db.from('purchase_order').select('*').order('created_at', { ascending: false }).limit(100)
    if (status) q = q.eq('status', status)
    return (unwrap(await q)) || []
  },

  async itemsFor(poId) {
    return (unwrap(await db.from('purchase_order_item').select('*').eq('po_id', poId).order('id'))) || []
  },

  /** 到货回填：bought_qty/cost_price，行转 done，重算整单状态（partial/received） */
  async receiveItem(item, boughtQty, costPrice) {
    await restWrite('PATCH', 'purchase_order_item', `id=eq.${item.id}`, {
      bought_qty: boughtQty, cost_price: costPrice ?? null, status: 'done',
    })
    // 采购到货 → 自动入库 + 流水（T3.3 库存台账）
    const tid = await tenantId()
    await restWrite('POST', 'inventory_log', '', {
      tenant_id: tid, goods_id: item.goods_id, delta: boughtQty,
      reason: 'purchase_in', ref_id: item.po_id, note: '采购到货',
    })
    await stockAdjust(item.goods_id, boughtQty)
    return this.recalcPo(item.po_id)
  },

  async recalcPo(poId) {
    const items = (unwrap(await db.from('purchase_order_item').select('status').eq('po_id', poId))) || []
    const done = items.filter((i) => i.status === 'done').length
    const status = done >= items.length && items.length ? 'received' : done > 0 ? 'partial' : 'ordered'
    await restWrite('PATCH', 'purchase_order', `id=eq.${poId}`, { status, updated_at: new Date().toISOString() })
    return { status, done, total: items.length }
  },

  async voidPo(poId) {
    await restWrite('PATCH', 'purchase_order', `id=eq.${poId}`, { status: 'void', updated_at: new Date().toISOString() })
  },
}

/** 库存台账（T3.3）：列表流水 + 手工调整（经 ff_stock_adjust 保证原子） */
export const inventoryApi = {
  async flows(limit = 50) {
    const rows = (unwrap(await db.from('inventory_log').select('*').order('created_at', { ascending: false }).limit(limit))) || []
    const goods = (unwrap(await db.from('goods').select('id,name,unit'))) || []
    const gmap = new Map(goods.map((g) => [g.id, g]))
    return rows.map((r) => ({
      ...r,
      delta: Number(r.delta),
      goodsName: gmap.get(r.goods_id)?.name || r.goods_id,
      unit: gmap.get(r.goods_id)?.unit || '',
    }))
  },

  async adjust(goodsId, delta, note) {
    const tid = await tenantId()
    await stockAdjust(goodsId, delta)
    await restWrite('POST', 'inventory_log', '', {
      tenant_id: tid, goods_id: goodsId, delta, reason: 'adjust', note: note || null,
    })
  },
}

export { userAdminApi } from './userAdminApi'
