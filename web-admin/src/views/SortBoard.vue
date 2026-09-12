<template>
  <div class="board">
    <div class="topbar">
      <el-radio-group v-model="dateMode" @change="loadBoard">
        <el-radio-button value="today">今天</el-radio-button>
        <el-radio-button value="tomorrow">明天</el-radio-button>
      </el-radio-group>
      <el-checkbox v-model="autoPrint" border style="margin-left: 16px">分拣完成自动打印标签</el-checkbox>
      <div style="flex: 1" />
      <span class="legend"><i class="dot blue" />未开始 <i class="dot yellow" />进行中 <i class="dot green" />已完成</span>
    </div>

    <div class="cols">
      <!-- 左：订单队列 -->
      <div class="queue">
        <div v-for="o in orders" :key="o.id" class="ocard" :class="[o.color, { sel: current && o.id === current.id }]" @click="selectOrder(o)">
          <div class="ono">{{ o.order_no }}</div>
          <div class="ocust">{{ o.customerName }}</div>
          <div class="oprog">{{ o.sort_done }}/{{ o.sort_total }}</div>
        </div>
        <el-empty v-if="!orders.length" description="该日期没有待分拣订单" :image-size="60" />
      </div>

      <!-- 右：商品分拣 -->
      <div class="work">
        <template v-if="current">
          <!-- 全部完成态：不再依赖选中商品，始终可见 -->
          <div v-if="!currentItem" class="donepanel">
            <span class="bigname">本订单全部分拣完成 ✅（{{ current.sort_done }}/{{ current.sort_total }}）</span>
            <div class="donehint">可在下方点击任意商品重新调整，或直接确认发货</div>
          </div>

          <template v-else>
            <div class="curname">
              <span class="bigname">{{ currentItem.goods_name }}</span>
              <el-tag type="info" size="small">下单 {{ Number(currentItem.order_qty) }} {{ currentItem.unit }}</el-tag>
              <el-tag v-if="currentItem.status === 'sorted'" type="success" size="small">已分拣 {{ Number(currentItem.sorted_qty ?? 0) }}{{ currentItem.unit }}，确认后覆盖</el-tag>
              <el-tag v-if="currentItem.status === 'short'" type="warning" size="small">已登记缺货，输入实际数量确认后恢复</el-tag>
            </div>

            <div class="weightbox">
              <div class="wlabel">本行分拣数量</div>
              <el-input-number v-model="inputQty" :min="0" :precision="2" size="large" style="width: 220px" />
              <span class="wunit">{{ currentItem.unit }}</span>
              <span class="acc">已累计：{{ Number(currentItem.sorted_qty ?? 0) }} {{ currentItem.unit }}（累加称重 = 已累计 + 输入值）</span>
            </div>

            <div class="btns">
              <el-button type="warning" size="large" :disabled="currentItem.status !== 'pending'" @click="doAccumulate">累加称重</el-button>
              <el-button type="danger" size="large" :disabled="currentItem.status !== 'pending'" @click="doShort">缺货</el-button>
              <el-button type="success" size="large" style="min-width: 150px" @click="doSort">
                {{ currentItem.status === 'pending' ? '完成分拣' : '确认覆盖数量' }}
              </el-button>
            </div>
          </template>

          <div class="tabs">
            <span class="t pending">待处理 {{ pendingItems.length }}</span>
            <span class="t warn" v-if="shortItems.length">缺货 {{ shortItems.length }}</span>
            <span class="t done">已分拣 {{ sortedItems.length }}</span>
          </div>
          <div class="items">
            <div v-for="i in pendingItems" :key="'p' + i.id" class="icard" :class="{ cur: currentItem && i.id === currentItem.id }" @click="pickItem(i)">
              <b>{{ i.goods_name }}</b>
              <span>下单 {{ Number(i.order_qty) }}{{ i.unit }}</span>
            </div>
            <div v-for="i in shortItems" :key="'d' + i.id" class="icard shortage" :class="{ cur: currentItem && i.id === currentItem.id }" @click="pickItem(i)">
              <b>{{ i.goods_name }}</b>
              <span style="color:#e6a23c">已登记缺货（点击可恢复）</span>
            </div>
            <div v-for="i in sortedOnly" :key="'s' + i.id" class="icard done" :class="{ cur: currentItem && i.id === currentItem.id }" @click="pickItem(i)">
              <b>{{ i.goods_name }}</b>
              <span>实拣 {{ Number(i.sorted_qty ?? 0) }}{{ i.unit }}（点击可改）</span>
            </div>
            <div v-if="!pendingItems.length && !shortItems.length && !sortedOnly.length" class="emptymini">该订单暂无商品</div>
          </div>

          <div class="tabs"><span class="t done">已分拣明细（可撤销/补签）</span></div>
          <el-table :data="sortedItems" border size="small">
            <el-table-column prop="goods_name" label="品名" min-width="110" />
            <el-table-column label="实拣" width="100" align="right">
              <template #default="{ row }">{{ Number(row.sorted_qty ?? 0) }} {{ row.unit }}</template>
            </el-table-column>
            <el-table-column label="状态" width="80" align="center">
              <template #default="{ row }">{{ row.status === 'short' ? '缺货' : '正常' }}</template>
            </el-table-column>
            <el-table-column label="时间" min-width="150">
              <template #default="{ row }">{{ (row.sort_time || '').replace('T', ' ').slice(0, 19) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="140" align="center">
              <template #default="{ row }">
                <el-button link type="warning" @click="backfill(row)">补签</el-button>
                <el-button link type="danger" @click="doUndo(row)">撤销</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div style="margin-top: 18px" v-if="current.status === 'ready'">
            <el-button type="primary" size="large" @click="doShip">✓ 分拣完成，确认发货（挂应收）</el-button>
          </div>
        </template>
        <el-empty v-else description="← 选择左侧订单开始分拣" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sortApi, orderApi } from '@/api/services'
import { printHtml } from '@/lib/printTemplates'

const dateMode = ref('today')
const autoPrint = ref(false)
const orders = ref([])
const current = ref(null)
const items = ref([])
const currentItem = ref(null)
const inputQty = ref(0)

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const boardDate = computed(() => {
  const d = new Date()
  if (dateMode.value === 'tomorrow') d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

const pendingItems = computed(() => items.value.filter((i) => i.status === 'pending'))
const shortItems = computed(() => items.value.filter((i) => i.status === 'short'))
const sortedOnly = computed(() => items.value.filter((i) => i.status === 'sorted'))
const sortedItems = computed(() => items.value.filter((i) => i.status === 'sorted' || i.status === 'short'))

async function loadBoard() {
  try {
    orders.value = await sortApi.boardOrders(boardDate.value)
    if (current.value) {
      const still = orders.value.find((o) => o.id === current.value.id)
      if (still) Object.assign(current.value, still)
      else { current.value = null; items.value = []; currentItem.value = null }
    }
    // 切页/刷新回来自动选中订单（优先已分拣完待发货的），发货按钮不丢失
    if (!current.value && orders.value.length) {
      const first = orders.value.find((o) => o.status === 'ready') || orders.value[0]
      await selectOrder(first)
    }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function selectOrder(o) {
  current.value = { ...o }
  items.value = await sortApi.itemsFor(o.id)
  pickItem(pendingItems.value[0] || shortItems.value[0] || sortedOnly.value[0] || null)
}

function pickItem(i) {
  currentItem.value = i
  // 未分拣/缺货预填 0；已分拣预填实拣量
  if (!i) { inputQty.value = 0; return }
  inputQty.value = Number(i.status === 'sorted' ? (i.sorted_qty ?? 0) : 0)
}

async function refresh() {
  if (!current.value) return
  const prog = await sortApi.refreshProgress(current.value.id)
  items.value = await sortApi.itemsFor(current.value.id)
  Object.assign(current.value, prog)
  const o = orders.value.find((x) => x.id === current.value.id)
  if (o) {
    o.sort_done = prog.done
    o.color = prog.done >= prog.total && prog.total ? 'green' : prog.done > 0 ? 'yellow' : 'blue'
  }
  return prog
}

async function doSort() {
  const it = currentItem.value
  if (!it || inputQty.value <= 0) return ElMessage.warning('请输入分拣数量')
  // 防误触：对已有分拣结果/缺货登记的行覆盖前二次确认
  if (it.status !== 'pending') {
    try {
      await ElMessageBox.confirm(
        `「${it.goods_name}」当前为${it.status === 'short' ? '缺货登记' : '已分拣 ' + Number(it.sorted_qty ?? 0) + it.unit}，确认覆盖为 ${inputQty.value} ${it.unit}？`,
        '覆盖确认', { type: 'warning' })
    } catch { return }
  }
  try {
    await sortApi.applySort(it, inputQty.value, 'input')
    if (autoPrint.value) printLabel(it, inputQty.value)
    ElMessage.success(`${it.goods_name} 已分拣 ${inputQty.value}`)
    const prog = await refresh()
    const next = pendingItems.value[0]
    if (next) {
      pickItem(next)
    } else {
      // 全部完成：停在完成态面板，发货按钮始终可见
      currentItem.value = null
      inputQty.value = 0
      if (prog.status === 'ready') ElMessage.success('该订单全部分拣完成，可确认发货')
    }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function doAccumulate() {
  const it = currentItem.value
  if (!it || inputQty.value <= 0) return ElMessage.warning('请输入本次称重数量')
  const acc = Math.round((Number(it.sorted_qty ?? 0) + inputQty.value) * 100) / 100
  try {
    await sortApi.applySort({ ...it }, acc, 'accumulate')
    ElMessage.success(`已累加，本行累计 ${acc} ${it.unit}`)
    await refresh()
    const again = items.value.find((x) => x.id === it.id)
    if (again) pickItem(again)
    inputQty.value = 0
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function doShort() {
  const it = currentItem.value
  if (!it) return
  try {
    await sortApi.markShort(it)
    ElMessage.warning(`${it.goods_name} 登记缺货（可点击黄色卡片恢复）`)
    await refresh()
    const next = pendingItems.value[0]
    if (next) pickItem(next)
    else { currentItem.value = null; inputQty.value = 0 }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function doUndo(row) {
  try {
    await sortApi.undoItem(row)
    ElMessage.success('已撤销，回待分拣')
    await refresh()
    if (!pendingItems.value.some((i) => i.id === currentItem.value?.id)) {
      currentItem.value = pendingItems.value[0] || null
      if (currentItem.value) pickItem(currentItem.value)
    }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function backfill(row) {
  const { value } = await ElMessageBox.prompt(`补签「${row.goods_name}」实拣数量`, '补签', { inputValue: Number(row.sorted_qty ?? 0) })
  const qty = Number(value)
  if (!(qty >= 0)) return
  await sortApi.applySort(row, qty, 'input')
  ElMessage.success('已补签')
  refresh()
}

function printLabel(item, qty) {
  const customerName = current.value?.customerName || ''
  const time = new Date().toLocaleString('zh-CN', { hour12: false })
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>标签</title>
<style>@page{size:80mm auto;margin:2mm}*{margin:0;padding:0;box-sizing:border-box}
body{width:74mm;font-family:"Microsoft YaHei";color:#000}
.cust{font-size:22pt;font-weight:700;text-align:center;border-bottom:1px dashed #000;padding:2mm 0}
.name{font-size:16pt;font-weight:700;margin-top:2mm}
.qty{font-size:26pt;font-weight:700;text-align:center;padding:2mm 0}
.meta{font-size:9pt;text-align:center;color:#333;border-top:1px dashed #000;padding:1.5mm 0}</style></head><body>
<div class="cust">${customerName}</div>
<div class="name">品名：${item.goods_name}</div>
<div class="qty">${qty} ${item.unit}</div>
<div class="meta">${time} · 鲜配 · 分拣标签</div>
</body></html>`
  printHtml(html)
}

async function doShip() {
  try {
    await ElMessageBox.confirm('确认整单发货？（状态→已发货，金额挂入往来应收）', '发货', { type: 'info' })
  } catch { return }
  try {
    const { ledgerApi } = await import('@/api/services')
    const balance = await ledgerApi.shipOrder(current.value)
    ElMessage.success(`已发货，应收已挂账，该客户当前欠款 ¥${Number(balance).toFixed(2)}`)
    loadBoard()
    current.value = null
    items.value = []
    currentItem.value = null
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

onMounted(loadBoard)
</script>

<style scoped>
.board { }
.topbar { display: flex; align-items: center; margin-bottom: 12px; }
.legend { color: #888; font-size: 13px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 4px 0 12px; }
.dot.blue { background: #3b82f6; } .dot.yellow { background: #e6a23c; } .dot.green { background: #1f9d55; }
.cols { display: flex; gap: 12px; align-items: flex-start; }
.queue { width: 230px; flex-shrink: 0; }
.ocard { background: #fff; border: 2px solid #e5e7eb; border-left-width: 8px; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; cursor: pointer; }
.ocard.blue { border-left-color: #3b82f6; }
.ocard.yellow { border-left-color: #e6a23c; }
.ocard.green { border-left-color: #1f9d55; background: #f0fdf4; }
.ocard.sel { outline: 2px solid #1f9d55; }
.ono { font-size: 13px; color: #666; }
.ocust { font-size: 18px; font-weight: 700; margin: 4px 0; }
.oprog { font-size: 24px; font-weight: 700; color: #1f9d55; }
.work { flex: 1; background: #fff; border-radius: 10px; padding: 16px; min-height: 300px; }
.curname { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.bigname { font-size: 26px; font-weight: 700; }
.weightbox { display: flex; align-items: center; gap: 14px; background: #f6f8f7; border-radius: 10px; padding: 14px; margin-bottom: 12px; flex-wrap: wrap; }
.wlabel { color: #555; }
.wunit { font-size: 20px; font-weight: 700; }
.acc { color: #888; font-size: 13px; }
.btns { display: flex; gap: 10px; margin-bottom: 14px; }
.tabs { margin: 12px 0 8px; }
.t { font-weight: 600; margin-right: 16px; }
.t.pending { color: #3b82f6; }
.t.warn { color: #e6a23c; }
.t.done { color: #1f9d55; }
.items { display: flex; flex-wrap: wrap; gap: 10px; }
.icard { border: 2px solid #d1d5db; border-radius: 10px; padding: 10px 14px; cursor: pointer; min-width: 120px; }
.icard b { font-size: 17px; display: block; }
.icard span { color: #666; }
.icard.cur { border-color: #1f9d55; background: #f0fdf4; }
.icard.done { border-style: dashed; }
.icard.shortage { border-color: #e6a23c; background: #fdf6ec; }
.donepanel { background: #f0fdf4; border: 1px solid #1f9d55; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
.donehint { color: #666; font-size: 13px; margin-top: 6px; }
.emptymini { color: #999; padding: 12px; }
</style>
