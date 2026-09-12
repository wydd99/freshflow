<template>
  <div>
    <el-alert type="success" :closable="false" style="margin-bottom: 12px"
      title="采购流程：选发货日期 → 自动聚合需采购量 → 生成采购单 → 到货后回填实买数量与采购价（采购价自动喂给录单最近价与成本利润）" />

    <el-card shadow="never" style="margin-bottom: 14px">
      <div class="ctitle">① 生成采购计划</div>
      <el-form inline>
        <el-form-item label="发货日期">
          <el-date-picker v-model="plan.deliveryDate" type="date" value-format="YYYY-MM-DD" :clearable="false" />
        </el-form-item>
        <el-form-item label="预计到货日">
          <el-date-picker v-model="plan.deliveryTarget" type="date" value-format="YYYY-MM-DD" :clearable="false" />
        </el-form-item>
        <el-form-item label="供应商/市场"><el-input v-model="plan.supplier" placeholder="可空，如 双福市场" style="width: 160px" /></el-form-item>
        <el-button type="primary" :loading="plan.loading" @click="aggregate">聚合需采购量</el-button>
      </el-form>

      <el-table v-if="plan.rows.length" :data="plan.rows" border size="small" style="max-width: 720px">
        <el-table-column prop="name" label="品名" min-width="140" />
        <el-table-column prop="unit" label="单位" width="70" align="center" />
        <el-table-column label="需采购量" width="110" align="right">
          <template #default="{ row }">{{ row.qty }}</template>
        </el-table-column>
      </el-table>
      <el-button v-if="plan.rows.length" type="success" style="margin-top: 10px"
        :loading="plan.creating" @click="generatePo">
        确认生成采购单（{{ plan.rows.length }} 项）
      </el-button>
    </el-card>

    <el-card shadow="never">
      <div style="display: flex; gap: 10px; margin-bottom: 12px">
        <b>② 采购单列表</b>
        <div style="flex: 1" />
        <el-select v-model="listFilter" placeholder="全部状态" clearable style="width: 140px" @change="loadList">
          <el-option v-for="(l, k) in poStatus" :key="k" :label="l" :value="k" />
        </el-select>
      </div>

      <el-table :data="list" v-loading="listLoading" border stripe>
        <el-table-column prop="po_no" label="采购单号" width="150" />
        <el-table-column prop="plan_date" label="采购日" width="110" align="center" />
        <el-table-column prop="delivery_date" label="对应发货日" width="120" align="center" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" size="small">{{ poStatus[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="supplier_note" label="供应商/市场" min-width="120" />
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="openPo(row)">明细/到货</el-button>
            <el-button v-if="row.status !== 'void'" link type="danger" @click="doVoid(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 采购单明细/到货回填 -->
    <el-dialog v-model="dlg.visible" :title="`采购明细 · ${dlg.po.po_no}（${poStatus[dlg.po.status] || ''}）`" width="720px">
      <el-table :data="dlg.items" border size="small">
        <el-table-column prop="goods_name" label="品名" min-width="120" />
        <el-table-column label="需采购" width="90" align="right">
          <template #default="{ row }">{{ Number(row.need_qty) }} {{ row.unit }}</template>
        </el-table-column>
        <el-table-column label="实买数量" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row._bought" :min="0" :precision="2" size="small" style="width: 110px" :disabled="row.status === 'done'" />
          </template>
        </el-table-column>
        <el-table-column label="采购单价" width="150">
          <template #default="{ row }">
            <el-input-number v-model="row._cost" :min="0" :precision="2" size="small" style="width: 120px" />
          </template>
        </el-table-column>
        <el-table-column label="行状态" width="90" align="center">
          <template #default="{ row }">{{ row.status === 'done' ? '已到货' : '待到货' }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="dlg.visible = false">关闭</el-button>
        <el-button type="success" :loading="dlg.saving" @click="saveAll">保存到货回填</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { purchaseApi, localToday } from '@/api/services'

const poStatus = purchaseApi.PO_STATUS
const statusTag = (s) => ({ draft: 'info', ordered: 'warning', partial: 'warning', received: 'success', void: 'danger' }[s] || 'info')

const list = ref([])
const listLoading = ref(false)
const listFilter = ref('')

const plan = reactive({
  deliveryDate: '', deliveryTarget: '', supplier: '', rows: [], loading: false, creating: false,
})
const dlg = reactive({ visible: false, po: {}, items: [], saving: false })

async function aggregate() {
  if (!plan.deliveryDate) return ElMessage.warning('请选发货日期')
  plan.loading = true
  try {
    plan.rows = await purchaseApi.aggregateNeed(plan.deliveryDate)
    if (!plan.rows.length) ElMessage.info('该发货日期没有订单，无需采购')
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    plan.loading = false
  }
}

async function generatePo() {
  plan.creating = true
  try {
    const po = await purchaseApi.createPo({
      plan_date: localToday(),
      delivery_date: plan.deliveryTarget || plan.deliveryDate,
      supplier_note: plan.supplier,
      items: plan.rows,
    })
    ElMessage.success(`采购单 ${po.po_no} 已生成`)
    plan.rows = []
    loadList()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    plan.creating = false
  }
}

async function loadList() {
  listLoading.value = true
  try {
    list.value = await purchaseApi.list(listFilter.value)
  } finally {
    listLoading.value = false
  }
}

async function openPo(row) {
  dlg.po = row
  dlg.items = (await purchaseApi.itemsFor(row.id)).map((i) => ({
    ...i,
    _bought: i.bought_qty != null ? Number(i.bought_qty) : undefined,
    _cost: i.cost_price != null ? Number(i.cost_price) : undefined,
  }))
  dlg.visible = true
}

async function saveAll() {
  dlg.saving = true
  try {
    for (const i of dlg.items) {
      if (i._bought != null && i._bought > 0) {
        await purchaseApi.receiveItem(i, i._bought, i._cost)
      }
    }
    const prog = await purchaseApi.recalcPo(dlg.po.id)
    dlg.po.status = prog.status
    ElMessage.success(`已保存到货回填，整单状态：${poStatus[prog.status]}`)
    dlg.visible = false
    loadList()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    dlg.saving = false
  }
}

async function doVoid(row) {
  await ElMessageBox.confirm(`作废采购单 ${row.po_no}？`, '作废确认', { type: 'warning' })
  await purchaseApi.voidPo(row.id)
  ElMessage.success('已作废')
  loadList()
}

onMounted(() => {
  plan.deliveryDate = localToday(1)
  plan.deliveryTarget = localToday(0)
  loadList()
})
</script>

<style scoped>
.ctitle { font-weight: 600; margin-bottom: 10px; }
</style>
