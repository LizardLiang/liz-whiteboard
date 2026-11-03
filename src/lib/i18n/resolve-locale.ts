// src/lib/i18n/resolve-locale.ts
// Pure locale detection helpers. No server-only imports: used on both sides.

export const SUPPORTED_LOCALES = ['en', 'zh-TW'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'locale'

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as ReadonlyArray<string>).includes(value)
  )
}

/**
 * Pick a supported locale from an ordered preference list.
 * Earlier entries win. `zh*` maps to zh-TW, `en*` maps to en, no match is en.
 */
export function matchLocale(list: ReadonlyArray<string>): Locale {
  for (const raw of list) {
    const tag = raw.trim().toLowerCase()
    if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) {
      return 'zh-TW'
    }
    if (tag === 'en' || tag.startsWith('en-') || tag.startsWith('en_')) {
      return 'en'
    }
  }
  return DEFAULT_LOCALE
}

/** Parse an Accept-Language header into tags ordered by q-value (stable). */
export function parseAcceptLanguage(
  header: string | null | undefined,
): Array<string> {
  if (!header) return []
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      let q = 1
      for (const p of params) {
        const [k, v] = p.trim().split('=')
        if (k === 'q') {
          const n = Number(v)
          q = Number.isFinite(n) ? n : 0
        }
      }
      return { tag: tag.trim(), q, index }
    })
    .filter((e) => e.tag !== '' && e.tag !== '*' && e.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((e) => e.tag)
}

/** Read the `locale` cookie from a Cookie header. Invalid values give null. */
export function parseLocaleCookie(
  cookieHeader: string | null | undefined,
): Locale | null {
  if (!cookieHeader) return null
  const entry = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LOCALE_COOKIE}=`))
  if (!entry) return null
  let value = entry.slice(LOCALE_COOKIE.length + 1)
  try {
    value = decodeURIComponent(value)
  } catch {
    return null
  }
  return isLocale(value) ? value : null
}

/** Cookie string for document.cookie after the user picks a language. */
export function buildLocaleCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

/** Cookie first, then Accept-Language / navigator.languages, then en. */
export function resolveLocaleFrom(
  cookieHeader: string | null | undefined,
  languages: ReadonlyArray<string>,
): Locale {
  return parseLocaleCookie(cookieHeader) ?? matchLocale(languages)
}
