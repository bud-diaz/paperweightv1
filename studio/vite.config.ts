import path from 'path';
import { fileURLToPath } from 'url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Served by the existing Express static middleware (src/index.js already
// serves everything under client/ at the domain root), so assets must live
// at /app/... to match their on-disk path under client/app/. The HTML entry
// itself is served at GET /studio by a small route in src/index.js.
const BASE_PATH = '/app/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(dirname, '..', 'client', 'app'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Dev-only: the Express API server runs on its own port (default
      // 3000, see src/config.js). In the built/served app this isn't
      // needed since studio/ is served same-origin from Express itself.
      // Also proxy the vendored fonts and existing brand assets so `npm run
      // dev` (standalone Vite server) renders identically to the real thing.
      '/api': process.env.PAPERWEIGHT_API_PROXY || 'http://localhost:3000',
      '/vendor': process.env.PAPERWEIGHT_API_PROXY || 'http://localhost:3000',
      '/favicon.png': process.env.PAPERWEIGHT_API_PROXY || 'http://localhost:3000',
    },
  },
});
