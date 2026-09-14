<template>
  <el-container class="layout">
    <el-aside width="200px" class="aside">
      <div class="logo">鲜配后台</div>
      <el-menu :default-active="route.path" router background-color="#1f2d3d" text-color="#bfcbd9" active-text-color="#409EFF">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="crumb">{{ route.meta.title }}</span>
        <el-dropdown>
          <span class="user">管理员 <el-icon><ArrowDown /></el-icon></span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main><router-view /></el-main>
    </el-container>
  </el-container>
  <GateDialog />
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import GateDialog from '@/components/GateDialog.vue'

const route = useRoute()
const router = useRouter()
const store = useAuthStore()

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
  { path: '/settings', title: '设置', icon: 'Setting' },
].filter((m) => !(HIDE_MODULES_FOR.includes(store.actor?.username) && HIDDEN_MODULES.includes(m.key))))

function logout() {
  store.logout()
  router.push('/login')
}
</script>

<style scoped>
.layout { height: 100%; }
.aside { background: #1f2d3d; }
.logo { color: #fff; font-size: 18px; font-weight: 700; text-align: center; padding: 18px 0; letter-spacing: 2px; }
.header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e6e6e6; }
.crumb { font-size: 16px; font-weight: 600; }
.user { cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.el-menu { border-right: none; }
</style>
