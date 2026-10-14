import { parseQuizAsset, validOwnedMedia } from '@filmovy-kviz/quiz-domain';
import { PrintCenterError } from './errors.js';

/** Resolve only the frozen quiz's immutable, verified asset. Never fetch a browser URL. */
export function printLogoAsset(reference: string, quizId: unknown, asset: Record<string, unknown> | undefined): { quizId: string; assetId: string; generation: string; contentType: 'image/png' | 'image/jpeg'; size: number } {
  const parsed = parseQuizAsset(reference);
  if (!parsed) throw new PrintCenterError(422, 'unsupported-logo', 'Logo z externího odkazu nelze vložit do PDF. V editoru nahrajte PNG nebo JPEG tohoto kvízu, nebo logo skryjte.');
  if (parsed.quizId !== quizId || !asset || asset.quizId !== quizId || asset.status !== 'ready' || asset.kind !== 'image' || !validOwnedMedia(asset.kind, asset.contentType, asset.size) || typeof asset.generation !== 'string' || !/^\d+$/u.test(asset.generation)) {
    throw new PrintCenterError(422, 'invalid-logo', 'Logo nepatří do připraveného kvízu nebo není ověřené. Vyberte ověřené médium tohoto kvízu.');
  }
  if (asset.contentType !== 'image/png' && asset.contentType !== 'image/jpeg') throw new PrintCenterError(422, 'unsupported-logo', 'PDF podporuje logo PNG nebo JPEG. Logo WebP nahraďte v editoru, nebo logo skryjte.');
  return { ...parsed, generation: asset.generation, contentType: asset.contentType, size: asset.size as number };
}
