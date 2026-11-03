// src/lib/i18n/translate.ts
import { en } from './locales/en'
import { zhTW } from './locales/zh-TW'
import type { TranslationKey } from './locales/en'
import type { Locale } from './resolve-locale'

export type Vars = Record<string, string | number>

const DICTIONARIES: Record<Locale, unknown> = { en, 'zh-TW': zhTW }

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node) {
      node = (node as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return typeof node === 'string' ? node : undefined
}

/** Lookup order: active locale, then en, then the key itself. */
export function translate(
  locale: Locale,
  key: TranslationKey | (string & {}),
  vars?: Vars,
): string {
  const template = lookup(DICTIONARIES[locale], key) ?? lookup(en, key) ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

export type TFunction = (
  key: TranslationKey | (string & {}),
  vars?: Vars,
) => string

export function formatDate(
  locale: Locale,
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value))
}
