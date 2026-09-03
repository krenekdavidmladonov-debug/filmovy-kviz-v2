export function formatHumanTime(seconds: number | null): string {
  if (seconds === null) return '';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  const secondText = Number.isInteger(remaining)
    ? String(remaining).padStart(2, '0')
    : remaining.toFixed(1).padStart(4, '0');
  return `${minutes}:${secondText}`;
}

export function parseHumanTime(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const match = /^(\d+):([0-5]\d(?:\.\d)?)$/u.exec(trimmed);
  if (match === null) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function clipDuration(start: number | null, end: number | null): number | null {
  return start !== null && end !== null && end > start ? end - start : null;
}
