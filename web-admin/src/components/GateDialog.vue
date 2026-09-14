<template>
  <el-dialog v-model="visible" title="安全验证" width="460px" :close-on-click-modal="false" :close-on-press-escape="false" :show-close="false">
    <div v-if="mode === 'no_phone'">
      <el-alert type="warning" :closable="false" :title="message" />
    </div>
    <template v-else>
      <p style="margin-bottom:10px">此设备首次登录，为保障账号安全，请完成短信验证（验证一次后本设备免验证）</p>
      <p v-if="phoneMask" style="color:#999;font-size:12px;margin-bottom:10px">验证码将发送至：{{ phoneMask }}</p>
      <div style="display:flex;gap:8px">
        <el-input v-model="code" placeholder="短信验证码" maxlength="8" style="flex:1" @keyup.enter="verify" />
        <el-button :disabled="countdown > 0" @click="send">{{ countdown > 0 ? countdown + ' 秒后重发' : '发送验证码' }}</el-button>
      </div>
    </template>
    <template #footer>
      <el-button @click="logout">退出登录</el-button>
      <el-button v-if="mode !== 'no_phone'" type="primary" :loading="verifying" @click="verify">验证</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

// 登录安全门禁（authgate）：新设备首登需短信验证；记录模式云端不拦截（trusted=true 直接放行）
const GATE_URL = 'https://freshflow-ENV_ID.service.tcloudbase.com/authgate'
const store = useAuthStore()
const router = useRouter()
const visible = ref(false)
const mode = ref('verify')
const message = ref('')
const phoneMask = ref('')
const code = ref('')
const countdown = ref(0)
const verifying = ref(false)
let timer = null

function device() {
  let d = localStorage.getItem('ff_admin_device')
  if (!d) { d = 'adm-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('ff_admin_device', d) }
  return d
}
function token() { return store.session?.access_token || '' }
async function call(action, extra) {
  const r = await fetch(GATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ action, access_token: token(), device_id: device() }, extra || {})),
  })
  return r.json()
}
async function check() {
  if (!token()) return
  try {
    const res = await call('check')
    if (!res || res.ok === false || res.trusted) return
    if (res.reason === 'no_phone') { mode.value = 'no_phone'; message.value = res.message || '该账号还未登记手机号，请联系配送站绑定后再登录' }
    else { mode.value = 'verify'; phoneMask.value = res.phone_mask || '' }
    visible.value = true
  } catch (e) { /* 网络异常不拦截 */ }
}
async function send() {
  try {
    const res = await call('send_code')
    if (res.ok) {
      ElMessage.success('验证码已发送')
      countdown.value = 60
      timer = setInterval(() => { countdown.value -= 1; if (countdown.value <= 0) clearInterval(timer) }, 1000)
    } else ElMessage.error(res.error || '发送失败')
  } catch (e) { ElMessage.error('网络异常，请重试') }
}
async function verify() {
  if (!code.value) return ElMessage.warning('请输入验证码')
  verifying.value = true
  try {
    const res = await call('verify', { code: String(code.value).trim() })
    if (res.ok && res.trusted) { visible.value = false; ElMessage.success('验证通过，本设备后续登录免验证') }
    else ElMessage.error(res.error || '验证失败')
  } catch (e) { ElMessage.error('网络异常，请重试') } finally { verifying.value = false }
}
function logout() { store.logout(); router.push('/login') }
onMounted(check)
</script>
