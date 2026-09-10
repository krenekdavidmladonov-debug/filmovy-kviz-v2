import { youtubeVideoId } from '@filmovy-kviz/quiz-domain';
import { MigrationSafetyError } from './errors.js';
import { classify, STAGING, transformedArtifact, type SourceArtifact, type TargetInventory } from './cloud-contract.js';
import { canonical, fingerprint } from './fingerprint.js';
import { normalizeV1Library } from './normalize.js';
import { calculateOutputStats } from './validate.js';
import type { NormalizedMedia } from './types.js';

export function mediaStatus(media: NormalizedMedia): 'OK' | 'LEGACY' | 'BROKEN' | 'UNSUPPORTED' {
  if (media.kind === 'unknown' || typeof media.value !== 'string') return 'UNSUPPORTED';
  if (media.validUrl === false && !/^[A-Za-z0-9_-]{11}$/u.test(media.value)) return 'BROKEN';
  if ((media.kind === 'audio' || media.kind === 'video') && youtubeVideoId(media.value) !== undefined) return 'LEGACY';
  if (media.validUrl === false) return 'BROKEN';
  if (media.kind === 'image' && media.url) return 'LEGACY';
  return 'UNSUPPORTED';
}
export function createPlan(source: SourceArtifact, inventory: TargetInventory, now = new Date()) {
  const transformed = transformedArtifact(source);
  const normalized = normalizeV1Library(source.snapshot);
  const quizzes = transformed.map((q, i) => {
    const counts = calculateOutputStats([q]);
    const media = { OK: 0, LEGACY: 0, BROKEN: 0, UNSUPPORTED: 0 };
    for (const item of normalized[i]!.slides.flatMap(s => s.media)) media[mediaStatus(item)]++;
    const classification = classify(q, inventory);
    return { sourceId: q.id, ...classification, title: typeof q.data.title === 'string' ? q.data.title : '', counts,
      fingerprint: (q.data.legacy as Record<string, unknown>).contentFingerprint as string, media,
      warnings: media.BROKEN ? ['SOURCE_MEDIA_SYNTAX_BROKEN'] : [],
      errors: [...(['CONFLICT', 'AMBIGUOUS'].includes(classification.classification) ? ['TARGET_COLLISION'] : []),
        ...(media.UNSUPPORTED ? ['UNSUPPORTED_MEDIA'] : [])] };
  });
  const totals = { ...calculateOutputStats(transformed), new: quizzes.filter(q => q.classification === 'NEW').length,
    identical: quizzes.filter(q => q.classification === 'IDENTICAL').length,
    conflicts: quizzes.filter(q => ['CONFLICT', 'AMBIGUOUS'].includes(q.classification)).length,
    unsupported: quizzes.reduce((n, q) => n + q.media.UNSUPPORTED, 0) };
  const body = { schemaVersion: 2 as const, sourceFingerprint: source.fingerprint, inventoryFingerprint: inventory.fingerprint,
    targetProject: STAGING, createdAt: now.toISOString(), status: quizzes.some(q => q.errors.length) ? 'BLOCKED' : 'PASS',
    totals, quizzes };
  return { ...body, fingerprint: fingerprint(body) };
}
export type CloudPlan = ReturnType<typeof createPlan>;
export function validatePlan(value: unknown, source: SourceArtifact, inventory: TargetInventory, now = new Date()): CloudPlan {
  try {
    const p = value as CloudPlan;
    const age = now.getTime() - Date.parse(p.createdAt);
    const inventoryAge = now.getTime() - Date.parse(inventory.inspectedAt);
    if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000
      || inventoryAge < 0 || inventoryAge > 24 * 60 * 60 * 1000 || p.status !== 'PASS'
      || canonical(p) !== canonical(createPlan(source, inventory, new Date(p.createdAt)))) throw new Error();
    return p;
  } catch { throw new MigrationSafetyError('Missing, stale, blocked or altered dry-run validation artifact; no write.'); }
}
