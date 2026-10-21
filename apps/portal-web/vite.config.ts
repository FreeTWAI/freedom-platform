import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const appRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: appRoot,
  // Hooks and the renderer must share one React instance, even with nested dependencies.
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {index:join(appRoot,'index.html'),'skill-social':join(appRoot,'src/skill-social.tsx'),storefront:join(appRoot,'src/storefront/main.tsx'),'storefront-gallery':join(appRoot,'src/storefront/gallery.ts')},
      output: {entryFileNames: chunk=>chunk.name==='skill-social'||chunk.name==='storefront'||chunk.name==='storefront-gallery'?`assets/${chunk.name}.js`:'assets/[name]-[hash].js'},
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:4310', changeOrigin: true },
      '/public': { target: 'http://127.0.0.1:4310', changeOrigin: true },
    },
  },
  preview: {
    host: '127.0.0.1',
  },
})
