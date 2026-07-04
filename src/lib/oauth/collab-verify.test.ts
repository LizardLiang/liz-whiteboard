// @vitest-environment node
// src/lib/oauth/collab-verify.test.ts
// Unit tests for validateCollabToken (TC-CT-01 through TC-CT-05).
//
// Tests use a real RS256 keypair generated at test startup (same as production)
// so that we exercise the actual jose jwtVerify path with correct algorithm
// validation. No mocking of getSigningKeyPair — we call it directly.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import { _resetKeyPairForTests, getSigningKeyPair } from './keys'
import { validateCollabToken } from './collab-verify'

const TEST_ISSUER = 'http://localhost:3000'
const TEST_COLLAB_URI = 'http://localhost:3010'

// Make sure env vars are set so validateCollabToken reads the right values.
vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)
vi.stubEnv('COLLAB_RESOURCE_URI', TEST_COLLAB_URI)

let privateKey: CryptoKey
let kid: string

beforeAll(async () => {
  _resetKeyPairForTests()
  const pair = await getSigningKeyPair()
  privateKey = pair.privateKey
  kid = pair.kid
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)
  vi.stubEnv('COLLAB_RESOURCE_URI', TEST_COLLAB_URI)
})

async function mintCollabJWT(
  overrides: {
    iss?: string
    aud?: string | Array<string>
    sub?: string
    exp?: number
  } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  let jwt = new SignJWT({ sub: overrides.sub ?? 'user-123' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt(now)
    .setNotBefore(now)

  if (overrides.iss !== undefined) {
    jwt = jwt.setIssuer(overrides.iss)
  } else {
    jwt = jwt.setIssuer(TEST_ISSUER)
  }

  if (overrides.aud !== undefined) {
    jwt = jwt.setAudience(overrides.aud as string)
  } else {
    jwt = jwt.setAudience(TEST_COLLAB_URI)
  }

  if (overrides.exp !== undefined) {
    jwt = jwt.setExpirationTime(overrides.exp)
  } else {
    jwt = jwt.setExpirationTime(now + 120)
  }

  return jwt.sign(privateKey)
}

// TC-CT-01: valid collab JWT is accepted, payload returned
describe('TC-CT-01: valid collab JWT accepted', () => {
  it('returns sub and exp on a valid collab JWT', async () => {
    const token = await mintCollabJWT({ sub: 'user-abc' })
    const payload = await validateCollabToken(token)
    expect(payload.sub).toBe('user-abc')
    expect(typeof payload.exp).toBe('number')
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })
})

// TC-CT-02: wrong audience is rejected
describe('TC-CT-02: wrong audience rejected', () => {
  it('throws when aud does not match COLLAB_RESOURCE_URI', async () => {
    const token = await mintCollabJWT({ aud: 'http://localhost:8080/mcp' })
    await expect(validateCollabToken(token)).rejects.toThrow()
  })
})

// TC-CT-03: wrong issuer is rejected
describe('TC-CT-03: wrong issuer rejected', () => {
  it('throws when iss does not match OAUTH_ISSUER', async () => {
    const token = await mintCollabJWT({ iss: 'http://evil.example.com' })
    await expect(validateCollabToken(token)).rejects.toThrow()
  })
})

// TC-CT-04: expired token is rejected
describe('TC-CT-04: expired JWT rejected', () => {
  it('throws when the token is expired', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await mintCollabJWT({ exp: now - 10 }) // 10 seconds in the past
    await expect(validateCollabToken(token)).rejects.toThrow()
  })
})

// TC-CT-05: missing sub claim is rejected
describe('TC-CT-05: missing sub rejected', () => {
  it('throws when sub claim is absent', async () => {
    // Build a JWT with no sub by overriding after construction
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({}) // no sub
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_COLLAB_URI)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + 120)
      .sign(privateKey)
    await expect(validateCollabToken(token)).rejects.toThrow()
  })
})
