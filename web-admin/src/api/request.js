import axios from 'axios'

// T1.2 云函数基座接入后统一走 /api（vite 代理）；当前占位
const request = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

request.interceptors.request.use((config) => {
  const token = localStorage.getItem('ff_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

request.interceptors.response.use(
  (resp) => resp.data,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ff_token')
      window.location.hash = '#/login'
    }
    return Promise.reject(err)
  },
)

export default request
