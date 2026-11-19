import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development, the room server runs on 8787 (`wrangler dev`); Vite forwards /api to it,
// WebSockets included. In production the Worker serves both.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
})
