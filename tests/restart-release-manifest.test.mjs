import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { editorReleaseFunctions, existingDependencies } from '../tools/staging/editor-release-manifest.mjs';

// Source-only contract: never import Firebase handlers, builders, cloud tools or environment files.
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const json = path => JSON.parse(read(path));
const manifest = json('tools/staging/restart-release-manifest.json');
const access = json('tools/access/deployment-manifest.json');
const events = json('tools/event-management/deployment-manifest.json');
const sorted = values => [...values].sort();
const union = values => sorted(new Set(values));
const emailExports = [
  'dispatchRegistrationEmail', 'deliverEmailTask',
  'previewEventTeamMessage', 'createEventTeamMessage', 'listEventTeamMessages', 'getEventTeamMessage',
];

function sourceExports() {
  const source = ts.createSourceFile('index.ts', read('functions/src/index.ts'), ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0);
  const exports = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      assert(statement.exportClause && ts.isNamedExports(statement.exportClause), 'Unbounded export requires inventory review');
      exports.push(...statement.exportClause.elements.map(element => element.name.text));
    } else if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        assert(ts.isIdentifier(declaration.name), 'Destructured export requires inventory review');
        exports.push(declaration.name.text);
      }
    } else if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      assert.fail('New export form requires inventory review');
    }
  }
  assert.equal(new Set(exports).size, exports.length, 'Duplicate source exports');
  return sorted(exports);
}

function assertInventory(candidate) {
  const required = union([...editorReleaseFunctions, ...existingDependencies, ...access.functions, ...events.functions]);
  assert.equal(new Set(candidate.functions).size, candidate.functions.length, 'Duplicate release functions');
  assert.deepEqual(candidate.functions, sorted(candidate.functions), 'Keep release functions sorted');
  assert.deepEqual(candidate.functions, required, 'Every source-manifest function/dependency must update');
  assert.deepEqual(sorted(Object.keys(candidate.excludedFunctions)), sorted(emailExports));
  assert.deepEqual(Object.keys(candidate.existingFunctionDependencies.retainedOutsideRelease), ['health']);
  assert.deepEqual(candidate.existingFunctionDependencies.includedInFunctions, existingDependencies);
  const accounted = [...candidate.functions, ...Object.keys(candidate.existingFunctionDependencies.retainedOutsideRelease), ...Object.keys(candidate.excludedFunctions)];
  assert.equal(new Set(accounted).size, accounted.length, 'Export groups overlap');
  assert.deepEqual(sorted(accounted), sourceExports(), 'Every application export must be included or explicitly accounted for');
  assert.deepEqual(candidate.counts, {
    sourceExports: accounted.length,
    releaseFunctions: required.length,
    retainedFunctionDependencies: 1,
    excludedEmailFunctions: emailExports.length,
    editorFunctions: editorReleaseFunctions.length,
    editorExistingDependencies: existingDependencies.length,
    accessFunctions: access.functions.length,
    eventManagementFunctions: events.functions.length,
    runtimePackages: Object.keys(candidate.runtime.packages).length,
  });
}

test('unified inventory covers every source export and all three release contracts without duplicates', () => {
  assertInventory(manifest);
  assert.equal(manifest.counts.releaseFunctions, 70);
  assert.equal(manifest.counts.sourceExports, 77);
  assert.deepEqual(manifest.sourceManifests, [
    'tools/staging/editor-release-manifest.mjs',
    'tools/access/deployment-manifest.json',
    'tools/event-management/deployment-manifest.json',
  ]);
});

test('omitted legacy handlers, duplicates and accidental email activation fail the inventory contract', () => {
  const missing = structuredClone(manifest);
  missing.functions = missing.functions.filter(name => name !== 'generatePrintArtifact');
  assert.throws(() => assertInventory(missing));
  const duplicate = structuredClone(manifest);
  duplicate.functions.push('readAccessData');
  assert.throws(() => assertInventory(duplicate));
  const worker = structuredClone(manifest);
  worker.functions.push('deliverEmailTask');
  worker.functions.sort();
  assert.throws(() => assertInventory(worker));
});

test('runtime/domain dependencies match package metadata and the vendored artifact lock', () => {
  const pkg = json(manifest.runtime.packageManifest);
  const lock = json(manifest.runtime.packageLock).packages[''];
  assert.deepEqual(manifest.runtime.packages, pkg.dependencies);
  assert.equal(manifest.runtime.node, pkg.engines.node);
  assert.equal(lock.engines.node, manifest.runtime.node);
  assert.deepEqual(lock.dependencies, { ...pkg.dependencies, '@filmovy-kviz/quiz-domain': manifest.runtime.domain.artifactDependency });
  assert.equal(manifest.runtime.domain.artifactDependency, 'file:vendor/quiz-domain');
  assert.equal(manifest.runtime.domain.sameReleaseShaRequired, true);
  assert.equal(manifest.runtime.sourceEntrypoint, 'functions/src/index.ts');
  assert.equal(manifest.runtime.targetedEntrypointRequired, true);
});

test('Rules/indexes and frontend are explicit components from the same release', () => {
  for (const key of ['firestoreRules', 'storageRules', 'firestoreIndexes', 'hosting']) assert.equal(manifest[key], access[key]);
  for (const key of ['firestoreRules', 'firestoreIndexes', 'hosting']) assert.equal(manifest[key], events[key]);
  assert.match(read(manifest.firestoreRules), /^rules_version = '2';/u);
  assert.match(read(manifest.storageRules), /^rules_version = '2';/u);
  assert(Array.isArray(json(manifest.firestoreIndexes).indexes));
  assert.equal(manifest.web.source, 'apps/web');
  assert.equal(manifest.web.buildMode, 'staging');
  assert.equal(manifest.web.sameReleaseShaRequired, true);
  assert.equal(manifest.web.requiredBuildFlags.VITE_ENABLE_TEAM_EMAIL, 'false');
  assert.match(read('apps/web/src/features/events/teamEmailCapability.ts'), /VITE_ENABLE_TEAM_EMAIL === 'true'/u);
});

test('local inventory authorizes no cloud activity, invitations or email infrastructure', () => {
  assert.equal(manifest.mode, 'LOCAL_RELEASE_INVENTORY_NOT_AUTHORIZATION');
  for (const key of ['cloudReadApproved', 'cloudWritesApproved', 'cloudInventoryVerified']) assert.equal(manifest[key], false);
  assert.equal(manifest.releaseSha, null);
  assert.equal(manifest.projectId, access.projectId);
  assert.equal(manifest.projectId, events.projectId);
  assert.equal(manifest.projectId, 'filmovy-kviz-v2-staging');
  assert.equal(manifest.region, 'europe-west1');
  for (const key of ['teamEmailEnabled', 'cloudRegistrationEmailEnabled', 'workersEnabled', 'workerProvisioning', 'secretProvisioning', 'queueProvisioning', 'realMessageDelivery']) assert.equal(manifest.email[key], false);
  assert.equal(manifest.activation.collaborationEnabled, false);
  assert.equal(manifest.activation.invitationsRequireSeparateApprovalAfterOnlineVerification, true);
  assert.equal(manifest.activation.authProvidersChanged, false);
  assert.equal(manifest.cloudPrerequisites.verified, false);
  assert.equal(manifest.cloudPrerequisites.provisioningApproved, false);
  assert.equal(manifest.cloudPrerequisites.storage.publicBucketReadsAllowed, false);
  assert.equal(manifest.cloudPrerequisites.storage.cleanupApproved, false);
  assert.deepEqual(manifest.cloudPrerequisites.historicalEventManagementAdditions, events.newCallableFunctions);
  assert.match(read('functions/src/email/intent.ts'), /if \(!emailEmulatorRuntime\(\)\) return;/u);
  assert.match(read('functions/src/registrations/callables.ts'), /from '\.\.\/email\/runtime\.js'/u);
  assert.doesNotMatch(read('functions/src/registrations/callables.ts'), /from '\.\.\/email\/(?:config|worker)\.js'/u);
});
