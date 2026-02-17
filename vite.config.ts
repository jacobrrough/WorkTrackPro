import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname)
const keyPath = path.resolve(root, 'key.pem')
const certPath = path.resolve(__dirname, 'cert.pem')
const hasHttps = fs.existsSync(keyPath) && fs.existsSync(certPath)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  server: {
    ...(hasHttps && {
      https: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      proxy: {
        '/api': { target: 'http://192.168.1.39:8090', changeOrigin: true, secure: false, rewrite: (p) => p },
        '/_': { target: 'http://192.168.1.39:8090', changeOrigin: true, secure: false },
      },
    }),
    host: '0.0.0.0',
    port: 3000,
  },
})
