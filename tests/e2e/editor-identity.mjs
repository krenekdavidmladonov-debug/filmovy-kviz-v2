import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
export async function editorIdentity(role = 'admin') {
  const env = requireFullEmulatorEnvironment(process.env, 'Editor identity');
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const sdk = require('firebase-admin/app'); const server = sdk.initializeApp({projectId:env.projectId},randomUUID());
  const auth = require('firebase-admin/auth').getAuth(server), db = require('firebase-admin/firestore').getFirestore(server);
  const email = 'editor-'+randomUUID()+'@example.test', password = randomUUID();
  const user = await auth.createUser({email,password}); await auth.setCustomUserClaims(user.uid,{role}); await seedEmulatorMembership(user.uid, role);
  const app = initializeApp({projectId:env.projectId,apiKey:'demo-api-key'},randomUUID());
  const clientAuth=getAuth(app); connectAuthEmulator(clientAuth,'http://'+env.authEndpoint.host+':'+env.authEndpoint.port,{disableWarnings:true});
  await signInWithEmailAndPassword(clientAuth,email,password);
  const functions=getFunctions(app,'europe-west1');connectFunctionsEmulator(functions,env.functionsEndpoint.host,env.functionsEndpoint.port);
  return {email,password,db,call:async(name,data)=>(await httpsCallable(functions,name)(data)).data,
    async dispose(){await db.doc(`memberships/${user.uid}`).delete();await auth.deleteUser(user.uid);await deleteApp(app);await sdk.deleteApp(server);}};
}
