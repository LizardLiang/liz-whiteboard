// M8: Origin policy for Socket.IO handshakes.

import { describe, expect, it, vi } from 'vitest'

import {
  cookieHandshakeOriginOk,
  isHandshakeAllowed,
} from './socket-origin'
import { authenticateSocketHandshake } from './socket-handshake'

const prod = { NODE_ENV: 'production', APP_BASE_URL: 'https://app.example.com' } as NodeJS.ProcessEnv
const dev = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

describe('isHandshakeAllowed (allowRequest)', () => {
  it('rejects a foreign Origin (cookie or not)', () => {
    expect(isHandshakeAllowed({ headers: { origin: 'https://evil.example', cookie: 'session_token=x' } }, prod)).toBe(false)
  })
  it('accepts the configured Origin', () => {
    expect(isHandshakeAllowed({ headers: { origin: 'https://app.example.com' } }, prod)).toBe(true)
  })
  it('accepts a bearer handshake with no Origin (MCP / Node client)', () => {
    expect(isHandshakeAllowed({ headers: {} }, prod)).toBe(true)
  })
  it('accepts CLIENT_URL list entries', () => {
    const env = { ...prod, CLIENT_URL: 'https://a.test, https://b.test' } as NodeJS.ProcessEnv
    expect(isHandshakeAllowed({ headers: { origin: 'https://b.test' } }, env)).toBe(true)
  })
  it('prod without config falls back to same Host', () => {
    const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv
    expect(isHandshakeAllowed({ headers: { origin: 'https://x.test', host: 'x.test' } }, env)).toBe(true)
    expect(isHandshakeAllowed({ headers: { origin: 'https://evil.test', host: 'x.test' } }, env)).toBe(false)
  })
  it('dev allows LAN/loopback on any port but not public hosts', () => {
    expect(isHandshakeAllowed({ headers: { origin: 'http://192.168.1.20:3001' } }, dev)).toBe(true)
    expect(isHandshakeAllowed({ headers: { origin: 'http://localhost:3000' } }, dev)).toBe(true)
    expect(isHandshakeAllowed({ headers: { origin: 'https://evil.example' } }, dev)).toBe(false)
  })
  it('prod does not allow LAN origins implicitly', () => {
    expect(isHandshakeAllowed({ headers: { origin: 'http://192.168.1.20:3001' } }, prod)).toBe(false)
  })
  it('rejects a malformed or null Origin', () => {
    expect(isHandshakeAllowed({ headers: { origin: 'null' } }, prod)).toBe(false)
    expect(isHandshakeAllowed({ headers: { origin: 'not a url' } }, prod)).toBe(false)
  })
})

describe('cookieHandshakeOriginOk', () => {
  it('requires an allowed Origin when present', () => {
    expect(cookieHandshakeOriginOk({ origin: 'https://evil.example' }, prod)).toBe(false)
    expect(cookieHandshakeOriginOk({ origin: 'https://app.example.com' }, prod)).toBe(true)
  })
  it('without Origin requires Sec-Fetch-Site same-origin', () => {
    expect(cookieHandshakeOriginOk({}, prod)).toBe(false)
    expect(cookieHandshakeOriginOk({ 'sec-fetch-site': 'cross-site' }, prod)).toBe(false)
    expect(cookieHandshakeOriginOk({ 'sec-fetch-site': 'same-origin' }, prod)).toBe(true)
  })
})

describe('authenticateSocketHandshake: cookie path origin gate', () => {
  it('refuses a cookie handshake without Origin proof before touching the session', async () => {
    const next = vi.fn()
    await authenticateSocketHandshake(
      { handshake: { auth: {}, headers: { cookie: 'session_token=abc' } }, data: {} },
      next,
    )
    expect(next).toHaveBeenCalledTimes(1)
    expect((next.mock.calls[0][0] as Error).message).toBe('UNAUTHORIZED')
  })
})
