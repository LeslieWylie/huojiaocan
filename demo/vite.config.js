import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const page = (path) => fileURLToPath(new URL(path, import.meta.url));

// OpenMAIC also injects these rules at runtime. Publish the exact installed
// package rules as a same-origin stylesheet for pages that disallow inline CSS.
const openmaicStylesId = 'virtual:openmaic-runtime.css';
function openmaicStyles() {
  return {
    name: 'openmaic-runtime-styles',
    resolveId(id) { if (id === openmaicStylesId) return `\0${id}`; },
    async load(id) {
      if (id !== `\0${openmaicStylesId}`) return;
      const definitions = [
        ['@openmaic/renderer', 'SLIDE_RENDERER_STYLES'],
        ['@openmaic/editor/react', 'EDITOR_REACT_STYLES'],
        ['@openmaic/editor/ui', 'EDITING_UI_STYLES']
      ];
      const rules = await Promise.all(definitions.map(async ([entry, name]) => {
        const path = new URL('./styles.js', import.meta.resolve(entry));
        this.addWatchFile(fileURLToPath(path));
        const module = await import(path.href);
        if (typeof module[name] !== 'string') throw new Error(`Missing OpenMAIC stylesheet: ${name}`);
        return module[name];
      }));
      return rules.join('\n');
    }
  };
}

export default defineConfig({
  plugins: [react(), openmaicStyles()],
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
