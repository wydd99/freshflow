/**
 * T2.13 管理边界：子账号管理 API（云函数 useradmin 代理）
 * 架构：web-admin 通过 callFn('useradmin') 调用云函数；
 *   云函数内部先用前端传来的 access_token 查 admin_user（RLS 借道）验证管理员身份，
 *   再走腾讯云 tcb 管理面 API 执行 Auth 用户创建/改密/停用（运行时临时密钥，零长期密钥）。
 * 注意：体验版套餐 Auth 用户数配额 3 个（超出时报"套餐用户数已达上限"）。
 */
import { auth, callFn } from '@/lib/cloudbase'

async function callUseradmin(action, payload) {
  const { data } = await auth.getSession()
  const tk = data?.session?.access_token
  if (!tk) throw new Error('会话失效，请重新登录')
  const res = await callFn('useradmin', { action, access_token: tk, payload })
  const r = res?.result ?? res
  if (!r || r.ok === false) throw new Error((r && r.error) || '操作失败')
  return r
}

export const userAdminApi = {
  /** 创建店家子账号（Auth 用户 + customer_user 映射） */
  createSubUser({ username, password, displayName, phone, customerId, canExport }) {
    return callUseradmin('createSubUser', { username, password, displayName, phone, customerId, canExport })
  },
  /** 重置密码 */
  resetPassword(uid, password) {
    return callUseradmin('resetPassword', { uid, password })
  },
  /** 停用/启用 */
  setStatus(uid, blocked) {
    return callUseradmin('setStatus', { uid, blocked })
  },
  /** 解绑（删 customer_user 映射行，Auth 用户保留） */
  unbind(uid) {
    return callUseradmin('unbind', { uid })
  },
}
