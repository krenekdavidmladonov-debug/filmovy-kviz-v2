import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, `file:///${root.replaceAll('\\', '/')}/`)), 'utf8');

describe('Windows local QA launcher contract', () => {
  const startCmd = read('START_LOCAL_QA.cmd');
  const stopCmd = read('STOP_LOCAL_QA.cmd');
  const common = read('tools/local-qa/LocalQa.Common.ps1');
  const worker = read('tools/local-qa/LocalQa.Worker.ps1');
  const start = read('tools/local-qa/Start-LocalQa.ps1');
  const stop = read('tools/local-qa/Stop-LocalQa.ps1');

  test('keeps the double-click entrypoints thin and local', () => {
    expect(startCmd).toContain('tools\\local-qa\\Start-LocalQa.ps1');
    expect(stopCmd).toContain('tools\\local-qa\\Stop-LocalQa.ps1');
    expect(startCmd).not.toMatch(/deploy/i);
    expect(stopCmd).not.toMatch(/\/IM\s+(node|java)/i);
  });

  test('pins the demo project and removes credential variables from children', () => {
    expect(common).toContain("LocalQaProjectId = 'demo-filmovy-kviz-v2'");
    expect(common).toContain("$ProjectId.StartsWith('demo-')");
    expect(common).toContain("FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true'");
    expect(common).toContain("apps\\web\\.env.example");
    expect(worker).toContain("$ProjectId -ne 'demo-filmovy-kviz-v2'");
    expect(worker).toContain("VITE_FIREBASE_API_KEY = 'demo-api-key'");
    expect(worker).toContain("'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG', 'FIREBASE_TOKEN'");
    expect(`${common}\n${worker}\n${start}`).not.toMatch(/firebase\s+deploy/i);
  });

  test('uses identity-checked process tracking instead of broad termination', () => {
    expect(common).toContain('function Test-TrackedWorker');
    expect(common).toContain('startedAtUtc');
    expect(common).toContain('[Globalization.DateTimeStyles]::RoundtripKind');
    expect(common).toContain('StartTime.ToUniversalTime().Ticks');
    expect(common).toContain('$authoritativeProcess = Get-Process -Id $Process.Id -ErrorAction Stop');
    expect(common).toContain('$authoritativeProcess.StartTime.ToUniversalTime()');
    expect(common).toContain('ExpectedToken');
    expect(stop).toContain("Stop-TrackedWorker $state.vite 'vite'");
    expect(stop).toContain("Stop-TrackedWorker $state.emulators 'emulators'");
    expect(`${common}\n${stop}`).not.toMatch(/taskkill(?:\.exe)?\s+\/IM/i);
  });
});
