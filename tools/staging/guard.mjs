export const STAGING_PROJECT = 'filmovy-kviz-v2-staging';
export const STAGING_APP = '1:177615774316:web:91aafb858b7cf61a7bee49';
export const STAGING_URL = `https://${STAGING_PROJECT}.web.app`;

export function assertStagingProject(project) {
  if (project !== STAGING_PROJECT) throw new Error('Only the explicitly allowlisted V2 staging project is permitted.');
  return project;
}

export function assertStagingEnvironment(env) {
  assertStagingProject(env.VITE_FIREBASE_PROJECT_ID);
  if (env.VITE_FIREBASE_USE_EMULATORS !== 'false' || env.VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT !== 'true' ||
      env.VITE_APP_ENV !== 'staging' || env.VITE_FIREBASE_AUTH_DOMAIN !== `${STAGING_PROJECT}.firebaseapp.com` ||
      env.VITE_FIREBASE_APP_ID !== STAGING_APP || env.VITE_FIREBASE_MESSAGING_SENDER_ID !== '177615774316' ||
      !env.VITE_FIREBASE_API_KEY || env.VITE_FIREBASE_STORAGE_BUCKET !== `${STAGING_PROJECT}.firebasestorage.app`) {
    throw new Error('Invalid or mixed staging environment.');
  }
}
