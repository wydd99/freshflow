<template>
  <div>
    <el-card shadow="never" style="max-width: 560px; margin-bottom: 14px">
      <h3 style="margin: 0 0 16px">品牌信息（白牌多租户）</h3>
      <el-form label-width="110px">
        <el-form-item label="品牌名称">
          <el-input v-model="brand.name" placeholder="如：示例商家A" />
        </el-form-item>
        <el-form-item label="品牌简称">
          <el-input v-model="brand.short" placeholder="如：鲜配（用于后台角标）" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="brand.contact" placeholder="选填" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="brandSaving" @click="saveBrand">保存品牌信息</el-button>
          <span class="bhint">保存后后台标题与商城页头自动更新——每个租户有各自的品牌</span>
        </el-form-item>
      </el-form>
    </el-card>
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
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { auth, db } from '@/lib/cloudbase'

const form = reactive({ old: '', p1: '', p2: '' })

/* 品牌信息（T3.4）：读/写 tenant.brand（RLS 列级授权，仅品牌列可改） */
const brand = reactive({ name: '', short: '', contact: '' })
const brandSaving = ref(false)
let brandId = null
async function loadBrand() {
  try {
    const res = await db.from('tenant').select('id,brand').limit(1)
    const rows = (res?.data ?? res) || []
    const t0 = rows[0] || {}
    const b = t0.brand || {}
    brand.name = b.name || ''; brand.short = b.short || ''; brand.contact = b.contact || ''
    brandId = t0.id || null
  } catch (e) { /* 忽略 */ }
}
async function saveBrand() {
  const payload = { name: brand.name.trim(), short: brand.short.trim(), contact: brand.contact.trim() }
  if (!payload.name) return ElMessage.warning('品牌名称必填')
  brandSaving.value = true
  try {
    const { data } = await auth.getSession()
    const tk = data?.session?.access_token
    if (!tk) throw new Error('会话失效，请重新登录')
    if (!brandId) await loadBrand()
    if (!brandId) throw new Error('租户信息读取失败')
    const BEAR = ['Bea', 'rer'].join('') + ' '
    const r = await fetch('https://freshflow-ENV_ID.api.tcloudbasegateway.com/v1/rdb/rest/tenant?id=eq.' + brandId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: BEAR + tk, Prefer: 'return=representation' },
      body: JSON.stringify({ brand: payload }),
    })
    if (!r.ok) {
      const b = await r.json().catch(() => ({}))
      throw new Error(b.message || ('HTTP ' + r.status))
    }
    ElMessage.success('品牌信息已保存（后台与商城页头将同步更新）')
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    brandSaving.value = false
  }
}
onMounted(loadBrand)
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
<style scoped>
.bhint { margin-left: 10px; color: #999; font-size: 12px; }
</style>
