// FreshFlow · 云函数 authgate：登录安全门禁（新设备手机验证码验证 + 登录审计）
// 通道：HTTP 云接入 /authgate（可取来源 IP）；函数内用调用者 access_token 验证身份（RLS 借道）
// 写库：环境 API Key（service_role，绕过 RLS；密钥仅存函数环境变量，绝不进代码/仓库）
// 环境变量：
//   AUTHGATE_ENFORCE  'true'=拦截模式（新设备必须完成手机验证）/'false'=记录模式（默认，先记录后开启）
//   AUTHGATE_APIKEY   环境 API Key（服务端写 login_device / login_audit）
// 流程：
//   check     — 登录后调用：登记设备 → 已白名单放行 / 新设备按开关要求验证
//   send_code — 向「账号绑定的手机号」发验证码（频控：60秒1条、24小时10条）
//   verify    — 校验验证码 → 通过则设备入白名单（失败5次作废本次验证码）
// 安全：手机号只从数据库读取（不接受前端传入）；白名单写入仅本函数（service_role）可为；验证码不落前端存储。

const ENV_ID = 'freshflow-ENV_ID'
const GW = 'https://' + ENV_ID + '.api.tcloudbasegateway.com'
const nowIso = () => new Date().toISOString()

function enc(v) { return encodeURIComponent(String(v)) }

// ---------- 用户身份解析（RLS 借道：只能查到自己） ----------
async function rlsGet(token, table, query) {
  const r = await fetch(GW + '/v1/rdb/rest/' + table + '?' + query, {
    headers: { Authorization: 'Bea' + 'rer ' + token },
  })
  if (!r.ok) throw new Error('身份校验失败 HTTP ' + r.status)
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) ? rows : []
}

async function resolveActor(accessToken) {
  if (!accessToken) throw new Error('未登录（缺少 access_token）')
  const admins = await rlsGet(accessToken, 'admin_user', 'select=id,uid,username,tenant_id,phone&limit=1')
  if (admins[0]) return { kind: 'admin', ...admins[0] }
  const custs = await rlsGet(accessToken, 'customer_user', 'select=id,uid,username,tenant_id,customer_id,phone&limit=1')
  if (custs[0]) return { kind: 'customer', ...custs[0] }
  throw new Error('无法识别账号身份')
}

// ---------- service_role 读写（环境 API Key） ----------
function svcHeaders() {
  const key = process.env.AUTHGATE_APIKEY || ''
  if (!key) throw new Error('服务端密钥未配置（AUTHGATE_APIKEY）')
  return { Authorization: 'Bea' + 'rer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' }
}
async function svcGet(table, query) {
  const r = await fetch(GW + '/v1/rdb/rest/' + table + '?' + query, { headers: svcHeaders() })
  if (!r.ok) throw new Error('svc 查询 ' + table + ' HTTP ' + r.status)
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) ? rows : []
}
async function svcInsert(table, body) {
  const r = await fetch(GW + '/v1/rdb/rest/' + table, { method: 'POST', headers: svcHeaders(), body: JSON.stringify(body) })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error('svc 写入 ' + table + ' HTTP ' + r.status + ' ' + t.slice(0, 120))
  }
  return r.json().catch(() => [])
}
async function svcPatch(table, query, body) {
  const r = await fetch(GW + '/v1/rdb/rest/' + table + '?' + query, { method: 'PATCH', headers: svcHeaders(), body: JSON.stringify(body) })
  if (!r.ok) throw new Error('svc 更新 ' + table + ' HTTP ' + r.status)
  return r.json().catch(() => [])
}

async function audit(actor, deviceId, ip, event, detail) {
  try {
    await svcInsert('login_audit', {
      tenant_id: actor.tenant_id || null, actor_type: actor.kind, actor_id: actor.id,
      actor_uid: actor.uid, username: actor.username, device_id: deviceId, ip, event, detail: detail || {},
    })
  } catch (e) { /* 审计失败不阻断主流程 */ }
}

// ---------- 业务动作 ----------
async function findDevice(actor, deviceId) {
  const rows = await svcGet('login_device',
    'select=*&tenant_id=eq.' + actor.tenant_id + '&actor_type=eq.' + actor.kind + '&actor_id=eq.' + actor.id + '&device_id=eq.' + enc(deviceId))
  return rows[0] || null
}

async function ensureDevice(actor, deviceId, ip) {
  let dev = await findDevice(actor, deviceId)
  if (dev) return dev
  try {
    const rows = await svcInsert('login_device', {
      tenant_id: actor.tenant_id, actor_type: actor.kind, actor_id: actor.id,
      actor_uid: actor.uid, username: actor.username, device_id: deviceId,
      verified: false, last_ip: ip,
    })
    return (Array.isArray(rows) ? rows[0] : rows) || null
  } catch (e) {
    // 并发冲突（UNIQUE）时回查
    dev = await findDevice(actor, deviceId)
    if (dev) return dev
    throw e
  }
}

function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '')
  if (d.length < 7) return '已绑定'
  return d.slice(0, 3) + '****' + d.slice(-4)
}
function normalizeCnPhone(p) {
  const d = String(p || '').replace(/\D/g, '')
  if (/^1\d{10}$/.test(d)) return '+86 ' + d
  if (/^861\d{10}$/.test(d)) return '+86 ' + d.slice(2)
  return null
}

async function doCheck(actor, deviceId, ip) {
  const enforce = String(process.env.AUTHGATE_ENFORCE || 'false') === 'true'
  let dev = await findDevice(actor, deviceId)
  if (dev) {
    await svcPatch('login_device', 'id=eq.' + dev.id, {
      last_seen: nowIso(), login_count: Number(dev.login_count || 0) + 1, last_ip: ip,
      actor_uid: actor.uid, username: actor.username,
    })
    await audit(actor, deviceId, ip, 'login', { trusted: !!dev.verified, enforce })
    if (dev.verified) return { ok: true, trusted: true }
  } else {
    await ensureDevice(actor, deviceId, ip)
    await audit(actor, deviceId, ip, 'new_device', { enforce })
  }
  const hasPhone = !!normalizeCnPhone(actor.phone)
  if (!enforce) {
    // 记录模式：不拦截，仅返回画像（前端无需弹验证）
    return { ok: true, trusted: true, enforce: false, note: 'record_only', has_phone: hasPhone }
  }
  if (!hasPhone) {
    return {
      ok: true, trusted: false, reason: 'no_phone', has_phone: false,
      message: '此设备首次登录，需要短信验证；该账号还未登记手机号，请联系配送站绑定手机后再登录',
    }
  }
  return { ok: true, trusted: false, reason: 'new_device', has_phone: true, phone_mask: maskPhone(actor.phone) }
}

async function doSendCode(actor, deviceId, ip) {
  const phone = normalizeCnPhone(actor.phone)
  if (!phone) throw new Error('该账号未登记手机号，请联系配送站绑定')
  // 频控：60 秒 1 条 / 24 小时 10 条
  const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString()
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const recent = await svcGet('login_audit',
    'select=id&actor_uid=eq.' + enc(actor.uid) + '&event=eq.verify_sent&created_at=gte.' + enc(oneMinAgo) + '&limit=1')
  if (recent.length) throw new Error('发送太频繁，请 60 秒后再试')
  const dayRows = await svcGet('login_audit',
    'select=id&actor_uid=eq.' + enc(actor.uid) + '&event=eq.verify_sent&created_at=gte.' + enc(dayAgo) + '&limit=20')
  if (dayRows.length >= 10) throw new Error('今日验证码发送次数已达上限，请明天再试或联系配送站')

  // 向绑定手机发码（手机号只来自数据库，不接受前端传入）
  const r = await fetch(GW + '/auth/v1/verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'ANY', phone_number: phone }),
  })
  const j = await r.json().catch(() => ({}))
  if (r.status >= 400 || !j.verification_id) {
    const msg = String(j.error_description || j.error || ('发码失败 HTTP ' + r.status))
    throw new Error(msg)
  }

  const dev = await ensureDevice(actor, deviceId, ip)
  if (dev) {
    await svcPatch('login_device', 'id=eq.' + dev.id, {
      pending_vid: j.verification_id, pending_vid_at: nowIso(), pending_fail: 0,
    })
  }
  await audit(actor, deviceId, ip, 'verify_sent', { phone: maskPhone(phone) })
  return { ok: true, expires_in: j.expires_in || 600, phone_mask: maskPhone(phone) }
}

async function doVerify(actor, deviceId, code, ip) {
  if (!/^\d{4,8}$/.test(String(code || ''))) throw new Error('请输入收到的验证码')
  const dev = await findDevice(actor, deviceId)
  if (!dev || !dev.pending_vid) throw new Error('请先点击「发送验证码」')
  const sentAt = dev.pending_vid_at ? new Date(dev.pending_vid_at).getTime() : 0
  if (Date.now() - sentAt > 10 * 60 * 1000) throw new Error('验证码已过期，请重新发送')

  const r = await fetch(GW + '/auth/v1/verification/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verification_id: dev.pending_vid, verification_code: String(code) }),
  })
  const j = await r.json().catch(() => ({}))

  if (r.status < 400 && (j.verification_token || j.expires_in)) {
    await svcPatch('login_device', 'id=eq.' + dev.id, {
      verified: true, verified_at: nowIso(), pending_vid: null, pending_fail: 0, last_ip: ip,
    })
    await audit(actor, deviceId, ip, 'verify_ok', {})
    return { ok: true, trusted: true }
  }

  const fail = Number(dev.pending_fail || 0) + 1
  await svcPatch('login_device', 'id=eq.' + dev.id, {
    pending_fail: fail, ...(fail >= 5 ? { pending_vid: null } : {}),
  })
  await audit(actor, deviceId, ip, 'verify_fail', { fail })
  if (fail >= 5) throw new Error('验证码错误次数过多，请重新发送验证码')
  throw new Error('验证码错误（还可以试 ' + (5 - fail) + ' 次）')
}

// ---------- 主入口 ----------
exports.main = async (event) => {
  let src = event
  if (src && typeof src.body === 'string' && src.action === undefined) {
    try { src = JSON.parse(src.body) } catch (e) { /* 保持原样 */ }
  }
  const headers = (event && event.headers) || {}
  const ip = String(headers['x-forwarded-for'] || headers['x-real-ip'] || '').split(',')[0].trim() || null
  const action = String((src && src.action) || '')
  const accessToken = String((src && src.access_token) || '')
  const deviceId = String((src && src.device_id) || '').slice(0, 160)
  if (!deviceId) return { ok: false, error: '缺少设备标识' }

  try {
    const actor = await resolveActor(accessToken)
    switch (action) {
      case 'check': return await doCheck(actor, deviceId, ip)
      case 'send_code': return await doSendCode(actor, deviceId, ip)
      case 'verify': return await doVerify(actor, deviceId, String((src && src.code) || ''), ip)
      default: throw new Error('未知操作：' + (action || '(空)'))
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}
