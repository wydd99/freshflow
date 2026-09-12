const api = require('../../utils/api')

Page({
  data: { username: '', password: '', loading: false },
  onUser(e) { this.setData({ username: e.detail.value }) },
  onPwd(e) { this.setData({ password: e.detail.value }) },
  doLogin() {
    const { username, password } = this.data
    if (!username || !password) {
      wx.showToast({ title: '请输入账号密码', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    api.login(username.trim(), password)
      .then((r) => wx.reLaunch({ url: r.role === 'admin' ? '/pages/report/report' : '/pages/index/index' }))
      .catch((e) => {
        const msg = (e.body && (e.body.error_description || e.body.message)) || e.message || '登录失败'
        wx.showToast({ title: String(msg).slice(0, 30), icon: 'none' })
      })
      .finally(() => this.setData({ loading: false }))
  },
  onLoad() {
    // 已有有效凭证：显示自动登录遮罩再分流，避免登录表单闪跳的观感
    if (api.token()) {
      const target = api.role() === 'admin' ? '/pages/report/report' : '/pages/index/index'
      wx.showLoading({ title: '自动登录中…', mask: true })
      setTimeout(() => { wx.hideLoading(); wx.reLaunch({ url: target }) }, 400)
    }
  },
})
