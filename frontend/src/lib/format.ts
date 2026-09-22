/** Display helpers. The clinic is in the UAE, so times are shown in Dubai. */

export const CLINIC_TIMEZONE = 'Asia/Dubai'

/** WhatsApp only allows a free-form reply within 24 hours of the last inbound. */
export const REPLY_WINDOW_HOURS = 24

export function hoursSince(iso: string | null): number | null {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 36e5
}

/**
 * True when a free-form reply would be rejected.
 *
 * The 24-hour window is a WhatsApp Business rule, so it is gated on channel —
 * Telegram has no such limit and must never show the warning.
 */
export function isOutsideReplyWindow(
  channel: string,
  lastIncomingAt: string | null,
): boolean {
  if (channel !== 'whatsapp') return false
  const hours = hoursSince(lastIncomingAt)
  return hours !== null && hours > REPLY_WINDOW_HOURS
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

/** "just now" / "5m ago" — relativeTime returns "now", which reads badly with a
 * trailing "ago". */
export function relativeAge(iso: string | null): string {
  const value = relativeTime(iso)
  if (value === 'now') return 'just now'
  if (value === '—') return 'unknown'
  return `${value} ago`
}

/**
 * `timezone` defaults to the clinic's own — pass the viewer's effective
 * timezone (see AuthProvider's `timezone`) at call sites where showing a
 * signed-in person's own per-user override (Settings → Profile) is more
 * appropriate than the clinic default, e.g. a message or record timestamp
 * someone is reading for their own reference rather than a business metric.
 */
export function clockTime(iso: string, timezone: string = CLINIC_TIMEZONE): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}

export function shortDate(iso: string, timezone: string = CLINIC_TIMEZONE): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  })
}

export function longDateTime(iso: string, timezone: string = CLINIC_TIMEZONE): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}

const channelLabels: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
  email: 'Email',
}

export function channelLabel(channel: string): string {
  return channelLabels[channel] ?? channel
}

const languageLabels: Record<string, string> = {
  en: 'English',
  ar: 'Arabic',
  hi: 'Hindi',
  ur: 'Urdu',
}

export function languageLabel(code: string | null): string {
  if (!code) return 'Not detected'
  return languageLabels[code] ?? code
}

/**
 * Privacy masking for a customer's WhatsApp number — the country code stays
 * visible (it's not identifying on its own), everything after it becomes
 * `X`s. The real number is still stored and transmitted normally (the
 * channel adapter needs it to actually send a message); this only affects
 * what a staff member sees on screen, applied at every render site rather
 * than in the API response — see README's "Inbox & privacy" note.
 */
export function maskPhoneNumber(phoneNumber: string | null, channel: string): string | null {
  if (!phoneNumber || channel !== 'whatsapp') return phoneNumber
  // UAE's country code is 3 digits — every contact in this workspace is
  // +971, matching the brief's own example (`+971 XXXXXXXX`) exactly. A
  // generic 1-4 digit match would greedily swallow the first digit of the
  // actual number into the "country code" and under-mask it.
  const match = phoneNumber.match(/^(\+971)[\s-]*(.+)$/) ?? phoneNumber.match(/^(\+\d{1,3})[\s-]*(.+)$/)
  if (!match) return phoneNumber
  const [, countryCode, rest] = match
  return `${countryCode} ${'X'.repeat(rest.replace(/[\s-]/g, '').length)}`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Arabic and Hebrew need the bubble laid out right-to-left. */
export function isRtl(text: string | null): boolean {
  if (!text) return false
  return /[֐-׿؀-ۿݐ-ݿ]/.test(text)
}
