<template>
  <div>
    <div class="head">
      <span class="hello">示例商家A · 经营日报</span>
      <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 150px" @change="loadAll" />
    </div>

    <el-row :gutter="14">
      <el-col :span="6"><el-card shadow="hover"><div class="label">今日订单数</div><div class="num">{{ today.orderCount }}</div></el-card></el-col>
      <el-col :span="6"><el-card shadow="hover"><div class="label">今日销售额</div><div class="num">¥{{ today.sales.toFixed(2) }}</div></el-card></el-col>
      <el-col :span="6"><el-card shadow="hover"><div class="label">待分拣订单</div><div class="num warn">{{ today.pendingSort }}</div></el-card></el-col>
      <el-col :span="6"><el-card shadow="hover"><div class="label">客户欠款总额</div><div class="num danger">¥{{ overdueTotal.toFixed(2) }}</div></el-card></el-col>
    </el-row>

    <el-row :gutter="14" style="margin-top: 14px">
      <el-col :span="12">
        <el-card shadow="never">
          <div class="ctitle">近 7 日销售额（按发货日期）</div>
          <div class="bars">
            <div v-for="d in week" :key="d.date" class="barcol">
              <div class="barval">¥{{ d.sales.toFixed(0) }}</div>
              <div class="bar" :style="{ height: barHeight(d.sales) + 'px' }" />
              <div class="bardate">{{ d.date.slice(5) }}</div>
              <div class="barcnt">{{ d.count }} 单</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <div class="ctitle">今日履约</div>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="待分拣订单">{{ today.pendingSort }} 单</el-descriptions-item>
            <el-descriptions-item label="待发货订单">{{ today.readyShip }} 单</el-descriptions-item>
            <el-descriptions-item label="已发货/完成">{{ today.shipped }} 单</el-descriptions-item>
            <el-descriptions-item label="成本利润">
              待采购价录入后自动计算（T2.11 采购模块）
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" style="margin-top: 14px">
      <div class="ctitle">欠款 TOP 客户（完整往来账在"对账"页）</div>
      <el-table :data="topDebt" border size="small">
        <el-table-column prop="name" label="客户" min-width="140" />
        <el-table-column label="欠款余额" width="120" align="right">
          <template #default="{ row }"><span :class="row.balance > 0 ? 'danger' : ''">¥{{ row.balance.toFixed(2) }}</span></template>
        </el-table-column>
        <el-table-column label="最近往来" min-width="160">
          <template #default="{ row }">{{ (row.last || '').replace('T', ' ').slice(0, 16) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { reportApi, ledgerApi, localToday } from '@/api/services'

const date = ref(localToday())
const today = ref({ orderCount: 0, sales: 0, pendingSort: 0, readyShip: 0, shipped: 0 })
const week = ref([])
const overdueTotal = ref(0)
const topDebt = ref([])

const maxWeekSales = computed(() => Math.max(...week.value.map((d) => d.sales), 1))
const barHeight = (v) => Math.max(6, Math.round(v / maxWeekSales.value * 90))

async function loadAll() {
  try {
    today.value = await reportApi.daily(date.value)
    week.value = await reportApi.week(7)
    const summary = await ledgerApi.summary()
    overdueTotal.value = Math.round(summary.filter((c) => c.balance > 0).reduce((s, c) => s + c.balance, 0) * 100) / 100
    topDebt.value = summary.filter((c) => c.balance > 0).slice(0, 5)
  } catch (e) {
    console.error(e)
  }
}

onMounted(loadAll)
</script>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.hello { font-size: 18px; font-weight: 700; }
.label { color: #888; font-size: 13px; }
.num { font-size: 26px; font-weight: 700; margin-top: 6px; }
.num.warn { color: #e6a23c; }
.num.danger { color: #e64340; }
.ctitle { font-weight: 600; margin-bottom: 10px; }
.bars { display: flex; align-items: flex-end; gap: 12px; height: 150px; }
.barcol { flex: 1; text-align: center; }
.bar { width: 100%; max-width: 46px; margin: 0 auto; background: #1f9d55; border-radius: 4px 4px 0 0; }
.barval { font-size: 11px; color: #666; }
.bardate { font-size: 11px; color: #888; margin-top: 4px; }
.barcnt { font-size: 10px; color: #bbb; }
.danger { color: #e64340; }
</style>
