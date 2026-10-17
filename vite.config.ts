import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: Vite on :5173 proxies the API to the notes server on :5180 (run `npm run server`).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:5180',
      '/files': 'http://localhost:5180',
    },
  },
})
