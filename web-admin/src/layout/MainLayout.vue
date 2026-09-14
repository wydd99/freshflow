<template>
  <el-container class="layout">
    <el-aside width="200px" class="aside">
      <div class="logo">{{ brandShort }}后台</div>
      <el-menu :default-active="route.path" router class="side-menu" :default-openeds="[]">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="crumb">{{ route.meta.title }}</span>
        <div style="display:flex; align-items:center; gap:14px">
          <el-dropdown trigger="click" @command="setTheme">
            <span class="user" style="gap:2px"><el-icon><Brush /></el-icon> {{ themeName }} <el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="th in THEMES" :key="th.key" :command="th.key" :disabled="th.key === theme">
                  {{ th.label }}{{ th.key === theme ? ' ✓' : '' }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown>
            <span class="user">管理员 <el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main><router-view /></el-main>
    </el-container>
  </el-container>
  <GateDialog />
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { db } from '@/lib/cloudbase'
import GateDialog from '@/components/GateDialog.vue'

const route = useRoute()
const router = useRouter()
const store = useAuthStore()

// 界面主题（三套可切换，localStorage 记忆）
const THEMES = [
  { key: 'natural', label: '清新自然' },
  { key: 'pro', label: '现代专业' },
  { key: 'warm', label: '暖食市集' },
]
const theme = ref(localStorage.getItem('ff_theme_admin') || 'natural')
const themeName = computed(() => (THEMES.find((x) => x.key === theme.value) || THEMES[0]).label)
function setTheme(key) {
  theme.value = key
  localStorage.setItem('ff_theme_admin', key)
  document.documentElement.dataset.theme = key
}
function applyTheme() {
  const saved = localStorage.getItem('ff_theme_admin') || 'natural'
  theme.value = saved
  document.documentElement.dataset.theme = ['natural', 'pro', 'warm'].includes(saved) ? saved : 'natural'
}

// 品牌（T3.4）：logo 读租户品牌简称
const brandShort = ref('鲜配')
onMounted(async () => {
  applyTheme()
  try {
    const res = await db.from('tenant').select('brand').limit(1)
    const rows = (res?.data ?? res) || []
    const b = rows[0]?.brand || {}
    if (b.short) brandShort.value = b.short
  } catch (e) { /* 读取失败用默认 */ }
})

// 按账号的模块开关：merchant_a（营业账号）隐藏库存/采购；其他测试账号可见全功能。
// 库存/采购的路由与自动联动逻辑保留，随时可改回全量可见。
const HIDE_MODULES_FOR = ['merchant_a']
const HIDDEN_MODULES = ['inventory', 'purchase']
const menus = computed(() => [
  { path: '/dashboard', title: '首页', icon: 'Odometer' },
  { path: '/goods', title: '商品', icon: 'Goods' },
  { path: '/customers', title: '客户', icon: 'User' },
  { path: '/prices', title: '报价', icon: 'PriceTag' },
  { path: '/orders', title: '订单', icon: 'Tickets' },
  { path: '/smart-entry', title: '智能录单', icon: 'MagicStick' },
  { path: '/sorting', title: '分拣', icon: 'Box' },
  { path: '/inventory', title: '库存', icon: 'GoodsFilled', key: 'inventory' },
  { path: '/purchase', title: '采购', icon: 'ShoppingCart', key: 'purchase' },
  { path: '/print-center', title: '打印中心', icon: 'Printer' },
  { path: '/statements', title: '对账', icon: 'Wallet' },
  { path: '/security', title: '安全', icon: 'Lock' },
  { path: '/oplog', title: '操作日志', icon: 'Document' },
  { path: '/platform', title: '平台管理', icon: 'Monitor' },
  { path: '/settings', title: '设置', icon: 'Setting' },
].filter((m) => !(HIDE_MODULES_FOR.includes(store.actor?.username) && HIDDEN_MODULES.includes(m.key)))
  // 权限真空守卫：登出后/身份未加载时菜单全空，防止过滤条件失效导致全量菜单闪现
  .filter(() => store.actor?.kind === 'admin'))

function logout() {
  store.logout()
  router.push('/login')
}
</script>

<style scoped>
.layout { height: 100%; }
.aside { background: var(--ff-sidebar-bg); box-shadow: inset -1px 0 0 var(--ff-sidebar-border); }
.logo { color: #fff; font-size: 18px; font-weight: 700; text-align: center; padding: 18px 0; letter-spacing: 2px; }
.header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--ff-header-line); background: #fff; }
.crumb { font-size: 16px; font-weight: 600; }
.user { cursor: pointer; display: inline-flex; align-items: center; gap: 4px; color: var(--ff-primary); font-size: 13.5px; }
.el-menu { border-right: none; background: transparent; }
.side-menu :deep(.el-menu-item) { color: var(--ff-sidebar-text); }
.side-menu :deep(.el-menu-item.is-active) { color: var(--ff-sidebar-active); background: var(--ff-sidebar-active-bg); border-right: 3px solid var(--ff-primary); }
.side-menu :deep(.el-menu-item:hover) { background: var(--ff-sidebar-active-bg); }
</style>
