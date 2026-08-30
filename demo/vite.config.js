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
        guide: page('./guide/index.html'),
        decision: page('./decision/index.html'),
        unit: page('./unit/index.html'),
        cards: page('./cards/index.html'),
        slides: page('./slides/index.html'),
        homework: page('./homework/index.html'),
        marking: page('./marking/index.html'),
        rehearsal: page('./rehearsal/index.html'),
        pulse: page('./pulse/index.html'),
        worksheet: page('./worksheet/index.html'),
        alignment: page('./alignment/index.html'),
        learning: page('./learning/index.html'),
        deliberation: page('./deliberation/index.html'),
        reflection: page('./reflection/index.html'),
        study: page('./study/index.html'),
        compare: page('./compare/index.html'),
        research: page('./research/index.html'),
        observation: page('./observation/index.html'),
        assets: page('./assets/index.html'),
        share: page('./share/index.html'),
        pitch: page('./pitch/index.html'),
        library: page('./library/index.html'),
        ask: page('./ask/index.html'),
        document: page('./document/index.html'),
        ingest: page('./ingest/index.html'),
        jobs: page('./jobs/index.html'),
        inspect: page('./inspect/index.html'),
        validation: page('./validation/index.html')
        ,login: page('./login/index.html')
        ,settings: page('./settings/index.html')
      }
    }
  }
});
