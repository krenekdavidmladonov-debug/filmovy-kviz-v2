import {spawn,spawnSync} from 'node:child_process';
import {strict as assert} from 'node:assert';
import {mkdirSync} from 'node:fs';
assert.match(process.env.GCLOUD_PROJECT||'',/^demo-/);
const root=process.cwd(),baseline=process.env.WHOLE_EVENING_PHASE==='baseline',source=baseline?root+'/.local-data/whole-evening/baseline/apps/web':root+'/apps/web',out=root+'/.local-data/whole-evening/'+(baseline?'baseline':'current')+'-hosting';
const env={...process.env,VITE_FIREBASE_API_KEY:'demo-api-key',VITE_FIREBASE_AUTH_DOMAIN:'demo-filmovy-kviz-v2.firebaseapp.com',VITE_FIREBASE_PROJECT_ID:'demo-filmovy-kviz-v2',VITE_FIREBASE_USE_EMULATORS:'true',VITE_FIREBASE_STORAGE_BUCKET:'demo-filmovy-kviz-v2.appspot.com',VITE_FIREBASE_MESSAGING_SENDER_ID:'000000000000',VITE_FIREBASE_APP_ID:'1:000000000000:web:demo',VITE_ENABLE_TEAM_EMAIL:'false'};
mkdirSync(out,{recursive:true});const vite=root+'/apps/web/node_modules/vite/bin/vite.js';
const built=spawnSync(process.execPath,[vite,'build',source,'--outDir',out,'--emptyOutDir'],{env,stdio:'inherit',windowsHide:true});if(built.status!==0)process.exit(built.status||1);
const child=spawn(process.execPath,[vite,'preview',source,'--outDir',out,'--host','127.0.0.1','--port','5208','--strictPort'],{env,stdio:'inherit',windowsHide:true});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>{process.exitCode=code||0;});
