/**
 * T1.5 余项：收货地址多行管理（customer_address 表 + RLS 已就位）
 * 后台：客户编辑弹窗内嵌地址列表（增删改 + 设默认）
 * 商城：下单时选择地址（写进 order_main.remark 头部，分拣/送货单可见）
 */
import { db } from '@/lib/cloudbase'

function unwrap(res) {
  const r = res ?? {}
  if (r.error) throw new Error(r.error.message || String(r.error))
  if (res === undefined || res === null) throw new Error('请求无响应（会话可能已过期），请刷新重新登录')
  return r.data
}

async function gw(method, table, query, body) {
  const { auth, CLOUDBASE_ENV_ID } = await import('@/lib/cloudbase')
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

export const addressApi = {
  async listByCustomer(customerId) {
    const rows = (unwrap(await db.from('customer_address').select('*').eq('customer_id', customerId).order('id'))) || []
    return rows
  },

  async listAll() {
    return (unwrap(await db.from('customer_address').select('*').order('customer_id,id'))) || []
  },

  async save({ id, customer_id, contact, phone, address, is_default }) {
    if (!customer_id) throw new Error('缺少客户')
    if (!String(address || '').trim()) throw new Error('地址不能为空')
    const payload = {
      customer_id,
      contact: contact || null,
      phone: phone || null,
      address: String(address).trim(),
      is_default: is_default === true,
    }
    if (id) {
      await gw('PATCH', 'customer_address', `id=eq.${id}`, payload)
    } else {
      const tidRows = (unwrap(await db.from('tenant').select('id').limit(1))) || []
      const tid = (Array.isArray(tidRows) ? tidRows[0] : tidRows)?.id
      await gw('POST', 'customer_address', '', { ...payload, tenant_id: tid })
    }
    // 设默认：同客户其它地址取消默认
    if (payload.is_default) {
      const others = (unwrap(await db.from('customer_address').select('id').eq('customer_id', customer_id))) || []
      for (const o of others) {
        if (o.id !== id && o.is_default) {
          await gw('PATCH', 'customer_address', `id=eq.${o.id}`, { is_default: false })
        }
      }
    }
    return true
  },

  async remove(id) {
    await gw('DELETE', 'customer_address', `id=eq.${id}`)
    return true
  },
}
