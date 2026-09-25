import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { gcApi } from './src/server/api.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), gcApi()],
})
