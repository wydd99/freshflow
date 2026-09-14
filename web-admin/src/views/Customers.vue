<template>
  <div>
    <el-alert type="success" :closable="false" style="margin-bottom: 12px"
      title="已连接 CloudBase PostgreSQL，数据实时保存（RLS 按租户隔离）" />

    <el-card shadow="never">
      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
        <el-input v-model="query.keyword" placeholder="客户名称" clearable style="width: 220px" @keyup.enter="fetchList" @clear="fetchList" />
        <el-select v-model="query.level" placeholder="等级" style="width: 120px" @change="fetchList">
          <el-option label="全部" value="" />
          <el-option v-for="lv in levels" :key="lv.value" :label="lv.label" :value="lv.value" />
        </el-select>
        <el-button type="primary" @click="fetchList">搜索</el-button>
        <div style="flex: 1" />
        <el-button type="primary" @click="openEdit()">新增客户</el-button>
      </div>

      <el-table :data="list" v-loading="loading" border stripe>
        <el-table-column prop="name" label="客户名称" min-width="160" />
        <el-table-column label="等级" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="levelTag(row.level)" size="small">{{ levelLabel(row.level) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结算方式" width="140" align="center">
          <template #default="{ row }">{{ settlementLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="欠款上限" width="110" align="right">
          <template #default="{ row }">{{ row.creditLimit ? '¥' + row.creditLimit.toFixed(0) : '不限' }}</template>
        </el-table-column>
        <el-table-column label="超期禁单" width="90" align="center">
          <template #default="{ row }">{{ row.overdueDays }} 天</template>
        </el-table-column>
        <el-table-column label="商城可见" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.visibleAll ? 'success' : 'info'" size="small">{{ row.visibleAll ? '全部' : '部分分类' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="子账号" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.subUsers && row.subUsers.length" size="small" type="success">{{ row.subUsers.length }}</el-tag>
            <span v-else style="color: #c0c4cc">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="100" />
        <el-table-column label="操作" width="190" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openSubUsers(row)">子账号</el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="doRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dlg.visible" :title="dlg.form.id ? '编辑客户' : '新增客户'" width="560px">
      <el-form :model="dlg.form" label-width="100px">
        <el-form-item label="客户名称" required><el-input v-model="dlg.form.name" placeholder="如：客户甲" /></el-form-item>
        <el-form-item label="客户等级">
          <el-select v-model="dlg.form.level" style="width: 160px">
            <el-option v-for="lv in levels" :key="lv.value" :label="lv.label" :value="lv.value" />
          </el-select>
          <span class="hint">等级用于"类型价"报价维度（一客一价，需求#6）</span>
        </el-form-item>
        <el-form-item label="结算方式">
          <el-radio-group v-model="dlg.form.settlementType">
            <el-radio value="daily">当日结</el-radio>
            <el-radio value="monthly">月结</el-radio>
            <el-radio value="cod">货到付款</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="dlg.form.settlementType === 'monthly'" label="每月结账日">
          <el-input-number v-model="dlg.form.settlementDay" :min="1" :max="31" />
        </el-form-item>
        <el-form-item label="欠款上限">
          <el-input-number v-model="dlg.form.creditLimit" :min="0" :step="1000" />
          <span class="hint">超过即锁单（0=不限），需求#7</span>
        </el-form-item>
        <el-form-item label="超期禁单">
          <el-input-number v-model="dlg.form.overdueDays" :min="1" :max="365" />
          <span class="hint">超过 N 天未结款禁止下单，需求#7</span>
        </el-form-item>
        <el-form-item label="商城可见">
          <el-switch v-model="dlg.form.visibleAll" active-text="全部分类" inactive-text="指定分类" />
        </el-form-item>
        <el-form-item v-if="!dlg.form.visibleAll" label="可见分类">
          <el-select v-model="dlg.form.visibleCategories" multiple style="width: 100%" placeholder="勾选该客户可购买的分类">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="dlg.form.remark" /></el-form-item>

        <!-- 收货地址多行管理（T1.5 余项）：仅编辑已有客户时显示 -->
        <el-form-item v-if="dlg.form.id" label="收货地址">
          <div style="width: 100%">
            <el-table :data="dlg.addresses" border size="small" v-loading="dlg.addrLoading">
              <el-table-column prop="contact" label="联系人" width="90" />
              <el-table-column prop="phone" label="电话" width="120" />
              <el-table-column prop="address" label="地址" min-width="180" />
              <el-table-column label="默认" width="60" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row.is_default" size="small" type="success">默认</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" align="center">
                <template #default="{ row, $index }">
                  <el-button link type="primary" size="small" @click="addrSetDefault(row)">设默认</el-button>
                  <el-button link type="danger" size="small" @click="addrRemove(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div style="margin-top: 8px; display: flex; gap: 8px">
              <el-input v-model="dlg.newAddr.contact" placeholder="联系人" style="width: 100px" size="small" />
              <el-input v-model="dlg.newAddr.phone" placeholder="电话" style="width: 130px" size="small" />
              <el-input v-model="dlg.newAddr.address" placeholder="收货地址（如：蜀山区XX路XX号后门）" size="small" />
              <el-button size="small" @click="addrAdd">添加</el-button>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" @click="doSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 子账号管理（T2.13） -->
    <el-dialog v-model="sub.visible" :title="`子账号管理 · ${sub.customer?.name || ''}`" width="720px">
      <el-alert v-if="sub.users.length >= 3" type="warning" :closable="false" style="margin-bottom: 12px"
        title="体验版套餐 Auth 用户数上限 3 个（全租户共享），新开账号需升级套餐或清理停用账号" />
      <div style="margin-bottom: 12px">
        <el-button type="primary" size="small" @click="openSubCreate">开通新子账号</el-button>
        <span class="hint">账号开通后店家即可用它在商城（网页/小程序）登录下单</span>
      </div>
      <el-table :data="sub.users" border size="small">
        <el-table-column prop="username" label="账号" width="140" />
        <el-table-column prop="display_name" label="名称" min-width="120" />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '正常' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="手机号" width="120" align="center">
          <template #default="{ row }">
            <span v-if="row.phone">{{ maskPhone(row.phone) }}</span>
            <el-tag v-else size="small" type="warning">未登记</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openSetPhone(row)">手机号</el-button>
            <el-button link type="primary" size="small" @click="openResetPwd(row)">重置密码</el-button>
            <el-button link size="small" :type="row.status === 'active' ? 'warning' : 'success'" @click="doToggle(row)">
              {{ row.status === 'active' ? '停用' : '启用' }}
            </el-button>
            <el-button link type="danger" size="small" @click="doUnbind(row)">解绑</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!sub.users.length" style="color: #999; padding: 20px 0; text-align: center">
        该客户还没有子账号，点上方「开通新子账号」给店家开一个
      </div>
    </el-dialog>

    <!-- 开通子账号 -->
    <el-dialog v-model="createDlg.visible" title="开通新子账号" width="480px" append-to-body>
      <el-form :model="createDlg.form" label-width="90px">
        <el-form-item label="登录账号" required>
          <el-input v-model="createDlg.form.username" placeholder="字母或数字开头，2-48 位，不支持中文" />
        </el-form-item>
        <el-form-item label="初始密码" required>
          <el-input v-model="createDlg.form.password" show-password placeholder="8-32 位，含大写/小写/数字/特殊字符至少 3 类" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="createDlg.form.displayName" placeholder="店家称呼，如：客户甲-张姐" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="createDlg.form.phone" placeholder="选填，11 位" />
        </el-form-item>
        <el-form-item label="导出对账单">
          <el-switch v-model="createDlg.form.canExport" />
          <span class="hint">允许店家在商城导出自己的对账单 CSV（需求#9）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="createDlg.loading" @click="doCreateSub">开通</el-button>
      </template>
    </el-dialog>

    <!-- 登记手机号（店家新设备验证用） -->
    <el-dialog v-model="phoneDlg.visible" title="登记手机号" width="440px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="账号"><span>{{ phoneDlg.row?.username }}</span></el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="phoneDlg.phone" placeholder="11 位手机号" maxlength="11" />
        </el-form-item>
        <el-form-item>
          <span class="hint">店家在新设备登录商城时，验证码会发到这个号——请与店家确认后登记；留空保存 = 清除</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="phoneDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="phoneDlg.loading" @click="doSetPhone">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog v-model="pwdDlg.visible" title="重置密码" width="420px" append-to-body>
      <el-form label-width="90px">
        <el-form-item label="账号">
          <span>{{ pwdDlg.row?.username }}</span>
        </el-form-item>
        <el-form-item label="新密码" required>
          <el-input v-model="pwdDlg.password" show-password placeholder="8-32 位，含大写/小写/数字/特殊字符至少 3 类" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="pwdDlg.loading" @click="doResetPwd">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { customerApi, goodsApi, userAdminApi } from '@/api/services'

const levels = [
  { value: 'default', label: '默认' },
  { value: 'A', label: 'A 类' },
  { value: 'B', label: 'B 类' },
  { value: 'C', label: 'C 类' },
]

const loading = ref(false)
const list = ref([])
const categories = ref([])
const query = reactive({ keyword: '', level: '' })
const dlg = reactive({ visible: false, form: {}, addresses: [], addrLoading: false, newAddr: { contact: '', phone: '', address: '' } })

// 子账号管理状态（T2.13）
const sub = reactive({ visible: false, customer: null, users: [] })
const createDlg = reactive({ visible: false, loading: false, form: {} })
const pwdDlg = reactive({ visible: false, loading: false, row: null, password: '' })
const phoneDlg = reactive({ visible: false, loading: false, row: null, phone: '' })

function levelLabel(v) { return levels.find((l) => l.value === v)?.label || v }
function levelTag(v) { return { A: 'danger', B: 'warning', C: 'info', default: '' }[v] || '' }
function settlementLabel(row) {
  return { daily: '当日结', monthly: `月结（每月${row.settlementDay || '?'}日）`, cod: '货到付款' }[row.settlementType] || row.settlementType
}

async function fetchList() {
  loading.value = true
  try {
    list.value = await customerApi.list({ ...query })
    // 附带子账号概览（customer_user 全量在租户内可见，RLS 保证）
    const { db } = await import('@/lib/cloudbase')
    const res = await db.from('customer_user').select('id,username,display_name,status,customer_id,phone')
    const rows = res?.data ?? res
    if (Array.isArray(rows)) {
      const byCustomer = new Map()
      for (const r of rows) {
        if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, [])
        byCustomer.get(r.customer_id).push(r)
      }
      list.value = list.value.map((c) => ({ ...c, subUsers: byCustomer.get(c.id) || [] }))
    }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loading.value = false
  }
}

function openEdit(row) {
  dlg.form = row
    ? { ...row, visibleCategories: row.visibleCategories || [] }
    : { name: '', level: 'default', settlementType: 'daily', settlementDay: null, creditLimit: 0, overdueDays: 30, visibleAll: true, visibleCategories: [], status: 'active', remark: '' }
  dlg.visible = true
  dlg.addresses = []
  dlg.newAddr = { contact: '', phone: '', address: '' }
  if (row?.id) loadAddresses(row.id)
}

// ---------- 收货地址多行管理（T1.5 余项） ----------
async function loadAddresses(customerId) {
  dlg.addrLoading = true
  try {
    const { addressApi } = await import('@/api/services')
    dlg.addresses = await addressApi.listByCustomer(customerId)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    dlg.addrLoading = false
  }
}
async function addrAdd() {
  if (!dlg.form.id) return
  if (!dlg.newAddr.address?.trim()) return ElMessage.warning('地址不能为空')
  try {
    const { addressApi } = await import('@/api/services')
    const isFirst = dlg.addresses.length === 0
    await addressApi.save({ customer_id: dlg.form.id, ...dlg.newAddr, is_default: isFirst })
    ElMessage.success('地址已添加')
    dlg.newAddr = { contact: '', phone: '', address: '' }
    loadAddresses(dlg.form.id)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}
async function addrSetDefault(row) {
  try {
    const { addressApi } = await import('@/api/services')
    await addressApi.save({ ...row, is_default: true })
    loadAddresses(dlg.form.id)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}
async function addrRemove(row) {
  await ElMessageBox.confirm(`确认删除该地址？「${row.address}」`, '删除确认', { type: 'warning' })
  try {
    const { addressApi } = await import('@/api/services')
    await addressApi.remove(row.id)
    ElMessage.success('已删除')
    loadAddresses(dlg.form.id)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function doSave() {
  if (!dlg.form.name) return ElMessage.warning('客户名称必填')
  await customerApi.save({ ...dlg.form })
  ElMessage.success('已保存')
  dlg.visible = false
  fetchList()
}

async function doRemove(row) {
  await ElMessageBox.confirm(`确认删除客户「${row.name}」？（有历史订单的客户建议停用而非删除）`, '删除确认', { type: 'warning' })
  await customerApi.remove(row.id)
  ElMessage.success('已删除')
  fetchList()
}

// ---------- 子账号管理（T2.13） ----------
function openSubUsers(row) {
  sub.customer = row
  sub.users = (row.subUsers || []).map((u) => ({ ...u }))
  sub.visible = true
}

function openSubCreate() {
  createDlg.form = { username: '', password: '', displayName: '', phone: '', canExport: false }
  createDlg.visible = true
}

async function doCreateSub() {
  const f = createDlg.form
  if (!f.username || !f.password) return ElMessage.warning('账号和密码必填')
  createDlg.loading = true
  try {
    await userAdminApi.createSubUser({ ...f, customerId: sub.customer.id })
    ElMessage.success(`子账号「${f.username}」已开通，店家可用它登录商城下单`)
    createDlg.visible = false
    await fetchList()
    const fresh = list.value.find((c) => c.id === sub.customer.id)
    if (fresh) sub.users = (fresh.subUsers || []).map((u) => ({ ...u }))
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    createDlg.loading = false
  }
}

function openResetPwd(row) {
  pwdDlg.row = row
  pwdDlg.password = ''
  pwdDlg.visible = true
}

async function doResetPwd() {
  if (!pwdDlg.password) return ElMessage.warning('请输入新密码')
  pwdDlg.loading = true
  try {
    await userAdminApi.resetPassword(pwdDlg.row.uid, pwdDlg.password)
    ElMessage.success(`「${pwdDlg.row.username}」密码已重置`)
    pwdDlg.visible = false
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    pwdDlg.loading = false
  }
}

async function doToggle(row) {
  const blocking = row.status === 'active'
  await ElMessageBox.confirm(
    blocking ? `确认停用「${row.username}」？停用后店家将无法登录商城` : `确认启用「${row.username}」？`,
    blocking ? '停用确认' : '启用确认', { type: 'warning' },
  )
  try {
    await userAdminApi.setStatus(row.uid, blocking)
    row.status = blocking ? 'blocked' : 'active'
    ElMessage.success(blocking ? '已停用' : '已启用')
    fetchList()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '')
  return d.length >= 11 ? d.slice(0, 3) + '****' + d.slice(-4) : String(p || '')
}
function openSetPhone(row) {
  phoneDlg.row = row
  phoneDlg.phone = row.phone || ''
  phoneDlg.visible = true
}
async function doSetPhone() {
  const p = String(phoneDlg.phone || '').trim()
  if (p && !/^1\d{10}$/.test(p)) return ElMessage.warning('手机号需为 11 位数字')
  phoneDlg.loading = true
  try {
    await userAdminApi.setPhone(phoneDlg.row.uid, p)
    ElMessage.success(p ? '手机号已登记' : '手机号已清除')
    phoneDlg.visible = false
    await fetchList()
    const fresh = list.value.find((c) => c.id === sub.customer?.id)
    if (fresh) sub.users = (fresh.subUsers || []).map((u) => ({ ...u }))
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    phoneDlg.loading = false
  }
}

async function doUnbind(row) {
  await ElMessageBox.confirm(
    `确认解绑「${row.username}」？解绑后该账号无法登录商城；Auth 用户保留，之后可重新绑定`,
    '解绑确认', { type: 'warning' },
  )
  try {
    await userAdminApi.unbind(row.uid)
    sub.users = sub.users.filter((u) => u.uid !== row.uid)
    ElMessage.success('已解绑')
    fetchList()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

onMounted(async () => {
  categories.value = await goodsApi.listCategories()
  await fetchList()
})
</script>

<style scoped>
.hint { margin-left: 10px; color: #999; font-size: 12px; }
</style>
