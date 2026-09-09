import type { TeamMessagePreview, TeamMessageRequest } from './teamMessageApi';
export interface TeamMessageRecovery { request: TeamMessageRequest; preview: TeamMessagePreview }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function readTeamMessageRecovery(read: () => string | null, eventId: string): { data: TeamMessageRecovery | null; blocked: boolean } {
  try {
    const raw = read();
    if (raw === null) return { data: null, blocked: false };
    const data: unknown = JSON.parse(raw);
    if (!record(data) || !record(data.request) || !record(data.preview)) throw new Error('Invalid recovery');
    const r = data.request, p = data.preview;
    if (r.eventId !== eventId || r.confirmed !== true || typeof r.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(r.requestId)
      || typeof r.subject !== 'string' || !r.subject || r.subject.length > 200 || typeof r.message !== 'string' || !r.message || r.message.length > 4000
      || typeof r.previewFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(r.previewFingerprint)
      || p.subject !== r.subject || p.message !== r.message || p.previewFingerprint !== r.previewFingerprint
      || typeof p.eventTitle !== 'string' || p.eventTitle.length > 300 || typeof p.total !== 'number' || !Number.isInteger(p.total) || p.total < 1 || p.total > 450) throw new Error('Invalid recovery');
    return { data: data as unknown as TeamMessageRecovery, blocked: false };
  } catch { return { data: null, blocked: true }; }
}
