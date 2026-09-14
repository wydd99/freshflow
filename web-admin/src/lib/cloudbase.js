import cloudbase from '@cloudbase/js-sdk'

// 多环境支持：构建时 VITE_ENV_ID 覆盖（商家B演示环境用），默认主环境
export const CLOUDBASE_ENV_ID = import.meta.env.VITE_ENV_ID || 'freshflow-ENV_ID'

const app = cloudbase.init({ env: CLOUDBASE_ENV_ID })

export const auth = app.auth
// PG 数据访问客户端（app.rdb()，postgREST 风格；真实数据页 T1.4 起启用）
export const db = typeof app.rdb === 'function' ? app.rdb() : null

// 云函数调用（如 ai 智能录单解析）
export function callFn(name, data) {
  return app.callFunction({ name, data })
}

export default app
