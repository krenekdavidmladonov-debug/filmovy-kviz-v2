import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientConfiguration, createConsent, consumeCallback, exchangeCode, tokenResult, ignoredPath, createOutput, persistGrant, listenForConsent,
  encryptedClientInput, protectCurrentUser, unprotectCurrentUser, secureDirectory, connectionDiagnostic, main,
  PROJECT, REDIRECT, SCOPE, TOKEN_ENDPOINT } from './oauth-connect.mjs';

const repo = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const input = () => ({ web: { project_id: PROJECT, client_id: 'synthetic.apps.googleusercontent.com', client_secret: 'synthetic-client-secret',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: TOKEN_ENDPOINT, redirect_uris: [REDIRECT] } });
const client = clientConfiguration(input());
const token = () => ({ access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', scope: SCOPE, token_type: 'Bearer', expires_in: 3600 });
const callback = consent => ({ method: 'GET', headers: { host: '127.0.0.1:53682' }, rawHeaders: ['Host', '127.0.0.1:53682'],
  url: '/oauth/callback?' + new URLSearchParams({ state: consent.state, code: 'synthetic-code' }) });
function fixture() {
  const directory = mkdtempSync(path.join(repo, '.local-data/oauth-connect-test-'));
  return { directory, cleanup: () => { assert.equal(realpathSync(directory), directory); assert.equal(path.dirname(directory), path.join(repo, '.local-data')); rmSync(directory, { recursive: true }); } };
}
function localGet(url) {
  return new Promise((resolve, reject) => {
    get(url, { agent: false }, response => { let body = ''; response.on('data', chunk => { body += chunk.toString(); }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body })); }).on('error', reject);
  });
}
async function windowsDirectoryState(directory) {
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $d=[Console]::In.ReadToEnd(); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[IO.Directory]::GetAccessControl($d); $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]); $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; $onlyOwner=$rules.Count -eq 1; foreach($r in $rules){$onlyOwner=$onlyOwner -and $r.IdentityReference.Value -eq $sid.Value -and $r.AccessControlType -eq 'Allow' -and $r.FileSystemRights -eq 'FullControl' -and $r.InheritanceFlags -eq 'ContainerInherit,ObjectInherit' -and $r.PropagationFlags -eq 'None' -and -not $r.IsInherited}; $hash=[Security.Cryptography.SHA256]::Create(); $descriptorHash=[Convert]::ToBase64String($hash.ComputeHash([Text.Encoding]::Unicode.GetBytes($acl.GetSecurityDescriptorSddlForm('All')))); $hash.Dispose(); [Console]::Out.Write((@{ownerUser=$owner -eq $sid.Value; ownerAdministrators=$owner -eq 'S-1-5-32-544'; protected=$acl.AreAccessRulesProtected; onlyOwner=$onlyOwner; descriptorHash=$descriptorHash}|ConvertTo-Json -Compress))`;
  const result = await new Promise(resolve => {
    const child = spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', error;
    const fail = cause => { error ??= cause; child.kill(); };
    const timeout = setTimeout(() => fail(Object.assign(new Error('Metadata helper timed out'), { code: 'ETIMEDOUT' })), 10_000);
    const append = (text, chunk) => {
      const next = text + chunk.toString('utf8');
      // Match spawnSync's default one-MiB output bound without retaining excess.
      if (Buffer.byteLength(next, 'utf8') > 1024 * 1024) {
        fail(Object.assign(new Error('Metadata helper output exceeded limit'), { code: 'ENOBUFS' }));
        return text;
      }
      return next;
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', cause => { error ??= cause; });
    child.stdin.on('error', fail);
    child.on('close', status => { clearTimeout(timeout); resolve({ error, status, stdout, stderr }); });
    child.stdin.end(directory);
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('only the exact V2 staging web client and one exact registered redirect are accepted', () => {
  assert.deepEqual(client, { clientId: 'synthetic.apps.googleusercontent.com', clientSecret: 'synthetic-client-secret' });
  for (const bad of [{ installed: input().web }, { web: { ...input().web, project_id: 'foreign-project' } },
    { web: { ...input().web, redirect_uris: ['http://localhost:53682/oauth/callback'] } },
    { web: { ...input().web, redirect_uris: [REDIRECT, 'https://foreign.test'] } }, { web: { ...input().web, token_uri: 'https://foreign.test/token' } },
    { web: { ...input().web, client_secret: 'newline\nsecret' } }]) assert.throws(() => clientConfiguration(bad));
});
test('offline consent is sole gmail.send with fresh state and S256 PKCE, not identity proof', () => {
  const first = createConsent(client, 'sender@example.test'), next = createConsent(client, 'sender@example.test');
  const url = new URL(first.authorizationUrl);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), SCOPE); assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent select_account'); assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT); assert.equal(url.searchParams.get('login_hint'), 'sender@example.test');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(first.state.length, 43);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(first.verifier).digest('base64url'));
  assert.notEqual(first.state, next.state); assert.notEqual(first.verifier, next.verifier); assert.ok(!url.href.includes(first.verifier));
  assert.ok(!url.href.includes(client.clientSecret));
});
test('only one exact valid callback can consume a code', () => {
  const consent = createConsent(client, 'sender@example.test');
  assert.equal(consumeCallback(callback(consent), consent), 'synthetic-code');
  assert.throws(() => consumeCallback(callback(consent), consent), /CALLBACK_ALREADY_CONSUMED/u);
});
test('Google issuer is optional but must match exactly before consuming a callback', () => {
  for (const suffix of ['', '&iss=https%3A%2F%2Faccounts.google.com']) {
    const consent = createConsent(client, 'sender@example.test');
    assert.equal(consumeCallback({ ...callback(consent), url: callback(consent).url + suffix }, consent), 'synthetic-code');
    assert.equal(consent.consumed, true);
  }
  for (const issuer of ['', 'https://foreign.test', 'http://accounts.google.com', 'https://accounts.google.com/',
    'https://ACCOUNTS.google.com', 'https://accounts.google.com?x=1', 'https://accounts.google.com#fragment']) {
    const consent = createConsent(client, 'sender@example.test');
    assert.throws(() => consumeCallback({ ...callback(consent), url: callback(consent).url + '&iss=' + encodeURIComponent(issuer) }, consent),
      /^Error: CALLBACK_ISSUER_INVALID$/u);
    assert.equal(consent.consumed, false);
  }
  const consent = createConsent(client, 'sender@example.test');
  assert.throws(() => consumeCallback({ ...callback(consent), url: callback(consent).url +
    '&iss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Faccounts.google.com' }, consent), /^Error: CALLBACK_FIELDS_INVALID$/u);
  assert.equal(consent.consumed, false);
});
test('valid Google issuer cannot bypass state or scope and denial never yields a code', () => {
  for (const patch of [{ state: 'x'.repeat(43), scope: SCOPE }, { scope: 'openid' }]) {
    const consent = createConsent(client, 'sender@example.test');
    const url = '/oauth/callback?' + new URLSearchParams({ state: consent.state, code: 'synthetic-code', iss: 'https://accounts.google.com', ...patch });
    assert.throws(() => consumeCallback({ ...callback(consent), url }, consent));
    assert.equal(consent.consumed, false);
  }
  const consent = createConsent(client, 'sender@example.test');
  const url = '/oauth/callback?' + new URLSearchParams({ state: consent.state, error: 'access_denied', iss: 'https://accounts.google.com' });
  assert.throws(() => consumeCallback({ ...callback(consent), url }, consent), /^Error: CONSENT_NOT_COMPLETED$/u);
  assert.equal(consent.consumed, true);
});
test('wrong state, host, method, duplicate query, body, foreign path and malformed encoding cannot consume or exchange', () => {
  for (const patch of [ { method: 'POST' }, { headers: { host: 'foreign.test' } }, { rawHeaders: ['Host', '127.0.0.1:53682', 'Host', 'foreign.test'] },
    { headers: { host: '127.0.0.1:53682', 'content-length': '0' } }, { headers: { host: '127.0.0.1:53682', 'transfer-encoding': 'chunked' } } ]) {
    const consent = createConsent(client, 'sender@example.test'); assert.throws(() => consumeCallback({ ...callback(consent), ...patch }, consent)); assert.equal(consent.consumed, false);
  }
  for (const suffix of ['&state=duplicate', '&code=duplicate', '&unexpected=synthetic', '&scope=openid', '&authuser=other', '&code=%ZZ']) {
    const consent = createConsent(client, 'sender@example.test'); assert.throws(() => consumeCallback({ ...callback(consent), url: callback(consent).url + suffix }, consent)); assert.equal(consent.consumed, false);
  }
  const consent = createConsent(client, 'sender@example.test');
  for (const url of ['/oauth/callback?state=' + 'x'.repeat(43) + '&code=synthetic', '/foreign', 'https://foreign.test/oauth/callback?x=1']) {
    assert.throws(() => consumeCallback({ ...callback(consent), url }, consent)); assert.equal(consent.consumed, false);
  }
});
test('consent denial consumes exactly once but never yields an exchange code', () => {
  const consent = createConsent(client, 'sender@example.test');
  assert.throws(() => consumeCallback({ ...callback(consent), url: '/oauth/callback?' + new URLSearchParams({ state: consent.state, error: 'access_denied' }) }, consent), /CONSENT_NOT_COMPLETED/u);
  assert.equal(consent.consumed, true);
});
test('token exchange is one fixed Google POST with client binding, redirect error and matching PKCE', async () => {
  let calls = 0;
  const verifier = createConsent(client, 'sender@example.test').verifier;
  const http = async (url, request) => {
    calls++; assert.equal(url, TOKEN_ENDPOINT); assert.equal(request.method, 'POST'); assert.equal(request.redirect, 'error');
    const params = new URLSearchParams(request.body);
    assert.deepEqual(Object.fromEntries(params), { client_id: client.clientId, client_secret: client.clientSecret, code: 'synthetic-code',
      code_verifier: verifier, redirect_uri: REDIRECT, grant_type: 'authorization_code' });
    return Response.json(token());
  };
  assert.equal(await exchangeCode(client, 'synthetic-code', verifier, http), 'synthetic-refresh-token'); assert.equal(calls, 1);
});
for (const patch of [{ scope: SCOPE + ' openid' }, { scope: undefined }, { token_type: 'bearer' }, { refresh_token: undefined },
  { access_token: undefined }, { expires_in: -1 }, { refresh_token: 'x'.repeat(8193) }]) test('rejects incomplete or wider token grant without secret diagnostics: ' + Object.keys(patch)[0], async () => {
  const data = { ...token(), ...patch }; assert.throws(() => tokenResult(data), /TOKEN_RESPONSE_INVALID/u);
  let calls = 0;
  await assert.rejects(exchangeCode(client, 'synthetic-code', createConsent(client, 'sender@example.test').verifier, async () => { calls++; return Response.json(data); }), /^Error: TOKEN_EXCHANGE_STOP$/u);
  assert.equal(calls, 1);
});
test('provider failure, response oversize and stalled handoff never retry or expose input/body', async () => {
  for (const response of [Response.json({ error: 'sensitive-provider-text' }, { status: 401 }), new Response('x'.repeat(32769), { headers: { 'content-type': 'application/json' } })]) {
    let calls = 0;
    await assert.rejects(exchangeCode(client, 'synthetic-code', createConsent(client, 'sender@example.test').verifier, async () => { calls++; return response; }), /^Error: TOKEN_EXCHANGE_STOP$/u);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(exchangeCode(client, 'synthetic-code', createConsent(client, 'sender@example.test').verifier, async () => { calls++; return new Promise(() => {}); }, 5), /^Error: TOKEN_EXCHANGE_STOP$/u);
  assert.equal(calls, 1);
});
test('explicit file guards refuse foreign, existing and linked paths; preserve synthetic original files', () => {
  const own = fixture();
  try {
    const source = path.join(own.directory, 'client.json'); writeFileSync(source, 'synthetic');
    assert.equal(ignoredPath(source), source);
    assert.throws(() => ignoredPath(path.join(repo, 'package.json')), /IGNORED_PATH_REQUIRED/u);
    assert.throws(() => ignoredPath(own.directory, { output: true }), /OUTPUT_EXISTS/u);
    const target = path.join(own.directory, 'target'); mkdirSync(target);
    const link = path.join(own.directory, 'link'); symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => ignoredPath(path.join(link, 'out'), { output: true }), /PATH_MISSING_OR_LINKED/u);
    assert.equal(readFileSync(source, 'utf8'), 'synthetic');
  } finally { own.cleanup(); }
});
test('owner protection happens before sensitive output; DPAPI boundary persists only ciphertext and never overwrites', async () => {
  const own = fixture();
  try {
    const output = path.join(own.directory, 'out'); let secured = false;
    await createOutput(output, async directory => { assert.deepEqual(readdirSync(directory), []); secured = true; });
    const ciphertext = Buffer.from('synthetic-encrypted-bytes');
    const protect = async bytes => {
      assert.equal(secured, true); const privateValue = JSON.parse(bytes.toString());
      assert.equal(privateValue.refreshToken, 'synthetic-refresh-token'); assert.equal(privateValue.clientSecret, client.clientSecret);
      return ciphertext;
    };
    const result = await persistGrant(output, client, 'synthetic-refresh-token', { scope: SCOPE }, protect);
    assert.equal(result, createHash('sha256').update(ciphertext).digest('hex'));
    assert.deepEqual(readFileSync(path.join(output, 'grant.current-user.dpapi')), ciphertext);
    assert.ok(!readFileSync(path.join(output, 'grant.current-user.dpapi')).includes(Buffer.from('synthetic-refresh-token')));
    await assert.rejects(persistGrant(output, client, 'synthetic-refresh-token', {}, protect), /EEXIST/u);
    await assert.rejects(createOutput(output, async () => {}), /OUTPUT_EXISTS/u);
  } finally { own.cleanup(); }
});
test('failed protection and expired active handoff cannot leave a plaintext/token artifact', async () => {
  const own = fixture();
  try {
    const output = path.join(own.directory, 'out'); await createOutput(output, async () => {});
    await assert.rejects(persistGrant(output, client, 'synthetic-refresh-token', {}, async () => { throw new Error('Synthetic protection failure'); }));
    await assert.rejects(persistGrant(output, client, 'synthetic-refresh-token', {}, async () => Buffer.from('encrypted'), () => false), /CONSENT_WAIT_TIMEOUT/u);
    assert.deepEqual(readdirSync(output), []);
    const denied = path.join(own.directory, 'denied');
    await assert.rejects(createOutput(denied, async () => { throw new Error('Synthetic ACL failure'); })); assert.deepEqual(readdirSync(denied), []);
  } finally { own.cleanup(); }
});

test('existing output directory, file and junction never reach protection or change synthetic contents', async () => {
  const own = fixture(); let calls = 0;
  try {
    const directory = path.join(own.directory, 'existing'), file = path.join(own.directory, 'existing-file'), link = path.join(own.directory, 'existing-link');
    mkdirSync(directory); writeFileSync(path.join(directory, 'marker'), 'synthetic-original'); writeFileSync(file, 'synthetic-original-file');
    symlinkSync(directory, link, process.platform === 'win32' ? 'junction' : 'dir');
    for (const output of [directory, file, link]) await assert.rejects(createOutput(output, async () => { calls++; }), /OUTPUT_EXISTS/u);
    assert.equal(calls, 0); assert.deepEqual(readdirSync(directory), ['marker']);
    assert.equal(readFileSync(path.join(directory, 'marker'), 'utf8'), 'synthetic-original'); assert.equal(readFileSync(file, 'utf8'), 'synthetic-original-file');
  } finally { own.cleanup(); }
});
test('encrypted-only client input binds original ciphertext and bounds/erases decoded bytes', async () => {
  const own = fixture();
  try {
    const file = path.join(own.directory, 'client.current-user.dpapi'), encrypted = Buffer.from('synthetic-encrypted-client');
    writeFileSync(file, encrypted);
    const decoded = Buffer.from(JSON.stringify(input()));
    const result = await encryptedClientInput(file, async bytes => { assert.deepEqual(bytes, encrypted); return decoded; });
    assert.deepEqual(result.client, client); assert.equal(result.hash, createHash('sha256').update(encrypted).digest('hex'));
    assert.ok(decoded.every(value => value === 0)); assert.deepEqual(readFileSync(file), encrypted);
    await assert.rejects(encryptedClientInput(file, async () => Buffer.alloc(65537)), /DECODED_CLIENT_TOO_LARGE/u);
    await assert.rejects(encryptedClientInput(file, async () => { throw new Error('Synthetic wrong Windows user'); }));
  } finally { own.cleanup(); }
});
test('actual Windows CurrentUser DPAPI round-trip and owner-only directory use only synthetic bytes', { skip: process.platform !== 'win32' }, async () => {
  const own = fixture();
  try {
    // On elevated CI the untouched fixture has Administrators ownership. The
    // standalone guard must reject it without normalizing any existing ACL.
    const before = await windowsDirectoryState(own.directory);
    if (!before.ownerUser) {
      assert.equal(before.ownerAdministrators, true);
      await assert.rejects(secureDirectory(own.directory), /^Error: PROTECTED_STORE_STOP$/u);
      assert.deepEqual(await windowsDirectoryState(own.directory), before); assert.deepEqual(readdirSync(own.directory), []);
    }
    const output = path.join(own.directory, 'secured'); await createOutput(output);
    const secured = await windowsDirectoryState(output);
    assert.equal(secured.ownerUser, true); assert.equal(secured.ownerAdministrators, false);
    assert.equal(secured.protected, true); assert.equal(secured.onlyOwner, true); assert.deepEqual(readdirSync(output), []);
    await secureDirectory(output); assert.deepEqual(await windowsDirectoryState(output), secured);
    await assert.rejects(createOutput(output), /OUTPUT_EXISTS/u); assert.deepEqual(await windowsDirectoryState(output), secured);
    const synthetic = Buffer.from('SYNTHETIC ONLY: not an OAuth credential');
    const encrypted = await protectCurrentUser(synthetic), decoded = await unprotectCurrentUser(encrypted);
    assert.notDeepEqual(encrypted, synthetic); assert.deepEqual(decoded, synthetic);
    decoded.fill(0);
  } finally { own.cleanup(); }
});
test('actual local listener strips code; duplicate/favicon during delayed handoff do not cancel or replay', async () => {
  const consent = createConsent(client, 'sender@example.test'); let calls = 0, release;
  const delayed = new Promise(resolve => { release = resolve; });
  let actions;
  const flow = listenForConsent(consent, async () => { calls++; await delayed; return 'synthetic-complete'; }, { timeoutMs: 2000, ready: () => {
    actions = (async () => {
      const received = await localGet('http://127.0.0.1:53682' + callback(consent).url);
      assert.equal(received.status, 303); assert.equal(received.headers.location, '/oauth/complete'); assert.ok(!received.body.includes('synthetic-code'));
      const complete = await localGet('http://127.0.0.1:53682/oauth/complete'); assert.equal(complete.status, 200);
      assert.equal((await localGet('http://127.0.0.1:53682/favicon.ico')).status, 400);
      assert.equal((await localGet('http://127.0.0.1:53682' + callback(consent).url)).status, 400);
      release();
    })();
    return actions;
  } });
  assert.equal(await flow, 'synthetic-complete'); await actions; assert.equal(calls, 1);
});
test('actual local listener rejects invalid issuer then hands off Google issuer exactly once', async () => {
  const consent = createConsent(client, 'sender@example.test'); let calls = 0, release, actions;
  const delayed = new Promise(resolve => { release = resolve; });
  const statuses = [];
  const acceptedUrl = 'http://127.0.0.1:53682' + callback(consent).url + '&iss=https%3A%2F%2Faccounts.google.com&scope=' + encodeURIComponent(SCOPE);
  const flow = listenForConsent(consent, async () => { calls++; await delayed; return 'synthetic-complete'; }, {
    timeoutMs: 2000, onCallback: status => statuses.push(status), ready: () => {
      actions = (async () => {
        for (const suffix of ['&iss=', '&iss=https%3A%2F%2Fforeign.test', '&iss=https%3A%2F%2Faccounts.google.com%2F',
          '&iss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Faccounts.google.com']) {
          const rejected = await localGet('http://127.0.0.1:53682' + callback(consent).url + suffix);
          assert.equal(rejected.status, 400); assert.equal(rejected.body, 'Callback refused.');
          assert.equal(calls, 0); assert.equal(consent.consumed, false);
        }
        const accepted = await localGet(acceptedUrl);
        assert.equal(accepted.status, 303); assert.equal(accepted.headers.location, '/oauth/complete');
        assert.ok(!accepted.body.includes('synthetic-code'));
        assert.equal((await localGet(acceptedUrl)).status, 400);
        release();
      })();
      return actions;
    }
  });
  assert.equal(await flow, 'synthetic-complete'); await actions;
  assert.equal(calls, 1); assert.deepEqual(statuses, ['REJECTED', 'ACCEPTED']);
});
test('actual local listener rejects bad state before handoff and bounds absent consent', async () => {
  const consent = createConsent(client, 'sender@example.test'); let calls = 0, readyFinished; const statuses = [];
  const flow = listenForConsent(consent, async () => { calls++; }, { timeoutMs: 100, ready: () => {
    readyFinished = localGet('http://127.0.0.1:53682/oauth/callback?state=' + 'x'.repeat(43) + '&code=synthetic').then(response => assert.equal(response.status, 400));
    return readyFinished;
  }, onCallback: status => statuses.push(status) });
  await assert.rejects(flow, /CONSENT_WAIT_TIMEOUT/u); await readyFinished; assert.equal(calls, 0);
  assert.deepEqual(statuses, ['REJECTED']);
});
test('diagnostics allow only fixed modes, stages and callback statuses, never supplied secret text', () => {
  const secret = 'synthetic-code state=secret sender@example.test https://provider.test client-secret';
  assert.deepEqual(connectionDiagnostic(secret, secret, secret), { mode: 'OAUTH_CONNECTION_STOP', stage: 'UNKNOWN', callback: 'UNKNOWN',
    senderIdentityVerified: false, sends: 0, deployments: 0 });
  assert.equal(connectionDiagnostic('OAUTH_CONNECTION_STOP', 'TOKEN_EXCHANGE', 'ACCEPTED').stage, 'TOKEN_EXCHANGE');
});
test('absence and unrelated requests differ from rejected callbacks; rejection reporting is bounded', async () => {
  for (const rejected of [false, true]) {
    const consent = createConsent(client, 'sender@example.test'), statuses = []; let actions, calls = 0;
    const flow = listenForConsent(consent, async () => { calls++; }, { timeoutMs: 200, onCallback: status => statuses.push(status), ready: () => {
      actions = (async () => {
        assert.equal((await localGet('http://127.0.0.1:53682/favicon.ico')).status, 400);
        assert.equal((await localGet('http://127.0.0.1:53682/oauth/callback-unrelated')).status, 400);
        if (rejected) for (let i = 0; i < 4; i++) {
          assert.equal((await localGet('http://127.0.0.1:53682/oauth/callback?state=' + 'x'.repeat(43) + '&code=synthetic')).status, 400);
        }
      })(); return actions;
    } });
    await assert.rejects(flow, /CONSENT_WAIT_TIMEOUT/u); await actions; assert.equal(calls, 0);
    assert.deepEqual(statuses, rejected ? ['REJECTED'] : []);
  }
});
test('a rejected callback can be followed by one accepted handoff; denial is distinct and never exchanges', async () => {
  for (const denied of [false, true]) {
    const consent = createConsent(client, 'sender@example.test'), statuses = []; let actions, calls = 0;
    const flow = listenForConsent(consent, async () => { calls++; return 'complete'; }, { timeoutMs: 2000,
      onCallback: status => statuses.push(status), ready: () => {
        actions = (async () => {
          await localGet('http://127.0.0.1:53682/oauth/callback?state=' + 'x'.repeat(43) + '&code=synthetic');
          const url = denied ? '/oauth/callback?' + new URLSearchParams({ state: consent.state, error: 'sensitive-provider-error', iss: 'https://accounts.google.com' }) : callback(consent).url;
          assert.equal((await localGet('http://127.0.0.1:53682' + url)).status, 303);
        })(); return actions;
      } });
    if (denied) await assert.rejects(flow, /^Error: CONSENT_NOT_COMPLETED$/u);
    else assert.equal(await flow, 'complete');
    await actions; assert.equal(calls, denied ? 0 : 1); assert.deepEqual(statuses, ['REJECTED', denied ? 'DENIED' : 'ACCEPTED']);
  }
});
test('failed status persistence stops before handing a callback to the token exchange', async () => {
  const consent = createConsent(client, 'sender@example.test'); let actions, calls = 0;
  const flow = listenForConsent(consent, async () => { calls++; }, { timeoutMs: 2000,
    onCallback: () => { throw new Error('synthetic-secret-error'); }, ready: () => {
      actions = localGet('http://127.0.0.1:53682' + callback(consent).url); return actions;
    } });
  await assert.rejects(flow, /^Error: DIAGNOSTIC_STORE_STOP$/u); await actions; assert.equal(calls, 0);
});
test('synthetic main records token, protected-store and result failures separately from success without secret output', { skip: process.platform !== 'win32' }, async () => {
  const own = fixture(), originalFetch = globalThis.fetch, originalLog = console.log;
  try {
    const encrypted = await protectCurrentUser(Buffer.from(JSON.stringify(input())));
    const clientFile = path.join(own.directory, 'client.current-user.dpapi'), selectionFile = path.join(own.directory, 'owner-selection.json');
    writeFileSync(clientFile, encrypted);
    writeFileSync(selectionFile, JSON.stringify({ schemaVersion: 1, status: 'DRAFT', recordedAt: '2026-10-13T00:00:00Z', source: 'synthetic',
      temporary: true, dedicatedMailboxPlanned: true, requestedSenderEmail: 'sender@example.test', verificationRecipientEmail: 'recipient@example.test',
      interpretation: 'synthetic', currentTransport: 'synthetic', senderAuthorizationVerified: false, providerConnectionConfigured: false,
      deliveryEnabled: false, containsCredentials: false }));
    for (const expectedStage of ['TOKEN_EXCHANGE', 'PROTECTED_STORE', 'RESULT_RECEIPT', 'COMPLETE']) {
      const output = path.join(own.directory, expectedStage), emitted = []; let request, calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++; assert.equal(url, TOKEN_ENDPOINT); assert.equal(new URLSearchParams(options.body).get('code'), 'synthetic-code');
        if (expectedStage === 'TOKEN_EXCHANGE') throw new Error('sensitive-provider-error sender@example.test synthetic-client-secret');
        if (expectedStage === 'PROTECTED_STORE') writeFileSync(path.join(output, 'grant.current-user.dpapi'), 'preexisting-synthetic-ciphertext');
        if (expectedStage === 'RESULT_RECEIPT') writeFileSync(path.join(output, 'result.json'), 'preexisting-synthetic-receipt');
        return Response.json(token());
      };
      console.log = value => {
        emitted.push(value);
        if (JSON.parse(value).mode === 'OAUTH_CALLBACK_READY') {
          const consentUrl = new URL(readFileSync(path.join(output, 'authorization-url.txt'), 'utf8'));
          request = localGet('http://127.0.0.1:53682/oauth/callback?' + new URLSearchParams({ state: consentUrl.searchParams.get('state'), code: 'synthetic-code' }));
        }
      };
      const run = main(['--connect', '--client', clientFile, '--owner-selection', selectionFile, '--out', output]);
      if (expectedStage === 'COMPLETE') await run;
      else await assert.rejects(run, error => { assert.equal(error.message, 'OAUTH_CONNECTION_STOP'); assert.equal(error.diagnostic.stage, expectedStage); return true; });
      await request; assert.equal(calls, 1);
      const diagnostic = JSON.parse(readFileSync(path.join(output, 'status.json'), 'utf8'));
      assert.equal(diagnostic.stage, expectedStage); assert.equal(diagnostic.callback, 'ACCEPTED');
      assert.equal(diagnostic.mode, expectedStage === 'COMPLETE' ? 'OAUTH_REFRESH_TOKEN_STORED' : 'OAUTH_CONNECTION_STOP');
      assert.ok(readFileSync(path.join(output, 'status.json')).length < 1024);
      for (const secret of ['synthetic-code', 'synthetic-client-secret', 'synthetic-refresh-token', 'sender@example.test', 'sensitive-provider-error', client.clientId]) {
        assert.ok(!emitted.join('\n').includes(secret)); assert.ok(!JSON.stringify(diagnostic).includes(secret));
      }
    }
  } finally { globalThis.fetch = originalFetch; console.log = originalLog; own.cleanup(); }
});
