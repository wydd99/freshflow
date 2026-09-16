<template>
  <div>
    <div v-if="!checked" v-loading="true" style="height: 200px"></div>
    <el-alert v-else-if="!isPlatform" type="warning" :closable="false"
      title="当前账号不是平台方（不在 PLATFORM_UIDS 名单内），无法查看平台后台。如需访问请联系系统管理员配置。" />
    <template v-else>
      <div style="margin-bottom: 12px; display: flex; gap: 10px; align-items: center">
        <el-button type="primary" @click="dlg.visible = true">新建租户</el-button>
        <el-button @click="activeTab === 'accounts' ? loadAccounts() : activeTab === 'maintain' ? reloadMt() : load()">刷新</el-button>
        <span class="hint">平台总后台（T3.4）：所有租户与账号的全平台视图。新建租户=运维专属操作。</span>
      </div>
      <el-tabs v-model="activeTab" @tab-change="onOuterTab">
        <el-tab-pane label="租户一览" name="tenants">
      <el-table :data="tenants" v-loading="loading" border stripe>
        <el-table-column label="ID" width="60" prop="id" align="center" />
        <el-table-column label="租户（品牌）" min-width="200">
          <template #default="{ row }">
            <b>{{ row.brand?.name || row.name }}</b>
            <span v-if="row.brand?.short" class="mono">（{{ row.brand.short }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="套餐" width="90" align="center">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ planName(row.plan) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'active' ? 'success' : 'danger'">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="店家账户" width="95" align="center">
          <template #default="{ row }">{{ row.stats.customer_users }} / {{ row.quotas?.customer_accounts ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="客户档案" width="90" align="center">
          <template #default="{ row }">{{ row.stats.customers }}</template>
        </el-table-column>
        <el-table-column label="订单数" width="85" align="center">
          <template #default="{ row }">{{ row.stats.orders }}</template>
        </el-table-column>
        <el-table-column label="管理员" width="80" align="center">
          <template #default="{ row }">{{ row.stats.admins }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button link :type="row.status === 'active' ? 'danger' : 'success'" size="small" @click="toggle(row)">
              {{ row.status === 'active' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="hint" style="margin-top: 10px">
        提示：正式运营时请把平台方账号（PLATFORM_UIDS）换成你自己的账号；每个租户的品牌信息由各租户在「设置」页自行维护。
      </div>
        </el-tab-pane>
        <el-tab-pane label="账号总览" name="accounts">
          <div class="hint" style="margin-bottom: 8px">全平台账号清单：谁是商家/员工、哪个顾客属于哪家商家，一目了然（数据来自 admin_user / customer_user 映射，无需人工标注）。</div>
          <el-table :data="accounts" v-loading="loadingAccounts" border stripe>
            <el-table-column label="类型" width="100" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.kind === '顾客' ? 'success' : 'primary'">{{ row.kind }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="登录名" min-width="130" prop="username" />
            <el-table-column label="显示名" min-width="140">
              <template #default="{ row }">{{ row.display }}</template>
            </el-table-column>
            <el-table-column label="角色" width="90" align="center">
              <template #default="{ row }">{{ row.role === 'boss' ? '老板' : row.role === 'manager' ? '店长' : row.role === 'customer' ? '顾客' : row.role }}</template>
            </el-table-column>
            <el-table-column label="所属租户（商家）" min-width="170">
              <template #default="{ row }"><b>{{ row.tenant }}</b></template>
            </el-table-column>
            <el-table-column label="所属客户" min-width="130">
              <template #default="{ row }">{{ row.customer || '—' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="80" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'active' ? 'success' : 'info'">{{ row.status === 'active' ? '正常' : row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Uid" width="180">
              <template #default="{ row }"><span class="mono">{{ row.uid }}</span></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="代维护" name="maintain">
          <div style="margin-bottom: 10px; display: flex; gap: 10px; align-items: center">
            <el-select v-model="mt.tenantId" placeholder="先选择要维护的商家租户" style="width: 260px" @change="onMtTenantChange">
              <el-option v-for="t in tenants" :key="t.id" :label="t.brand?.name || t.name" :value="t.id" />
            </el-select>
            <el-button @click="reloadMt">刷新</el-button>
            <span class="hint">替商家代录商品/客户/价格（商家的密码始终在商家手里，运维不登商家后台）；每笔代录均留痕可审计。</span>
          </div>
          <el-empty v-if="!mt.tenantId" description="请先选择商家租户" />
          <el-tabs v-else v-model="mt.subTab">
            <el-tab-pane label="商品" name="goods">
              <div style="margin-bottom: 8px; display: flex; gap: 10px; align-items: center">
                <el-button type="primary" size="small" @click="openGoodsDialog()">新增商品</el-button>
                <el-button size="small" @click="batch.visible = true">批量粘贴</el-button>
                <el-input v-model="mt.goodsKw" placeholder="搜索品名/编码" clearable style="width: 200px" />
              </div>
              <el-table :data="filteredMtGoods" v-loading="mt.loadingGoods" border stripe>
                <el-table-column label="编码" width="110">
                  <template #default="{ row }"><span class="mono">{{ row.code }}</span></template>
                </el-table-column>
                <el-table-column label="品名" min-width="130" prop="name" />
                <el-table-column label="分类" width="100">
                  <template #default="{ row }">{{ catName(row.category_id) }}</template>
                </el-table-column>
                <el-table-column label="别名" min-width="140">
                  <template #default="{ row }">{{ aliasText(row.alias) }}</template>
                </el-table-column>
                <el-table-column label="单位" width="70" align="center" prop="unit" />
                <el-table-column label="基准价" width="90" align="right">
                  <template #default="{ row }">¥{{ Number(row.base_price || 0).toFixed(2) }}</template>
                </el-table-column>
                <el-table-column label="商城可见" width="90" align="center">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.allow_mall ? 'success' : 'info'">{{ row.allow_mall ? '是' : '否' }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="80" align="center">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.status === 'active' ? 'success' : 'danger'">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="70" align="center">
                  <template #default="{ row }">
                    <el-button link type="primary" size="small" @click="openGoodsDialog(row)">编辑</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="客户" name="customers">
              <div style="margin-bottom: 8px; display: flex; gap: 10px; align-items: center">
                <el-button type="primary" size="small" @click="openCustomerDialog()">新增客户</el-button>
                <el-input v-model="mt.custKw" placeholder="搜索客户名称" clearable style="width: 200px" />
              </div>
              <el-table :data="filteredMtCustomers" v-loading="mt.loadingCustomers" border stripe>
                <el-table-column label="名称" min-width="150" prop="name" />
                <el-table-column label="等级" width="90" align="center">
                  <template #default="{ row }">
                    <el-tag :type="mtLevelTag(row.level)" size="small">{{ mtLevelLabel(row.level) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="结算方式" width="160" align="center">
                  <template #default="{ row }">{{ mtSettleLabel(row) }}</template>
                </el-table-column>
                <el-table-column label="欠款上限" width="100" align="right">
                  <template #default="{ row }">{{ row.credit_limit != null ? '¥' + Number(row.credit_limit).toFixed(0) : '不限' }}</template>
                </el-table-column>
                <el-table-column label="超期天数" width="90" align="center">
                  <template #default="{ row }">{{ row.overdue_days }} 天</template>
                </el-table-column>
                <el-table-column label="可见全部商品" width="110" align="center">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.visible_all ? 'success' : 'info'">{{ row.visible_all ? '是' : '否' }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="80" align="center">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.status === 'active' ? 'success' : 'danger'">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="70" align="center">
                  <template #default="{ row }">
                    <el-button link type="primary" size="small" @click="openCustomerDialog(row)">编辑</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="价格" name="prices">
              <div style="display: flex; gap: 16px; align-items: flex-start">
                <div style="width: 280px; flex-shrink: 0">
                  <el-select v-model="mt.priceGoodsId" filterable placeholder="选择商品（编码/品名）" style="width: 100%">
                    <el-option v-for="g in mt.goods" :key="g.id" :label="`${g.code} ${g.name}`" :value="g.id" />
                  </el-select>
                  <div class="hint" style="margin-top: 8px; line-height: 1.6">先选商品，右侧显示当前生效价；行首箭头展开该价格的全部历史。不做批量改价与删除价格。</div>
                </div>
                <div style="flex: 1; min-width: 0">
                  <el-table :data="mtCurrentPrices" v-loading="mt.loadingPrices" border stripe>
                    <el-table-column type="expand">
                      <template #default="{ row }">
                        <div style="padding: 4px 12px">
                          <el-table :data="priceHistory(row)" size="small" border>
                            <el-table-column label="生效日" prop="valid_from" width="130" align="center" />
                            <el-table-column label="价格" width="120" align="right">
                              <template #default="{ row: h }">¥{{ Number(h.price).toFixed(2) }}</template>
                            </el-table-column>
                          </el-table>
                        </div>
                      </template>
                    </el-table-column>
                    <el-table-column label="价格类型" width="110" align="center">
                      <template #default="{ row }">{{ row.scope === 'type' ? '等级价' : '客户专属价' }}</template>
                    </el-table-column>
                    <el-table-column label="对象" min-width="140">
                      <template #default="{ row }">{{ priceTargetLabel(row) }}</template>
                    </el-table-column>
                    <el-table-column label="当前价" width="110" align="right">
                      <template #default="{ row }">¥{{ Number(row.price).toFixed(2) }}</template>
                    </el-table-column>
                    <el-table-column label="生效日" prop="valid_from" width="130" align="center" />
                  </el-table>
                  <div style="margin-top: 14px; border-top: 1px solid #ebeef5; padding-top: 12px">
                    <div style="margin-bottom: 10px; display: flex; gap: 14px; align-items: center">
                      <b>新增/修改价格</b>
                      <el-radio-group v-model="pf.scope">
                        <el-radio value="type">等级价</el-radio>
                        <el-radio value="customer">客户专属价</el-radio>
                      </el-radio-group>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
                      <el-checkbox-group v-if="pf.scope === 'type'" v-model="pf.levels">
                        <el-checkbox value="A">A 级</el-checkbox>
                        <el-checkbox value="B">B 级</el-checkbox>
                        <el-checkbox value="C">C 级</el-checkbox>
                      </el-checkbox-group>
                      <el-select v-else v-model="pf.customerId" filterable placeholder="选择客户" style="width: 200px">
                        <el-option v-for="c in mt.customers" :key="c.id" :label="c.name" :value="c.id" />
                      </el-select>
                      <el-input-number v-model="pf.price" :precision="2" :min="0.01" placeholder="价格" style="width: 140px" />
                      <el-button type="primary" :loading="pf.saving" @click="submitPrice">保存价格</el-button>
                      <span class="hint">同一日期重复设置=覆盖当日价，历史保留。</span>
                    </div>
                  </div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-tab-pane>
      </el-tabs>

      <el-dialog v-model="dlg.visible" title="新建租户向导（运维专属）" width="460px">
        <el-form label-width="110px">
          <el-form-item label="商家名称">
            <el-input v-model="dlg.name" placeholder="如：示例商家B（租户显示名）" maxlength="40" />
          </el-form-item>
          <el-form-item label="管理员账号">
            <el-input v-model="dlg.username" placeholder="字母开头，2-48 位，仅字母数字 . _ -" />
          </el-form-item>
          <el-form-item label="初始密码">
            <el-input v-model="dlg.password" type="password" show-password placeholder="8-32 位，含大写/小写/数字中至少 3 类" />
          </el-form-item>
          <el-form-item label="安全模式">
            <el-switch v-model="dlg.phoneVerify" active-text="开" inactive-text="关" />
            <div class="hint" style="line-height:1.5">开=顾客新设备登录需短信验证（安全套餐卖点）；关=基础模式（账号密码直接登录）。创建后可改。</div>
          </el-form-item>
          <el-form-item label="商品分类种子">
            <el-switch v-model="dlg.seed" active-text="复制标准分类" inactive-text="空白起步" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dlg.visible = false">取消</el-button>
          <el-button type="primary" :loading="dlg.saving" @click="createTenant">一键创建</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="gdlg.visible" :title="gdlg.id ? '编辑商品（代维护）' : '新增商品（代维护）'" width="520px">
        <el-form label-width="100px">
          <el-form-item label="品名" required>
            <el-input v-model="gdlg.name" maxlength="60" placeholder="如：土鸡蛋" />
          </el-form-item>
          <el-form-item label="分类">
            <el-select v-model="gdlg.category" filterable allow-create default-first-option clearable placeholder="选择分类，或输入新分类名（自动创建）" style="width: 100%">
              <el-option v-for="c in mt.categories" :key="c.id" :label="c.name" :value="c.name" />
            </el-select>
          </el-form-item>
          <el-form-item label="单位">
            <el-input v-model="gdlg.unit" placeholder="默认：斤" style="width: 160px" />
          </el-form-item>
          <el-form-item label="基准价">
            <el-input-number v-model="gdlg.base_price" :precision="2" :min="0" />
          </el-form-item>
          <el-form-item label="别名">
            <el-input v-model="gdlg.alias" placeholder="手写单常见叫法，分号分隔，如：鸡旦;土鸡蛋" />
          </el-form-item>
          <el-form-item label="规格">
            <el-input v-model="gdlg.spec" placeholder="如：30枚/箱" />
          </el-form-item>
          <el-form-item label="商品介绍">
            <el-input v-model="gdlg.description" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="商城可见">
            <el-switch v-model="gdlg.allow_mall" active-text="开" inactive-text="关" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="gdlg.visible = false">取消</el-button>
          <el-button type="primary" :loading="gdlg.saving" @click="saveGoods">保存</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="batch.visible" title="批量粘贴录入商品（代维护）" width="560px">
        <el-input
          v-model="batch.text" type="textarea" :rows="8"
          placeholder="每行一条，格式：品名,分类,单位,基准价&#10;白菜,叶菜类,斤,3.5&#10;土豆,根茎类,斤,2.8&#10;番茄,,斤,5&#10;分类留空=不设分类；单位留空=默认斤；基准价留空=0" />
        <div class="hint" style="margin-top: 8px">用英文逗号分隔；逐行录入，结束后显示成功/失败明细。</div>
        <template #footer>
          <el-button @click="batch.visible = false">取消</el-button>
          <el-button type="primary" :loading="batch.running" @click="runBatch">开始录入</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="cdlg.visible" :title="cdlg.id ? '编辑客户（代维护）' : '新增客户（代维护）'" width="520px">
        <el-form label-width="110px">
          <el-form-item label="名称" required>
            <el-input v-model="cdlg.name" maxlength="40" placeholder="客户/店铺名称" />
          </el-form-item>
          <el-form-item label="等级">
            <el-select v-model="cdlg.level" style="width: 160px">
              <el-option label="普通" value="default" />
              <el-option label="A 级" value="A" />
              <el-option label="B 级" value="B" />
              <el-option label="C 级" value="C" />
            </el-select>
          </el-form-item>
          <el-form-item label="结算方式">
            <el-radio-group v-model="cdlg.settlement_type">
              <el-radio value="daily">当日结</el-radio>
              <el-radio value="monthly">月结</el-radio>
              <el-radio value="cod">货到付款</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="cdlg.settlement_type === 'monthly'" label="每月结账日">
            <el-input-number v-model="cdlg.settlement_day" :min="1" :max="31" placeholder="1-31" />
          </el-form-item>
          <el-form-item label="欠款上限">
            <el-input-number v-model="cdlg.credit_limit" :min="0" placeholder="留空=不限" />
            <span class="hint" style="margin-left: 8px">留空=不限</span>
          </el-form-item>
          <el-form-item label="超期禁单天数">
            <el-input-number v-model="cdlg.overdue_days" :min="0" />
          </el-form-item>
          <el-form-item label="可见全部商品">
            <el-switch v-model="cdlg.visible_all" active-text="开" inactive-text="关" />
          </el-form-item>
          <el-form-item v-if="!cdlg.visible_all" label="可见分类">
            <el-select v-model="cdlg.visible_category_names" multiple filterable style="width: 100%" placeholder="勾选该客户可购买的分类（可输入新分类名）">
              <el-option v-for="c in mt.custCategories" :key="c.id" :label="c.name" :value="c.name" />
            </el-select>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="cdlg.remark" type="textarea" :rows="2" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="cdlg.visible = false">取消</el-button>
          <el-button type="primary" :loading="cdlg.saving" @click="saveCustomer">保存</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { auth, CLOUDBASE_ENV_ID } from '@/lib/cloudbase'

const PLATFORM_URL = `https://${CLOUDBASE_ENV_ID}.service.tcloudbase.com/platform`

const checked = ref(false)
const isPlatform = ref(false)
const tenants = ref([])
const loading = ref(false)
const activeTab = ref('tenants')
const accounts = ref([])
const loadingAccounts = ref(false)
const dlg = reactive({ visible: false, name: '', username: '', password: '', phoneVerify: true, seed: true, saving: false })

function planName(p) {
  return { trial: '试用', basic: '基础', pro: '专业', white: '白牌' }[p] || p
}
async function call(action, extra) {
  const { data } = await auth.getSession()
  const tk = data?.session?.access_token
  if (!tk) throw new Error('会话失效，请重新登录')
  const r = await fetch(PLATFORM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ action, access_token: tk, device_id: localStorage.getItem('ff_admin_device') || 'web-admin' }, extra || {})),
  })
  return r.json()
}
async function load() {
  loading.value = true
  try {
    const res = await call('list_tenants')
    if (!res.ok) throw new Error(res.error || '加载失败')
    tenants.value = res.tenants || []
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loading.value = false
  }
}
async function loadAccounts() {
  loadingAccounts.value = true
  try {
    const res = await call('list_accounts')
    if (!res.ok) throw new Error(res.error || '加载失败')
    accounts.value = res.accounts || []
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    loadingAccounts.value = false
  }
}
async function createTenant() {
  if (!dlg.name.trim() || !dlg.username.trim() || !dlg.password) return ElMessage.warning('请填完整')
  dlg.saving = true
  try {
    const res = await call('create_tenant', {
      name: dlg.name.trim(), username: dlg.username.trim(), password: dlg.password,
      phone_verify: dlg.phoneVerify, seed: dlg.seed,
    })
    if (!res.ok) throw new Error(res.error || '创建失败')
    ElMessage.success(`租户「${res.name}」已创建，管理员 ${res.username} 可立即登录后台`)
    dlg.visible = false
    dlg.name = ''; dlg.username = ''; dlg.password = ''; dlg.phoneVerify = true; dlg.seed = true
    load()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    dlg.saving = false
  }
}
async function toggle(row) {
  const action = row.status === 'active' ? '停用' : '启用'
  await ElMessageBox.confirm(`确认${action}租户「${row.brand?.name || row.name}」？${row.status === 'active' ? '停用后该租户将无法使用系统。' : ''}`, `${action}确认`, { type: 'warning' })
  try {
    const res = await call('set_status', { id: row.id, status: row.status === 'active' ? 'suspended' : 'active' })
    if (!res.ok) throw new Error(res.error || '操作失败')
    ElMessage.success(`已${action}`)
    load()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}
// ===== U6 代维护（替商家录商品/客户/价格，后端每笔留痕） =====
const mt = reactive({ tenantId: null, subTab: 'goods', goodsKw: '', custKw: '', goods: [], categories: [], customers: [], custCategories: [], prices: [], loadingGoods: false, loadingCustomers: false, loadingPrices: false, priceGoodsId: null })
const gdlg = reactive({ visible: false, saving: false, id: null, code: '', name: '', category: '', unit: '斤', base_price: 0, alias: '', spec: '', description: '', allow_mall: true, status: 'active' })
const cdlg = reactive({ visible: false, saving: false, id: null, name: '', level: 'default', settlement_type: 'daily', settlement_day: null, credit_limit: null, overdue_days: 30, visible_all: true, visible_category_names: [], remark: '', status: 'active' })
const pf = reactive({ scope: 'type', levels: [], customerId: null, price: null, saving: false })
const batch = reactive({ visible: false, text: '', running: false })

function catName(id) {
  const c = mt.categories.find((x) => x.id === id)
  return c ? c.name : '—'
}
function aliasText(a) {
  if (Array.isArray(a)) return a.join('；')
  return String(a || '').trim() || '—'
}
function mtLevelLabel(v) { return { A: 'A 级', B: 'B 级', C: 'C 级', default: '普通' }[v] || v }
function mtLevelTag(v) { return { A: 'danger', B: 'warning', C: 'info', default: '' }[v] || '' }
function mtSettleLabel(row) {
  return { daily: '当日结', monthly: `月结（每月${row.settlement_day || '?'}日）`, cod: '货到付款' }[row.settlement_type] || row.settlement_type
}
const filteredMtGoods = computed(() => {
  const kw = mt.goodsKw.trim().toLowerCase()
  if (!kw) return mt.goods
  return mt.goods.filter((g) => String(g.name || '').toLowerCase().includes(kw) || String(g.code || '').toLowerCase().includes(kw))
})
const filteredMtCustomers = computed(() => {
  const kw = mt.custKw.trim().toLowerCase()
  if (!kw) return mt.customers
  return mt.customers.filter((c) => String(c.name || '').toLowerCase().includes(kw))
})
// 当前生效价：同商品同 scope+scope_value 只取 valid_from 最大一条（日期为 YYYY-MM-DD，字典序即时间序）
const mtCurrentPrices = computed(() => {
  if (!mt.priceGoodsId) return []
  const groups = new Map()
  for (const p of mt.prices) {
    if (p.goods_id !== mt.priceGoodsId) continue
    const key = p.scope + '|' + p.scope_value
    const cur = groups.get(key)
    if (!cur || String(p.valid_from) > String(cur.valid_from)) groups.set(key, p)
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.scope === b.scope ? String(a.scope_value).localeCompare(String(b.scope_value)) : a.scope.localeCompare(b.scope))
})
function priceHistory(row) {
  return mt.prices
    .filter((p) => p.goods_id === mt.priceGoodsId && p.scope === row.scope && p.scope_value === row.scope_value)
    .slice()
    .sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)))
}
function priceTargetLabel(p) {
  if (p.scope === 'type') return mtLevelLabel(p.scope_value)
  const c = mt.customers.find((x) => x.id === Number(p.scope_value))
  return c ? c.name : '客户 #' + p.scope_value
}
async function loadMtGoods() {
  mt.loadingGoods = true
  try {
    const res = await call('maintain', { sub: 'list_goods', tenant_id: mt.tenantId })
    if (!res.ok) throw new Error(res.error || '加载失败')
    mt.goods = res.goods || []
    mt.categories = res.categories || []
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally { mt.loadingGoods = false }
}
async function loadMtCustomers() {
  mt.loadingCustomers = true
  try {
    const res = await call('maintain', { sub: 'list_customers', tenant_id: mt.tenantId })
    if (!res.ok) throw new Error(res.error || '加载失败')
    mt.customers = res.customers || []
    if (res.categories) mt.custCategories = res.categories
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally { mt.loadingCustomers = false }
}
async function loadMtPrices() {
  mt.loadingPrices = true
  try {
    const res = await call('maintain', { sub: 'list_prices', tenant_id: mt.tenantId })
    if (!res.ok) throw new Error(res.error || '加载失败')
    mt.prices = res.prices || []
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally { mt.loadingPrices = false }
}
function loadMtAll() {
  loadMtGoods(); loadMtCustomers(); loadMtPrices()
}
function onMtTenantChange() {
  mt.goods = []; mt.categories = []; mt.customers = []; mt.prices = []; mt.priceGoodsId = null
  loadMtAll()
}
function reloadMt() {
  if (!mt.tenantId) return
  if (mt.subTab === 'goods') loadMtGoods()
  else if (mt.subTab === 'customers') loadMtCustomers()
  else loadMtPrices()
}
function onOuterTab(t) {
  if (t === 'accounts') {
    if (!accounts.value.length) loadAccounts()
  } else if (t === 'maintain' && mt.tenantId && !mt.goods.length) {
    loadMtAll()
  }
}
function openGoodsDialog(row) {
  Object.assign(gdlg, {
    visible: true, id: row?.id || null, code: row?.code || '', name: row?.name || '',
    category: row ? catName(row.category_id) : '', unit: row?.unit || '斤',
    base_price: row ? Number(row.base_price || 0) : 0,
    alias: row ? (Array.isArray(row.alias) ? row.alias.join(';') : String(row.alias || '')) : '',
    spec: row?.spec || '', description: row?.description || '',
    allow_mall: row ? row.allow_mall !== false : true,
    status: row?.status || 'active',
  })
}
async function saveGoods() {
  if (!gdlg.name.trim()) return ElMessage.warning('品名必填')
  gdlg.saving = true
  try {
    const res = await call('maintain', {
      sub: 'save_goods', tenant_id: mt.tenantId, id: gdlg.id || undefined,
      code: gdlg.code || undefined, name: gdlg.name.trim(), category: gdlg.category.trim(),
      unit: gdlg.unit.trim(), base_price: gdlg.base_price, alias: gdlg.alias,
      spec: gdlg.spec.trim(), description: gdlg.description.trim(), allow_mall: gdlg.allow_mall,
      status: gdlg.status || undefined,
    })
    if (!res.ok) throw new Error(res.error || '保存失败')
    ElMessage.success(res.mode === 'created' ? `已创建（编码 ${res.code}）` : '已更新')
    gdlg.visible = false
    loadMtGoods()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally { gdlg.saving = false }
}
async function runBatch() {
  const todo = []
  const failed = []
  String(batch.text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const cols = line.split(',').map((s) => s.trim())
    const name = cols[0] || ''
    if (!name) { failed.push(`第${i + 1}行：缺少品名`); return }
    let price = 0
    if (cols[3]) {
      const n = Number(cols[3])
      if (!Number.isFinite(n) || n < 0) { failed.push(`第${i + 1}行「${name}」：基准价“${cols[3]}”不是有效数字`); return }
      price = n
    }
    todo.push({ lineNo: i + 1, name, category: cols[1] || '', unit: cols[2] || '', base_price: price })
  })
  if (!todo.length) return ElMessage.warning('没有可录入的行（每行格式：品名,分类,单位,基准价）')
  batch.running = true
  let okCount = 0
  try {
    for (const item of todo) {
      try {
        const res = await call('maintain', { sub: 'save_goods', tenant_id: mt.tenantId, name: item.name, category: item.category, unit: item.unit, base_price: item.base_price })
        if (!res.ok) throw new Error(res.error || '失败')
        okCount++
      } catch (e) {
        failed.push(`第${item.lineNo}行「${item.name}」：${String(e?.message || e)}`)
      }
    }
    ElMessageBox.alert(
      `成功 ${okCount} 条` + (failed.length ? `，失败 ${failed.length} 条：\n${failed.join('\n')}` : ''),
      '批量粘贴结果',
      { type: failed.length ? 'warning' : 'success', customStyle: { whiteSpace: 'pre-line' } }
    ).catch(() => {})
    batch.visible = false
    batch.text = ''
    loadMtGoods()
  } finally { batch.running = false }
}
function openCustomerDialog(row) {
  Object.assign(cdlg, {
    visible: true, id: row?.id || null, name: row?.name || '',
    level: row?.level || 'default', settlement_type: row?.settlement_type || 'daily',
    settlement_day: row?.settlement_day ?? null, credit_limit: row?.credit_limit ?? null,
    overdue_days: row?.overdue_days ?? 30,
    visible_all: row ? row.visible_all !== false : true,
    visible_category_names: row ? [...(row.visible_category_names || [])] : [],
    remark: row?.remark || '', status: row?.status || 'active',
  })
}
async function saveCustomer() {
  if (!cdlg.name.trim()) return ElMessage.warning('客户名称必填')
  cdlg.saving = true
  try {
    const res = await call('maintain', {
      sub: 'save_customer', tenant_id: mt.tenantId, id: cdlg.id || undefined,
      name: cdlg.name.trim(), level: cdlg.level, settlement_type: cdlg.settlement_type,
      settlement_day: cdlg.settlement_type === 'monthly' ? cdlg.settlement_day : undefined,
      credit_limit: cdlg.credit_limit, overdue_days: cdlg.overdue_days,
      visible_all: cdlg.visible_all, remark: cdlg.remark, status: cdlg.status || undefined,
      visible_category_names: cdlg.visible_all ? [] : cdlg.visible_category_names.slice(),
    })
    if (!res.ok) throw new Error(res.error || '保存失败')
    ElMessage.success(res.mode === 'created' ? '已创建' : '已更新')
    cdlg.visible = false
    loadMtCustomers()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally { cdlg.saving = false }
}
async function submitPrice() {
  if (!mt.priceGoodsId) return ElMessage.warning('请先选择商品')
  const targets = pf.scope === 'type' ? pf.levels.slice() : pf.customerId ? [String(pf.customerId)] : []
  if (!targets.length) return ElMessage.warning(pf.scope === 'type' ? '请勾选等级（可多选）' : '请选择客户')
  if (!(pf.price > 0)) return ElMessage.warning('请输入大于 0 的价格')
  pf.saving = true
  try {
    let last = null
    for (const sv of targets) {
      const res = await call('maintain', { sub: 'set_price', tenant_id: mt.tenantId, goods_id: mt.priceGoodsId, scope: pf.scope, scope_value: sv, price: pf.price })
      if (!res.ok) throw new Error(res.error || '设置失败')
      last = res
    }
    ElMessage.success(`已生效（${last.valid_from} 起）`)
    loadMtPrices()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally { pf.saving = false }
}
onMounted(async () => {
  try {
    const res = await call('whoami')
    isPlatform.value = !!(res.ok && res.isPlatform)
  } catch (e) { isPlatform.value = false }
  checked.value = true
  if (isPlatform.value) load()
})
</script>

<style scoped>
.hint { color: #999; font-size: 12px; }
.mono { color: #888; font-size: 12px; }
</style>
