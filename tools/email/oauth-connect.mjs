// One-shot operator consent only; no Firebase SDK, Gmail send, provisioning or retries.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ownerSelection } from './activation-plan.mjs';

const self = fileURLToPath(import.meta.url), root = realpathSync(path.resolve(path.dirname(self), '../..'));
export const PROJECT = 'filmovy-kviz-v2-staging', SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const REDIRECT = 'http://127.0.0.1:53682/oauth/callback', TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const MAX_WAIT_MS = 600_000;
const need = (condition, code) => { if (!condition) throw new Error(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, max = 8192) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/u.test(value);

export function clientConfiguration(input) {
  need(plain(input) && Object.keys(input).join(',') === 'web' && plain(input.web), 'WEB_CLIENT_REQUIRED');
  const web = input.web;
  need(web.project_id === PROJECT && typeof web.client_id === 'string' && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/u.test(web.client_id)
    && text(web.client_secret) && web.auth_uri === 'https://accounts.google.com/o/oauth2/auth' && web.token_uri === TOKEN_ENDPOINT
    && Array.isArray(web.redirect_uris) && web.redirect_uris.length === 1 && web.redirect_uris[0] === REDIRECT, 'CLIENT_SCOPE_INVALID');
  return { clientId: web.client_id, clientSecret: web.client_secret };
}

export function ignoredPath(candidate, { output = false, repo = root } = {}) {
  const absolute = path.resolve(candidate), local = path.join(repo, '.local-data');
  need(absolute.startsWith(local + path.sep), 'IGNORED_PATH_REQUIRED');
  const existing = output ? path.dirname(absolute) : absolute;
  need(existsSync(existing) && realpathSync(existing) === existing && !lstatSync(existing).isSymbolicLink(), 'PATH_MISSING_OR_LINKED');
  for (let current = existing; current.length >= local.length; current = path.dirname(current)) {
    need(!lstatSync(current).isSymbolicLink() && realpathSync(current) === current, 'PATH_MISSING_OR_LINKED');
    if (current === local) break;
  }
  need(output ? !existsSync(absolute) : lstatSync(absolute).isFile(), output ? 'OUTPUT_EXISTS' : 'INPUT_FILE_REQUIRED');
  return absolute;
}

export function createConsent(client, sender) {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false', login_hint: sender,
    state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { state, verifier, authorizationUrl: url.href, consumed: false };
}

export function consumeCallback(request, consent) {
  need(!consent.consumed, 'CALLBACK_ALREADY_CONSUMED');
  need(request.method === 'GET' && request.headers.host === '127.0.0.1:53682'
    && (request.rawHeaders ?? []).filter((_, i, headers) => i % 2 === 0 && headers[i].toLowerCase() === 'host').length === 1
    && request.headers['content-length'] === undefined && request.headers['transfer-encoding'] === undefined
    && typeof request.url === 'string' && request.url.length <= 8192 && request.url.startsWith('/oauth/callback?')
    && !request.url.includes('#') && !/%(?![a-fA-F0-9]{2})/u.test(request.url), 'CALLBACK_REQUEST_INVALID');
  const params = new URL(request.url, REDIRECT).searchParams;
  const keys = [...params.keys()];
  need(new Set(keys).size === keys.length && keys.every(key => ['state', 'code', 'scope', 'authuser', 'prompt', 'error'].includes(key)), 'CALLBACK_FIELDS_INVALID');
  const state = params.get('state');
  need(typeof state === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(state) && state.length === consent.state.length
    && timingSafeEqual(Buffer.from(state), Buffer.from(consent.state)), 'CALLBACK_STATE_INVALID');
  need(!params.has('scope') || params.get('scope') === SCOPE, 'CALLBACK_SCOPE_INVALID');
  need(!params.has('authuser') || /^\d{1,2}$/u.test(params.get('authuser')), 'CALLBACK_FIELDS_INVALID');
  need(!params.has('prompt') || ['consent', 'select_account', 'consent select_account'].includes(params.get('prompt')), 'CALLBACK_FIELDS_INVALID');
  if (params.has('error')) {
    need(!params.has('code') && text(params.get('error'), 100), 'CALLBACK_FIELDS_INVALID');
    consent.consumed = true;
    throw new Error('CONSENT_NOT_COMPLETED');
  }
  need(text(params.get('code'), 4096), 'CALLBACK_CODE_INVALID');
  consent.consumed = true;
  return params.get('code');
}

export function tokenResult(value) {
  need(plain(value) && value.token_type === 'Bearer' && value.scope === SCOPE && text(value.refresh_token) && text(value.access_token)
    && Number.isSafeInteger(value.expires_in) && value.expires_in > 0 && value.expires_in <= 86400, 'TOKEN_RESPONSE_INVALID');
  return value.refresh_token;
}

export async function exchangeCode(client, code, verifier, http = fetch, timeoutMs = 15_000) {
  need(text(code, 4096) && /^[A-Za-z0-9_-]{43}$/u.test(verifier) && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15_000, 'EXCHANGE_INPUT_INVALID');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([(async () => {
      const response = await http(TOKEN_ENDPOINT, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret,
          code, code_verifier: verifier, redirect_uri: REDIRECT, grant_type: 'authorization_code' }).toString() });
      need(response.status === 200 && response.headers.get('content-type')?.split(';')[0] === 'application/json' && response.body, 'TOKEN_EXCHANGE_FAILED');
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; need(size <= 32768, 'TOKEN_RESPONSE_TOO_LARGE'); chunks.push(value); }
      return tokenResult(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('TOKEN_EXCHANGE_TIMEOUT')); }, timeoutMs); })]);
  } catch { throw new Error('TOKEN_EXCHANGE_STOP'); }
  finally { clearTimeout(timer); }
}

// Scripts are fixed; directories/secrets cross stdin only, never command arguments.
const aclScript = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $d=[Console]::In.ReadToEnd(); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[IO.Directory]::GetAccessControl($d); if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'Owner'}; $acl.SetAccessRuleProtection($true,$false); foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){[void]$acl.RemoveAccessRuleSpecific($r)}; $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')); [IO.Directory]::SetAccessControl($d,$acl); $check=[IO.Directory]::GetAccessControl($d); if($check.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'Owner'}; if(-not $check.AreAccessRulesProtected){throw 'Inheritance'}; $rules=$check.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]); if($rules.Count -ne 1){throw 'Count'}; foreach($r in $rules){if($r.IdentityReference.Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow' -or $r.FileSystemRights -ne 'FullControl'){throw 'Access'}}; [Console]::Out.Write('OWNER_ONLY')`;
const protectScript = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a'); $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $sealed=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($sealed))`;
const unprotectScript = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a'); $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $opened=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($opened))`;
async function powershell(script, input) {
  need(process.platform === 'win32', 'WINDOWS_PROTECTED_STORE_REQUIRED');
  need(!process.env.SystemRoot || process.env.SystemRoot.toLowerCase() === 'c:\\windows', 'FOREIGN_POWERSHELL_ROOT');
  const executable = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', failed = false;
    const timeout = setTimeout(() => { failed = true; child.kill(); }, 10_000);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 100_000) { failed = true; child.kill(); } });
    child.stderr.on('data', () => { failed = true; });
    child.on('error', () => { clearTimeout(timeout); reject(new Error('PROTECTED_STORE_STOP')); });
    child.on('close', code => { clearTimeout(timeout); if (code !== 0 || failed) reject(new Error('PROTECTED_STORE_STOP')); else resolve(output); });
    child.stdin.on('error', () => { failed = true; }); child.stdin.end(input);
  });
}
export async function secureDirectory(directory) { need(await powershell(aclScript, directory) === 'OWNER_ONLY', 'DIRECTORY_ACL_INVALID'); }
export async function protectCurrentUser(bytes) {
  const encrypted = await powershell(protectScript, bytes.toString('base64'));
  need(/^[A-Za-z0-9+/]+={0,2}$/u.test(encrypted), 'PROTECTED_STORE_STOP');
  return Buffer.from(encrypted, 'base64');
}
export async function unprotectCurrentUser(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 131072, 'ENCRYPTED_CLIENT_INPUT_INVALID');
  const decoded = await powershell(unprotectScript, bytes.toString('base64'));
  need(/^[A-Za-z0-9+/]+={0,2}$/u.test(decoded), 'PROTECTED_STORE_STOP');
  return Buffer.from(decoded, 'base64');
}
export async function encryptedClientInput(file, unprotect = unprotectCurrentUser) {
  const bytes = readFileSync(file); need(bytes.length > 0 && bytes.length <= 131072, 'ENCRYPTED_CLIENT_INPUT_INVALID');
  const decoded = await unprotect(bytes);
  try { need(Buffer.isBuffer(decoded) && decoded.length <= 65536, 'DECODED_CLIENT_TOO_LARGE'); return { client: clientConfiguration(JSON.parse(decoded.toString('utf8'))), hash: sha(bytes) }; }
  finally { if (Buffer.isBuffer(decoded)) decoded.fill(0); }
}
function writeExclusive(file, bytes) {
  const descriptor = openSync(file, 'wx', 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
export async function createOutput(directory, secure = secureDirectory) {
  need(!existsSync(directory), 'OUTPUT_EXISTS'); mkdirSync(directory, { mode: 0o700 });
  await secure(directory); need(readdirSync(directory).length === 0, 'OUTPUT_NOT_EMPTY');
}
export async function persistGrant(directory, client, refreshToken, bindings, protect = protectCurrentUser, active = () => true) {
  const secret = Buffer.from(JSON.stringify({ schemaVersion: 1, clientId: client.clientId, clientSecret: client.clientSecret, refreshToken, ...bindings }));
  let encrypted;
  try { encrypted = await protect(secret); } finally { secret.fill(0); }
  need(Buffer.isBuffer(encrypted) && encrypted.length > 0, 'PROTECTED_STORE_STOP');
  need(active(), 'CONSENT_WAIT_TIMEOUT');
  writeExclusive(path.join(directory, 'grant.current-user.dpapi'), encrypted);
  return sha(encrypted);
}

export async function listenForConsent(consent, handle, { timeoutMs = MAX_WAIT_MS, ready = () => {} } = {}) {
  need(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_WAIT_MS, 'CONSENT_TIMEOUT_INVALID');
  return await new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      if (request.method === 'GET' && request.headers.host === '127.0.0.1:53682' && request.url === '/oauth/complete') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<p>Callback received. Check the local tool outcome.</p>'); return;
      }
      // A favicon/duplicate callback must not cancel a valid in-flight handoff.
      if (consent.consumed) { response.writeHead(400); response.end('Callback refused.'); return; }
      let code;
      try { code = consumeCallback(request, consent); }
      catch {
        if (consent.consumed) { response.writeHead(303, { Location: '/oauth/complete' }); response.end(); finish(new Error('CONSENT_NOT_COMPLETED')); }
        else { response.writeHead(400); response.end('Callback refused.'); }
        return;
      }
      // Strip the authorization code from the browser URL even if token exchange fails.
      response.writeHead(303, { Location: '/oauth/complete' }); response.end();
      Promise.resolve().then(() => handle(code, () => !settled)).then(value => finish(null, value), () => finish(new Error('CONSENT_HANDOFF_STOP')));
    });
    const timeout = setTimeout(() => finish(new Error('CONSENT_WAIT_TIMEOUT')), timeoutMs);
    function finish(error, value) {
      if (settled) return; settled = true; clearTimeout(timeout);
      server.close();
      // Drain the cleaned redirect response; there are never unbounded keep-alive sockets.
      setTimeout(() => server.closeAllConnections(), 100);
      if (error) reject(error); else resolve(value);
    }
    server.on('error', () => finish(new Error('CALLBACK_LISTENER_STOP')));
    server.listen(53682, '127.0.0.1', () => { Promise.resolve().then(ready).catch(() => finish(new Error('AUTHORIZATION_FILE_STOP'))); });
  });
}

function jsonInput(file) { const bytes = readFileSync(file); need(bytes.length <= 65536, 'INPUT_TOO_LARGE'); return { value: JSON.parse(bytes.toString('utf8')), hash: sha(bytes) }; }
export async function main(argv = process.argv.slice(2)) {
  need(process.versions.node.split('.')[0] === '22', 'NODE22_REQUIRED');
  need(!process.env.NODE_OPTIONS && !process.env.FIREBASE_TOKEN && !process.env.GOOGLE_APPLICATION_CREDENTIALS
    && !Object.keys(process.env).some(key => key.endsWith('_EMULATOR_HOST') && process.env[key]), 'AMBIENT_OVERRIDE_REFUSED');
  const mode = argv.shift(); need(['--prepare', '--connect'].includes(mode), 'MODE_REQUIRED');
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) { const key = argv[i], value = argv[i + 1]; need(['--client', '--owner-selection', '--out'].includes(key) && !Object.hasOwn(flags, key) && typeof value === 'string' && !value.startsWith('--'), 'ARGUMENTS_INVALID'); flags[key] = value; }
  need(flags['--client'] && flags['--owner-selection'] && flags['--out'], 'EXPLICIT_PATHS_REQUIRED');
  const clientInput = await encryptedClientInput(ignoredPath(flags['--client'])), selectionInput = jsonInput(ignoredPath(flags['--owner-selection']));
  const client = clientInput.client, selection = ownerSelection(selectionInput.value), output = ignoredPath(flags['--out'], { output: true });
  await createOutput(output);
  const bindings = { projectId: PROJECT, redirectUri: REDIRECT, scope: SCOPE, helperSha256: sha(readFileSync(self)), clientInputSha256: clientInput.hash, ownerSelectionSha256: selectionInput.hash };
  const prepared = { schemaVersion: 1, mode: 'OAUTH_LOCAL_PREPARED', at: new Date().toISOString(), ...bindings,
    senderIdentityVerified: false, sends: 0, deployments: 0, limitations: ['Consent account must match the selected sender; login_hint is not identity proof.', 'No deployed secret, Gmail send or inbox delivery is established.'] };
  writeExclusive(path.join(output, 'prepare.json'), JSON.stringify(prepared, null, 2));
  if (mode === '--prepare') { console.log(JSON.stringify({ mode: prepared.mode, receipt: path.join(output, 'prepare.json') })); return; }
  const consent = createConsent(client, selection.senderEmail);
  await listenForConsent(consent, async (code, active) => {
    const refreshToken = await exchangeCode(client, code, consent.verifier);
    need(active(), 'CONSENT_WAIT_TIMEOUT');
    const protectedGrantSha256 = await persistGrant(output, client, refreshToken, bindings, protectCurrentUser, active);
    writeExclusive(path.join(output, 'result.json'), JSON.stringify({ ...prepared, mode: 'OAUTH_REFRESH_TOKEN_STORED', at: new Date().toISOString(),
      protection: 'WINDOWS_DPAPI_CURRENT_USER', protectedGrantSha256, senderIdentityVerified: false }, null, 2));
  }, { ready: () => {
    writeExclusive(path.join(output, 'authorization-url.txt'), consent.authorizationUrl);
    console.log(JSON.stringify({ mode: 'OAUTH_CALLBACK_READY', receipt: path.join(output, 'prepare.json') }));
  } });
  console.log(JSON.stringify({ mode: 'OAUTH_REFRESH_TOKEN_STORED', receipt: path.join(output, 'result.json') }));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('OAUTH_CONNECTION_STOP; NO_SEND_OR_DEPLOY'); process.exitCode = 1; });
}
