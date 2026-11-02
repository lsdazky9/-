import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 前端构建配置。
 *
 * 关键约定（保证「不影响与其他部分结合」）：
 * 1. 所有后端请求统一走 VITE_API_BASE_URL（默认 /api/v1），不在代码里硬编码主机地址；
 * 2. 开发期用 VITE_DEV_PROXY_TARGET 指向主应用，同源代理，避免跨域与 Cookie 问题；
 * 3. 后端未就绪时用 VITE_USE_MOCK=true 跑通全部界面状态，接口契约不变。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:8080'

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      port: Number(env.VITE_DEV_PORT || 5173),
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 2000
    }
  }
})
