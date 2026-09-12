<template>
  <div class="login-wrap">
    <el-card class="login-card">
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

<style scoped>
.login-wrap { height: 100%; display: flex; align-items: center; justify-content: center; background: #1f2d3d; }
.login-card { width: 360px; }
.title { text-align: center; font-size: 22px; font-weight: 700; margin-bottom: 20px; letter-spacing: 4px; }
.tip { margin-top: 12px; font-size: 12px; color: #999; text-align: center; }
</style>
