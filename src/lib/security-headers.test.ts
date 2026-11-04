// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CONTENT_SECURITY_POLICY,
  DEFAULT_MAX_BODY_BYTES,
  buildSecurityHeaders,
  checkBodyLimit,
  maxBodyBytes,
} from './security-headers'

describe('buildSecurityHeaders', () => {
  it('always sends CSP, nosniff, frame and referrer protections', () => {
    const h = buildSecurityHeaders({})
    expect(h['Content-Security-Policy']).toBe(CONTENT_SECURITY_POLICY)
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'")
    expect(h['Content-Security-Policy']).toContain("object-src 'none'")
    expect(h['Content-Security-Policy']).not.toContain('unsafe-eval')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['Permissions-Policy']).toContain('camera=()')
  })

  it('sends HSTS only when APP_BASE_URL is https', () => {
    expect(
      buildSecurityHeaders({ APP_BASE_URL: 'http://x.test' })[
        'Strict-Transport-Security'
      ],
    ).toBeUndefined()
    expect(
      buildSecurityHeaders({})['Strict-Transport-Security'],
    ).toBeUndefined()
    expect(
      buildSecurityHeaders({ APP_BASE_URL: 'https://x.test' })[
        'Strict-Transport-Security'
      ],
    ).toContain('max-age=')
  })
})

describe('body limit', () => {
  it('defaults to 10 MB and honours MAX_REQUEST_BODY_BYTES', () => {
    expect(maxBodyBytes({})).toBe(DEFAULT_MAX_BODY_BYTES)
    expect(maxBodyBytes({ MAX_REQUEST_BODY_BYTES: '2048' })).toBe(2048)
    expect(maxBodyBytes({ MAX_REQUEST_BODY_BYTES: 'abc' })).toBe(
      DEFAULT_MAX_BODY_BYTES,
    )
  })

  it('rejects oversized Content-Length with too-large', () => {
    expect(
      checkBodyLimit('POST', { 'content-length': '11000000' }, 10_485_760),
    ).toBe('too-large')
    expect(
      checkBodyLimit('POST', { 'content-length': '100' }, 10_485_760),
    ).toBe('ok')
  })

  it('refuses chunked bodies of unknown length but allows bodiless GET', () => {
    expect(
      checkBodyLimit('POST', { 'transfer-encoding': 'chunked' }, 100),
    ).toBe('length-required')
    expect(checkBodyLimit('GET', {}, 100)).toBe('ok')
    expect(checkBodyLimit('POST', { 'content-length': 'nope' }, 100)).toBe(
      'length-required',
    )
  })
})
