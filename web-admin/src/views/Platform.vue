<template>
  <div>
    <div v-if="!checked" v-loading="true" style="height: 200px"></div>
    <el-alert v-else-if="!isPlatform" type="warning" :closable="false"
      title="当前账号不是平台方（不在 PLATFORM_UIDS 名单内），无法查看平台后台。如需访问请联系系统管理员配置。" />
    <template v-else>
      <div style="margin-bottom: 12px; display: flex; gap: 10px; align-items: center">
        <el-button type="primary" @click="dlg.visible = true">新建租户</el-button>
        <el-button @click="activeTab === 'accounts' ? loadAccounts() : load()">刷新</el-button>
        <span class="hint">平台总后台（T3.4）：所有租户与账号的全平台视图。新建租户=运维专属操作。</span>
      </div>
      <el-tabs v-model="activeTab" @tab-change="(t) => (t === 'accounts' && !accounts.length ? loadAccounts() : null)">
        <el-tab-pane label="租户一览" name="tenants">
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
        </el-tab-pane>
        <el-tab-pane label="账号总览" name="accounts">
          <div class="hint" style="margin-bottom: 8px">全平台账号清单：谁是商家/员工、哪个顾客属于哪家商家，一目了然（数据来自 admin_user / customer_user 映射，无需人工标注）。</div>
          <el-table :data="accounts" v-loading="loadingAccounts" border stripe>
            <el-table-column label="类型" width="100" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.kind === '顾客' ? 'success' : 'primary'">{{ row.kind }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="登录名" min-width="130" prop="username" />
            <el-table-column label="显示名" min-width="140">
              <template #default="{ row }">{{ row.display }}</template>
            </el-table-column>
            <el-table-column label="角色" width="90" align="center">
              <template #default="{ row }">{{ row.role === 'boss' ? '老板' : row.role === 'manager' ? '店长' : row.role === 'customer' ? '顾客' : row.role }}</template>
            </el-table-column>
            <el-table-column label="所属租户（商家）" min-width="170">
              <template #default="{ row }"><b>{{ row.tenant }}</b></template>
            </el-table-column>
            <el-table-column label="所属客户" min-width="130">
              <template #default="{ row }">{{ row.customer || '—' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="80" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'active' ? 'success' : 'info'">{{ row.status === 'active' ? '正常' : row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Uid" width="180">
              <template #default="{ row }"><span class="mono">{{ row.uid }}</span></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>

      <el-dialog v-model="dlg.visible" title="新建租户向导（运维专属）" width="460px">
        <el-form label-width="110px">
          <el-form-item label="商家名称">
            <el-input v-model="dlg.name" placeholder="如：示例商家B（租户显示名）" maxlength="40" />
          </el-form-item>
          <el-form-item label="管理员账号">
            <el-input v-model="dlg.username" placeholder="字母开头，2-48 位，仅字母数字 . _ -" />
          </el-form-item>
          <el-form-item label="初始密码">
            <el-input v-model="dlg.password" type="password" show-password placeholder="8-32 位，含大写/小写/数字中至少 3 类" />
          </el-form-item>
          <el-form-item label="安全模式">
            <el-switch v-model="dlg.phoneVerify" active-text="开" inactive-text="关" />
            <div class="hint" style="line-height:1.5">开=顾客新设备登录需短信验证（安全套餐卖点）；关=基础模式（账号密码直接登录）。创建后可改。</div>
          </el-form-item>
          <el-form-item label="商品分类种子">
            <el-switch v-model="dlg.seed" active-text="复制标准分类" inactive-text="空白起步" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dlg.visible = false">取消</el-button>
          <el-button type="primary" :loading="dlg.saving" @click="createTenant">一键创建</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { auth, CLOUDBASE_ENV_ID } from '@/lib/cloudbase'

const PLATFORM_URL = `https://${CLOUDBASE_ENV_ID}.service.tcloudbase.com/platform`

const checked = ref(false)
const isPlatform = ref(false)
const tenants = ref([])
const loading = ref(false)
const activeTab = ref('tenants')
const accounts = ref([])
const loadingAccounts = ref(false)
const dlg = reactive({ visible: false, name: '', username: '', password: '', phoneVerify: true, seed: true, saving: false })

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
async function loadAccounts() {
  loadingAccounts.value = true
  try {
    const res = await call('list_accounts')
    if (!res.ok) throw new Error(res.error || '加载失败')
    accounts.value = res.accounts || []
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loadingAccounts.value = false
  }
}
async function createTenant() {
  if (!dlg.name.trim() || !dlg.username.trim() || !dlg.password) return ElMessage.warning('请填完整')
  dlg.saving = true
  try {
    const res = await call('create_tenant', {
      name: dlg.name.trim(), username: dlg.username.trim(), password: dlg.password,
      phone_verify: dlg.phoneVerify, seed: dlg.seed,
    })
    if (!res.ok) throw new Error(res.error || '创建失败')
    ElMessage.success(`租户「${res.name}」已创建，管理员 ${res.username} 可立即登录后台`)
    dlg.visible = false
    dlg.name = ''; dlg.username = ''; dlg.password = ''; dlg.phoneVerify = true; dlg.seed = true
    load()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    dlg.saving = false
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
