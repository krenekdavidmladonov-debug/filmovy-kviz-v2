export function mediaBucketName(projectId: string, configuredBucket: string | undefined, env: NodeJS.ProcessEnv): string {
  const endpoint = env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (projectId.startsWith('demo-') || endpoint || env.FUNCTIONS_EMULATOR === 'true' || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) {
    if (!projectId.startsWith('demo-') || !/^(?:127\.0\.0\.1|localhost|\[::1\]):[1-9]\d{0,4}$/u.test(endpoint ?? '') || Number(endpoint?.split(':').at(-1)) > 65535) throw new Error('Media requires a local Storage emulator and demo project.');
    return projectId + '.appspot.com';
  }
  if (!configuredBucket) throw new Error('Media bucket is not configured.');
  return configuredBucket;
}
