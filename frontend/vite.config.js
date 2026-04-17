import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
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
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames(chunkInfo) {
          const name = chunkInfo.name || 'chunk'
          return `assets/${name}.js`
        },
        assetFileNames(assetInfo) {
          const rawName = assetInfo.name || 'asset'
          const extIndex = rawName.lastIndexOf('.')
          const ext = extIndex >= 0 ? rawName.slice(extIndex) : ''
          const baseName = extIndex >= 0 ? rawName.slice(0, extIndex) : rawName
          return `assets/${baseName}${ext}`
        },
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
