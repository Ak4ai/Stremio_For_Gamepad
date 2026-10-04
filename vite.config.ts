import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { dualsenseBridge } from './scripts/dualsenseBridge.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dualsenseBridge(),
  ],
  server: {
    port: 3000,
    open: false,
    proxy: {
      '/stremio-server': {
        target: 'http://127.0.0.1:11470',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stremio-server/, ''),
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (res && 'writeHead' in res && !(res as any).headersSent) {
              (res as any).writeHead(503, { 'Content-Type': 'application/json' });
              (res as any).end(JSON.stringify({ isOnline: false }));
            }
          });
        },
      },
    },
  },
})
