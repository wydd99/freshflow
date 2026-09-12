const api = require('../../utils/api')

const STATUS = {
  draft: '草单', confirmed: '已确认', sorting: '分拣中', ready: '待发货',
  shipped: '已发货', done: '已完成', void: '已作废',
}

Page({
  data: { orders: [], pwdOpen: false, oldPwd: '', newPwd: '', newPwd2: '', saving: false },
  onShow() {
    if (!api.token()) { wx.reLaunch({ url: '/pages/login/login' }); return }
    this.load()
  },
  togglePwdSec() { this.setData({ pwdOpen: !this.data.pwdOpen }) },
  onOld(e) { this.setData({ oldPwd: e.detail.value }) },
  onNew(e) { this.setData({ newPwd: e.detail.value }) },
  onNew2(e) { this.setData({ newPwd2: e.detail.value }) },
  async savePwd() {
    const { oldPwd, newPwd, newPwd2 } = this.data
    if (!oldPwd || !newPwd) return wx.showToast({ title: '请填写完整', icon: 'none' })
    if (newPwd !== newPwd2) return wx.showToast({ title: '两次新密码不一致', icon: 'none' })
    this.setData({ saving: true })
    try {
      await api.request('PATCH', '/auth/v1/user/password', { old_password: oldPwd, new_password: newPwd })
      wx.showToast({ title: '密码已更新', icon: 'success' })
      this.setData({ pwdOpen: false, oldPwd: '', newPwd: '', newPwd2: '' })
    } catch (e) {
      const msg = (e.body && (e.body.error_description || e.body.message)) || e.message || '修改失败'
      wx.showToast({ title: String(msg).slice(0, 30), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
  async load() {
    try {
      const rows = (await api.rest('order_main', 'select=*&order=created_at.desc&limit=50')) || []
      this.setData({
        orders: rows.map((o) => ({
          ...o,
          statusLabel: STATUS[o.status] || o.status,
          total: Number(o.amount_original ?? 0).toFixed(2),
        })),
      })
    } catch (e) {
      if (e.statusCode === 401) { api.logout(); wx.reLaunch({ url: '/pages/login/login' }) }
    }
  },

  /** 再来一单（T2.12c）：拉旧单明细 → 按今日价重算 → 确认后直接建新草单 */
  async onReorder(e) {
    const orderId = e.currentTarget.dataset.id
    this.setData({ reordering: orderId })
    try {
      const items = (await api.rest('order_item', `select=*&order_id=eq.${orderId}&status=neq.void`)) || []
      if (!items.length) { wx.showToast({ title: '该订单没有明细', icon: 'none' }); return }
      // 取当前客户与取价链价格（与订货页同逻辑），只保留仍在售商品按今日价重算
      const cuRows = (await api.rest('customer_user', `select=customer_id&uid=eq.${api.sub()}`)) || []
      const cRows = (await api.rest('customer', `select=*&id=eq.${(cuRows[0] || {}).customer_id}`)) || []
      const customer = cRows[0] || {}
      const today = this.localDate(0)
      const priceRows = (await api.rest('price', `select=*&valid_from=lte.${today}&order=valid_from.desc`)) || []
      const pickPrice = (gid) => {
        const c = priceRows.find((p) => p.goods_id === gid && p.scope === 'customer' && String(p.scope_value) === String(customer.id))
        if (c) return { price: Number(c.price), source: 'customer' }
        const t = priceRows.find((p) => p.goods_id === gid && p.scope === 'type' && String(p.scope_value) === String(customer.level))
        if (t) return { price: Number(t.price), source: 'type' }
        return null
      }
      const valid = []
      let total = 0
      for (const it of items) {
        const gRows = (await api.rest('goods', `select=*&id=eq.${it.goods_id}`)) || []
        const g = gRows[0]
        if (!g || !g.allow_mall || g.status !== 'active') continue
        const chain = pickPrice(g.id)
        const price = chain ? chain.price : Number(g.base_price)
        const qty = Number(it.order_qty)
        const amount = Math.round(qty * price * 100) / 100
        total += amount
        valid.push({ g, qty, amount, price, source: chain ? chain.source : 'base' })
      }
      if (!valid.length) { wx.showToast({ title: '商品均已下架，无法复制', icon: 'none' }); return }
      const lines = valid.map((v) => `${v.g.name} × ${v.qty}${v.g.unit}`).join('\n')
      const that = this
      wx.showModal({
        title: '确认再来一单',
        content: `${lines}\n合计 ¥${total.toFixed(2)}（按今日价格）`,
        confirmText: '提交',
        success(r) { if (r.confirm) that.submitReorder(valid, total, customer) },
      })
    } catch (err) {
      if (err.statusCode === 401) { api.logout(); wx.reLaunch({ url: '/pages/login/login' }); return }
      wx.showToast({ title: '复制失败', icon: 'none' })
    } finally {
      this.setData({ reordering: null })
    }
  },

  async submitReorder(valid, total, customer) {
    wx.showLoading({ title: '提交中' })
    try {
      const now = new Date()
      const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const todays = (await api.rest('order_main', `select=order_no&created_at=gte.${ymd}T00:00:00Z`)) || []
      const orderNo = `OR_${ymd}${String(todays.length + 1).padStart(4, '0')}`
      const created = await api.insert('order_main', {
        tenant_id: customer.tenant_id, order_no: orderNo,
        customer_id: customer.id,
        source: 'mall', delivery_date: this.localDate(1), status: 'draft',
        amount_original: Number(total.toFixed(2)), sort_total: valid.length, remark: '商城再来一单',
      })
      let order = Array.isArray(created) ? created[0] : created
      if (!order || !order.id) {
        const back = (await api.rest('order_main', `select=*&order_no=eq.${orderNo}`)) || []
        order = back[0]
      }
      if (!order || !order.id) throw new Error('订单创建失败')
      await api.insert('order_item', valid.map((v) => ({
        tenant_id: v.g.tenant_id, order_id: order.id, goods_id: v.g.id,
        goods_name: v.g.name, unit: v.g.unit, order_qty: v.qty,
        order_price: v.price, price_source: v.source,
        amount: v.amount, status: 'pending',
      })))
      wx.showToast({ title: '下单成功', icon: 'success' })
      this.load()
    } catch (e) {
      if (e.statusCode === 401) { api.logout(); wx.reLaunch({ url: '/pages/login/login' }); return }
      wx.showToast({ title: '提交失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  localDate(offset = 0) {
    const d = new Date(); d.setDate(d.getDate() + offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },
  onLogout() {
    api.logout()
    wx.reLaunch({ url: '/pages/login/login' })
  },
  noop() {},
})
