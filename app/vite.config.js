import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // backend api + ws live on :8787 (see api contract)
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
})
