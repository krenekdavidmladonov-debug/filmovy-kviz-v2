export function generatedAgendaOptions(rounds: readonly { readonly title: string }[]): readonly string[] {
  return rounds.map((round, index) => `${index + 1}. KOLO${round.title.trim() === '' ? '' : ` – ${round.title.trim()}`}`);
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function youtubeVideoId(source: string): string | undefined {
  const trimmed = source.trim();
  if (/^[\w-]{11}$/u.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (!isSafeHttpUrl(trimmed)) return undefined;
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

/** Direct file sources only, never HTML/iframe input or a server-side URL proxy. */
export function directMediaKind(source: string): 'audio' | 'video' | undefined {
  if (!isSafeHttpUrl(source)) return undefined;
  const path = new URL(source).pathname.toLowerCase();
  if (/\.(mp3|wav|ogg|m4a)$/.test(path)) return 'audio';
  if (/\.(mp4|webm|ogv)$/.test(path)) return 'video';
  return undefined;
}
