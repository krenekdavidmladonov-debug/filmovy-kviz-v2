/** Pure environment check: importing registration code must never declare cloud email secrets. */
export function emailEmulatorRuntime(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true' || Boolean(process.env.FIRESTORE_EMULATOR_HOST)
    || (process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? '').startsWith('demo-');
}
