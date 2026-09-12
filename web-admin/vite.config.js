import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
    proxy: {
      // T1.2 云函数基座就绪后指向云接入路径；本地开发先占位
      '/api': {
        target: 'http://127.0.0.1:0',
        changeOrigin: true,
      },
    },
  },
})
