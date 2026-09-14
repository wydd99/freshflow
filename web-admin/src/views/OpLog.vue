<template>
  <div>
    <el-card shadow="never">
      <div style="margin-bottom: 12px; display: flex; gap: 10px">
        <el-select v-model="actionFilter" style="width: 180px" clearable placeholder="全部操作">
          <el-option label="全部操作" value="" />
          <el-option label="草单整合" value="merge_draft" />
          <el-option label="强制赊账放行" value="credit_force_pass" />
          <el-option label="设备踢除" value="kick_device" />
        </el-select>
        <el-button @click="load">刷新</el-button>
        <el-button @click="doExport">导出 CSV</el-button>
        <span class="hint">记录系统里的关键操作（谁、何时、对什么做的），最近 200 条</span>
      </div>
      <el-table :data="filtered" v-loading="loading" border stripe size="small">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }"><el-tag size="small" :type="tagOf(row.action)">{{ nameOf(row.action) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="对象" width="160">
          <template #default="{ row }">{{ row.entity }} #{{ row.entity_id }}</template>
        </el-table-column>
        <el-table-column label="详情" min-width="240">
          <template #default="{ row }"><span class="mono">{{ detailOf(row) }}</span></template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { db } from '@/lib/cloudbase'
import { exportCsv, todayTag } from '@/utils/exportCsv'

const rows = ref([])
const loading = ref(false)
const actionFilter = ref('')

const filtered = computed(() => (actionFilter.value ? rows.value.filter((r) => r.action === actionFilter.value) : rows.value))

function fmt(t) {
  if (!t) return ''
  return String(t).replace('T', ' ').slice(0, 19)
}
function nameOf(a) {
  return { merge_draft: '草单整合', credit_force_pass: '强制赊账放行', kick_device: '设备踢除' }[a] || a
}
function tagOf(a) {
  return { merge_draft: 'info', credit_force_pass: 'warning', kick_device: 'danger' }[a] || ''
}
function detailOf(row) {
  try { return JSON.stringify(row.detail || {}) } catch (e) { return '' }
}

async function load() {
  loading.value = true
  try {
    const res = await db.from('op_log').select('*').order('created_at', { ascending: false }).limit(200)
    const list = (res?.data ?? res) || []
    rows.value = Array.isArray(list) ? list : []
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loading.value = false
  }
}

function doExport() {
  const headers = ['时间', '操作', '对象', '对象ID', '详情']
  const data = filtered.value.map((r) => [fmt(r.created_at), nameOf(r.action), r.entity, r.entity_id, detailOf(r)])
  exportCsv('操作日志_' + todayTag() + '.csv', headers, data)
}

onMounted(load)
</script>

<style scoped>
.hint { color: #999; font-size: 12px; align-self: center; }
.mono { font-family: Consolas, monospace; font-size: 12px; color: #666; }
</style>
