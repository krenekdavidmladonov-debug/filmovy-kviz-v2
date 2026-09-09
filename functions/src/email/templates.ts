export type RegistrationEmailType = 'registration-confirmed' | 'registration-updated' | 'registration-cancelled';

export interface RegistrationEmailContent {
  readonly eventTitle: string;
  readonly startsAtMillis: number;
  readonly timeZone: string;
  readonly venueName: string;
  readonly publicLocation: string;
  readonly teamName: string;
  readonly memberCount: number;
}

export interface EmailBody {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function managementUrl(origin: string, eventId: string, registrationId: string, token: string): string {
  const base = new URL(origin);
  if (base.origin !== origin || base.username || base.password
    || !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw new Error('Invalid server email origin.');
  }
  return `${origin}/events/${encodeURIComponent(eventId)}/registration/manage#registration=${encodeURIComponent(registrationId)}&token=${encodeURIComponent(token)}`;
}

export function registrationEmail(type: RegistrationEmailType, content: RegistrationEmailContent, link?: string): EmailBody {
  if (type === 'registration-confirmed' && !link) throw new Error('Confirmation requires a protected management link.');
  if (link && !/^https?:\/\//u.test(link)) throw new Error('Invalid management link.');
  const title = { 'registration-confirmed': 'Potvrzení registrace', 'registration-updated': 'Změna registrace', 'registration-cancelled': 'Zrušení registrace' }[type];
  const introduction = {
    'registration-confirmed': 'Váš tým je úspěšně přihlášen. Těšíme se na vás!',
    'registration-updated': 'Změna vaší registrace byla úspěšně uložena. Níže najdete nové údaje.',
    'registration-cancelled': 'Vaše registrace byla zrušena. Tým již není aktivně přihlášen na tuto akci.',
  }[type];
  const when = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'full', timeStyle: 'short', timeZone: content.timeZone }).format(content.startsAtMillis);
  const where = [content.venueName, content.publicLocation].filter(Boolean).join(' · ');
  const rows = [`Akce: ${content.eventTitle}`, `Kdy: ${when}`, ...(where ? [`Místo: ${where}`] : []), `Tým: ${content.teamName}`, `Počet hráčů: ${content.memberCount}`];
  const footer = 'QUIZ PLATFORM';
  const cta = type === 'registration-confirmed' ? link : undefined;
  const text = [title, introduction, ...rows, ...(cta ? [`Spravovat přihlášku: ${cta}`, 'Odkaz je soukromý. Umožňuje přihlášku upravit nebo zrušit; nepřeposílejte jej.'] : []), footer].join('\n\n');
  return {
    subject: `${title} – ${content.eventTitle.replace(/[\r\n]/gu, ' ')}`,
    text,
    html: `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:20px;background:#f3f5f7;color:#202938;font-family:Arial,sans-serif;line-height:1.6"><main style="max-width:560px;margin:auto;padding:24px;background:#fff;border-radius:12px"><p style="font-size:12px;letter-spacing:2px">${footer}</p><h1 style="font-size:25px">${title}</h1><p>${introduction}</p>${rows.map((row) => `<p>${escapeHtml(row)}</p>`).join('')}${cta ? `<p style="margin:28px 0"><a style="display:inline-block;padding:12px 20px;background:#253c62;color:#fff;border-radius:8px;text-decoration:none" href="${escapeHtml(cta)}">Spravovat přihlášku</a></p><p style="font-size:13px">Odkaz je soukromý. Umožňuje přihlášku upravit nebo zrušit; nepřeposílejte jej.</p>` : ''}</main></body></html>`,
  };
}
