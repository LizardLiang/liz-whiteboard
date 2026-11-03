// src/lib/i18n/I18nProvider.tsx
import { createContext, useCallback, useMemo, useState } from 'react'
import { DEFAULT_LOCALE, buildLocaleCookie } from './resolve-locale'
import { translate } from './translate'
import type { ReactNode } from 'react'
import type { Locale } from './resolve-locale'
import type { TFunction } from './translate'

export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: TFunction
}

// Default value is `en` so components render without a provider (unit tests).
export const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
})

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale
  children: ReactNode
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const setLocale = useCallback((next: Locale) => {
    document.cookie = buildLocaleCookie(next)
    document.documentElement.lang = next
    setLocaleState(next)
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
