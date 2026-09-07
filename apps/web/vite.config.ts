import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertStagingEnvironment } from '../../tools/staging/guard.mjs';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  if (mode === 'staging') assertStagingEnvironment(env);
  else if (env.VITE_FIREBASE_PROJECT_ID && !env.VITE_FIREBASE_PROJECT_ID.startsWith('demo-')) {
    throw new Error('Cloud builds require explicit staging mode; production is not supported.');
  }
  return {
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  };
});
