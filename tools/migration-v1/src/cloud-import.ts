import { assertCloudSelection, transformedArtifact, validateSourceArtifact, validateInventory, type CloudSelection, type SourceArtifact, type TargetInventory } from './cloud-contract.js';
import { createPlan, validatePlan } from './cloud-plan.js';
import { MigrationSafetyError } from './errors.js';
import { contentFingerprint } from './fingerprint.js';
import { createOnlyQuiz, inspectTarget, type PrivateTargetStore } from './target-store.js';

export async function importToTarget(options: {
  selection: CloudSelection; confirmStagingWrite: boolean; source: SourceArtifact;
  inventory: TargetInventory; validation: unknown; store: PrivateTargetStore;
}, environment: NodeJS.ProcessEnv = process.env) {
  assertCloudSelection(options.selection, environment);
  if (!options.confirmStagingWrite) throw new MigrationSafetyError('Missing --confirm-staging-write; no write.');
  validateSourceArtifact(options.source, options.selection);
  validateInventory(options.inventory);
  validatePlan(options.validation, options.source, options.inventory);
  const fresh = await inspectTarget(options.store, options.selection.targetProject);
  const plan = createPlan(options.source, fresh);
  if (plan.status !== 'PASS') throw new MigrationSafetyError('Fresh target inventory contains a collision or blocker; no write.');
  let created = 0; let identical = 0;
  for (const quiz of transformedArtifact(options.source)) {
    // Recheck all candidates before each quiz, then use existence preconditions.
    const next = createPlan(options.source, await inspectTarget(options.store, options.selection.targetProject));
    if (next.status !== 'PASS') throw new MigrationSafetyError('Target changed; remaining import blocked.');
    const decision = next.quizzes.find(q => q.sourceId === quiz.id)!;
    if (decision.classification === 'IDENTICAL') { identical++; continue; }
    if (decision.classification !== 'NEW') throw new MigrationSafetyError('Target is not NEW; no overwrite.');
    await createOnlyQuiz(options.store, quiz);
    const read = await options.store.readQuiz(quiz.id);
    if (!read.exists || read.pending || contentFingerprint(read.quiz) !== contentFingerprint(quiz)) {
      throw new MigrationSafetyError('Imported quiz read-back mismatch; remaining import stopped.');
    }
    created++;
  }
  return { status: 'PASS', created, identical, inventory: await inspectTarget(options.store, options.selection.targetProject) };
}
