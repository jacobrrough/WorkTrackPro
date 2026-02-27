import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { trelloProxyPlugin } from './vite/trelloProxyPlugin'

const root = path.resolve(__dirname)
const keyPath = path.resolve(root, 'key.pem')
const certPath = path.resolve(__dirname, 'cert.pem')
const hasHttps = fs.existsSync(keyPath) && fs.existsSync(certPath)

export default defineConfig({
  plugins: [react(), trelloProxyPlugin()],
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          scanner: ['jsqr'],
        },
      },
    },
  },
  server: {
    ...(hasHttps && {
      https: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
    }),
    proxy: {
      // Trello attachment proxy is handled by trelloProxyPlugin (no separate server needed)
    },
    host: '0.0.0.0',
    port: 3000,
  },
})
