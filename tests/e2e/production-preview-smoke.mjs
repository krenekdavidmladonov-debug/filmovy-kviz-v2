import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const baseUrl = new URL(process.env.PRODUCTION_PREVIEW_BASE_URL ?? 'http://127.0.0.1:5000');
const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

if (!allowedHosts.has(baseUrl.hostname)) {
  throw new Error(`Production preview smoke test only accepts a loopback host, received ${baseUrl.hostname}.`);
}

const routes = [
  '/',
  '/admin/login',
  '/admin/quizzes',
  '/admin/quizzes/direct-reload/edit',
  '/admin/quizzes/direct-reload/readiness',
  '/admin/live/direct-reload',
  '/projector/direct-reload',
];

async function expectResponse(relativePath, expectedContentType) {
  const response = await fetch(new URL(relativePath, baseUrl));
  if (!response.ok) {
    throw new Error(`${relativePath} returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes(expectedContentType)) {
    throw new Error(`${relativePath} returned unexpected content type ${contentType || '<missing>'}.`);
  }

  const body = await response.arrayBuffer();
  if (body.byteLength === 0) {
    throw new Error(`${relativePath} returned an empty response.`);
  }

  return Buffer.from(body).toString('utf8');
}

for (const route of routes) {
  const html = await expectResponse(route, 'text/html');
  if (!html.includes('<div id="root"></div>')) {
    throw new Error(`${route} did not return the built single-page application shell.`);
  }
}

const assetsDirectory = path.resolve('apps/web/dist/assets');
const assetNames = (await readdir(assetsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();

if (assetNames.length === 0) {
  throw new Error('No built assets were found. Run pnpm build before this smoke test.');
}

for (const assetName of assetNames) {
  const expectedContentType = assetName.endsWith('.css') ? 'text/css' : 'javascript';
  await expectResponse(`/assets/${encodeURIComponent(assetName)}`, expectedContentType);
}

console.info(JSON.stringify({
  status: 'PASS',
  baseUrl: baseUrl.origin,
  directReloadRoutes: routes.length,
  builtAssets: assetNames.length,
}));
