<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <div class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none">
          <path d="M12 3c3.5 2.2 5.5 5.4 5.5 8.6 0 3.4-2.4 5.9-5.5 5.9s-5.5-2.5-5.5-5.9C6.5 8.4 8.5 5.2 12 3z" fill="#1a6b45"/>
          <path d="M4 20c2.2-3.2 5-4.8 8-4.8s5.8 1.6 8 4.8" stroke="#2e9e63" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="title">鲜配后台</div>
      <el-form :model="form" @keyup.enter="submit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="账号" size="large" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="submit">
          登 录
        </el-button>
        <div class="tip">真实登录（CloudBase Auth）；本地 localhost 预览如遇域名限制，请用已发布的正式站点</div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const store = useAuthStore()
const form = reactive({ username: '', password: '' })
const loading = ref(false)

async function submit() {
  if (!form.username || !form.password) return ElMessage.warning('请输入账号和密码')
  loading.value = true
  try {
    await store.login(form.username.trim(), form.password)
    if (store.actor?.kind !== 'admin') {
      // 店家账号不允许进后台（身份类型由 RLS/ff_actor 判定，非界面摆设）
      await store.logout()
      showErr('该账号为店家账号，请从商城下单；后台请使用员工/管理员账号')
      return
    }
    router.push('/')
  } catch (e) {
    const msg = String(e?.message || e)
    showErr(/domain|域名|origin/i.test(msg) ? '当前域名未加入安全域名白名单，请使用已发布的正式站点登录' : msg)
  } finally {
    loading.value = false
  }
}

function showErr(msg) {
  const el = document.querySelector('.login-card .tip')
  if (el) { el.textContent = msg; el.style.color = '#e64340' }
  ElMessage.error(msg)
}
</script>

<style scoped>.login-wrap {  height: 100%;  display: flex;  align-items: center;  justify-content: center;  background:    radial-gradient(1000px 500px at 85% -10%, rgba(46, 158, 99, 0.18), transparent 60%),    radial-gradient(800px 420px at -10% 110%, rgba(26, 107, 69, 0.22), transparent 55%),    linear-gradient(160deg, #0f2a1c 0%, #123322 55%, #173d29 100%);}.login-card { width: 380px; border-radius: 16px; border: none; box-shadow: 0 20px 60px rgba(4, 20, 12, 0.45); padding: 6px 6px 2px; }.brand-mark { text-align: center; margin-bottom: 4px; }.title { text-align: center; font-size: 22px; font-weight: 700; margin: 4px 0 22px; letter-spacing: 6px; color: #173d29; }.tip { margin-top: 14px; font-size: 12px; color: #9aa8a0; text-align: center; line-height: 1.6; }</style>