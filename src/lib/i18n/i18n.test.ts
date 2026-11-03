import { describe, expect, it } from 'vitest'
import {
  matchLocale,
  parseAcceptLanguage,
  parseLocaleCookie,
  resolveLocaleFrom,
} from './resolve-locale'
import { translate } from './translate'
import { tError } from './t-error'
import { en } from './locales/en'

describe('matchLocale', () => {
  it.each<[Array<string>, string]>([
    [['zh-TW'], 'zh-TW'],
    [['zh-HK'], 'zh-TW'],
    [['zh-CN'], 'zh-TW'],
    [['zh'], 'zh-TW'],
    [['en-GB'], 'en'],
    [['fr-FR'], 'en'],
    [['fr', 'zh'], 'zh-TW'],
    [['de', 'zh-HK'], 'zh-TW'],
    [['en-US', 'zh-TW'], 'en'],
    [[], 'en'],
  ])('%j -> %s', (list, expected) => {
    expect(matchLocale(list)).toBe(expected)
  })
})

describe('parseAcceptLanguage', () => {
  it('feeds matchLocale: unsupported tags are skipped', () => {
    expect(matchLocale(parseAcceptLanguage('fr,zh;q=0.5'))).toBe('zh-TW')
    expect(matchLocale(parseAcceptLanguage('zh;q=0.4,en;q=0.8'))).toBe('en')
  })
  it('orders by q-value, ties by position', () => {
    expect(parseAcceptLanguage('fr;q=0.4, zh-TW;q=0.9, en;q=0.9')).toEqual([
      'zh-TW',
      'en',
      'fr',
    ])
  })
  it('ignores *, empty and q=0', () => {
    expect(parseAcceptLanguage('*')).toEqual([])
    expect(parseAcceptLanguage('')).toEqual([])
    expect(parseAcceptLanguage(null)).toEqual([])
    expect(parseAcceptLanguage('de;q=0, en')).toEqual(['en'])
  })
})

describe('parseLocaleCookie', () => {
  it('reads a valid value', () => {
    expect(parseLocaleCookie('a=1; locale=zh-TW; b=2')).toBe('zh-TW')
  })
  it('ignores invalid and missing values', () => {
    expect(parseLocaleCookie('locale=klingon')).toBeNull()
    expect(parseLocaleCookie('locale=%E0%A4%A')).toBeNull()
    expect(parseLocaleCookie('a=1')).toBeNull()
    expect(parseLocaleCookie(null)).toBeNull()
  })
  it('cookie beats browser language', () => {
    expect(resolveLocaleFrom('locale=en', ['zh-TW'])).toBe('en')
    expect(resolveLocaleFrom('locale=bad', ['zh-TW'])).toBe('zh-TW')
  })
})

describe('translate', () => {
  it('uses the active locale', () => {
    expect(translate('zh-TW', 'header.logout')).toBe('登出')
    expect(translate('en', 'header.logout')).toBe('Log out')
  })
  it('falls back to the key for unknown keys', () => {
    expect(translate('zh-TW', 'no.such.key')).toBe('no.such.key')
  })
  it('interpolates {name} placeholders', () => {
    expect(translate('en', 'Hello {name}, {n}', { name: 'Ann', n: 2 })).toBe(
      'Hello Ann, 2',
    )
    expect(translate('en', 'Hi {missing}')).toBe('Hi {missing}')
  })
})

describe('tError', () => {
  const t = (key: string) => translate('zh-TW', key)
  it('translates a known English message', () => {
    expect(tError(t, new Error(en.errors.unauthorized))).toBe('未經授權')
    expect(tError(t, { message: en.errors.unauthorized })).toBe('未經授權')
  })
  it('returns unknown messages unchanged', () => {
    expect(tError(t, new Error('Something odd'))).toBe('Something odd')
  })
  it('handles non-Error values', () => {
    expect(tError(t, 42)).toBe('')
    expect(tError(t, 'Plain text')).toBe('Plain text')
  })
})
