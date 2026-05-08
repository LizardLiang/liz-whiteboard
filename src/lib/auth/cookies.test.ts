// src/lib/auth/cookies.test.ts
// Unit tests for cookie utilities (TC-P2-11 through TC-P2-13)

import { describe, expect, it } from 'vitest'
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  parseSessionCookie,
} from './cookies'

describe('buildSetCookieHeader', () => {
  // TC-P2-11: no Secure flag, HttpOnly present, SameSite=Lax
  describe('TC-P2-11: cookie flags', () => {
    it('contains HttpOnly', () => {
      const header = buildSetCookieHeader('sometoken', false)
      expect(header).toContain('HttpOnly')
    })

    it('contains SameSite=Lax', () => {
      const header = buildSetCookieHeader('sometoken', false)
      expect(header).toContain('SameSite=Lax')
    })

    it('does NOT contain Secure flag (LAN HTTP development)', () => {
      const header = buildSetCookieHeader('sometoken', false)
      expect(header).not.toContain('Secure')
    })

    it('contains the session token value', () => {
      const header = buildSetCookieHeader('mytoken123', false)
      expect(header).toContain('session_token=mytoken123')
    })

    it('sets Max-Age=86400 for non-rememberMe (24h)', () => {
      const header = buildSetCookieHeader('sometoken', false)
      expect(header).toContain('Max-Age=86400')
    })

    it('sets Max-Age=2592000 for rememberMe=true (30 days)', () => {
      const header = buildSetCookieHeader('sometoken', true)
      expect(header).toContain('Max-Age=2592000')
    })
  })
})

describe('parseSessionCookie', () => {
  // TC-P2-12: extracts token from Cookie header
  describe('TC-P2-12: cookie parsing', () => {
    it('extracts token from multi-cookie header', () => {
      const result = parseSessionCookie('session_token=abc123; other=xyz')
      expect(result).toBe('abc123')
    })

    it('returns null when session_token not present', () => {
      const result = parseSessionCookie('other=xyz')
      expect(result).toBeNull()
    })

    it('returns null for null header', () => {
      const result = parseSessionCookie(null)
      expect(result).toBeNull()
    })

    it('is case-sensitive — rejects SESSION_TOKEN wrong case', () => {
      const result = parseSessionCookie('SESSION_TOKEN=abc')
      expect(result).toBeNull()
    })

    it('extracts token when session_token is the only cookie', () => {
      const result = parseSessionCookie('session_token=onlytoken')
      expect(result).toBe('onlytoken')
    })
  })
})

describe('buildClearCookieHeader', () => {
  // TC-P2-13: Max-Age=0
  describe('TC-P2-13: clear cookie', () => {
    it('contains Max-Age=0', () => {
      const header = buildClearCookieHeader()
      expect(header).toContain('Max-Age=0')
    })

    it('contains session_token in the header', () => {
      const header = buildClearCookieHeader()
      expect(header).toContain('session_token=')
    })

    it('does NOT contain Secure flag', () => {
      const header = buildClearCookieHeader()
      expect(header).not.toContain('Secure')
    })
  })
})
