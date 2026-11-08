/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tracksManifestPlugin } from './plugins/tracksManifest'

export default defineConfig({
  plugins: [react(), tracksManifestPlugin()],
  server: {
    // honor the harness-assigned port (Vite ignores PORT by default)
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
