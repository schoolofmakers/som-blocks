import type { Lang } from '../i18n/messages';

/** "hace 3 minutos" / "3 minutes ago", via the browser's Intl data (no extra strings). */
export function relativeTime(then: number, now: number, lang: Lang): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return new Date(then).toLocaleDateString(lang);
}
