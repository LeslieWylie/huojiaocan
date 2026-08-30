import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const page = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787'
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        dashboard: page('./index.html'),
        decision: page('./decision/index.html'),
        unit: page('./unit/index.html'),
        cards: page('./cards/index.html'),
        evidence: page('./evidence/index.html'),
        pitch: page('./pitch/index.html'),
        library: page('./library/index.html'),
        ask: page('./ask/index.html'),
        document: page('./document/index.html')
      }
    }
  }
});
