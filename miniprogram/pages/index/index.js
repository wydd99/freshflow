const api = require('../../utils/api')

const SOURCE_NAME = { customer: '专价', type: '', base: '原价', history: '历史' }
// 语音开单：云函数 ai 的网关地址（语音→文字→商品行）
const AI_URL = 'https://freshflow-ENV_ID.service.tcloudbase.com/ai'
const rm = wx.getRecorderManager()

Page({
  data: {
    customerName: '',
    customerLevel: 'default',
    catId: null,
    categories: [],
    goods: [],
    cart: {},
    total: '0.00',
    count: 0,
    deliveryDate: '',
    recording: false,
    result: { visible: false, ok: false, orderNo: '', msg: '', countdown: 5 },
  },

  onLoad() {
    rm.onStop((res) => this.onVoiceFile(res))
    rm.onError(() => {
      this.setData({ recording: false })
      wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' })
    })
  },

  onShow() {
    if (!api.token()) { wx.reLaunch({ url: '/pages/login/login' }); return }
    if (api.role() === 'admin') { wx.reLaunch({ url: '/pages/report/report' }); return }
    if (!this.data.goods.length) this.loadAll()
  },

  today() { return new Date().toISOString().slice(0, 10) },

  async loadAll() {
    wx.showLoading({ title: '加载中' })
    try {
      const sub = api.sub()
      const cuRows = (await api.rest('customer_user', `select=customer_id&uid=eq.${sub}`)) || []
      const cu = cuRows[0] || {}
      const cRows = (await api.rest('customer', `select=*&id=eq.${cu.customer_id}`)) || []
      const customer = cRows[0] || {}
      let visibleCatIds = null
      if (!customer.visible_all) {
        const vis = (await api.rest('customer_visible_category', `select=category_id&customer_id=eq.${cu.customer_id}`)) || []
        visibleCatIds = new Set(vis.map((v) => v.category_id))
      }
      const categories = (await api.rest('goods_category', 'select=*&order=sort')) || []
      const goodsRows = (await api.rest('goods', 'select=*&status=eq.active&order=code')) || []
      const visibleGoods = goodsRows.filter((g) => g.allow_mall && (!visibleCatIds || visibleCatIds.has(g.category_id)))

      // 取价链（客户端实现）：客户专属 → 等级价 → 基准价
      const today = this.today()
      const ids = visibleGoods.map((g) => g.id)
      let priceRows = []
      if (ids.length) {
        priceRows = (await api.rest('price', `select=*&goods_id=in.(${ids.join(',')})&valid_from=lte.${today}&order=valid_from.desc`)) || []
      }
      const pick = (gid, scope, value) =>
        priceRows.find((p) => p.goods_id === gid && p.scope === scope && String(p.scope_value) === String(value))

      const goods = visibleGoods.map((g) => {
        const cust = pick(g.id, 'customer', customer.id)
        const typ = pick(g.id, 'type', customer.level)
        const price = cust ? Number(cust.price) : typ ? Number(typ.price) : Number(g.base_price)
        const source = cust ? 'customer' : typ ? 'type' : 'base'
        return {
          ...g,
          salePrice: price.toFixed(2),
          source,
          unit: g.unit,
        }
      })

      this.setData({
        customerName: customer.name || '',
        customerLevel: customer.level || 'default',
        customer: customer,
        categories: [{ id: null, name: '全部' }, ...categories],
        goods,
        allGoods: goods,
        deliveryDate: this.data.deliveryDate || today,
      })
    } catch (e) {
      if (e.statusCode === 401) { api.logout(); wx.reLaunch({ url: '/pages/login/login' }); return }
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onCat(e) {
    // dataset 会把 null 序列化成字符串，Number('null')/Number(null) 都会变成 0 导致过滤全空
    const raw = e.currentTarget.dataset.id
    const id = (raw === '' || raw === null || raw === undefined || raw === 'null') ? null : Number(raw)
    this.setData({ catId: id, goods: (this.data.allGoods || []).filter((g) => id === null || g.category_id === id) })
  },

  onDateChange(e) { this.setData({ deliveryDate: e.detail.value }) },
  /** 点品名看商品介绍（T3.6） */
  showDetail(e) {
    const id = Number(e.currentTarget.dataset.id)
    const g = this.data.goods.find((x) => x.id === id)
    if (!g) return
    wx.showModal({
      title: g.name,
      content: (g.description || '暂无介绍') + (g.spec ? '\n规格：' + g.spec : ''),
      showCancel: false,
      confirmText: '知道了',
    })
  },

  onPlus(e) { this.step(e, 1) },
  onMinus(e) { this.step(e, -1) },
  /** 直接输入数量（支持 0.5 半斤等小数） */
  onQtyInput(e) {
    const id = Number(e.currentTarget.dataset.id)
    const v = parseFloat(e.detail.value)
    const cart = { ...this.data.cart }
    if (!v || v <= 0) delete cart[id]
    else cart[id] = Math.round(v * 100) / 100
    this.setData({ cart })
    this.recalc()
  },
  step(e, d) {
    const id = e.currentTarget.dataset.id
    const cart = { ...this.data.cart }
    const next = Math.max(0, Math.round(((cart[id] || 0) + d) * 100) / 100)
    if (next <= 0) delete cart[id]
    else cart[id] = next
    this.setData({ cart })
    this.recalc()
  },

  recalc() {
    const cart = this.data.cart
    let count = 0
    let total = 0
    for (const id in cart) {
      const g = (this.data.allGoods || []).find((x) => x.id === Number(id) || x.id === id)
      if (!g) continue
      count += cart[id]
      total += cart[id] * Number(g.salePrice)
    }
    this.setData({ count, total: total.toFixed(2) })
  },

  onSubmit() {
    const { cart, deliveryDate } = this.data
    const goodsMap = {}
    for (const id in cart) {
      const g = (this.data.allGoods || []).find((x) => x.id === Number(id) || x.id === id)
      if (g) goodsMap[id] = g
    }
    const ids = Object.keys(cart)
    if (!ids.length) { wx.showToast({ title: '先选商品哦', icon: 'none' }); return }
    if (!this.data.customerName) { wx.showToast({ title: '客户信息加载中', icon: 'none' }); return }

    const items = ids.map((id) => ({ goods: goodsMap[id], qty: cart[id] }))
    const total = items.reduce((s, i) => s + i.qty * Number(i.goods.salePrice), 0).toFixed(2)
    const lines = items.map((i) => `${i.goods.name} × ${i.qty}${i.goods.unit}`).join('\n')

    wx.showModal({
      title: `确认下单（${this.data.deliveryDate}）`,
      content: `${lines}\n合计 ¥${total}`,
      confirmText: '提交',
      success: (r) => { if (r.confirm) this.submitOrder(items, total, deliveryDate) },
    })
  },

  async submitOrder(items, total, deliveryDate) {
    wx.showLoading({ title: '提交中' })
    try {
      const customer = this.data.customer
      const now = new Date()
      const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const todays = (await api.rest('order_main', `select=order_no&created_at=gte.${ymd}T00:00:00Z`)) || []
      const orderNo = `OR_${ymd}${String(todays.length + 1).padStart(4, '0')}`

      const created = await api.insert('order_main', {
        tenant_id: customer.tenant_id,
        order_no: orderNo,
        customer_id: customer.id,
        source: 'mall',
        delivery_date: deliveryDate,
        status: 'draft',
        amount_original: Number(total),
        sort_total: items.length,
        remark: '商城自下单',
      })
      let order = Array.isArray(created) ? created[0] : created
      if (!order || !order.id) {
        const back = (await api.rest('order_main', `select=*&order_no=eq.${orderNo}`)) || []
        order = back[0]
      }
      if (!order || !order.id) throw new Error('订单创建后未查询到，请勿重复提交，联系配送站')
      await api.insert('order_item', items.map((p) => ({
        tenant_id: customer.tenant_id,
        order_id: order.id,
        goods_id: p.goods.id,
        goods_name: p.goods.name,
        unit: p.goods.unit,
        order_qty: p.qty,
        order_price: Number(p.goods.salePrice),
        price_source: p.goods.source,
        amount: Math.round(p.qty * Number(p.goods.salePrice) * 100) / 100,
        status: 'pending',
      })))
      this.setData({ cart: {} })
      this.recalc()
      this.showResult(true, order.order_no)
    } catch (e) {
      if (e.statusCode === 401) { api.logout(); wx.reLaunch({ url: '/pages/login/login' }); return }
      this.showResult(false, '', (e.body && (e.body.message || e.body.error)) || '网络异常，请重试')
    } finally {
      wx.hideLoading()
    }
  },

  showResult(ok, orderNo, msg) {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    this.setData({ result: { visible: true, ok, orderNo: orderNo || '', msg: msg || '', countdown: 5 } })
    this._timer = setInterval(() => {
      const c = this.data.result.countdown - 1
      if (c <= 0) this.closeResult()
      else this.setData({ 'result.countdown': c })
    }, 1000)
  },

  /* ---------- 语音开单（T2.12b）：按住说话 → 云函数转文字+解析 → 确认下单 ---------- */
  onVoiceStart() {
    if (!api.token()) { wx.reLaunch({ url: '/pages/login/login' }); return }
    if (!this.data.customerName) { wx.showToast({ title: '客户信息加载中', icon: 'none' }); return }
    this.setData({ recording: true })
    rm.start({ format: 'mp3', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, duration: 60000 })
  },

  onVoiceEnd() {
    if (this.data.recording) rm.stop()
  },

  onVoiceFile(res) {
    this.setData({ recording: false })
    if (!res || !res.tempFilePath) return
    wx.getFileSystemManager().readFile({
      filePath: res.tempFilePath,
      encoding: 'base64',
      success: (fr) => this.voiceRecognize(fr.data),
      fail: () => wx.showToast({ title: '录音读取失败', icon: 'none' }),
    })
  },

  voiceRecognize(base64) {
    wx.showLoading({ title: '识别中…' })
    wx.request({
      url: AI_URL,
      method: 'POST',
      data: { mode: 'audio', audioBase64: 'data:audio/mp3;base64,' + base64, audioFormat: 'mp3' },
      header: { 'Content-Type': 'application/json' },
      success: (r) => {
        wx.hideLoading()
        const resp = r.data || {}
        if (r.statusCode >= 400 || resp.ok === false) {
          const msg = String(resp.error || '识别失败，请重试')
          if (resp.text) {
            wx.showModal({ title: '没匹配上，识别结果是', content: resp.text, showCancel: false, confirmText: '知道了' })
          } else {
            wx.showToast({ title: msg.slice(0, 30), icon: 'none' })
          }
          return
        }
        this.confirmVoiceOrder(resp.items || [], resp.text || '')
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络异常，请重试', icon: 'none' }) },
    })
  },

  /** 语音商品行 × 商城商品库匹配 → 确认弹窗 → 走统一下单 */
  confirmVoiceOrder(parsed, voiceText) {
    const lines = []
    const skipped = []
    for (const it of parsed) {
      const name = String(it.name || '').trim()
      const qty = Number(it.qty || 1) || 1
      if (!name) { skipped.push(it.raw || '?'); continue }
      const g = this.data.allGoods.find((x) =>
        x.name === name || (x.alias || []).includes(name) ||
        x.name.includes(name) || name.includes(x.name))
      if (!g) { skipped.push(name); continue }
      lines.push({ goods: g, qty })
    }
    if (!lines.length) {
      return wx.showModal({
        title: '没匹配到商城商品',
        content: '识别到：' + (voiceText || '（空）'),
        showCancel: false, confirmText: '知道了',
      })
    }
    const total = lines.reduce((s, l) => s + l.qty * Number(l.goods.salePrice), 0)
    const linesText = lines.map((l) => `${l.goods.name} × ${l.qty}${l.goods.unit}`).join('\n')
    const extra = skipped.length ? `\n（未收录已略过：${skipped.join('、')}）` : ''
    const that = this
    wx.showModal({
      title: `语音下单（${this.data.deliveryDate}）`,
      content: `${linesText}\n合计 ¥${total.toFixed(2)}${extra}`,
      confirmText: '提交',
      success(r) { if (r.confirm) that.submitOrder(lines, total.toFixed(2), that.data.deliveryDate) },
    })
  },

  closeResult() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    this.setData({ 'result.visible': false })
  },

  onUnload() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  },
})
