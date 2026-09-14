import { defineStore } from 'pinia'
import { auth, db } from '@/lib/cloudbase'

// 登录态：CloudBase Auth 会话 + ff_actor() 身份（kind/tenant_id/role/customer_id，见 database/migrations）
export const useAuthStore = defineStore('auth', {
  state: () => ({ session: null, actor: null, checked: false }),
  getters: {
    isLoggedIn: (s) => !!s.session,
    displayName: (s) => s.actor?.kind === 'admin' ? `管理员` : '用户',
  },
  actions: {
    async restore() {
      if (this.checked) return
      this.checked = true
      try {
        // 会话可能已过期（access_token 2h）：先强制刷新再取会话，
        // 否则 rdb 写操作会静默 0 行（本 bug 实证过两轮）
        try { await auth.refreshSession?.() } catch (e) { /* 无会话则走登录 */ }
        const { data } = await auth.getSession()
        const session = data?.session
        this.session = session && !session.user?.is_anonymous ? session : null
        if (this.session) { this.startKeepAlive(); await this.loadActor() }
      } catch (e) {
        this.session = null
      }
    },
    async loadActor() {
      if (!db) return
      try {
        const res = await db.rpc('ff_actor')
        const rows = res?.data ?? res
        const actor = Array.isArray(rows) ? rows[0] || null : rows || null
        // 补充 username（员工才查得到 admin_user 自己那行），供按账号的模块开关使用
        if (actor?.kind === 'admin') {
          const uid = this.session?.user?.id || this.session?.sub
          if (uid) {
            const mine = await db.from('admin_user').select('username').eq('uid', uid)
            const r = mine?.data ?? mine
            if (Array.isArray(r) && r[0]) actor.username = r[0].username
          }
        }
        this.actor = actor
      } catch (e) {
        this.actor = null
      }
    },
    startKeepAlive() {
      if (this._ka) clearInterval(this._ka)
      // access_token 有效期 2h，提前 30 分钟续期；js-sdk rdb 写入不会自动续期（静默 0 行 bug 根因）
      this._ka = setInterval(async () => {
        try { await auth.refreshSession?.() } catch (e) { /* 失败则下次 restore 兜底 */ }
      }, 90 * 60 * 1000)
    },

    async login(username, password) {
      const res = await auth.signInWithPassword({ username, password })
      const error = res?.error
      if (error) throw new Error(error.message || '登录失败')
      this.session = res?.data?.session || null
      this.startKeepAlive()
      await this.loadActor()
      return this.session
    },
    async logout() {
      try { await auth.signOut?.() } catch (e) { /* 忽略登出异常 */ }
      this.session = null
      this.actor = null
      // checked 置 true 短路 restore()：登出后 js-sdk getSession() 仍可能返回内存缓存会话，
      // 守卫若重新发现它会误判"已登录"把人弹回首页（退出停留 bug 实证）。下次冷启动内存态自然重置。
      this.checked = true
    },
  },
})
