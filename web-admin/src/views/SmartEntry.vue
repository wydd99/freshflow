<template>
  <div>
    <el-alert type="success" :closable="false" style="margin-bottom: 12px"
      title="把客户的订货信息拍照或粘贴进来，系统自动识别成订单草单；识别不准的地方可直接在下方修改，没有的商品可一键建档" />

    <el-card shadow="never" style="margin-bottom: 12px">
      <el-form inline>
        <el-form-item label="客户">
          <el-select v-model="form.customerId" filterable placeholder="选择客户" style="width: 240px">
            <el-option v-for="c in customers" :key="c.id" :value="c.id" :label="`${c.name}（${levelLabel(c.level)}·${settleLabel(c)}）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="发货日期"><el-date-picker v-model="form.deliveryDate" type="date" value-format="YYYY-MM-DD" :clearable="false" /></el-form-item>
        <el-form-item label="时段">
          <el-select v-model="form.timeSlot" filterable allow-create default-first-option
            placeholder="选择或输入发货时段" style="width: 180px">
            <el-option v-for="t in timeSlots" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-tabs v-model="mode">
        <el-tab-pane label="文本粘贴 / 语音转写" name="text">
          <el-input v-model="form.text" type="textarea" :rows="5"
            placeholder='粘贴客户报单，例如：&#10;客户甲：奶白菜一斤，土豆两斤，海天生抽2瓶&#10;或：大蒜一斤、紫皮洋葱四斤' />
          <div style="margin-top: 10px; display: flex; gap: 10px">
            <el-button type="primary" :loading="parsing" @click="recognizeText">识别文本</el-button>
            <span class="hint">AI 自动识别，识别后可人工修改</span>
          </div>
        </el-tab-pane>

        <el-tab-pane label="拍照 / 图片识别" name="image">
          <el-upload drag accept="image/png,image/jpeg,image/gif" :auto-upload="false" :show-file-list="false"
            :on-change="onImagePick">
            <el-icon style="font-size: 40px; margin-top: 20px"><UploadFilled /></el-icon>
            <div style="margin: 8px 0">点击选择手写单/打印单照片（JPG/PNG/GIF）</div>
          </el-upload>
          <div style="margin-top: 10px; display: flex; gap: 10px; align-items: center">
            <el-button type="primary" :loading="parsing" :disabled="!imageDataUrl" @click="recognizeImage">AI 识别图片</el-button>
            <span v-if="imageDataUrl" class="hint">图片已就绪（{{ imageName }}）</span>
            <span v-else class="hint">选好照片后点击识别，自动转录成订单明细</span>
          </div>
        </el-tab-pane>
      </el-tabs>

    </el-card>

    <el-card v-if="rows.length" shadow="never">
      <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 10px">
        <b>识别结果</b>
        <el-tag type="success" size="small">已匹配 {{ countBy('matched') }}</el-tag>
        <el-tag type="warning" size="small">待选 {{ countBy('candidate') }}</el-tag>
        <el-tag type="danger" size="small">未匹配 {{ countBy('unmatched') }}</el-tag>
        <div style="flex: 1" />
        <el-button type="primary" :disabled="countBy('matched') + countBy('candidate') === 0"
          :loading="saving" @click="saveDraft">保存为草单（{{ usableRows.length }} 行）</el-button>
      </div>

      <el-table :data="rows" border size="small">
        <el-table-column prop="raw" label="原文" min-width="140" />
        <el-table-column label="品名" min-width="130">
          <template #default="{ row }"><el-input v-model="row.name" size="small" @change="rematch(row)" /></template>
        </el-table-column>
        <el-table-column label="数量" width="110">
          <template #default="{ row }"><el-input-number v-model="row.qty" :min="0.5" size="small" style="width: 90px" /></template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="60" align="center" />
        <el-table-column label="匹配" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'matched' ? 'success' : row.status === 'candidate' ? 'warning' : 'danger'">
              {{ row.status === 'matched' ? '已匹配' : row.status === 'candidate' ? '待选' : '未匹配' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="商品确认" min-width="220">
          <template #default="{ row }">
            <el-select v-if="row.status === 'candidate'" v-model="row.goodsId" size="small" placeholder="选择正确商品"
              style="width: 100%" @change="row.status = 'matched'">
              <el-option v-for="g in row.candidates" :key="g.id" :value="g.id" :label="`${g.name}（${g.code}）`" />
            </el-select>
            <span v-else-if="row.status === 'matched'">{{ goodsName(row.goodsId) }}</span>
            <el-button v-else link type="primary" @click="openCreateGoods(row)">一键建档</el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="60" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" @click="rows.splice($index, 1)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="createGoods.visible" title="一键建档（未匹配商品 → 商品库）" width="520px">
      <el-form label-width="90px">
        <el-form-item label="品名" required><el-input v-model="createGoods.form.name" /></el-form-item>
        <el-form-item label="别名">
          <el-select v-model="createGoods.form.alias" multiple filterable allow-create default-first-option
            placeholder="手写单常见叫法，回车添加" style="width: 100%" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="createGoods.form.category" style="width: 180px">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="单位">
          <el-select v-model="createGoods.form.unit" filterable allow-create default-first-option
            style="width: 160px" placeholder="选择或直接输入自定义单位">
            <el-option v-for="u in commonUnits" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="称重类型">
          <el-radio-group v-model="createGoods.form.weighType">
            <el-radio value="weight">按重分拣</el-radio>
            <el-radio value="none">无需称重</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="基准价"><el-input-number v-model="createGoods.form.basePrice" :min="0" :precision="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createGoods.visible = false">取消</el-button>
        <el-button type="primary" @click="doCreateGoods">建档并匹配</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { orderApi, customerApi, goodsApi, localToday } from '@/api/services'
import { parseOrderText } from '@/lib/orderParse'
import {
  getGlmKey, setGlmKey, getTextModel, setTextModel, getImageModel, setImageModel,
  glmParseText, glmParseImage, compressImage,
} from '@/lib/glm'

const router = useRouter()
const timeSlots = ['早5:00-7:00', '早5:00-8:00', '早6:00-9:00', '上午', '下午', '当天多次']
const mode = ref('text')
const parsing = ref(false)
const saving = ref(false)
const customers = ref([])
const goodsAll = ref([])
const categories = ref([])
const rows = ref([])
const glmKey = ref(getGlmKey())
const ai = reactive({ key: getGlmKey(), textModel: getTextModel(), imageModel: getImageModel() })
const imageDataUrl = ref('')
const imageName = ref('')
const commonUnits = ['斤', '公斤', '件', '箱', '瓶', '袋', '桶', '包', '份', '把', '个', '盒', '板']

const form = reactive({
  customerId: null,
  deliveryDate: localToday(),
  timeSlot: '',
  text: '',
})

const createGoods = reactive({
  visible: false,
  targetRow: null,
  form: { name: '', alias: [], category: '', unit: '斤', weighType: 'weight', basePrice: 0 },
})

const levelLabel = (v) => ({ default: '默认', A: 'A类', B: 'B类', C: 'C类' }[v] || v)
const settleLabel = (c) => ({ daily: '日结', monthly: '月结', cod: '货到付款' }[c.settlement_type] || c.settlement_type)
const countBy = (s) => rows.value.filter((r) => r.status === s).length
const usableRows = computed(() => rows.value.filter((r) => r.goodsId && r.qty > 0))
const goodsName = (id) => goodsAll.value.find((g) => g.id === id)?.name || ''

function matchGoodsByName(name) {
  const n = (name || '').trim()
  if (!n) return { status: 'unmatched', candidates: [] }
  const exact = goodsAll.value.filter((g) => g.name === n || (g.alias || []).includes(n))
  if (exact.length >= 1) return { status: 'matched', goodsId: exact[0].id, candidates: exact }
  const fuzzy = goodsAll.value.filter((g) =>
    g.name.includes(n) || n.includes(g.name) ||
    (g.alias || []).some((a) => a.includes(n) || n.includes(a)))
  if (fuzzy.length) return { status: 'candidate', candidates: fuzzy }
  return { status: 'unmatched', candidates: [] }
}

function rematch(row) {
  const m = matchGoodsByName(row.name)
  row.status = m.status
  row.goodsId = m.goodsId || null
  row.candidates = m.candidates
}

function ingestParsed(parsed, sourceTag) {
  const list = (parsed.items || []).map((it) => ({
    raw: it.raw || `${it.name || ''}${it.qty ?? ''}${it.unit || ''}`,
    name: it.name || '',
    qty: Number(it.qty ?? 1) || 1,
    unit: it.unit || '斤',
    status: 'unmatched',
    goodsId: null,
    candidates: [],
    confidence: it.confidence || null,
  }))
  rows.value = list
  rows.value.forEach(rematch)
  // 客户名提示消歧：先看是否命中商品库（如"来点小葱"这类纯品名段），再看是否命中客户
  const hint = parsed.customer_hint
  if (hint) {
    const m = matchGoodsByName(hint)
    if (m.status === 'matched') {
      rows.value.push({
        raw: hint, name: hint, qty: 1, unit: goodsAll.value.find((g) => g.id === m.goodsId)?.unit || '斤',
        status: 'matched', goodsId: m.goodsId, candidates: m.candidates,
      })
    } else {
      const hit = customers.value.find((c) => c.name.includes(hint) || hint.includes(c.name))
      if (hit) {
        form.customerId = hit.id
        ElMessage.success(`已按识别结果选择客户：${hit.name}`)
      }
    }
  }
  const bad = countBy('unmatched')
  ElMessage.success(`${sourceTag}完成：${rows.value.length} 行，未匹配 ${bad} 行${bad ? '（可一键建档）' : ''}`)
}

async function recognizeText() {
  const text = form.text.trim()
  if (!text) return ElMessage.warning('请先粘贴订单文本')
  parsing.value = true
  try {
    let parsed = null
    if (glmKey.value) {
      try {
        parsed = await glmParseText(text)
      } catch (e) {
        ElMessage.warning('GLM 调用失败，已回退本地规则：' + String(e?.message || e).slice(0, 120))
      }
    }
    if (!parsed) parsed = parseOrderText(text)
    ingestParsed(parsed, '识别')
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    parsing.value = false
  }
}

async function onImagePick(file) {
  const raw = file.raw
  if (!raw) return
  try {
    imageName.value = raw.name
    imageDataUrl.value = await compressImage(raw)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function recognizeImage() {
  parsing.value = true
  try {
    const parsed = await glmParseImage(imageDataUrl.value)
    ingestParsed(parsed, '图片识别')
  } catch (e) {
    const msg = String(e?.message || e)
    ElMessage.error(/Failed to fetch|NetworkError/i.test(msg) ? '浏览器直连 GLM 被拦（CORS），可稍后改走云函数代理，或用文本模式' : msg)
  } finally {
    parsing.value = false
  }
}

function saveAiSettings() {
  setGlmKey(ai.key)
  setTextModel(ai.textModel)
  setImageModel(ai.imageModel)
  glmKey.value = getGlmKey()
  ElMessage.success('AI 设置已保存（仅存本机）')
}

function openCreateGoods(row) {
  createGoods.targetRow = row
  createGoods.form = {
    name: row.name || '',
    alias: row.raw && row.raw !== row.name ? [row.raw.replace(/\d+(\.\d+)?|[一二两三四五六七八九十半]+/g, '').replace(/[斤公斤克件箱瓶袋桶包份把个盒板条听罐]/g, '').trim()].filter((a) => a && a !== row.name) : [],
    category: categories.value[0] || '',
    unit: row.unit || '斤', // 跟随识别原文单位（件/包/盒），下拉可快速切换，也可输入任意自定义单位
    weighType: 'weight',
    basePrice: 0,
  }
  createGoods.visible = true
}

async function doCreateGoods() {
  const f = createGoods.form
  if (!f.name) return ElMessage.warning('品名必填')
  try {
    const saved = await goodsApi.save({ ...f, status: 'active' })
    goodsAll.value = await goodsApi.list()
    const row = createGoods.targetRow
    if (row) {
      row.goodsId = saved.id
      row.status = 'matched'
    }
    createGoods.visible = false
    ElMessage.success(`已建档「${f.name}」，该行已匹配`)
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

async function saveDraft() {
  const customer = customers.value.find((c) => c.id === form.customerId)
  if (!customer) return ElMessage.warning('请选择客户')
  const items = usableRows.value.map((r) => ({ goods_id: r.goodsId, qty: r.qty }))
  if (!items.length) return ElMessage.warning('没有可保存的有效行')
  saving.value = true
  try {
    const order = await orderApi.createDraft(
      { customer, delivery_date: form.deliveryDate, time_slot: form.timeSlot, items },
      { source: mode.value === 'image' ? 'photo' : 'text' })
    ElMessage.success(`草单 ${order.order_no} 已生成，可到订单页确认`)
    rows.value = []
    router.push('/orders')
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    customers.value = await customerApi.list()
    goodsAll.value = await goodsApi.list()
    categories.value = await goodsApi.listCategories()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
})
</script>

<style scoped>
.hint { color: #999; font-size: 12px; }
</style>
