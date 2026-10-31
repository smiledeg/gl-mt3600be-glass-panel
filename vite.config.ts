import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/**
 * 部署到路由器 /www/glass/，base 固定 /glass/。
 * 本地预览请用: vite build --base=/ --outDir dist-local
 *
 * 开发模式（npm run dev）会把 /rpc 代理到真机，方便本机直接联调：
 *   DEV_HOST=192.168.8.1 npm run dev   （默认就是 192.168.8.1）
 */
const devHost = process.env.DEV_HOST || '192.168.8.1'

export default defineConfig({
  base: '/glass/',
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: true,
    proxy: {
      // 与设备同源的 JSON-RPC（challenge / login / call）
      '/rpc': {
        target: `https://${devHost}`,
        changeOrigin: true,
        secure: false,
      },
      // 非 RPC 通道：固件上传、日志/备份下载、CGI
      '/upload': { target: `https://${devHost}`, changeOrigin: true, secure: false },
      '/download': { target: `https://${devHost}`, changeOrigin: true, secure: false },
      '/cgi-bin': { target: `https://${devHost}`, changeOrigin: true, secure: false },
    },
  },
  build: {
    target: 'es2018',
    // 路由器上空间有限，控制 chunk 体积；不做 sourcemap
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
