export function generatedAgendaOptions(rounds: readonly { readonly title: string }[]): readonly string[] {
  return rounds.map((round, index) => `${index + 1}. KOLO${round.title.trim() === '' ? '' : ` – ${round.title.trim()}`}`);
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function youtubeVideoId(source: string): string | undefined {
  const trimmed = source.trim();
  if (/^[\w-]{11}$/u.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{11}$/u.test(id) ? id : undefined;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const candidate = parsed.searchParams.get('v')
        ?? (['embed', 'shorts', 'live'].includes(pathParts[0] ?? '') ? pathParts[1] : undefined);
      return candidate && /^[\w-]{11}$/u.test(candidate) ? candidate : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
