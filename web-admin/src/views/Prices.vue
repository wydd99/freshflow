<template>
  <div>
    <el-alert type="success" :closable="false" style="margin-bottom: 12px"
      title="一客一价（需求#6）：取价链 = 客户专属价 → 等级价 → 商品基准价；同日重复执行批量改价=覆盖；历史价格按生效日留痕" />

    <el-tabs v-model="tab">
      <el-tab-pane label="按商品查价" name="lookup">
        <el-card shadow="never">
          <div style="display: flex; gap: 10px; margin-bottom: 12px">
            <el-select v-model="lookup.goodsId" filterable placeholder="选择商品（可搜品名/编码）" style="width: 320px" @change="fetchPrices">
              <el-option v-for="g in goodsList" :key="g.id" :value="g.id" :label="`${g.name}（${g.code}）基准价 ¥${g.basePrice.toFixed(2)}`" />
            </el-select>
            <el-button type="primary" @click="openAdd" :disabled="!lookup.goodsId">新增价格行</el-button>
          </div>

          <el-descriptions v-if="lookup.goods" :column="3" border style="margin-bottom: 12px">
            <el-descriptions-item label="商品">{{ lookup.goods.name }}</el-descriptions-item>
            <el-descriptions-item label="基准价（原）">¥{{ lookup.goods.basePrice.toFixed(2) }}</el-descriptions-item>
            <el-descriptions-item label="今日生效价">
              {{ todayPrices.length ? todayPrices.map(p => p.scopeLabel + ' ¥' + p.price.toFixed(2)).join('；') : '仅基准价' }}
            </el-descriptions-item>
          </el-descriptions>

          <el-table :data="lookup.rows" v-loading="lookup.loading" border stripe>
            <el-table-column prop="scopeLabel" label="报价对象" min-width="160" />
            <el-table-column label="价格" width="110" align="right">
              <template #default="{ row }">¥{{ row.price.toFixed(2) }}</template>
            </el-table-column>
            <el-table-column prop="valid_from" label="生效日" width="120" align="center" />
            <el-table-column label="状态" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="row.valid_from <= today ? 'success' : 'info'" size="small">
                  {{ row.valid_from <= today ? '生效中' : '待生效' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90" align="center">
              <template #default="{ row }">
                <el-button link type="danger" @click="doRemovePrice(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="批量改价（按等级）" name="batch">
        <el-card shadow="never">
          <el-form label-width="110px" style="max-width: 760px">
            <el-form-item label="客户等级">
              <el-select v-model="batch.level" style="width: 180px">
                <el-option label="默认" value="default" />
                <el-option label="A 类" value="A" />
                <el-option label="B 类" value="B" />
                <el-option label="C 类" value="C" />
              </el-select>
              <span class="hint">给该等级全部客户设置类型价（scope=type）</span>
            </el-form-item>
            <el-form-item label="调价方式">
              <el-radio-group v-model="batch.mode">
                <el-radio value="percent">按基准价上浮</el-radio>
                <el-radio value="fixed">统一固定价</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="batch.mode === 'percent'" label="上浮比例 %">
              <el-input-number v-model="batch.percent" :precision="1" :step="5" />
              <span class="hint">负数=下浮；示例：上浮 10% → 基准 ¥2.80 → ¥3.08</span>
            </el-form-item>
            <el-form-item v-else label="统一价格">
              <el-input-number v-model="batch.fixed" :min="0" :precision="2" />
            </el-form-item>
            <el-form-item label="商品范围">
              <el-select v-model="batch.goodsIds" multiple filterable style="width: 100%" placeholder="勾选商品（不选=全部商品）">
                <el-option v-for="g in goodsList" :key="g.id" :value="g.id" :label="`${g.name}（基准 ¥${g.basePrice.toFixed(2)}）`" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="batch.loading" @click="executeBatch">
                执行批量改价（预览 {{ batchPreview.length }} 行，今日生效）
              </el-button>
              <span class="hint">同日同商品同等级重复执行=覆盖旧价</span>
            </el-form-item>
          </el-form>

          <el-table v-if="batchPreview.length" :data="batchPreview" border size="small" style="max-width: 760px">
            <el-table-column prop="name" label="商品" min-width="140" />
            <el-table-column label="基准价" width="100" align="right">
              <template #default="{ row }">¥{{ row.basePrice.toFixed(2) }}</template>
            </el-table-column>
            <el-table-column label="新价格" width="100" align="right">
              <template #default="{ row }">¥{{ batchPrice(row).toFixed(2) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="addDlg.visible" title="新增价格行" width="480px">
      <el-form label-width="100px">
        <el-form-item label="报价对象">
          <el-radio-group v-model="addDlg.scope" @change="onScopeSwitch">
            <el-radio value="type">客户等级价</el-radio>
            <el-radio value="customer">客户专属价</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="addDlg.scope === 'type'" label="等级">
          <el-select v-model="addDlg.scopeValue" style="width: 160px">
            <el-option label="默认" value="default" />
            <el-option label="A 类" value="A" />
            <el-option label="B 类" value="B" />
            <el-option label="C 类" value="C" />
          </el-select>
        </el-form-item>
        <el-form-item v-else label="客户">
          <el-select v-model="addDlg.scopeValue" filterable style="width: 220px" placeholder="必须选择客户">
            <el-option v-for="c in customers" :key="c.id" :value="String(c.id)" :label="c.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="价格"><el-input-number v-model="addDlg.price" :min="0" :precision="2" /></el-form-item>
        <el-form-item label="生效日"><el-input v-model="today" disabled /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="doAdd">保存（今日生效）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { priceApi, customerApi } from '@/api/services'

const today = new Date().toISOString().slice(0, 10)
const tab = ref('lookup')
const goodsList = ref([])
const customers = ref([])

const lookup = reactive({ goodsId: null, goods: null, rows: [], loading: false })
const addDlg = reactive({ visible: false, scope: 'type', scopeValue: 'A', price: 0 })
const batch = reactive({ level: 'A', mode: 'percent', percent: 10, fixed: 0, goodsIds: [], loading: false })

const todayPrices = computed(() => lookup.rows.filter((r) => r.valid_from <= today))
const batchScopeGoods = computed(() =>
  batch.goodsIds.length ? goodsList.value.filter((g) => batch.goodsIds.includes(g.id)) : goodsList.value)
const batchPreview = computed(() => (tab.value === 'batch' ? batchScopeGoods.value : []))

function batchPrice(g) {
  return batch.mode === 'percent'
    ? Math.round(g.basePrice * (1 + batch.percent / 100) * 100) / 100
    : Number(batch.fixed ?? 0)
}

async function fetchPrices() {
  lookup.goods = goodsList.value.find((g) => g.id === lookup.goodsId) || null
  if (!lookup.goodsId) { lookup.rows = []; return }
  lookup.loading = true
  try {
    lookup.rows = await priceApi.listPrices(lookup.goodsId)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    lookup.loading = false
  }
}

function openAdd() {
  addDlg.scope = 'type'
  addDlg.scopeValue = 'A'
  addDlg.price = lookup.goods ? lookup.goods.basePrice : 0
  addDlg.visible = true
}

/** 切换报价对象时重置选择值，防止"等级值 A 被当成客户 ID"存成脏数据 */
function onScopeSwitch() {
  addDlg.scopeValue = addDlg.scope === 'type' ? 'A' : ''
}

async function doAdd() {
  if (addDlg.scope === 'customer' && !/^\d+$/.test(String(addDlg.scopeValue))) {
    return ElMessage.warning('请选择具体客户（专属价只对单个客户生效）')
  }
  try {
    await priceApi.saveTodayRows([{ goods_id: lookup.goodsId, scope: addDlg.scope, scope_value: addDlg.scopeValue, price: addDlg.price }])
    ElMessage.success('已保存（今日生效）')
    addDlg.visible = false
    fetchPrices()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function doRemovePrice(row) {
  await ElMessageBox.confirm(`确认删除「${row.scopeLabel} ¥${row.price.toFixed(2)}（${row.valid_from}）」？`, '删除确认', { type: 'warning' })
  await priceApi.removePrice(row.id)
  fetchPrices()
}

async function executeBatch() {
  const items = batchPreview.value.map((g) => ({ goods_id: g.id, scope: 'type', scope_value: batch.level, price: batchPrice(g) }))
  if (!items.length) return ElMessage.warning('没有可改价的商品')
  batch.loading = true
  try {
    const n = await priceApi.saveTodayRows(items)
    ElMessage.success(`已写入 ${n} 条价格（${batch.level} 类，今日生效）`)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    batch.loading = false
  }
}

onMounted(async () => {
  goodsList.value = await priceApi.listGoodsLite()
  try {
    customers.value = await customerApi.list()
  } catch (e) {
    customers.value = []
  }
})
</script>

<style scoped>
.hint { margin-left: 10px; color: #999; font-size: 12px; }
</style>
