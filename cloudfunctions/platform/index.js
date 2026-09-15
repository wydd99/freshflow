// FreshFlow · 云函数 platform：平台总后台（T3.4 白牌多租户）
// 平台方（PLATFORM_UIDS 白名单内的账号）跨租户查看/管理所有租户。
// 通道：HTTP 云接入 /platform；身份=调用者 access_token（RLS 借道解析）；数据=环境 API Key（service_role 跨租户）。
// 环境变量：
//   PLATFORM_UIDS    平台方账号 uid 白名单（逗号分隔；演示期=administrator，正式期换成你自己的账号）
//   PLATFORM_APIKEY  环境 API Key（与 authgate 同一个即可）
// 约束：租户数据只读（统计）+ 租户状态（active/suspended）；绝不修改租户业务数据。
// 9/15 新增：create_tenant 新建租户向导（运维专属：白名单硬校验，商家绝不可达）。

const crypto = require('crypto')

const ENV_ID = 'freshflow-ENV_ID'
const GW = 'https://' + ENV_ID + '.api.tcloudbasegateway.com'
const TCB_API = 'https://tcb.tencentcloudapi.com/'

// ---------- TC3 签名（与 useradmin/ai 同款；建租户时用 SCF 运行时临时凭据建 Auth 用户） ----------
function hmac(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest() }
async function tcbRequest(action, payload) {
  const secretId = process.env.TENCENTCLOUD_SECRETID
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN || ''
  if (!secretId || !secretKey) throw new Error('函数运行时缺少临时凭据（请在云函数环境运行）')
  const body = JSON.stringify(payload)
  const service = 'tcb'
  const host = 'tcb.tencentcloudapi.com'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalRequest = ['POST', '/', '',
    'content-type:application/json; charset=utf-8\nhost:' + host + '\nx-tc-action:' + action.toLowerCase() + '\n',
    'content-type;host;x-tc-action',
    crypto.createHash('sha256').update(body).digest('hex')].join('\n')
  const stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + date + '/' + service + '/tc3_request\n' +
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  const kDate = hmac('TC3' + secretKey, date)
  const kService = hmac(kDate, service)
  const kSigning = hmac(kService, 'tc3_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const r = await fetch(TCB_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Version': '2018-06-08',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': 'ap-shanghai',
      ...(token ? { 'X-TC-Token': token } : {}),
      Authorization: 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + date + '/' + service + '/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=' + signature,
    },
    body,
  })
  const data = await r.json().catch(() => ({}))
  if (data.Response && data.Response.Error) throw new Error(data.Response.Error.Code + ': ' + data.Response.Error.Message)
  return data.Response || {}
}

// service_role 写（service_key 专用：平台专属特权写，仅本函数内使用）
async function svcInsert(table, body) {
  const r = await fetch(GW + '/v1/rdb/rest/' + table, {
    method: 'POST',
    headers: { ...svcHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error('svc 写入 ' + table + ' HTTP ' + r.status + ' ' + t.slice(0, 150))
  }
  return r.json().catch(() => [])
}

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

    // ===== 新建租户向导（运维专属）：商家名+管理员账号+初始密码 → 租户/Auth外部用户/映射/分类种子 一键建齐 =====
    if (action === 'create_tenant') {
      const name = String(src.name || '').trim()
      const username = String(src.username || '').trim()
      const password = String(src.password || '')
      const phoneVerify = src.phone_verify !== false // 默认开安全模式
      const seedCategories = src.seed !== false // 默认复制标准分类种子
      if (!name) throw new Error('缺少商家名称')
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/.test(username)) throw new Error('管理员账号 2-48 位，字母数字开头，仅 . _ -')
      if (typeof password !== 'string' || password.length < 8 || password.length > 32) throw new Error('密码 8-32 位')
      const kinds = [
        /[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[()!@#$%^&*|?><_-]/.test(password),
      ].filter(Boolean).length
      if (kinds < 3) throw new Error('密码需大写/小写/数字/特殊字符至少 3 类')
      if (name.length > 40) throw new Error('商家名称过长（≤40 字）')

      // 0) 同名租户查重（白名单已过，service_role 可查全表）
      const dup = await svcGet('tenant', 'select=id&name=eq.' + encodeURIComponent(name))
      if (Array.isArray(dup) && dup.length) throw new Error('已存在同名租户：' + name)
      const dupAdmin = await svcGet('admin_user', 'select=id&username=eq.' + encodeURIComponent(username))
      if (Array.isArray(dupAdmin) && dupAdmin.length) throw new Error('管理员账号已存在，请换一个')

      // 1) 建租户（features.phone_verify 按选择；brand 默认=商家名）
      const tRows = await svcInsert('tenant', {
        name,
        brand: { name, short: name.slice(0, 4), contact: '' },
        features: { audit: true, returns: true, phone_verify: phoneVerify },
      })
      const tenant = (Array.isArray(tRows) ? tRows[0] : tRows) || {}
      if (!tenant.id) throw new Error('租户创建后未返回 id，请检查后手工补')

      try {
        // 2) 建管理员 Auth 用户（外部用户，不占内部配额；Description ≤64 字符是平台实测坑）
        const desc = 'FF merchant (' + (username.length > 20 ? username.slice(0, 20) : username) + ')'
        const resp = await tcbRequest('CreateUser', {
          EnvId: ENV_ID, Name: username, Password: password,
          NickName: name, Description: desc, Type: 'externalUser',
        })
        const uid = (resp && resp.Data && resp.Data.Uid) || (resp && resp.Uid)
        if (!uid) throw new Error('平台未返回用户 uid')

        // 3) 绑定商家映射（boss）
        await svcInsert('admin_user', {
          tenant_id: tenant.id, uid, username,
          password_hash: 'managed-by-cloudbase-auth',
          display_name: name.slice(0, 20), role: 'boss', status: 'active',
        })

        // 4) 分类种子（从租户 2 复制标准七分类；该租户无数据时跳过）
        if (seedCategories) {
          const cats = await svcGet('goods_category', 'select=name,sort&tenant_id=eq.2&order=sort')
          for (const c of (Array.isArray(cats) ? cats : [])) {
            await svcInsert('goods_category', { tenant_id: tenant.id, name: c.name, sort: c.sort })
          }
        }

        return { ok: true, tenant_id: tenant.id, name, username, uid, phone_verify: phoneVerify }
      } catch (e) {
        // 半途失败回滚租户行，避免残留半成品（Auth 用户若已建则保留，重跑前先删）
        try { await svcPatch('tenant', 'id=eq.' + tenant.id, { status: 'suspended' }) } catch (e2) { /* 忽略 */ }
        throw new Error('建租户中途失败已停用残留租户（id=' + tenant.id + '）：' + String((e && e.message) || e))
      }
    }

    throw new Error('未知操作：' + (action || '(空)'))
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}
