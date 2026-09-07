import type { PrintTeam } from '../print/types.js';

export function registrationToPrintTeam(
  id: string,
  value: Record<string, unknown>,
): PrintTeam | undefined {
  if (value.status !== 'accepted' || typeof value.teamName !== 'string') return undefined;
  const name = value.teamName.normalize('NFC').trim();
  if (name === '') return undefined;
  return { id, name };
}
