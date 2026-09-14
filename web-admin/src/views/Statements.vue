<template>
  <div>
    <el-row :gutter="14" style="margin-bottom: 14px">
      <el-col :span="8"><el-card shadow="hover"><div class="label">应收总额（累计）</div><div class="num">¥{{ total.receivable.toFixed(2) }}</div></el-card></el-col>
      <el-col :span="8"><el-card shadow="hover"><div class="label">实收总额</div><div class="num ok">¥{{ total.received.toFixed(2) }}</div></el-card></el-col>
      <el-col :span="8"><el-card shadow="hover"><div class="label">欠款余额</div><div class="num danger">¥{{ total.balance.toFixed(2) }}</div></el-card></el-col>
    </el-row>

    <el-card shadow="never">
      <div style="display: flex; gap: 10px; margin-bottom: 12px">
        <el-input v-model="keyword" placeholder="客户名称" clearable style="width: 220px" />
        <el-button type="primary" @click="loadAll">搜索</el-button>
        <el-button @click="doExport">导出 CSV</el-button>
      </div>
      <el-table :data="filtered" v-loading="loading" border stripe @row-click="(r) => openFlows(r)">
        <el-table-column prop="name" label="客户" min-width="140" />
        <el-table-column label="应收累计" width="120" align="right">
          <template #default="{ row }">¥{{ row.receivable.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="实收累计" width="120" align="right">
          <template #default="{ row }">¥{{ row.received.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="欠款余额" width="120" align="right">
          <template #default="{ row }">
            <span :class="row.balance > 0 ? 'danger' : ''">¥{{ row.balance.toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最近往来" min-width="160">
          <template #default="{ row }">{{ (row.last || '').replace('T', ' ').slice(0, 16) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="210" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openFlows(row)">流水</el-button>
            <el-button link type="success" @click.stop="openPay(row)">登记收款</el-button>
            <el-button link type="warning" @click.stop="openStatement(row)">对账单</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 登记收款 -->
    <el-dialog v-model="pay.visible" :title="`登记收款 · ${pay.customerName}`" width="420px">
      <el-form label-width="90px">
        <el-form-item label="当前欠款"><b style="color:#e64340">¥{{ pay.balance.toFixed(2) }}</b></el-form-item>
        <el-form-item label="收款金额"><el-input-number v-model="pay.amount" :min="0.01" :precision="2" style="width: 200px" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="pay.note" placeholder="如：现金/转账 9月货款" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pay.visible = false">取消</el-button>
        <el-button type="success" :loading="pay.saving" @click="doReceive">确认收款</el-button>
      </template>
    </el-dialog>

    <!-- 月度对账单 -->
    <el-dialog v-model="st.visible" :title="`月度对账单 · ${st.customerName}`" width="760px">
      <div style="display:flex;gap:10px;margin-bottom:10px;align-items:center">
        <el-date-picker v-model="st.month" type="month" value-format="YYYY-MM" :clearable="false" style="width: 140px" @change="loadStatement" />
        <div style="flex:1" />
        <el-button @click="printStatement">打印 / 存 PDF</el-button>
      </div>
      <el-descriptions :column="4" border size="small">
        <el-descriptions-item label="期初欠款">¥{{ st.data.opening.toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="本月应收">¥{{ st.data.receivableTotal.toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="本月收款">¥{{ st.data.receivedTotal.toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="期末欠款"><b style="color:#e64340">¥{{ st.data.closing.toFixed(2) }}</b></el-descriptions-item>
      </el-descriptions>
      <el-table :data="st.data.flows" border size="small" style="margin-top:10px">
        <el-table-column prop="date" label="日期" width="100" />
        <el-table-column label="方向" width="80" align="center">
          <template #default="{ row }">{{ row.direction === 'receivable' ? '应收' : '收款' }}</template>
        </el-table-column>
        <el-table-column prop="orderNo" label="关联单号" min-width="150" />
        <el-table-column label="金额" width="100" align="right">
          <template #default="{ row }">¥{{ row.amount.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="余额" width="110" align="right">
          <template #default="{ row }">{{ row.balanceAfter != null ? '¥' + row.balanceAfter.toFixed(2) : '-' }}</template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="flows.visible" :title="`往来流水 · ${flows.customerName}`" width="760px">
      <el-table :data="flows.rows" border size="small">
        <el-table-column label="方向" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.direction === 'receivable' ? 'warning' : 'success'" size="small">
              {{ row.direction === 'receivable' ? '应收' : '实收' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110" align="right">
          <template #default="{ row }">¥{{ row.amount.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="关联单号" min-width="160">
          <template #default="{ row }">{{ row.orderNo }}</template>
        </el-table-column>
        <el-table-column label="欠款余额（当时）" width="140" align="right">
          <template #default="{ row }">{{ row.balanceAfter != null ? '¥' + row.balanceAfter.toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column label="时间" min-width="160">
          <template #default="{ row }">{{ (row.created_at || '').replace('T', ' ').slice(0, 19) }}</template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ledgerApi } from '@/api/services'
import { exportCsv, todayTag } from '@/utils/exportCsv'
import { printHtml } from '@/lib/printTemplates'

const loading = ref(false)
const rows = ref([])
const keyword = ref('')
const flows = reactive({ visible: false, customerName: '', rows: [] })

const total = computed(() => ({
  receivable: rows.value.reduce((s, c) => s + c.receivable, 0),
  received: rows.value.reduce((s, c) => s + c.received, 0),
  balance: rows.value.reduce((s, c) => s + c.balance, 0),
}))
const filtered = computed(() => {
  const kw = keyword.value.trim()
  return kw ? rows.value.filter((c) => c.name.includes(kw)) : rows.value
})

async function loadAll() {
  loading.value = true
  try {
    rows.value = await ledgerApi.summary()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loading.value = false
  }
}

function doExport() {
  const headers = ['客户', '应收累计', '实收累计', '欠款余额']
  const rows = filtered.value.map((c) => [c.name, c.receivable.toFixed(2), c.received.toFixed(2), c.balance.toFixed(2)])
  exportCsv('对账汇总_' + todayTag() + '.csv', headers, rows)
}

async function openFlows(row) {
  try {
    flows.customerName = row.name
    flows.rows = await ledgerApi.flows(row.customerId)
    flows.visible = true
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

/* 登记收款（T2.14） */
const pay = reactive({ visible: false, customerName: '', customerId: null, balance: 0, amount: null, note: '', saving: false })

function openPay(row) {
  pay.customerName = row.name
  pay.customerId = row.customerId
  pay.balance = row.balance
  pay.amount = row.balance > 0 ? row.balance : null
  pay.note = ''
  pay.visible = true
}

async function doReceive() {
  if (!(pay.amount > 0)) return ElMessage.warning('请填写收款金额')
  pay.saving = true
  try {
    const balance = await ledgerApi.receivePayment(pay.customerId, pay.amount, pay.note)
    ElMessage.success(`已登记收款 ¥${pay.amount.toFixed(2)}，${pay.customerName} 欠款余额 ¥${balance.toFixed(2)}`)
    pay.visible = false
    loadAll()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    pay.saving = false
  }
}

/* 月度对账单（T2.14） */
const st = reactive({
  visible: false, customerName: '', customerId: null,
  month: new Date().toISOString().slice(0, 7),
  data: { opening: 0, closing: 0, receivableTotal: 0, receivedTotal: 0, flows: [] },
})

function openStatement(row) {
  st.customerName = row.name
  st.customerId = row.customerId
  st.visible = true
  loadStatement()
}

async function loadStatement() {
  try {
    st.data = await ledgerApi.monthlyStatement(st.customerId, st.month)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

function printStatement() {
  const d = st.data
  const rows = d.flows.map((f) =>
    `<tr><td>${f.date}</td><td>${f.direction === 'receivable' ? '应收' : '收款'}</td><td>${f.orderNo}</td><td class="r">${f.amount.toFixed(2)}</td><td class="r">${f.balanceAfter != null ? f.balanceAfter.toFixed(2) : '-'}</td></tr>`).join('')
  printHtml(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>对账单</title>
<style>@page{size:A4;margin:14mm}*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Microsoft YaHei";color:#000;font-size:11pt}
h2{text-align:center;letter-spacing:6px;margin-bottom:4mm}
.sub{text-align:center;color:#444;margin-bottom:6mm}
.meta{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:2mm;margin-bottom:4mm}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:1.6mm;font-size:10pt}
th{background:#f2f2f2}.r{text-align:right}
.sum{margin-top:3mm;font-weight:700}
.foot{margin-top:10mm;display:flex;justify-content:space-between}</style></head><body>
<h2>月度对账单</h2>
<div class="sub">鲜配 · 示例商家A</div>
<div class="meta">
<div>客户：${d.customerName}</div><div>月份：${d.month}</div>
<div>期初欠款：¥${d.opening.toFixed(2)}</div><div>期末欠款：¥${d.closing.toFixed(2)}</div>
</div>
<table><thead><tr><th>日期</th><th>方向</th><th>关联单号</th><th>金额</th><th>余额</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sum">本月应收合计 ¥${d.receivableTotal.toFixed(2)}　本月收款合计 ¥${d.receivedTotal.toFixed(2)}　期末欠款 ¥${d.closing.toFixed(2)}</div>
<div class="foot"><div>制单：＿＿＿＿</div><div>客户确认（盖章）：＿＿＿＿</div></div>
</body></html>`)
}

onMounted(loadAll)
</script>

<style scoped>
.label { color: #888; font-size: 13px; }
.num { font-size: 24px; font-weight: 700; margin-top: 6px; }
.num.ok { color: #1f9d55; }
.num.danger { color: #e64340; }
.danger { color: #e64340; }
</style>
