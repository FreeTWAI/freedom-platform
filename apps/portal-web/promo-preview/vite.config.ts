import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

// Independent synthetic preview; not an input of the production Portal build.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  resolve: {dedupe: ['react', 'react-dom']},
  server: {host: '127.0.0.1', port: 4492, strictPort: true},
  preview: {host: '127.0.0.1', port: 4492, strictPort: true},
  build: {outDir: 'dist', emptyOutDir: true},
});
