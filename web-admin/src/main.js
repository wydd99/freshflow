import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { ElMessage } from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/theme.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'

// 兜底网：任何未捕获的异步错误都弹出真实原因（零静默失败原则——页面毫无反应比报错更坑）
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e?.reason?.message || e?.reason || '操作失败')
  ElMessage.error({ message: msg.slice(0, 200), duration: 6000, showClose: true })
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}
app.mount('#app')
