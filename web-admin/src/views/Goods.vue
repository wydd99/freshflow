<template>
  <div>
    <el-alert type="success" :closable="false" style="margin-bottom: 12px"
      title="已连接 CloudBase PostgreSQL，数据实时保存（RLS 按租户隔离）；Excel 批量导入随 T1.4 收尾交付" />

    <el-card shadow="never">
      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
        <el-input v-model="query.keyword" placeholder="品名 / 编码 / 别名" clearable style="width: 220px" @keyup.enter="fetchList" @clear="fetchList" />
        <el-select v-model="query.category" placeholder="分类" clearable style="width: 140px" @change="fetchList">
          <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
        </el-select>
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px" @change="fetchList">
          <el-option label="启用" value="active" />
          <el-option label="停用" value="disabled" />
        </el-select>
        <el-button type="primary" @click="fetchList">搜索</el-button>
        <div style="flex: 1" />
        <el-button :loading="importing" @click="fileEl.click()">批量导入 Excel</el-button>
        <el-button @click="downloadTemplate">下载导入模板</el-button>
        <input ref="fileEl" type="file" accept=".xlsx,.csv" style="display: none" @change="onImportFile" />
        <el-button type="primary" @click="openEdit()">新增商品</el-button>
      </div>

      <el-table :data="list" v-loading="loading" border stripe>
        <el-table-column prop="code" label="编码" width="120" />
        <el-table-column label="品名（别名）" min-width="180">
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-for="a in row.alias" :key="a" size="small" type="info" style="margin-left: 4px">{{ a }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="category" label="分类" width="100" />
        <el-table-column prop="unit" label="单位" width="70" align="center" />
        <el-table-column label="称重类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.weighType === 'weight' ? 'warning' : 'success'" size="small">
              {{ row.weighType === 'weight' ? '按重分拣' : '无需称重' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="basePrice" label="基准价" width="90" align="right">
          <template #default="{ row }">¥{{ row.basePrice.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="商城可见" width="90" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.allowMall" @change="(v) => toggleMall(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="doRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dlg.visible" :title="dlg.form.id ? '编辑商品' : '新增商品'" width="560px">
      <el-form :model="dlg.form" label-width="90px">
        <el-form-item label="商品编码"><el-input v-model="dlg.form.code" placeholder="留空自动生成" /></el-form-item>
        <el-form-item label="品名" required><el-input v-model="dlg.form.name" /></el-form-item>
        <el-form-item label="别名">
          <el-select v-model="dlg.form.alias" multiple filterable allow-create default-first-option
            placeholder="手写单常见叫法（如 鸡旦），回车添加" style="width: 100%" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="dlg.form.category" style="width: 100%">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="单位"><el-input v-model="dlg.form.unit" style="width: 120px" /></el-form-item>
        <el-form-item label="称重类型">
          <el-radio-group v-model="dlg.form.weighType">
            <el-radio value="weight">按重分拣（上秤）</el-radio>
            <el-radio value="none">无需称重（标品，直接打 N 张贴纸）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="基准价"><el-input-number v-model="dlg.form.basePrice" :min="0" :precision="2" /></el-form-item>
        <el-form-item label="条码/规格">
          <el-input v-model="dlg.form.barcode" placeholder="条码" style="width: 180px" />
          <el-input v-model="dlg.form.spec" placeholder="规格（如 500ml/瓶）" style="width: 180px; margin-left: 8px" />
        </el-form-item>
        <el-form-item label="商品介绍">
          <el-input v-model="dlg.form.description" type="textarea" :rows="3" placeholder="商城/小程序点开商品时展示的图文介绍" />
        </el-form-item>
        <el-form-item label="商城可见"><el-switch v-model="dlg.form.allowMall" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="dlg.form.remark" type="textarea" :rows="2" /></el-form-item>
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
import * as XLSX from 'xlsx'
import { goodsApi } from '@/api/services'

const loading = ref(false)
const importing = ref(false)
const fileEl = ref(null)
const list = ref([])
const categories = ref([])
const query = reactive({ keyword: '', category: '', status: '' })

const dlg = reactive({
  visible: false,
  form: {},
})

async function fetchList() {
  loading.value = true
  try {
    list.value = await goodsApi.list({ ...query })
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loading.value = false
  }
}

function openEdit(row) {
  dlg.form = row
    ? { ...row, alias: [...row.alias] }
    : { code: '', name: '', alias: [], category: categories.value[0] || '', unit: '斤', weighType: 'weight', barcode: '', spec: '', basePrice: 0, allowMall: true, status: 'active', remark: '', description: '' }
  dlg.visible = true
}

async function doSave() {
  if (!dlg.form.name) return ElMessage.warning('品名必填')
  await goodsApi.save({ ...dlg.form })
  ElMessage.success('已保存')
  dlg.visible = false
  fetchList()
}

async function doRemove(row) {
  await ElMessageBox.confirm(`确认删除「${row.name}」？（有历史订单的商品建议停用而非删除）`, '删除确认', { type: 'warning' })
  await goodsApi.remove(row.id)
  ElMessage.success('已删除')
  fetchList()
}

async function toggleMall(row, v) {
  await goodsApi.save({ ...row, allowMall: v })
  row.allowMall = v
}

/** Excel 批量导入：解析 → 逐行建档 → 汇报成功/失败（需求#16） */
async function onImportFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  importing.value = true
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
    if (!rows.length) throw new Error('表格没有数据行')
    let ok = 0
    const fails = []
    for (const r of rows) {
      const name = String(r['品名'] ?? '').trim()
      if (!name) { fails.push('某行缺品名'); continue }
      try {
        await goodsApi.save({
          code: String(r['编码'] ?? '').trim() || null,
          name,
          alias: String(r['别名'] ?? '').split(/[;；,，]/).map((s) => s.trim()).filter(Boolean),
          category: String(r['分类'] ?? '').trim(),
          unit: String(r['单位'] ?? '').trim() || '斤',
          weighType: /标品|无需/.test(String(r['称重类型'] ?? '')) ? 'none' : 'weight',
          barcode: String(r['条码'] ?? '').trim() || null,
          spec: String(r['规格'] ?? '').trim() || null,
          description: String(r['商品介绍'] ?? '').trim() || null,
          basePrice: Number(r['基准价']) || 0,
          allowMall: !/否/.test(String(r['商城可见'] ?? '是')),
          status: 'active',
          remark: String(r['备注'] ?? '').trim() || null,
        })
        ok++
      } catch (err) {
        fails.push(`${name}：${err.message || err}`)
      }
    }
    if (fails.length) ElMessage.warning(`导入完成：成功 ${ok} 条，失败 ${fails.length} 条——${fails.slice(0, 3).join('；')}`)
    else ElMessage.success(`导入完成：${ok} 条商品已入库`)
    fetchList()
  } catch (err) {
    ElMessage.error('导入失败：' + String(err?.message || err))
  } finally {
    importing.value = false
  }
}

/** 生成导入模板（表头与字段一一对应） */
function downloadTemplate() {
  const rows = [
    { 品名: '奶白菜', 编码: '', 分类: '叶菜', 单位: '斤', 称重类型: '按重分拣', 基准价: 5.5, 条码: '', 规格: '', 别名: '小白菜;奶白', 商城可见: '是', 商品介绍: '高原基地直供', 备注: '' },
    { 品名: '海天生抽', 编码: '', 分类: '调味', 单位: '瓶', 称重类型: '无需称重', 基准价: 9.9, 条码: '690123', 规格: '500ml/瓶', 别名: '生抽', 商城可见: '是', 商品介绍: '', 备注: '标品直接打贴纸' },
  ]
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '商品导入')
  XLSX.writeFile(wb, 'FreshFlow商品导入模板.xlsx')
}

onMounted(async () => {
  categories.value = await goodsApi.listCategories()
  await fetchList()
})
</script>
