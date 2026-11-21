// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CSP_NONCE_HEADER,
  DEFAULT_MAX_BODY_BYTES,
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  checkBodyLimit,
  generateCspNonce,
  maxBodyBytes,
} from './security-headers'

describe('buildSecurityHeaders', () => {
  it('always sends CSP, nosniff, frame and referrer protections', () => {
    const h = buildSecurityHeaders({}, 'abc')
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

describe('CSP nonce (audit F9)', () => {
  const scriptSrc = (csp: string) =>
    csp.split('; ').find((d) => d.startsWith('script-src')) ?? ''

  it('script-src carries the nonce and no unsafe-inline', () => {
    const src = scriptSrc(buildContentSecurityPolicy('N0nce', {}))
    expect(src).toContain("'nonce-N0nce'")
    expect(src).not.toContain('unsafe-inline')
  })

  it('every generated nonce is unique and the header uses it', () => {
    const a = generateCspNonce()
    const b = generateCspNonce()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(22)
    expect(
      scriptSrc(buildSecurityHeaders({}, a)['Content-Security-Policy']),
    ).toContain(`'nonce-${a}'`)
  })

  it('connect-src names the wss origin from APP_BASE_URL, not blanket ws:/wss:', () => {
    const csp = buildContentSecurityPolicy('n', {
      APP_BASE_URL: 'https://app.example.com/',
    })
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src'))
    expect(connect).toBe(
      "connect-src 'self' wss://app.example.com https://challenges.cloudflare.com",
    )
    expect(csp).not.toMatch(/ ws: | wss: /)
  })

  it('exports the header name the SSR handler reads', () => {
    expect(CSP_NONCE_HEADER).toBe('x-csp-nonce')
  })
})
