<template>
  <div>
    <el-alert type="success" :closable="false" style="margin-bottom: 12px"
      title="打印三件套（需求#4/#14）：配货单A4纯文字 / 出库单A4表格（大写金额·三联）/ 80mm小票；打印自动记流水与补打次数。浏览器弹出打印框后选择打印机即可" />

    <el-card shadow="never">
      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
        <el-select v-model="orderId" filterable placeholder="选择订单（可搜单号/客户）" style="width: 340px" @change="onOrderChange">
          <el-option v-for="o in orders" :key="o.id" :value="o.id"
            :label="`${o.order_no} · ${o.customerName} · ${o.delivery_date} · ¥${o.amountOriginal.toFixed(2)}`" />
        </el-select>
        <el-radio-group v-model="template">
          <el-radio-button v-for="(t, key) in templates" :key="key" :value="key">{{ t.label }}</el-radio-button>
        </el-radio-group>
        <el-input-number v-model="copies" :min="1" :max="10" style="width: 110px" />
        <div style="flex: 1" />
        <el-button :disabled="!html" @click="preview.visible = true">预览</el-button>
        <el-button type="primary" :disabled="!html" :loading="printing" @click="doPrint">打印</el-button>
      </div>

      <el-empty v-if="!orderId" description="选择订单后生成票据预览" />
      <el-empty v-else-if="!html" description="该订单暂无有效明细行" />
    </el-card>

    <el-card v-if="orderId && printLogs.length" shadow="never" style="margin-top: 12px">
      <div style="font-weight: 600; margin-bottom: 8px">打印记录（共打印 {{ printCount }} 次）</div>
      <el-table :data="printLogs" border size="small">
        <el-table-column label="模板" min-width="160">
          <template #default="{ row }">{{ templates[row.template]?.label || row.template }}</template>
        </el-table-column>
        <el-table-column prop="copies" label="份数" width="80" align="center" />
        <el-table-column prop="created_at" label="时间" min-width="180" />
      </el-table>
    </el-card>

    <el-dialog v-model="preview.visible" :title="'预览 · ' + (templates[template]?.label || '')" :width="templates[template]?.width || '800px'">
      <iframe :srcdoc="html" style="width: 100%; height: 60vh; border: 1px solid #ddd; background: #fff" />
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { orderApi, printApi } from '@/api/services'
import { TEMPLATES, printHtml } from '@/lib/printTemplates'

const templates = TEMPLATES
const orders = ref([])
const orderId = ref(null)
const template = ref('peihuo_a4')
const copies = ref(1)
const printing = ref(false)
const printLogs = ref([])
const printCount = ref(0)
const preview = reactive({ visible: false })

const current = ref(null) // { order, items }
const html = computed(() => {
  if (!current.value || !current.value.items.length) return ''
  const t = templates[template.value]
  const meta = {
    printedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    printNo: printCount.value + 1,
    customerName: current.value.order.customerName,
  }
  return t.build(current.value.order, current.value.items, meta)
})

async function onOrderChange() {
  printLogs.value = []
  printCount.value = 0
  current.value = null
  if (!orderId.value) return
  try {
    const row = orders.value.find((o) => o.id === orderId.value)
    const data = await orderApi.getWithItems(orderId.value)
    current.value = { order: { ...data.order, customerName: row?.customerName || '' }, items: data.items }
    printLogs.value = await printApi.listByOrder(orderId.value)
    printCount.value = Number(data.order.print_count ?? 0)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function doPrint() {
  if (!html.value) return
  printing.value = true
  try {
    printHtml(html.value)
    printCount.value = await printApi.record(orderId.value, template.value, copies.value)
    printLogs.value = await printApi.listByOrder(orderId.value)
    ElMessage.success('打印任务已发送，流水已记录')
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    printing.value = false
  }
}

onMounted(async () => {
  try {
    orders.value = (await orderApi.list()).filter((o) => o.status !== 'void')
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
})
</script>
