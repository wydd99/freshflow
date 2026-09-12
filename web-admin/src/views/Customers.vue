<template>
  <div>
    <el-alert type="success" :closable="false" style="margin-bottom: 12px"
      title="已连接 CloudBase PostgreSQL，数据实时保存（RLS 按租户隔离）；子账号管理与收货地址多行管理在 T1.5 收尾交付" />

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
        <el-table-column prop="remark" label="备注" min-width="100" />
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
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
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" @click="doSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { customerApi, goodsApi } from '@/api/services'

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
const dlg = reactive({ visible: false, form: {} })

function levelLabel(v) { return levels.find((l) => l.value === v)?.label || v }
function levelTag(v) { return { A: 'danger', B: 'warning', C: 'info', default: '' }[v] || '' }
function settlementLabel(row) {
  return { daily: '当日结', monthly: `月结（每月${row.settlementDay || '?'}日）`, cod: '货到付款' }[row.settlementType] || row.settlementType
}

async function fetchList() {
  loading.value = true
  try {
    list.value = await customerApi.list({ ...query })
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

onMounted(async () => {
  categories.value = await goodsApi.listCategories()
  await fetchList()
})
</script>

<style scoped>
.hint { margin-left: 10px; color: #999; font-size: 12px; }
</style>
