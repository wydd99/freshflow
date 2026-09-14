// FreshFlow · 云函数 useradmin：管理边界（T2.13）
// 职责：租户管理员（admin_user，RLS 强制本租户）在后台自助执行 Auth 用户管理——
//       创建店家子账号（Auth 用户 + customer_user 映射行）、重置密码、停用/启用、解绑。
// 架构：Event Function（仅 web-admin 经 app.callFunction 调用，不绑 HTTP 路由）。
//   - 管理面调用：腾讯云 tcb 服务（2018-06-08）CreateUser / ModifyUser，TC3-HMAC-SHA256 手写签名。
//   - 凭据：云函数运行时临时密钥（TENCENTCLOUD_SECRETID/KEY/SESSIONTOKEN），不落任何长期密钥。
//   - 授权：RLS 借道——前端传自己的 access_token + device_id，本函数用它查 admin_user（网关 REST，
//     RLS 只可能返回调用者自己租户的管理员行）。查不到管理员行 = 拒绝。
// 坑（实测）：网关 Auth 会话与设备绑定，跨设备裸 token 一律 401 —— 所有网关请求必须带原设备 x-device-id。
// 安全：密码仅出现在出站请求体（TLS），不写日志不落库；出站目标为字面量官方域名。

const crypto = require('crypto')

const ENV_ID = 'freshflow-ENV_ID'
const TCB_API = 'https://tcb.tencentcloudapi.com/'
const GW_BASE = 'https://' + ENV_ID + '.api.tcloudbasegateway.com'

// ---------- TC3 签名（腾讯云 API 通用，与 ai 函数同款实现） ----------
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

  // canonicalHeaders 自带尾换行（官方 join 写法）→ 与 signedHeaders 列表之间形成双换行
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
  if (data.Response && data.Response.Error) {
    const code = data.Response.Error.Code
    if (code === 'LimitExceeded') throw new Error('体验版套餐用户数已达上限，需升级套餐或联系运维清理账号')
    if (code === 'UnauthorizedOperation' || code.indexOf('AuthFailure') === 0 || code === 'AuthFailure') throw new Error('平台权限不足(' + code + ')，请联系运维为云函数角色授权用户管理权限')
    throw new Error(code + ': ' + data.Response.Error.Message)
  }
  return data.Response || {}
}

// ---------- 网关 REST（统一带设备头） ----------
function gwHeaders(accessToken, deviceId, extra) {
  const h = { Authorization: 'Bearer ' + accessToken, 'x-device-id': deviceId || 'ff-server' }
  return Object.assign(h, extra || {})
}

// ---------- RLS 借道：验证调用者是 admin_user ----------
async function verifyAdmin(accessToken, deviceId) {
  if (!accessToken) throw new Error('未登录（缺少 access_token）')
  const r = await fetch(GW_BASE + '/v1/rdb/rest/admin_user?select=uid,username,role,tenant_id&limit=1', {
    headers: gwHeaders(accessToken, deviceId),
  })
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error('登录已失效或无管理员权限，请刷新页面重新登录')
    throw new Error('身份校验失败 HTTP ' + r.status)
  }
  const rows = await r.json().catch(() => [])
  const admin = Array.isArray(rows) ? rows[0] : null
  if (!admin || !admin.uid) throw new Error('非管理员账号，无法使用用户管理功能')
  return admin // { uid, username, role, tenant_id }
}

// ---------- PG 行操作（网关 REST，RLS 已验证身份） ----------
async function pgInsert(table, body, accessToken, deviceId) {
  const r = await fetch(GW_BASE + '/v1/rdb/rest/' + table, {
    method: 'POST',
    headers: gwHeaders(accessToken, deviceId, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    throw new Error(b.message || ('写入 ' + table + ' 失败 HTTP ' + r.status))
  }
  return r.json().catch(() => [])
}
async function pgList(table, query, accessToken, deviceId) {
  const r = await fetch(GW_BASE + '/v1/rdb/rest/' + table + '?' + query, {
    headers: gwHeaders(accessToken, deviceId),
  })
  if (!r.ok) throw new Error('查询 ' + table + ' 失败 HTTP ' + r.status)
  return r.json().catch(() => [])
}
async function pgPatch(table, query, body, accessToken, deviceId) {
  const r = await fetch(GW_BASE + '/v1/rdb/rest/' + table + '?' + query, {
    method: 'PATCH',
    headers: gwHeaders(accessToken, deviceId, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    throw new Error(b.message || ('更新 ' + table + ' 失败 HTTP ' + r.status))
  }
  return r.json().catch(() => [])
}
async function pgDelete(table, query, accessToken, deviceId) {
  const r = await fetch(GW_BASE + '/v1/rdb/rest/' + table + '?' + query, {
    method: 'DELETE',
    headers: gwHeaders(accessToken, deviceId, { Prefer: 'return=representation' }),
  })
  if (!r.ok) throw new Error('删除 ' + table + ' 失败 HTTP ' + r.status)
  return r.json().catch(() => [])
}

// ---------- 输入校验（与平台规则对齐） ----------
function validateUsername(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/.test(name || '')) {
    throw new Error('用户名 2-48 位，字母或数字开头，仅支持字母数字及 . _ - （不支持中文）')
  }
}
function validatePassword(pwd) {
  if (typeof pwd !== 'string' || pwd.length < 8 || pwd.length > 32) {
    throw new Error('密码 8-32 位')
  }
  if (!/^[A-Za-z0-9]/.test(pwd)) throw new Error('密码不能以特殊字符开头')
  const kinds = [
    /[a-z]/.test(pwd), /[A-Z]/.test(pwd), /[0-9]/.test(pwd), /[()!@#$%^&*|?><_-]/.test(pwd),
  ].filter(Boolean).length
  if (kinds < 3) throw new Error('密码需包含大写、小写、数字、特殊字符中至少 3 类')
}
function validatePhone(phone) {
  if (phone && !/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确（11 位）')
}

// ---------- 主入口 ----------
exports.main = async (event) => {
  let src = event
  if (src && typeof src.body === 'string' && src.action === undefined) {
    try { src = JSON.parse(src.body) } catch (e) { /* 保持原样 */ }
  }
  const action = String((src && src.action) || '')
  const accessToken = String((src && src.access_token) || '')
  const deviceId = String((src && src.device_id) || '')
  const payload = (src && src.payload) || {}

  try {
    const admin = await verifyAdmin(accessToken, deviceId)

    switch (action) {

      // 创建店家子账号：Auth 用户 → customer_user 映射行
      case 'createSubUser': {
        const username = String(payload.username || '').trim()
        const password = String(payload.password || '')
        const displayName = String(payload.displayName || '').trim()
        const phone = String(payload.phone || '').trim()
        const customerId = Number(payload.customerId)
        if (!customerId) throw new Error('缺少客户（customerId）')
        validateUsername(username)
        validatePassword(password)
        validatePhone(phone)

        // 同租户用户名查重（customer_user 唯一约束兜底，先给友好报错）
        const dup = await pgList('customer_user', 'select=id&tenant_id=eq.' + admin.tenant_id + '&username=eq.' + encodeURIComponent(username), accessToken, deviceId)
        if (Array.isArray(dup) && dup.length) throw new Error('用户名已存在，请换一个')

        // 1) 管理面建 Auth 用户（密码规则平台侧强制）
        const resp = await tcbRequest('CreateUser', {
          EnvId: ENV_ID,
          Name: username,
          Password: password,
          NickName: displayName || username,
          ...(phone ? { Phone: phone } : {}),
          Description: 'FreshFlow sub user (self-service)',
        })
        const uid = (resp && resp.Data && resp.Data.Uid) || (resp && resp.Uid)
        if (!uid) throw new Error('平台未返回用户 uid，请稍后重试或联系运维')

        // 2) 写 customer_user 映射（RLS：仅本租户管理员可写）
        await pgInsert('customer_user', {
          tenant_id: admin.tenant_id,
          customer_id: customerId,
          username,
          password_hash: '', // Auth 体系托管密码；本列仅满足非空约束
          display_name: displayName || null,
          phone: phone || null,
          can_export: payload.canExport === true,
          status: 'active',
          uid,
        }, accessToken, deviceId)

        return { ok: true, uid, username }
      }

      // 重置密码
      case 'resetPassword': {
        const uid = String(payload.uid || '')
        const password = String(payload.password || '')
        if (!uid) throw new Error('缺少用户 uid')
        validatePassword(password)
        const own = await pgList('customer_user', 'select=id,username&uid=eq.' + uid, accessToken, deviceId)
        if (!Array.isArray(own) || !own.length) throw new Error('该账号不属于本租户，无法重置')
        await tcbRequest('ModifyUser', { EnvId: ENV_ID, Uid: uid, Password: password })
        return { ok: true, uid }
      }

      // 停用/启用（平台 BLOCKED/ACTIVE + customer_user.status 同步）
      case 'setStatus': {
        const uid = String(payload.uid || '')
        const blocked = payload.blocked === true
        if (!uid) throw new Error('缺少用户 uid')
        const own = await pgList('customer_user', 'select=id,status&uid=eq.' + uid, accessToken, deviceId)
        if (!Array.isArray(own) || !own.length) throw new Error('该账号不属于本租户，无法操作')
        await tcbRequest('ModifyUser', { EnvId: ENV_ID, Uid: uid, UserStatus: blocked ? 'BLOCKED' : 'ACTIVE' })
        await pgPatch('customer_user', 'uid=eq.' + uid, { status: blocked ? 'blocked' : 'active' }, accessToken, deviceId)
        return { ok: true, uid, blocked }
      }

      // 登记/修改子账号手机号（店家新设备验证用；商家端自助操作）
      case 'setPhone': {
        const uid = String(payload.uid || '')
        const phone = String(payload.phone || '').trim()
        if (!uid) throw new Error('缺少用户 uid')
        if (phone && !/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确（11 位）')
        const own = await pgList('customer_user', 'select=id,username&uid=eq.' + uid, accessToken, deviceId)
        if (!Array.isArray(own) || !own.length) throw new Error('该账号不属于本租户，无法操作')
        await pgPatch('customer_user', 'uid=eq.' + uid, { phone: phone || null }, accessToken, deviceId)
        return { ok: true, uid, phone: phone || null }
      }

      // 解绑：删 customer_user 映射行（保留 Auth 用户，防误删可恢复）
      case 'unbind': {
        const uid = String(payload.uid || '')
        if (!uid) throw new Error('缺少用户 uid')
        const own = await pgList('customer_user', 'select=id,username&uid=eq.' + uid, accessToken, deviceId)
        if (!Array.isArray(own) || !own.length) throw new Error('该账号不属于本租户，无法解绑')
        await pgDelete('customer_user', 'uid=eq.' + uid, accessToken, deviceId)
        return { ok: true, uid }
      }

      default:
        throw new Error('未知操作：' + (action || '(空)'))
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}
