const api = require('../../utils/api')

Page({
  data: {
    today: { count: 0, sales: '0.00', pendingSort: 0 },
    debts: { total: '0.00', list: [] },
    week: [],
    loading: true,
  },

  onShow() {
    if (!api.token()) { wx.reLaunch({ url: '/pages/login/login' }); return }
    if (api.role() !== 'admin') { wx.reLaunch({ url: '/pages/index/index' }); return }
    this.load()
  },

  localDate(offset = 0) {
    const d = new Date(); d.setDate(d.getDate() + offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },

  async load() {
    wx.showLoading({ title: '加载中' })
    try {
      const start = this.localDate(-6)
      const orders = (await api.rest('order_main', `select=*&delivery_date=gte.${start}&status=neq.void`)) || []
      const byDate = new Map()
      let today = { count: 0, sales: 0, pendingSort: 0 }
      const t = this.localDate(0)
      for (const o of orders) {
        const amt = Number(o.amount_configured || o.amount_original || 0)
        const e = byDate.get(o.delivery_date) || { count: 0, sales: 0 }
        e.count++; e.sales += amt
        byDate.set(o.delivery_date, e)
        if (o.delivery_date === t) {
          today.count++
          today.sales += amt
          if (['confirmed', 'sorting'].includes(o.status)) today.pendingSort++
        }
      }
      const week = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, e]) => ({ date, count: e.count, sales: Math.round(e.sales * 100) / 100 }))
      const max = Math.max(...week.map((w) => w.sales), 1)
      const weekPct = week.map((w) => ({ ...w, pct: Math.max(4, Math.round(w.sales / max * 100)) }))

      const ledger = (await api.rest('payment_ledger', 'select=customer_id,direction,amount')) || []
      const customers = (await api.rest('customer', 'select=id,name')) || []
      const cmap = new Map(customers.map((c) => [c.id, c.name]))
      const bal = new Map()
      for (const l of ledger) {
        const e = bal.get(l.customer_id) || 0
        bal.set(l.customer_id, e + (l.direction === 'receivable' ? Number(l.amount) : -Number(l.amount)))
      }
      const debts = [...bal.entries()]
        .map(([cid, b]) => ({ customerId: cid, name: cmap.get(cid) || cid, balance: Math.round(b * 100) / 100 }))
        .filter((d) => d.balance > 0)
        .sort((a, b) => b.balance - a.balance)

      this.setData({
        today: { count: today.count, sales: today.sales.toFixed(2), pendingSort: today.pendingSort },
        debts: {
          total: debts.reduce((s, d) => s + d.balance, 0).toFixed(2),
          list: debts.slice(0, 5),
        },
        week: weekPct,
        loading: false,
      })
    } catch (e) {
      if (e.statusCode === 401) { api.logout(); wx.reLaunch({ url: '/pages/login/login' }); return }
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  doLogout() {
    api.logout()
    wx.reLaunch({ url: '/pages/login/login' })
  },
})
