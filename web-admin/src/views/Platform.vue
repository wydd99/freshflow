<template>
  <div>
    <div v-if="!checked" v-loading="true" style="height: 200px"></div>
    <el-alert v-else-if="!isPlatform" type="warning" :closable="false"
      title="当前账号不是平台方（不在 PLATFORM_UIDS 名单内），无法查看平台后台。如需访问请联系系统管理员配置。" />
    <template v-else>
      <div style="margin-bottom: 12px; display: flex; gap: 10px; align-items: center">
        <el-button @click="load">刷新</el-button>
        <span class="hint">平台总后台（T3.4）：所有租户一览与启停控制。停用租户将使其无法使用系统（配合年费/续费管理）。</span>
      </div>
      <el-table :data="tenants" v-loading="loading" border stripe>
        <el-table-column label="ID" width="60" prop="id" align="center" />
        <el-table-column label="租户（品牌）" min-width="200">
          <template #default="{ row }">
            <b>{{ row.brand?.name || row.name }}</b>
            <span v-if="row.brand?.short" class="mono">（{{ row.brand.short }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="套餐" width="90" align="center">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ planName(row.plan) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'active' ? 'success' : 'danger'">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="店家账户" width="95" align="center">
          <template #default="{ row }">{{ row.stats.customer_users }} / {{ row.quotas?.customer_accounts ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="客户档案" width="90" align="center">
          <template #default="{ row }">{{ row.stats.customers }}</template>
        </el-table-column>
        <el-table-column label="订单数" width="85" align="center">
          <template #default="{ row }">{{ row.stats.orders }}</template>
        </el-table-column>
        <el-table-column label="管理员" width="80" align="center">
          <template #default="{ row }">{{ row.stats.admins }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button link :type="row.status === 'active' ? 'danger' : 'success'" size="small" @click="toggle(row)">
              {{ row.status === 'active' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="hint" style="margin-top: 10px">
        提示：正式运营时请把平台方账号（PLATFORM_UIDS）换成你自己的账号；每个租户的品牌信息由各租户在「设置」页自行维护。
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { auth } from '@/lib/cloudbase'

const PLATFORM_URL = 'https://freshflow-ENV_ID.service.tcloudbase.com/platform'

const checked = ref(false)
const isPlatform = ref(false)
const tenants = ref([])
const loading = ref(false)

function planName(p) {
  return { trial: '试用', basic: '基础', pro: '专业', white: '白牌' }[p] || p
}
async function call(action, extra) {
  const { data } = await auth.getSession()
  const tk = data?.session?.access_token
  if (!tk) throw new Error('会话失效，请重新登录')
  const r = await fetch(PLATFORM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ action, access_token: tk, device_id: localStorage.getItem('ff_admin_device') || 'web-admin' }, extra || {})),
  })
  return r.json()
}
async function load() {
  loading.value = true
  try {
    const res = await call('list_tenants')
    if (!res.ok) throw new Error(res.error || '加载失败')
    tenants.value = res.tenants || []
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loading.value = false
  }
}
async function toggle(row) {
  const action = row.status === 'active' ? '停用' : '启用'
  await ElMessageBox.confirm(`确认${action}租户「${row.brand?.name || row.name}」？${row.status === 'active' ? '停用后该租户将无法使用系统。' : ''}`, `${action}确认`, { type: 'warning' })
  try {
    const res = await call('set_status', { id: row.id, status: row.status === 'active' ? 'suspended' : 'active' })
    if (!res.ok) throw new Error(res.error || '操作失败')
    ElMessage.success(`已${action}`)
    load()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}
onMounted(async () => {
  try {
    const res = await call('whoami')
    isPlatform.value = !!(res.ok && res.isPlatform)
  } catch (e) { isPlatform.value = false }
  checked.value = true
  if (isPlatform.value) load()
})
</script>

<style scoped>
.hint { color: #999; font-size: 12px; }
.mono { color: #888; font-size: 12px; }
</style>
