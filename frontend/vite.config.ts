import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Keeps the browser on one origin in dev, so no CORS surprises.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Uploaded KB documents / message attachments, served by FastAPI's
      // StaticFiles mount — same reasoning as /api above.
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
