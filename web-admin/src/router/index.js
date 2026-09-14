import { createRouter, createWebHistory } from 'vue-router'
import MainLayout from '@/layout/MainLayout.vue'
import { useAuthStore } from '@/stores/auth'

// T1.1 起逐个替换 Placeholder 为真实页面；路由即后台信息架构（PLAN.md 选型）
const routes = [
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { title: '登录' } },
  {
    path: '/',
    component: MainLayout,
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/Dashboard.vue'), meta: { title: '首页', icon: 'Odometer' } },
      { path: 'goods', name: 'goods', component: () => import('@/views/Goods.vue'), meta: { title: '商品', icon: 'Goods' } },
      { path: 'customers', name: 'customers', component: () => import('@/views/Customers.vue'), meta: { title: '客户', icon: 'User' } },
      { path: 'prices', name: 'prices', component: () => import('@/views/Prices.vue'), meta: { title: '报价', icon: 'PriceTag' } },
      { path: 'orders', name: 'orders', component: () => import('@/views/Orders.vue'), meta: { title: '订单', icon: 'Tickets' } },
      { path: 'smart-entry', name: 'smartEntry', component: () => import('@/views/SmartEntry.vue'), meta: { title: '智能录单', icon: 'MagicStick' } },
      { path: 'sorting', name: 'sorting', component: () => import('@/views/SortBoard.vue'), meta: { title: '分拣', icon: 'Box' } },
      { path: 'inventory', name: 'inventory', component: () => import('@/views/Inventory.vue'), meta: { title: '库存', icon: 'GoodsFilled' } },
      { path: 'purchase', name: 'purchase', component: () => import('@/views/Purchase.vue'), meta: { title: '采购', icon: 'ShoppingCart' } },
      { path: 'print-center', name: 'printCenter', component: () => import('@/views/PrintCenter.vue'), meta: { title: '打印中心', icon: 'Printer' } },
      { path: 'statements', name: 'statements', component: () => import('@/views/Statements.vue'), meta: { title: '对账', icon: 'Wallet' } },
      { path: 'security', name: 'security', component: () => import('@/views/Security.vue'), meta: { title: '安全', icon: 'Lock' } },
      { path: 'oplog', name: 'opLog', component: () => import('@/views/OpLog.vue'), meta: { title: '操作日志', icon: 'Document' } },
      { path: 'platform', name: 'platform', component: () => import('@/views/Platform.vue'), meta: { title: '平台管理', icon: 'Monitor' } },
      { path: 'settings', name: 'settings', component: () => import('@/views/Settings.vue'), meta: { title: '设置', icon: 'Setting' } },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  document.title = (to.meta.title ? to.meta.title + ' · ' : '') + '鲜配后台'
  // 登录守卫：CloudBase Auth 会话（体验版套餐下 localhost 不在安全域名白名单，
  // 真实登录需走已发布的静态托管域名）
  const store = useAuthStore()
  await store.restore()
  if (to.name === 'login') return store.isLoggedIn ? { path: '/' } : true
  return store.isLoggedIn ? true : { path: '/login' }
})

export default router
