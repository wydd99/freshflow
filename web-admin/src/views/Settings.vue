<template>
  <div>
    <el-card shadow="never" style="max-width: 560px">
      <h3 style="margin: 0 0 16px">修改密码</h3>
      <el-form label-width="110px">
        <el-form-item label="旧密码">
          <el-input v-model="form.old" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="form.p1" type="password" show-password placeholder="至少3类字符（大写/小写/数字/符号），如 Abc12345" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="form.p2" type="password" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存新密码</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { auth } from '@/lib/cloudbase'

const form = reactive({ old: '', p1: '', p2: '' })
const saving = ref(false)

async function save() {
  if (!form.old || !form.p1) return ElMessage.warning('请填写完整')
  if (form.p1 !== form.p2) return ElMessage.warning('两次输入的新密码不一致')
  saving.value = true
  try {
    const { data } = await auth.getSession()
    const tk = data?.session?.access_token
    if (!tk) throw new Error('会话失效，请重新登录')
    const r = await fetch('https://freshflow-ENV_ID.api.tcloudbasegateway.com/auth/v1/user/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
      body: JSON.stringify({ old_password: form.old, new_password: form.p1 }),
    })
    if (!r.ok) {
      const b = await r.json().catch(() => ({}))
      throw new Error(b.error_description || b.message || `HTTP ${r.status}`)
    }
    ElMessage.success('密码已更新，下次登录请使用新密码')
    form.old = form.p1 = form.p2 = ''
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    saving.value = false
  }
}
</script>
