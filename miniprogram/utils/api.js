/** FreshFlow 商城 API 封装：网关 Auth 登录 + rdb REST（Bearer access_token，RLS 按客户身份过滤） */
const ENV_ID = 'freshflow-ENV_ID'
const BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`

function deviceId() {
  let d = wx.getStorageSync('ff_device')
  if (!d) {
    d = 'mp-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    wx.setStorageSync('ff_device', d)
  }
  return d
}

function token() { return wx.getStorageSync('ff_access') || '' }
function sub() { return wx.getStorageSync('ff_sub') || '' }

function rawRequest(method, path, data, authToken, extra) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId(),
        ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}),
        ...(extra || {}),
      },
      success(r) {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(r.data || null)
        else reject({ statusCode: r.statusCode, body: r.data })
      },
      fail(e) { reject({ message: e.errMsg }) },
    })
  })
}

let refreshing = null
async function refreshOnce() {
  if (!wx.getStorageSync('ff_refresh')) throw { statusCode: 401, final: true }
  if (!refreshing) {
    refreshing = rawRequest('POST', '/auth/v1/token', {
      grant_type: 'refresh_token',
      refresh_token: wx.getStorageSync('ff_refresh'),
    }).then((t) => {
      wx.setStorageSync('ff_access', t.access_token)
      wx.setStorageSync('ff_refresh', t.refresh_token)
      return t.access_token
    }).finally(() => { refreshing = null })
  }
  return refreshing
}

async function request(method, path, data, extra) {
  try {
    return await rawRequest(method, path, data, token(), extra)
  } catch (e) {
    if (e.statusCode === 401) {
      try {
        const at = await refreshOnce()
        return await rawRequest(method, path, data, at, extra)
      } catch (e2) {
        ['ff_access', 'ff_refresh', 'ff_sub', 'ff_role'].forEach((k) => wx.removeStorageSync(k))
        throw { statusCode: 401, final: true }
      }
    }
    throw e
  }
}

async function login(username, password) {
  const r = await rawRequest('POST', '/auth/v1/signin', { username, password })
  // 身份分流：店家（customer_user）进商城下单；员工/管理员进老板报表页
  const cu = await rawRequest('GET', `/v1/rdb/rest/customer_user?select=uid&uid=eq.${r.sub}`, undefined, r.access_token)
  const role = (Array.isArray(cu) && cu.length) ? 'customer' : 'admin'
  wx.setStorageSync('ff_access', r.access_token)
  wx.setStorageSync('ff_refresh', r.refresh_token)
  wx.setStorageSync('ff_sub', r.sub || '')
  wx.setStorageSync('ff_role', role)
  return { ...r, role }
}

function role() { return wx.getStorageSync('ff_role') || '' }

function logout() {
  ['ff_access', 'ff_refresh', 'ff_sub', 'ff_role'].forEach((k) => wx.removeStorageSync(k))
}

function rest(table, query = '') {
  return request('GET', `/v1/rdb/rest/${table}${query ? '?' + query : ''}`)
}

// Prefer: return=representation —— 插入后返回新行（否则 201 空体，拿不到订单 id）
function insert(table, rows) {
  return request('POST', `/v1/rdb/rest/${table}`, rows, { Prefer: 'return=representation' })
}

module.exports = { ENV_ID, BASE, login, logout, rest, insert, token, sub, role, request }
