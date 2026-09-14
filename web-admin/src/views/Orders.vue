<template>
  <div>
    <el-card shadow="never">
      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 140px" @change="fetchList">
          <el-option v-for="(label, key) in statusLabels" :key="key" :label="label" :value="key" />
        </el-select>
        <el-input v-model="query.keyword" placeholder="单号 / 客户" clearable style="width: 220px" @keyup.enter="fetchList" @clear="fetchList" />
        <el-button type="primary" @click="fetchList">搜索</el-button>
        <div style="flex: 1" />
        <el-button type="primary" @click="openCreate">新增订单（后台代录）</el-button>
      </div>

      <el-table :data="filteredList" v-loading="loading" border stripe>
        <el-table-column prop="order_no" label="单号" width="170" />
        <el-table-column prop="customerName" label="客户" min-width="120" />
        <el-table-column prop="delivery_date" label="发货日期" width="110" align="center" />
        <el-table-column prop="time_slot" label="时段" width="110" align="center" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" size="small">{{ statusLabels[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="90" align="center">
          <template #default="{ row }">{{ sourceLabels[row.source] || row.source }}</template>
        </el-table-column>
        <el-table-column label="明细" width="70" align="center">
          <template #default="{ row }">{{ row.sort_total }}</template>
        </el-table-column>
        <el-table-column label="订单金额" width="110" align="right">
          <template #default="{ row }">¥{{ row.amountOriginal.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">查看</el-button>
            <el-button v-if="row.status === 'draft'" link type="success" @click="doConfirm(row)">确认</el-button>
            <el-button v-if="row.status !== 'void' && row.status !== 'done'" link type="danger" @click="doVoid(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 录单弹窗 -->
    <el-dialog v-model="create.visible" title="新增订单（草单）" width="880px" :close-on-click-modal="false">
      <el-form inline>
        <el-form-item label="客户">
          <el-select v-model="create.customerId" filterable placeholder="选择客户（带出等级与专价）" style="width: 240px" @change="onCustomerChange">
            <el-option v-for="c in customers" :key="c.id" :value="c.id" :label="`${c.name}（${levelLabel(c.level)}·${settleLabel(c)}）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="发货日期"><el-date-picker v-model="create.deliveryDate" type="date" value-format="YYYY-MM-DD" :clearable="false" /></el-form-item>
        <el-form-item label="时段">
          <el-select v-model="create.timeSlot" filterable allow-create default-first-option
            placeholder="选择或输入发货时段" style="width: 180px">
            <el-option v-for="t in timeSlots" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-table :data="create.items" border size="small">
        <el-table-column label="商品" min-width="220">
          <template #default="{ row }">
            <el-select v-model="row.goodsId" filterable placeholder="搜品名/编码" @change="(gid) => onItemGoods(row, gid)">
              <el-option v-for="g in goodsList" :key="g.id" :value="g.id" :label="`${g.name}（${g.code}）`" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="120">
          <template #default="{ row }"><el-input-number v-model="row.qty" :min="0.5" :step="1" size="small" style="width: 100px" /></template>
        </el-table-column>
        <el-table-column label="单位" width="60" align="center">
          <template #default="{ row }">{{ row.unit }}</template>
        </el-table-column>
        <el-table-column label="单价（价源）" width="150" align="right">
          <template #default="{ row }">
            <span>¥{{ row.price.toFixed(2) }}</span>
            <el-tag size="small" :type="sourceTag(row.source)" style="margin-left: 4px">{{ sourceName(row.source) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="100" align="right">
          <template #default="{ row }">¥{{ (row.qty * row.price).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="70" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" @click="create.items.splice($index, 1)">删</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="add-row-wrap">
        <el-button circle icon="Plus" :disabled="!create.customerId" title="新增一行商品" @click="addItem" />
      </div>
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 16px; margin-top: 6px">
        <span>共 {{ create.items.length }} 行，合计：<b style="font-size: 16px">¥{{ draftTotal.toFixed(2) }}</b></span>
      </div>

      <template #footer>
        <el-button @click="create.visible = false">取消</el-button>
        <el-button type="primary" :loading="create.saving" @click="doSave">保存草单</el-button>
      </template>
    </el-dialog>

    <!-- 详情弹窗（T3.2：退货 + 售后金额 + 改单留痕时间线） -->
    <el-dialog v-model="detail.visible" :title="detail.order ? `订单详情 ${detail.order.order_no}` : ''" width="880px">
      <template v-if="detail.order">
        <el-descriptions :column="4" border size="small">
          <el-descriptions-item label="客户">{{ detail.customerName }}</el-descriptions-item>
          <el-descriptions-item label="状态"><el-tag size="small" :type="statusTag(detail.order.status)">{{ statusLabels[detail.order.status] }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="发货日期">{{ detail.order.delivery_date }}</el-descriptions-item>
          <el-descriptions-item label="时段">{{ detail.order.time_slot || '-' }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="detail.items" border size="small" style="margin-top: 10px">
          <el-table-column prop="goods_name" label="品名" min-width="110">
            <template #default="{ row }">
              {{ row.goods_name }}
              <el-tag v-if="logCount(row)" size="small" type="info" style="margin-left:4px;cursor:pointer" @click="loadLogs">痕{{ logCount(row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="下单数量" width="85" align="right">
            <template #default="{ row }">{{ Number(row.order_qty) }} {{ row.unit }}</template>
          </el-table-column>
          <el-table-column label="实拣" width="75" align="right">
            <template #default="{ row }">{{ row.sorted_qty != null ? Number(row.sorted_qty) : '—' }}</template>
          </el-table-column>
          <el-table-column label="单价" width="85" align="right">
            <template #default="{ row }">¥{{ row.orderPrice.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="价源" width="60" align="center">
            <template #default="{ row }"><el-tag size="small" :type="sourceTag(row.price_source)">{{ sourceName(row.price_source) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="金额" width="90" align="right">
            <template #default="{ row }">¥{{ row.amount.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="行状态" width="76" align="center">
            <template #default="{ row }">{{ itemStatus(row.status) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="86" align="center">
            <template #default="{ row }">
              <el-button v-if="canRefund(row)" link type="warning" size="small" @click="doRefund(row)">退货</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div style="margin-top: 10px; display: flex; justify-content: flex-end; gap: 24px; align-items: baseline">
          <span v-if="Number(detail.order.amount_aftersale) > 0" style="color: #e6a23c">
            售后累计：¥{{ Number(detail.order.amount_aftersale).toFixed(2) }}
          </span>
          <span v-if="Number(detail.order.amount_configured) > 0">
            配货金额：<b style="font-size: 15px; color: #409eff">¥{{ Number(detail.order.amount_configured).toFixed(2) }}</b>
          </span>
          <span>
            订单金额合计：<b style="font-size: 16px">¥{{ Number(detail.order.amount_original ?? 0).toFixed(2) }}</b>
          </span>
        </div>

        <!-- 改单留痕时间线（需求#8） -->
        <div v-if="detail.logs.length" style="margin-top: 14px">
          <el-divider content-position="left">改单留痕（{{ detail.logs.length }}）</el-divider>
          <el-timeline style="padding-left: 4px; max-height: 220px; overflow: auto">
            <el-timeline-item v-for="(lg, i) in detail.logs" :key="i"
              :timestamp="fmtTime(lg.at)" :type="lg.f === 'refund' ? 'warning' : 'primary'" size="small">
              <b>{{ lg.goodsName }}</b>&nbsp;{{ logText(lg) }}
              <span v-if="lg.reason" style="color: #999">（{{ lg.reason }}）</span>
            </el-timeline-item>
          </el-timeline>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  orderApi, customerApi, localToday, SOURCE_LABELS, STATUS_LABELS,
} from '@/api/services'

const statusLabels = STATUS_LABELS
const timeSlots = ['早5:00-7:00', '早5:00-8:00', '早6:00-9:00', '上午', '下午', '当天多次']
const sourceLabels = SOURCE_LABELS
const statusTag = (s) => ({ draft: 'info', confirmed: 'primary', sorting: 'warning', ready: 'warning', shipped: 'success', done: 'success', void: 'danger' }[s] || 'info')
const sourceTag = (s) => ({ customer: 'danger', type: 'warning', base: 'info', history: 'info' }[s] || 'info')
const sourceName = (s) => ({ customer: '客', type: '等级', base: '原', history: '历' }[s] || s)
const itemStatus = (s) => ({ pending: '待分拣', sorted: '已分拣', short: '缺货', void: '作废' }[s] || s)
const levelLabel = (v) => ({ default: '默认', A: 'A类', B: 'B类', C: 'C类' }[v] || v)
const settleLabel = (c) => ({ daily: '日结', monthly: '月结', cod: '货到付款' }[c.settlement_type] || c.settlement_type)

const loading = ref(false)
const list = ref([])
const customers = ref([])
const goodsList = ref([])
const query = reactive({ status: '', keyword: '' })

const filteredList = computed(() => {
  const kw = query.keyword.trim()
  if (!kw) return list.value
  return list.value.filter((o) => o.order_no.includes(kw) || (o.customerName || '').includes(kw))
})

const create = reactive({
  visible: false, customerId: null, deliveryDate: localToday(),
  timeSlot: '', items: [], saving: false,
})
const detail = reactive({ visible: false, order: null, items: [], customerName: '', logs: [] })

const draftTotal = computed(() =>
  Math.round(create.items.reduce((s, r) => s + r.qty * r.price, 0) * 100) / 100)

const currentCustomer = computed(() => customers.value.find((c) => c.id === create.customerId) || null)

function onCustomerChange() {
  // 换客户后重新取价（取价链随客户等级/专属价而变）
  create.items.forEach((row) => { if (row.goodsId) resolveRow(row) })
}

async function resolveRow(row) {
  const g = goodsList.value.find((x) => x.id === row.goodsId)
  if (!g) return
  row.unit = g.unit
  const c = currentCustomer.value
  const { priceApi } = await import('@/api/services')
  const chain = await priceApi.resolvePriceChain(g.id, c?.id, c?.level)
  row.price = chain ? chain.price : Number(g.basePrice ?? 0)
  row.source = chain ? chain.source : 'base'
}

function addItem() {
  create.items.push({ goodsId: null, qty: 1, unit: '斤', price: 0, source: 'base' })
}

function onItemGoods(row, gid) {
  row.goodsId = gid
  resolveRow(row)
}

function openCreate() {
  create.customerId = null
  create.deliveryDate = localToday()
  create.timeSlot = ''
  create.items = []
  addItem()
  create.visible = true
}

async function doSave() {
  if (!create.customerId) return ElMessage.warning('请选择客户')
  const items = create.items.filter((r) => r.goodsId && r.qty > 0)
  if (!items.length) return ElMessage.warning('至少一行有效商品明细')
  create.saving = true
  try {
    const customer = currentCustomer.value
    await orderApi.createDraft({
      customer,
      delivery_date: create.deliveryDate,
      time_slot: create.timeSlot,
      items: items.map((r) => ({ goods_id: r.goodsId, qty: r.qty })),
    })
    ElMessage.success('草单已保存')
    create.visible = false
    fetchList()
  } catch (e) {
    if (e?.code === 'CREDIT_LOCK') {
      try {
        await ElMessageBox.confirm(
          `${e.message}。是否强制放行？（将记操作日志）`, '账期锁单',
          { type: 'warning', confirmButtonText: '强制放行', cancelButtonText: '取消' })
        const customer = currentCustomer.value
        await orderApi.createDraft({
          customer,
          delivery_date: create.deliveryDate,
          time_slot: create.timeSlot,
          items: items.map((r) => ({ goods_id: r.goodsId, qty: r.qty })),
        }, { force: true })
        ElMessage.success('已强制放行，草单已保存')
        create.visible = false
        fetchList()
      } catch (e2) {
        if (e2 !== 'cancel' && e2?.message) ElMessage.error(String(e2.message || e2))
      }
    } else {
      ElMessage.error(String(e?.message || e))
    }
  } finally {
    create.saving = false
  }
}

async function fetchList() {
  loading.value = true
  try {
    list.value = await orderApi.list({ status: query.status })
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loading.value = false
  }
}

async function openDetail(row) {  try {
    const { orderApi: oa, refundApi } = await import('@/api/services')
    const { order, items } = await oa.getWithItems(row.id)
    detail.order = order
    detail.items = items
    detail.customerName = row.customerName
    detail.logs = []
    detail.visible = true
    try { detail.logs = await refundApi.itemLogs(order.id) } catch (e) { /* 留痕读取失败不阻断详情 */ }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

// ---------- T3.2 退货 + 改单留痕 ----------
function logCount(row) {
  return Array.isArray(row.edit_log) ? row.edit_log.length : 0
}
function canRefund(row) {
  const qty = row.sorted_qty != null ? Number(row.sorted_qty) : Number(row.order_qty ?? 0)
  return qty > 0 && !['void', 'pending'].includes(row.status) && detail.order && !['void', 'draft'].includes(detail.order.status)
}
function fmtTime(at) {
  const d = new Date(at || '')
  return isNaN(d.getTime()) ? (at || '') : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function logText(lg) {
  if (lg.f === 'refund') return `退货 ${lg.n}（原 ${lg.o}）→ ¥${Number(lg.amt || 0).toFixed(2)}`
  if (lg.f) return `${lg.f}: ${lg.o} → ${lg.n}`
  return JSON.stringify(lg).slice(0, 60)
}
async function loadLogs() {
  if (!detail.order) return
  try {
    const { refundApi } = await import('@/api/services')
    detail.logs = await refundApi.itemLogs(detail.order.id)
  } catch (e) { /* 同上 */ }
}
async function doRefund(row) {
  const maxQty = Number(row.sorted_qty ?? row.order_qty ?? 0)
  try {
    const { value } = await ElMessageBox.prompt(
      `「${row.goods_name}」当前 ${maxQty} ${row.unit}。输入退货数量（默认整行退）`,
      '退货确认',
      { inputValue: String(maxQty), inputPattern: /^\d+(\.\d+)?$/, inputErrorMessage: '请输入有效数量', type: 'warning' },
    )
    const qty = Math.min(Number(value), maxQty)
    let reason = ''
    try {
      const r2 = await ElMessageBox.prompt('退货原因（选填，会记入留痕）', '原因', { inputValue: '', type: 'info' })
      reason = (r2.value || '').trim()
    } catch { /* 取消原因输入 = 空原因 */ }
    const { refundApi } = await import('@/api/services')
    const res = await refundApi.refundItem(detail.order, row, { qty, reason })
    ElMessage.success(`已退货 ${row.goods_name} ${res.refundQty} ${row.unit}，冲减 ¥${res.refundAmount.toFixed(2)}` + (['shipped', 'done'].includes(detail.order.status) ? '（欠款已同步冲减）' : ''))
    openDetail({ id: detail.order.id, customerName: detail.customerName })
    fetchList()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e?.message || e))
  }
}

async function doConfirm(row) {
  await ElMessageBox.confirm(`确认订单 ${row.order_no}？（草单 → 已确认，进入履约）`, '确认订单', { type: 'info' })
  await orderApi.confirm(row.id)
  ElMessage.success('已确认')
  fetchList()
}

async function doVoid(row) {
  await ElMessageBox.confirm(`作废订单 ${row.order_no}？`, '作废确认', { type: 'warning' })
  await orderApi.voidOrder(row.id)
  ElMessage.success('已作废')
  fetchList()
}

onMounted(async () => {
  await fetchList()
  try {
    customers.value = await customerApi.list()
  } catch (e) { /* 未登录等场景列表页仍可用 */ }
  try {
    const { priceApi: pa } = await import('@/api/services')
    goodsList.value = await pa.listGoodsLite()
  } catch (e) { /* 同上 */ }
})
</script>

<style scoped>
.add-row-wrap { text-align: center; margin-top: 10px; }
.add-row-wrap :deep(.el-button) { width: 40px; height: 40px; font-size: 20px; }
</style>
