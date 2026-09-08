import type { EventFormValues } from '../../apps/web/src/features/events/types';

declare global { interface Window { uxCalls: unknown[]; } }
window.uxCalls = [];
const params = new URLSearchParams(window.location.search);
export const useAuth = () => ({ role: params.get('role') ?? 'admin', currentUser: { email: 'staff@example.test' }, signOut: () => Promise.resolve() });
let record = { id: 'synthetic-event', title: 'Syntetická testovací akce', startsAt: new Date('2030-10-20T17:00:00Z'),
  venue: { name: 'Testovací sál', publicLocation: 'Testovací lokalita' }, timeZone: 'Europe/Prague',
  teamCapacity: 20, peopleCapacity: 120, teamSizeMin: 2, teamSizeMax: 6, acceptedTeams: 0,
  lifecycleStatus: 'draft', revision: 2, quizAssignment: null };
export const getEvent = () => Promise.resolve(record);
export const listQuizzes = () => Promise.resolve([]);
export const getEditorQuiz = () => Promise.resolve(null);
export const eventActionError = () => 'Změny se nepodařilo uložit. Zkuste to znovu.';
async function save(values: EventFormValues) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (params.has('fail')) throw new Error('synthetic save failure');
  record = { ...record, ...values, startsAt: new Date(values.startsAt),
    venue: { name: values.venueName, publicLocation: values.publicLocation }, revision: record.revision + 1 };
}
export async function createEvent(values: EventFormValues) { window.uxCalls.push({ operation: 'create', values }); await save(values); return { eventId: record.id }; }
export async function updateEvent(id: string, revision: number, values: EventFormValues) { window.uxCalls.push({ operation: 'update', id, revision, values }); await save(values); }
export const archiveEvent = () => Promise.resolve();
export const cancelEvent = () => Promise.resolve();
export const lockEventQuiz = () => Promise.resolve();
