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
