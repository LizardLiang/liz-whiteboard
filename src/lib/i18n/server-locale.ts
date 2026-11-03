// src/lib/i18n/server-locale.ts
// Resolves the locale from the current request. The server-only import is
// dynamic so client bundles never pull it in statically.

import {
  DEFAULT_LOCALE,
  parseAcceptLanguage,
  resolveLocaleFrom,
} from './resolve-locale'
import type { Locale } from './resolve-locale'

export async function getRequestLocale(): Promise<Locale> {
  try {
    const { getRequest } = await import('@tanstack/react-start/server')
    const request = getRequest()
    return resolveLocaleFrom(
      request.headers.get('cookie'),
      parseAcceptLanguage(request.headers.get('accept-language')),
    )
  } catch {
    return DEFAULT_LOCALE
  }
}
