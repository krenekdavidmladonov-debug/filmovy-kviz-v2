import { getApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { mediaBucketName } from './environment.js';
export function mediaBucket(): ReturnType<ReturnType<typeof getStorage>['bucket']> {
  const app = getApp(), projectId = app.options.projectId ?? process.env.GCLOUD_PROJECT ?? '';
  return getStorage(app).bucket(mediaBucketName(projectId, app.options.storageBucket, process.env));
}
