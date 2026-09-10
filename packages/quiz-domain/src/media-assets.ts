export type OwnedMediaKind = 'image' | 'audio';
export interface QuizAssetReference { readonly quizId: string; readonly assetId: string }
export function parseQuizAsset(value: unknown): QuizAssetReference | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^quiz-asset:([A-Za-z0-9_-]{1,150})\/([a-f0-9]{64})$/u.exec(value);
  return match ? { quizId: match[1]!, assetId: match[2]! } : undefined;
}
export const quizAssetReference = (quizId: string, assetId: string) => 'quiz-asset:' + quizId + '/' + assetId;
export const ownedMediaTypes = { image: ['image/png', 'image/jpeg', 'image/webp'], audio: ['audio/mpeg', 'audio/wav'] } as const;
export const ownedMediaLimits = { image: 10 * 1024 * 1024, audio: 25 * 1024 * 1024 } as const;
export function validOwnedMedia(kind: unknown, contentType: unknown, size: unknown): kind is OwnedMediaKind {
  return (kind === 'image' || kind === 'audio') && typeof contentType === 'string'
    && (ownedMediaTypes[kind] as readonly string[]).includes(contentType) && typeof size === 'number' && Number.isInteger(size) && size > 0 && size <= ownedMediaLimits[kind];
}
