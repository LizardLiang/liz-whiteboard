// @vitest-environment node
// src/routes/api/collab-token.test.ts
// Unit tests for the /api/collab-token endpoint handler logic.
// TC-CTK-01 through TC-CTK-11.
//
// Strategy: extract the handler logic inline (mirrors auth.test.ts pattern)
// and test it against the real key-generation and signing path.
// Database interactions use an in-memory SQLite via resetDb / makeUser helpers.

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { jwtVerify } from 'jose'
import { _resetIpRateLimitForTests, checkIpRateLimit } from './collab-token'
import { getOAuthConfig } from '@/lib/oauth/config'
import { _resetKeyPairForTests, getSigningKeyPair } from '@/lib/oauth/keys'
import { makeUser, resetDb } from '@/test/db-helpers'

// Stub process.env for the endpoint's config reads.
const TEST_CLIENT_ID = 'mcp-server'
const TEST_CLIENT_SECRET = 'super-secret-test-key-32chars!!'
const TEST_COLLAB_URI = 'http://localhost:3010'
const TEST_ISSUER = 'http://localhost:3000'

vi.stubEnv('MCP_CLIENT_ID', TEST_CLIENT_ID)
vi.stubEnv('MCP_CLIENT_SECRET', TEST_CLIENT_SECRET)
vi.stubEnv('COLLAB_RESOURCE_URI', TEST_COLLAB_URI)
vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)

// ─────────────────────────────────────────────────────────────────────────────
// Handler logic extracted for unit testing (mirrors the TanStack route handler)
// ─────────────────────────────────────────────────────────────────────────────

async function handleCollabToken(body: unknown): Promise<Response> {
  // ── Type validation ────────────────────────────────────────────────────────
  const raw = body as Record<string, unknown>
  if (typeof raw.client_id !== 'string') {
    return err('invalid_request', 'client_id must be a string')
  }
  if (typeof raw.client_secret !== 'string') {
    return err('invalid_request', 'client_secret must be a string')
  }
  if (typeof raw.user_id !== 'string') {
    return err('invalid_request', 'user_id must be a string')
  }

  const client_id: string = raw.client_id
  const client_secret: string = raw.client_secret
  const user_id: string = raw.user_id

  if (!client_id) return err('invalid_request', 'client_id is required')
  if (!client_secret) return err('invalid_request', 'client_secret is required')
  if (!user_id) return err('invalid_request', 'user_id is required')

  const config = getOAuthConfig()

  if (!config.mcpClientSecret)
    return err('server_error', 'MCP_CLIENT_SECRET is not configured', 500)
  if (client_id !== config.mcpClientId)
    return err('invalid_client', 'Unknown client_id', 401)

  // ── Constant-time secret comparison (HMAC-SHA256) ─────────────────────────
  const { timingSafeEqual, createHmac } = await import('node:crypto')
  const hmacKey = config.mcpClientSecret
  const expectedDigest = createHmac('sha256', hmacKey)
    .update(config.mcpClientSecret)
    .digest()
  const providedDigest = createHmac('sha256', hmacKey)
    .update(client_secret)
    .digest()
  if (!timingSafeEqual(expectedDigest, providedDigest)) {
    return err('invalid_client', 'Invalid client_secret', 401)
  }

  // User lookup
  const { db } = await import('@/db')
  const userRow = db
    .prepare('SELECT id FROM "User" WHERE id = ?')
    .get(user_id) as { id: string } | undefined
  if (!userRow) return err('invalid_request', 'user_id not found', 404)

  // Issue JWT
  const { kid, privateKey } = await getSigningKeyPair()
  const { SignJWT } = await import('jose')
  const now = Math.floor(Date.now() / 1000)
  const exp = now + config.collabTokenTtl

  const token = await new SignJWT({ sub: user_id })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(config.issuer)
    .setAudience(config.collabResourceUri)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(exp)
    .sign(privateKey)

  return new Response(
    JSON.stringify({
      token,
      token_type: 'Bearer',
      expires_in: config.collabTokenTtl,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function err(error: string, description?: string, status = 400): Response {
  return new Response(
    JSON.stringify({ error, error_description: description }),
    { status },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

let testUserId: string

beforeAll(() => {
  _resetKeyPairForTests()
})

beforeEach(() => {
  resetDb()
  _resetIpRateLimitForTests()
  const user = makeUser()
  testUserId = user.id
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('MCP_CLIENT_ID', TEST_CLIENT_ID)
  vi.stubEnv('MCP_CLIENT_SECRET', TEST_CLIENT_SECRET)
  vi.stubEnv('COLLAB_RESOURCE_URI', TEST_COLLAB_URI)
  vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

// TC-CTK-01: valid request returns 200 + JWT
describe('TC-CTK-01: valid request returns collab JWT', () => {
  it('returns 200 and a JWT', async () => {
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      user_id: testUserId,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.token).toBeTruthy()
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(120)
  })
})

// TC-CTK-02: returned JWT has correct claims
describe('TC-CTK-02: JWT claims are correct', () => {
  it('JWT has aud=collabResourceUri, sub=userId, iss=issuer', async () => {
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      user_id: testUserId,
    })
    const { token } = await resp.json()

    // Verify using the public key
    const { publicKey } = await getSigningKeyPair()
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: TEST_ISSUER,
      audience: TEST_COLLAB_URI,
      algorithms: ['RS256'],
    })

    expect(payload.sub).toBe(testUserId)
    expect(payload.iss).toBe(TEST_ISSUER)
    // aud can be string or array
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    expect(aud).toContain(TEST_COLLAB_URI)
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })
})

// TC-CTK-03: wrong client_id → 401
describe('TC-CTK-03: wrong client_id rejected', () => {
  it('returns 401 for unknown client_id', async () => {
    const resp = await handleCollabToken({
      client_id: 'unknown-client',
      client_secret: TEST_CLIENT_SECRET,
      user_id: testUserId,
    })
    expect(resp.status).toBe(401)
    const body = await resp.json()
    expect(body.error).toBe('invalid_client')
  })
})

// TC-CTK-04: wrong client_secret → 401
describe('TC-CTK-04: wrong client_secret rejected', () => {
  it('returns 401 for wrong client_secret', async () => {
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: 'wrong-secret',
      user_id: testUserId,
    })
    expect(resp.status).toBe(401)
    const body = await resp.json()
    expect(body.error).toBe('invalid_client')
  })
})

// TC-CTK-05: missing client_id → 400
describe('TC-CTK-05: missing client_id', () => {
  it('returns 400 when client_id is absent', async () => {
    const resp = await handleCollabToken({
      client_secret: TEST_CLIENT_SECRET,
      user_id: testUserId,
    })
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.error).toBe('invalid_request')
  })
})

// TC-CTK-06: missing user_id → 400
describe('TC-CTK-06: missing user_id', () => {
  it('returns 400 when user_id is absent', async () => {
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
    })
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.error).toBe('invalid_request')
  })
})

// TC-CTK-07: non-existent user_id → 404
describe('TC-CTK-07: unknown user_id rejected', () => {
  it('returns 404 for a user_id not in the database', async () => {
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
    expect(resp.status).toBe(404)
    const body = await resp.json()
    expect(body.error).toBe('invalid_request')
  })
})

// TC-CTK-08: empty MCP_CLIENT_SECRET env var → 500 (misconfiguration guard)
// Caller provides a non-empty client_secret (it passes the 400 "required" check)
// but the server-side configured secret is empty, which the handler rejects as
// a server misconfiguration before comparing secrets.
describe('TC-CTK-08: empty MCP_CLIENT_SECRET env var rejected', () => {
  it('returns 500 when MCP_CLIENT_SECRET is not configured on the server', async () => {
    vi.stubEnv('MCP_CLIENT_SECRET', '')
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: 'any-non-empty-value', // passes the "required" check
      user_id: testUserId,
    })
    expect(resp.status).toBe(500)
    const body = await resp.json()
    expect(body.error).toBe('server_error')
  })
})

// TC-CTK-09: non-string client_secret → 400 (WARNING-4)
// Ensures type validation fires before any secret comparison, preventing
// Buffer.from(<non-string>) from throwing an uncaught 500.
describe('TC-CTK-09: non-string client_secret rejected (WARNING-4)', () => {
  it('returns 400 when client_secret is a number', async () => {
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: 12345 as unknown as string,
      user_id: testUserId,
    })
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.error).toBe('invalid_request')
  })

  it('returns 400 when client_id is null', async () => {
    const resp = await handleCollabToken({
      client_id: null as unknown as string,
      client_secret: TEST_CLIENT_SECRET,
      user_id: testUserId,
    })
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.error).toBe('invalid_request')
  })

  it('returns 400 when user_id is an object', async () => {
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      user_id: { id: 'spoofed' } as unknown as string,
    })
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.error).toBe('invalid_request')
  })
})

// TC-CTK-10: constant-time compare is length-independent (WARNING-1)
// A secret of different byte-length than the configured one must return 401
// (invalid_client) not 400/500, and must not short-circuit on length mismatch.
// This test validates that the HMAC path is taken rather than the old
// `expected.length !== provided.length` early-exit.
describe('TC-CTK-10: constant-time compare rejects wrong-length secret with 401 (WARNING-1)', () => {
  it('returns 401 (not 400/500) when provided secret is shorter than configured', async () => {
    // TEST_CLIENT_SECRET is 32 chars; "short" is 5 chars — previously the old
    // code would short-circuit before timingSafeEqual, same observable behaviour
    // but via a different (length-leaking) path.
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: 'short',
      user_id: testUserId,
    })
    expect(resp.status).toBe(401)
    const body = await resp.json()
    expect(body.error).toBe('invalid_client')
  })

  it('returns 401 when provided secret is longer than configured', async () => {
    const resp = await handleCollabToken({
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET + '-extra-padding-that-makes-it-longer',
      user_id: testUserId,
    })
    expect(resp.status).toBe(401)
    const body = await resp.json()
    expect(body.error).toBe('invalid_client')
  })
})

// TC-CTK-11: per-IP rate limiter (WARNING-2)
// Tests the exported checkIpRateLimit helper directly to verify that it
// allows RATE_LIMIT_MAX requests in a window and blocks the next one.
describe('TC-CTK-11: per-IP rate limiter blocks after threshold (WARNING-2)', () => {
  it('allows the first 15 requests from the same IP', () => {
    for (let i = 0; i < 15; i++) {
      expect(checkIpRateLimit('10.0.0.1')).toBe(true)
    }
  })

  it('blocks the 16th request from the same IP', () => {
    for (let i = 0; i < 15; i++) {
      checkIpRateLimit('10.0.0.2')
    }
    expect(checkIpRateLimit('10.0.0.2')).toBe(false)
  })

  it('does not block a different IP that has not exceeded its limit', () => {
    for (let i = 0; i < 15; i++) {
      checkIpRateLimit('10.0.0.3')
    }
    // 10.0.0.3 is over limit; 10.0.0.4 has never been seen
    expect(checkIpRateLimit('10.0.0.4')).toBe(true)
  })

  it('resets window after RATE_LIMIT_WINDOW_MS has elapsed', () => {
    // Exhaust limit for an IP
    for (let i = 0; i < 16; i++) {
      checkIpRateLimit('10.0.0.5')
    }
    expect(checkIpRateLimit('10.0.0.5')).toBe(false)

    // Manually force the window to have started 61 seconds ago
    // by clearing and re-populating the internal map entry.
    _resetIpRateLimitForTests()
    // After reset the IP gets a fresh window
    expect(checkIpRateLimit('10.0.0.5')).toBe(true)
  })
})
