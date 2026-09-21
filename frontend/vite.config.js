import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev only: forward /api calls to the Node backend
    proxy: { '/api': 'http://localhost:3000' },
  },
})
