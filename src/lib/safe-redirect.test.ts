// src/lib/safe-redirect.test.ts
import { describe, expect, it } from 'vitest'

import { isSafeRedirect, sanitizeRedirect } from './safe-redirect'

describe('isSafeRedirect', () => {
  it('accepts a plain relative path', () => {
    expect(isSafeRedirect('/project/abc-123')).toBe(true)
  })

  it('accepts the root path', () => {
    expect(isSafeRedirect('/')).toBe(true)
  })

  it('rejects protocol-relative "//host" payloads', () => {
    expect(isSafeRedirect('//evil.com')).toBe(false)
    expect(isSafeRedirect('//evil.com/phish')).toBe(false)
  })

  it('rejects backslash-prefixed payloads browsers may normalize to "//host"', () => {
    expect(isSafeRedirect('/\\evil.com')).toBe(false)
  })

  it('rejects absolute URLs with a scheme', () => {
    expect(isSafeRedirect('https://evil.com')).toBe(false)
    expect(isSafeRedirect('javascript:alert(1)')).toBe(false)
  })

  it('rejects paths that do not start with a slash', () => {
    expect(isSafeRedirect('evil.com')).toBe(false)
    expect(isSafeRedirect('')).toBe(false)
  })

  it.each([
    ['tab', '/\t/evil.com'],
    ['LF', '/\n/evil.com'],
    ['CR', '/\r/evil.com'],
    ['decoded %09', decodeURIComponent('/%09/evil.com')],
    ['decoded %0a', decodeURIComponent('/%0a/evil.com')],
    ['mixed', '/\t\\/evil.com'],
    ['embedded backslash', '/foo\\bar'],
    ['space', '/ /evil.com'],
    ['NUL', '/\u0000/evil.com'],
    ['leading tab', '\t//evil.com'],
  ])('rejects control-char/backslash bypass: %s', (_n, p) => {
    expect(isSafeRedirect(p)).toBe(false)
  })

  it('accepts a literal %09 that stays inside the path', () => {
    expect(isSafeRedirect('/%09/evil.com')).toBe(true)
  })

  it('rejects non-string input', () => {
    expect(isSafeRedirect(undefined as unknown as string)).toBe(false)
    expect(isSafeRedirect(null as unknown as string)).toBe(false)
  })
})

describe('sanitizeRedirect', () => {
  it('returns the path unchanged when safe', () => {
    expect(sanitizeRedirect('/invite/abc123')).toBe('/invite/abc123')
  })

  it('falls back to "/" when unsafe', () => {
    expect(sanitizeRedirect('//evil.com')).toBe('/')
    expect(sanitizeRedirect('https://evil.com')).toBe('/')
  })

  it('supports a custom fallback', () => {
    expect(sanitizeRedirect('//evil.com', '/dashboard')).toBe('/dashboard')
  })
})
