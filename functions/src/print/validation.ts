import { PrintCenterError } from './errors.js';
import { PRINT_LIMITS } from './limits.js';
import type {
  PrintArtifactType,
  PrintDisposition,
  PrintOptions,
  PrintRequestOptions,
  PrintTeam,
  TeamSheetMode,
} from './types.js';

const TEAM_NAME_MAX_LENGTH = 80;
function hasUnsafeText(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new PrintCenterError(400, 'invalid-request', 'Požadavek obsahuje nepovolená pole.');
  }
}

function parseDisposition(value: unknown): PrintDisposition {
  if (value === 'inline' || value === 'attachment') return value;
  throw new PrintCenterError(400, 'invalid-disposition', 'Neplatný způsob doručení PDF.');
}

function parseArtifactType(value: unknown): PrintArtifactType {
  if (value === 'team-sheets' || value === 'answer-key' || value === 'score-table') return value;
  throw new PrintCenterError(400, 'invalid-artifact', 'Neplatný typ dokumentu.');
}

function parseMode(value: unknown): TeamSheetMode {
  if (value === 'generic' || value === 'single' || value === 'all') return value;
  throw new PrintCenterError(400, 'invalid-mode', 'Neplatný režim hracích archů.');
}

function parseTeams(value: unknown): PrintTeam[] {
  if (!Array.isArray(value) || value.length > PRINT_LIMITS.teams) {
    throw new PrintCenterError(400, 'invalid-teams', `Počet týmů musí být nejvýše ${PRINT_LIMITS.teams}.`);
  }

  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new PrintCenterError(400, 'invalid-team', 'Neplatný tým.');
    }
    assertExactKeys(entry, ['id', 'name']);
    if (typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(entry.id)
      || typeof entry.name !== 'string') {
      throw new PrintCenterError(400, 'invalid-team-name', 'Název týmu musí být text.');
    }
    const name = entry.name.trim().normalize('NFC');
    if (!name || name.length > TEAM_NAME_MAX_LENGTH || hasUnsafeText(name)) {
      throw new PrintCenterError(400, 'invalid-team-name', 'Název týmu není platný.');
    }
    const key = name.toLocaleLowerCase('cs-CZ');
    if (seen.has(key)) {
      throw new PrintCenterError(400, 'duplicate-team', 'Názvy týmů se nesmí opakovat.');
    }
    seen.add(key);
    return { id: entry.id, name };
  });
}

export function parsePrintRequestOptions(value: unknown): PrintRequestOptions {
  if (!isRecord(value)) throw new PrintCenterError(400, 'invalid-request', 'Neplatný požadavek na PDF.');
  const artifactType = parseArtifactType(value.artifactType);
  const disposition = parseDisposition(value.disposition);
  if (artifactType === 'answer-key' || artifactType === 'score-table') {
    assertExactKeys(value, ['artifactType', 'disposition']);
    return { artifactType, disposition };
  }
  const mode = parseMode(value.mode);
  if (mode === 'single') {
    assertExactKeys(value, ['artifactType', 'disposition', 'mode', 'teamId']);
    if (typeof value.teamId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.teamId)) {
      throw new PrintCenterError(400, 'invalid-team', 'Neplatný tým.');
    }
    return { artifactType, disposition, mode, teamId: value.teamId };
  }
  assertExactKeys(value, ['artifactType', 'disposition', 'mode']);
  return { artifactType, disposition, mode };
}

export function parsePrintOptions(value: unknown): PrintOptions {
  if (!isRecord(value)) {
    throw new PrintCenterError(400, 'invalid-request', 'Neplatný požadavek na PDF.');
  }
  const artifactType = parseArtifactType(value.artifactType);
  const disposition = parseDisposition(value.disposition);

  if (artifactType === 'answer-key') {
    assertExactKeys(value, ['artifactType', 'disposition']);
    return { artifactType, disposition };
  }

  if (artifactType === 'score-table') {
    assertExactKeys(value, ['artifactType', 'disposition', 'teams']);
    const teams = parseTeams(value.teams);
    if (teams.length === 0) {
      throw new PrintCenterError(400, 'missing-teams', 'Bodovací tabulka vyžaduje alespoň jeden tým.');
    }
    return { artifactType, disposition, teams };
  }

  assertExactKeys(value, ['artifactType', 'disposition', 'mode', 'teams']);
  const mode = parseMode(value.mode);
  const teams = parseTeams(value.teams);
  if (mode === 'generic' && teams.length !== 0) {
    throw new PrintCenterError(400, 'unexpected-teams', 'Obecný arch nesmí obsahovat tým.');
  }
  if (mode === 'single' && teams.length !== 1) {
    throw new PrintCenterError(400, 'missing-team', 'Arch jednoho týmu vyžaduje právě jeden tým.');
  }
  if (mode === 'all' && teams.length === 0) {
    throw new PrintCenterError(400, 'missing-teams', 'Společné PDF vyžaduje alespoň jeden tým.');
  }
  return { artifactType, disposition, mode, teams };
}

export function authorizePrintArtifact(role: unknown, artifactType: PrintArtifactType): void {
  if (role === 'admin') return;
  if (role === 'moderator' && artifactType !== 'answer-key') return;
  throw new PrintCenterError(403, 'permission-denied', 'Pro tento dokument nemáte oprávnění.');
}
