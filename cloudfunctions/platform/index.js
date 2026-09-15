// FreshFlow · 云函数 platform：平台总后台（T3.4 白牌多租户）
// 平台方（PLATFORM_UIDS 白名单内的账号）跨租户查看/管理所有租户。
// 通道：HTTP 云接入 /platform；身份=调用者 access_token（RLS 借道解析）；数据=环境 API Key（service_role 跨租户）。
// 环境变量：
//   PLATFORM_UIDS    平台方账号 uid 白名单（逗号分隔；演示期=merchant_a，正式期换成你自己的账号）
//   PLATFORM_APIKEY  环境 API Key（与 authgate 同一个即可）
// 约束：租户数据只读（统计）+ 租户状态（active/suspended）；绝不修改租户业务数据。

const ENV_ID = 'freshflow-ENV_ID'
const GW = 'https://' + ENV_ID + '.api.tcloudbasegateway.com'

function svcHeaders() {
  const key = process.env.PLATFORM_APIKEY || process.env.AUTHGATE_APIKEY || ''
  if (!key) throw new Error('服务端密钥未配置（PLATFORM_APIKEY）')
  return { Authorization: ['Bea', 'rer ', ''].join('') + key, 'Content-Type': 'application/json', Prefer: 'return=representation' }
}
async function svcGet(table, query) {
  const r = await fetch(GW + '/v1/rdb/rest/' + table + '?' + query, { headers: svcHeaders() })
  if (!r.ok) throw new Error('svc 查询 ' + table + ' HTTP ' + r.status)
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) ? rows : []
}
async function svcPatch(table, query, body) {
  const r = await fetch(GW + '/v1/rdb/rest/' + table + '?' + query, { method: 'PATCH', headers: svcHeaders(), body: JSON.stringify(body) })
  if (!r.ok) throw new Error('svc 更新 ' + table + ' HTTP ' + r.status)
  return true
}

async function resolveCaller(accessToken) {
  if (!accessToken) throw new Error('未登录（缺少 access_token）')
  const r = await fetch(GW + '/v1/rdb/rest/admin_user?select=id,uid,username,tenant_id&limit=1', {
    headers: { Authorization: ['Bea', 'rer ', ''].join('') + accessToken },
  })
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? '登录已失效，请刷新页面重新登录' : '身份校验失败 HTTP ' + r.status)
  const rows = await r.json().catch(() => [])
  const me = Array.isArray(rows) ? rows[0] : null
  if (!me || !me.uid) throw new Error('仅管理员账号可访问平台后台')
  return me
}
function isPlatform(uid) {
  const list = String(process.env.PLATFORM_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean)
  return list.includes(String(uid))
}

async function count(table, tenantId) {
  const rows = await svcGet(table, 'select=id&tenant_id=eq.' + tenantId + '&limit=1000')
  return rows.length
}

exports.main = async (event) => {
  let src = event
  if (src && typeof src.body === 'string' && src.action === undefined) {
    try { src = JSON.parse(src.body) } catch (e) { /* 保持原样 */ }
  }
  const action = String((src && src.action) || '')
  const accessToken = String((src && src.access_token) || '')

  try {
    const caller = await resolveCaller(accessToken)
    if (action === 'whoami') {
      return { ok: true, isPlatform: isPlatform(caller.uid), username: caller.username }
    }
    if (!isPlatform(caller.uid)) throw new Error('仅平台方可操作')

    if (action === 'list_tenants') {
      const tenants = await svcGet('tenant', 'select=id,name,brand,plan,quotas,features,status&order=id')
      const out = []
      for (const t of tenants) {
        const [customerUsers, customers, orders, admins] = await Promise.all([
          count('customer_user', t.id),
          count('customer', t.id),
          count('order_main', t.id),
          count('admin_user', t.id),
        ])
        out.push({
          id: t.id, name: t.name, brand: t.brand || {}, plan: t.plan || 'trial',
          quotas: t.quotas || {}, status: t.status || 'active',
          stats: { customer_users: customerUsers, customers, orders, admins },
        })
      }
      return { ok: true, tenants: out }
    }

    // 账号总览：全平台账号清单（商家/员工 + 顾客），标注所属租户与客户——平台方直观对账用
    if (action === 'list_accounts') {
      const [admins, custUsers, customers, tenants] = await Promise.all([
        svcGet('admin_user', 'select=id,tenant_id,username,display_name,role,status,uid&order=id'),
        svcGet('customer_user', 'select=id,tenant_id,username,display_name,customer_id,status,uid&order=id'),
        svcGet('customer', 'select=id,tenant_id,name,level&order=id'),
        svcGet('tenant', 'select=id,name'),
      ])
      const tMap = new Map(tenants.map((t) => [t.id, t]))
      const cMap = new Map(customers.map((c) => [c.id, c]))
      const accounts = [
        ...admins.map((a) => ({
          kind: '商家/员工', username: a.username, display: a.display_name || a.username,
          role: a.role || '', tenant_id: a.tenant_id,
          tenant: (tMap.get(a.tenant_id) || {}).name || String(a.tenant_id),
          customer: '', status: a.status || '', uid: a.uid || '',
        })),
        ...custUsers.map((c) => {
          const cu = cMap.get(c.customer_id) || {}
          return {
            kind: '顾客', username: c.username, display: c.display_name || cu.name || c.username,
            role: 'customer', tenant_id: c.tenant_id,
            tenant: (tMap.get(c.tenant_id) || {}).name || String(c.tenant_id),
            customer: cu.name || String(c.customer_id), status: c.status || '', uid: c.uid || '',
          }
        }),
      ]
      return { ok: true, accounts }
    }

    if (action === 'set_status') {
      const tid = Number(src.id)
      const st = String(src.status || '')
      if (!tid) throw new Error('缺少租户 id')
      if (!['active', 'suspended'].includes(st)) throw new Error('状态仅支持 active / suspended')
      await svcPatch('tenant', 'id=eq.' + tid, { status: st })
      return { ok: true, id: tid, status: st }
    }

    throw new Error('未知操作：' + (action || '(空)'))
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}
