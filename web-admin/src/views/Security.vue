<template>
  <div>
    <el-tabs v-model="tab">
      <el-tab-pane label="登录记录" name="audit">
        <div style="margin-bottom: 10px; display: flex; gap: 10px">
          <el-select v-model="auditFilter" style="width: 150px">
            <el-option label="全部事件" value="" />
            <el-option label="登录" value="login" />
            <el-option label="新设备" value="new_device" />
            <el-option label="发验证码" value="verify_sent" />
            <el-option label="验证通过" value="verify_ok" />
            <el-option label="验证失败" value="verify_fail" />
            <el-option label="设备踢除" value="kick_device" />
          </el-select>
          <el-button @click="loadAudit">刷新</el-button>
          <span class="hint">最近 200 条登录足迹（谁、何时、在哪台设备、什么 IP 登录）</span>
        </div>
        <el-table :data="auditFiltered" v-loading="loadingAudit" border stripe size="small">
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ fmt(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="账号" width="120" prop="username" />
          <el-table-column label="端" width="70" align="center">
            <template #default="{ row }">{{ row.actor_type === 'admin' ? '管理端' : '顾客端' }}</template>
          </el-table-column>
          <el-table-column label="事件" width="110" align="center">
            <template #default="{ row }"><el-tag size="small" :type="evTag(row.event)">{{ evName(row.event) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="设备" width="160">
            <template #default="{ row }"><span class="mono">{{ shortDev(row.device_id) }}</span></template>
          </el-table-column>
          <el-table-column label="IP" width="140" prop="ip" />
          <el-table-column label="备注" min-width="120">
            <template #default="{ row }">{{ detailText(row) }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="登录设备（白名单）" name="devices">
        <el-alert type="info" :closable="false" style="margin-bottom: 10px"
          title="店家的新设备需一次短信验证后进入白名单（验证后该设备免验）；发现可疑设备可直接踢除——踢除后该设备下次登录需重新验证" />
        <el-button size="small" @click="loadDevices" style="margin-bottom: 10px">刷新</el-button>
        <el-table :data="devices" v-loading="loadingDev" border stripe size="small">
          <el-table-column label="账号" width="120" prop="username" />
          <el-table-column label="端" width="80" align="center">
            <template #default="{ row }">{{ row.actor_type === 'admin' ? '管理端' : '顾客端' }}</template>
          </el-table-column>
          <el-table-column label="设备" width="180">
            <template #default="{ row }"><span class="mono">{{ shortDev(row.device_id) }}</span></template>
          </el-table-column>
          <el-table-column label="首次见到" width="160">
            <template #default="{ row }">{{ fmt(row.first_seen) }}</template>
          </el-table-column>
          <el-table-column label="最近登录" width="160">
            <template #default="{ row }">{{ fmt(row.last_seen) }}</template>
          </el-table-column>
          <el-table-column label="次数" width="70" align="center" prop="login_count" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.verified ? 'success' : 'warning'">{{ row.verified ? '已验证' : '未验证' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="最近 IP" width="140" prop="last_ip" />
          <el-table-column label="操作" width="130" align="center">
            <template #default="{ row }">
              <el-button v-if="!row.verified" link type="success" size="small" @click="trust(row)">放行</el-button>
              <el-button link type="danger" size="small" @click="kick(row)">踢除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { db, auth } from '@/lib/cloudbase'

const GATE_URL = 'https://freshflow-ENV_ID.service.tcloudbase.com/authgate'

const tab = ref('audit')
const audit = ref([])
const devices = ref([])
const auditFilter = ref('')
const loadingAudit = ref(false)
const loadingDev = ref(false)

const auditFiltered = computed(() => (auditFilter.value ? audit.value.filter((a) => a.event === auditFilter.value) : audit.value))

function fmt(t) {
  if (!t) return ''
  return String(t).replace('T', ' ').slice(0, 16)
}
function shortDev(d) {
  const s = String(d || '')
  return s.length > 26 ? s.slice(0, 12) + '…' + s.slice(-10) : s
}
function evName(e) {
  return {
    login: '登录', new_device: '新设备', verify_sent: '发验证码',
    verify_ok: '验证通过', verify_fail: '验证失败', kick_device: '设备踢除',
  }[e] || e
}
function evTag(e) {
  return { login: 'info', new_device: 'warning', verify_ok: 'success', verify_fail: 'danger', kick_device: 'danger' }[e] || ''
}
function detailText(row) {
  try {
    const d = row.detail || {}
    const parts = []
    if (d.phone) parts.push('发往 ' + d.phone)
    if (d.trusted !== undefined) parts.push(d.trusted ? '免验证' : '需验证')
    if (d.fail) parts.push('错误 ' + d.fail + ' 次')
    if (d.username) parts.push(d.username)
    return parts.join(' · ')
  } catch (e) { return '' }
}

async function loadAudit() {
  loadingAudit.value = true
  try {
    const res = await db.from('login_audit').select('*').order('created_at', { ascending: false }).limit(200)
    const rows = (res?.data ?? res) || []
    audit.value = Array.isArray(rows) ? rows : []
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loadingAudit.value = false
  }
}
async function loadDevices() {
  loadingDev.value = true
  try {
    const res = await db.from('login_device').select('*').order('last_seen', { ascending: false })
    const rows = (res?.data ?? res) || []
    devices.value = Array.isArray(rows) ? rows : []
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loadingDev.value = false
  }
}
async function kick(row) {
  await ElMessageBox.confirm(`确认踢除「${row.username}」的这台设备？踢除后该设备下次登录需要重新短信验证。`, '踢除设备', { type: 'warning' })
  try {
    const { data } = await auth.getSession()
    const tk = data?.session?.access_token
    if (!tk) throw new Error('会话失效，请重新登录')
    const r = await fetch(GATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kick_device', access_token: tk, device_id: localStorage.getItem('ff_admin_device') || 'web-admin', id: row.id }),
    })
    const j = await r.json()
    if (!j.ok) throw new Error(j.error || '操作失败')
    ElMessage.success('已踢除')
    loadDevices()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function trust(row) {
  await ElMessageBox.confirm(`确认放行「${row.username}」的这台设备？放行后顾客刷新页面即可直接进入。`, '放行设备', { type: 'success' })
  try {
    const { data } = await auth.getSession()
    const tk = data?.session?.access_token
    if (!tk) throw new Error('会话失效，请重新登录')
    const r = await fetch(GATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trust_device', access_token: tk, device_id: localStorage.getItem('ff_admin_device') || 'web-admin', id: row.id }),
    })
    const j = await r.json()
    if (!j.ok) throw new Error(j.error || '操作失败')
    ElMessage.success('已放行——通知顾客刷新页面即可进入')
    loadDevices()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

onMounted(() => {
  loadAudit()
  loadDevices()
})
</script>

<style scoped>
.hint { color: #999; font-size: 12px; align-self: center; }
.mono { font-family: Consolas, monospace; font-size: 12px; }
</style>
