// src/lib/i18n/get-locale.ts
// Isomorphic locale resolution for the root route's beforeLoad.
// Server: request cookie, then Accept-Language. Client: document.cookie, then
// navigator.languages (no server round trip per navigation).

import { createServerFn } from '@tanstack/react-start'
import { getRequestLocale } from './server-locale'
import { resolveLocaleFrom } from './resolve-locale'
import type { Locale } from './resolve-locale'

/**
 * Reads the request cookie and Accept-Language header only.
 * @requires unauthenticated
 */
export const getServerLocale = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Locale> => getRequestLocale(),
)

export async function resolveLocale(): Promise<Locale> {
  if (typeof document === 'undefined') {
    return getServerLocale()
  }
  return resolveLocaleFrom(document.cookie, navigator.languages)
}
