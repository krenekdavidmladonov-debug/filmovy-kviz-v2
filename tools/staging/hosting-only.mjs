import { STAGING_PROJECT, assertStagingProject, assertStagingEnvironment } from './guard.mjs';

export function deploymentMode(args) {
  assertStagingProject(args[0]);
  if (args.length === 1) return 'full';
  if (args.length === 2 && args[1] === '--hosting-only') return 'hosting-only';
  throw new Error('Only the explicit --hosting-only option is accepted; no resource overrides.');
}

export function assertHostingOnlyConfig(config) {
  const forbidden = new Set(['predeploy', 'postdeploy', 'pinTag', 'run', 'function']);
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key)) throw new Error('Hooks and backend rewrites are forbidden for Hosting-only.');
      inspect(child);
    }
  }
  inspect(config);
  const h = config.hosting;
  if (!h || Array.isArray(h) || h.site !== STAGING_PROJECT || h.public !== 'apps/web/dist' ||
      Object.keys(h).some((key) => !['site', 'public', 'ignore', 'headers', 'rewrites'].includes(key)) ||
      JSON.stringify(h.rewrites) !== JSON.stringify([{ source: '**', destination: '/index.html' }])) {
    throw new Error('Hosting-only requires the exact staging site, frontend directory and static SPA rewrite.');
  }
  const headers = h.headers?.find((item) => item.source === '**')?.headers;
  if (!headers?.some((item) => item.key.toLowerCase() === 'x-robots-tag' && item.value === 'noindex, nofollow')) {
    throw new Error('Staging noindex header is required.');
  }
}

export function hostingOnlyArgs(project, env, config, configPath) {
  assertStagingProject(project);
  assertStagingEnvironment(env);
  assertHostingOnlyConfig(config);
  return ['deploy', '--project', project, '--config', configPath, '--only', 'hosting', '--non-interactive'];
}

export function assertFrontendFiles(files) {
  if (!files.some((file) => file.name === 'index.html')) throw new Error('Missing frontend entry point.');
  for (const { name, text } of files) {
    if (!/^(?:index\.html|assets\/[A-Za-z0-9_.-]+\.(?:js|css|png|svg|webp|jpg|jpeg|woff2?|ico))$/u.test(name)) {
      throw new Error('Unexpected file in frontend build; refusing to publish local data.');
    }
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:|"refresh_token"\s*:|\.local-data\//u.test(text)) {
      throw new Error('Private artifact marker in frontend build.');
    }
  }
}
