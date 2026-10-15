// Local, synthetic design review. This entry is not part of the production build.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5216', '--strictPort'], {
  cwd: web,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    VITE_FIREBASE_API_KEY: 'demo-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'demo-filmovy-kviz-v2.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'demo-filmovy-kviz-v2',
    VITE_FIREBASE_STORAGE_BUCKET: 'demo-filmovy-kviz-v2.appspot.com',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
    VITE_FIREBASE_APP_ID: '1:000000000000:web:demo',
    VITE_FIREBASE_USE_EMULATORS: 'true',
    VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT: 'false',
    VITE_ENABLE_TEAM_EMAIL: 'false',
  },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
