<template>
  <div>
    <el-alert type="success" :closable="false" style="margin-bottom: 12px"
      title="库存口径：采购到货自动入库、发货自动出库（均留流水），此页看水位/手工调整/设预警。库存 ≤ 预警阈值时标红" />

    <el-card shadow="never">
      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
        <el-input v-model="keyword" placeholder="品名 / 编码" clearable style="width: 220px" @keyup.enter="fetchList" @clear="fetchList" />
        <el-switch v-model="onlyAlert" active-text="只看预警" style="margin-left: 8px" />
        <el-button type="primary" @click="fetchList">搜索</el-button>
      </div>

      <el-table :data="filtered" v-loading="loading" border stripe>
        <el-table-column prop="name" label="品名" min-width="140" />
        <el-table-column prop="unit" label="单位" width="70" align="center" />
        <el-table-column label="当前库存" width="110" align="right">
          <template #default="{ row }">
            <span :class="alerting(row) ? 'danger' : ''" style="font-weight: 700">{{ Number(row.stock_qty ?? 0) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="预警阈值" width="100" align="right">
          <template #default="{ row }">{{ row.stock_alert != null ? row.stock_alert : '未设' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <el-button link type="warning" @click="openAdjust(row)">手工调整</el-button>
            <el-button link type="primary" @click="openAlert(row)">设预警</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" style="margin-top: 14px">
      <div class="ctitle">最近库存流水（含采购入库 / 发货出库 / 手工调整）</div>
      <el-table :data="flows" border size="small">
        <el-table-column prop="goodsName" label="品名" min-width="120" />
        <el-table-column label="变动" width="100" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.delta >= 0 ? '#1f9d55' : '#e64340', fontWeight: 700 }">
              {{ row.delta >= 0 ? '+' : '' }}{{ row.delta }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="原因" width="110" align="center">
          <template #default="{ row }">{{ reasonName(row.reason) }}</template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="140" />
        <el-table-column label="时间" min-width="150">
          <template #default="{ row }">{{ (row.created_at || '').replace('T', ' ').slice(0, 19) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="adjust.visible" title="手工调整库存" width="440px">
      <el-form label-width="90px">
        <el-form-item label="商品"><b>{{ adjust.goodsName }}</b></el-form-item>
        <el-form-item label="变动数量">
          <el-input-number v-model="adjust.delta" :precision="2" />
          <span class="hint">正数=入库，负数=出库（如盘点修正）</span>
        </el-form-item>
        <el-form-item label="原因"><el-input v-model="adjust.note" placeholder="如：盘盈 3 斤" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjust.visible = false">取消</el-button>
        <el-button type="primary" @click="doAdjust">确认调整</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="alertDlg.visible" title="设置库存预警阈值" width="400px">
      <el-form label-width="90px">
        <el-form-item label="商品"><b>{{ alertDlg.goodsName }}</b></el-form-item>
        <el-form-item label="预警阈值">
          <el-input-number v-model="alertDlg.value" :min="0" :precision="2" />
          <span class="hint">库存 ≤ 此值时在库存页标红提醒（空=不预警）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="alertDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="doSaveAlert">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { inventoryApi, goodsApi } from '@/api/services'

const loading = ref(false)
const list = ref([])
const keyword = ref('')
const onlyAlert = ref(false)
const flows = ref([])
const adjust = reactive({ visible: false, goodsId: null, goodsName: '', delta: 0, note: '' })
const alertDlg = reactive({ visible: false, goodsId: null, goodsName: '', value: 0 })

const filtered = computed(() => {
  const kw = keyword.value.trim()
  return list.value.filter((g) => {
    if (kw && !(g.name.includes(kw) || (g.code || '').includes(kw))) return false
    if (onlyAlert.value && !(g.stock_alert != null && Number(g.stock_qty ?? 0) <= Number(g.stock_alert))) return false
    return true
  })
})

function alerting(row) {
  return row.stock_alert != null && Number(row.stock_qty ?? 0) <= Number(row.stock_alert)
}
function reasonName(r) {
  return { purchase_in: '采购入库', ship_out: '发货出库', adjust: '手工调整' }[r] || r
}

async function fetchList() {
  loading.value = true
  try {
    list.value = await goodsApi.list({ keyword: keyword.value })
    flows.value = await inventoryApi.flows(50)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loading.value = false
  }
}

function openAdjust(row) {
  adjust.goodsId = row.id
  adjust.goodsName = row.name
  adjust.delta = 0
  adjust.note = ''
  adjust.visible = true
}

async function doAdjust() {
  if (!adjust.delta) return ElMessage.warning('变动数量不能为 0')
  try {
    await inventoryApi.adjust(adjust.goodsId, adjust.delta, adjust.note)
    ElMessage.success('已调整')
    adjust.visible = false
    fetchList()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

function openAlert(row) {
  alertDlg.goodsId = row.id
  alertDlg.goodsName = row.name
  alertDlg.value = row.stock_alert != null ? Number(row.stock_alert) : 0
  alertDlg.visible = true
}

async function doSaveAlert() {
  try {
    const row = list.value.find((g) => g.id === alertDlg.goodsId)
    await goodsApi.save({ ...row, stock_alert: alertDlg.value })
    ElMessage.success('预警阈值已保存')
    alertDlg.visible = false
    fetchList()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

onMounted(fetchList)
</script>

<style scoped>
.ctitle { font-weight: 600; margin-bottom: 10px; }
.hint { margin-left: 10px; color: #999; font-size: 12px; }
.danger { color: #e64340; font-weight: 700; }
</style>
