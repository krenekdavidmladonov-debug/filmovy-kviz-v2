import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const mocks = fileURLToPath(new URL('../../tests/browser/events-form-ux.mocks.ts', import.meta.url));
export default defineConfig({
  root, plugins: [react(), {
    name: 'event-form-isolated-fixtures',
    enforce: 'pre',
    resolveId(source) {
      if (['auth/AuthProvider', 'events/eventApi', 'events/eventRepository', 'quizzes/quizRepository', 'editor/editorRepository'].some((name) => source.endsWith(name))) return mocks;
    },
    configureServer(server) { server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/admin/events/')) req.url = '/tests/browser/events-form-ux.harness.html';
      next();
    }); },
  }],
  define: { 'import.meta.env.VITE_APP_ENV': JSON.stringify('staging') },
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
});
