import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000'
    }
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    reportCompressedSize: true,
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
        manualChunks(id) {
          if (id.includes('node_modules/react-dom')) return 'vendor-react-dom'
          if (id.includes('node_modules/react-router-dom')) return 'vendor-router'
          if (id.includes('node_modules/react')) return 'vendor-react'
          if (id.includes('node_modules/leaflet')) return 'vendor-leaflet'
        },
      },
    },
  },
})
