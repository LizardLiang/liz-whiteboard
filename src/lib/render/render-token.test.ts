// @vitest-environment node
// src/lib/render/render-token.test.ts
// Sign/verify coverage for the render token: the happy path plus every way a
// token must be refused (expired, wrong audience, wrong issuer, bad signature,
// malformed claims).

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SignJWT, generateKeyPair } from 'jose'
import {
  RENDER_TOKEN_AUDIENCE,
  RENDER_TOKEN_TTL_SECONDS,
  signRenderToken,
  verifyRenderToken,
} from './render-token'
import { _resetKeyPairForTests, getSigningKeyPair } from '@/lib/oauth/keys'

const ISSUER = 'http://localhost:3000'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const BOARD_ID = '22222222-2222-4222-8222-222222222222'

vi.stubEnv('OAUTH_ISSUER', ISSUER)

/** Sign with the AS key but with caller-controlled claims, to forge bad tokens. */
async function forge(opts: {
  audience?: string
  issuer?: string
  ttlSeconds?: number
  claims?: Record<string, unknown>
  sub?: string | null
}): Promise<string> {
  const { kid, privateKey } = await getSigningKeyPair()
  const now = Math.floor(Date.now() / 1000)
  const jwt = new SignJWT({
    kind: 'whiteboard',
    boardId: BOARD_ID,
    ...opts.claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? RENDER_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.ttlSeconds ?? 60))
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? USER_ID)
  return jwt.sign(privateKey)
}

beforeAll(() => {
  _resetKeyPairForTests()
})

describe('signRenderToken / verifyRenderToken', () => {
  it('round-trips sub, kind and boardId', async () => {
    const { token, expiresAt } = await signRenderToken({
      sub: USER_ID,
      kind: 'canvas',
      boardId: BOARD_ID,
    })
    const claims = await verifyRenderToken(token)
    expect(claims).toMatchObject({
      sub: USER_ID,
      kind: 'canvas',
      boardId: BOARD_ID,
    })
    expect(claims.exp).toBe(expiresAt)
  })

  it('lives for 60 seconds', async () => {
    const before = Math.floor(Date.now() / 1000)
    const { expiresAt } = await signRenderToken({
      sub: USER_ID,
      kind: 'whiteboard',
      boardId: BOARD_ID,
    })
    expect(RENDER_TOKEN_TTL_SECONDS).toBe(60)
    expect(expiresAt - before).toBeGreaterThanOrEqual(60)
    expect(expiresAt - before).toBeLessThanOrEqual(61)
  })

  it('rejects an expired token with the jose expiry code', async () => {
    const token = await forge({ ttlSeconds: -5 })
    await expect(verifyRenderToken(token)).rejects.toMatchObject({
      code: 'ERR_JWT_EXPIRED',
    })
  })

  it('rejects a token with the wrong audience (a collab JWT)', async () => {
    const token = await forge({ audience: 'http://localhost:3010' })
    await expect(verifyRenderToken(token)).rejects.toThrow()
  })

  it('rejects a token from another issuer', async () => {
    const token = await forge({ issuer: 'https://evil.example' })
    await expect(verifyRenderToken(token)).rejects.toThrow()
  })

  it('rejects a token signed by a different key', async () => {
    const other = await generateKeyPair('RS256')
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ kind: 'whiteboard', boardId: BOARD_ID })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(USER_ID)
      .setIssuer(ISSUER)
      .setAudience(RENDER_TOKEN_AUDIENCE)
      .setExpirationTime(now + 60)
      .sign(other.privateKey)
    await expect(verifyRenderToken(token)).rejects.toThrow()
  })

  it('rejects a token whose payload was tampered with', async () => {
    const { token } = await signRenderToken({
      sub: USER_ID,
      kind: 'whiteboard',
      boardId: BOARD_ID,
    })
    const [header, , signature] = token.split('.')
    const forgedPayload = Buffer.from(
      JSON.stringify({
        kind: 'whiteboard',
        boardId: '33333333-3333-4333-8333-333333333333',
        sub: USER_ID,
        iss: ISSUER,
        aud: RENDER_TOKEN_AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url')
    await expect(
      verifyRenderToken(`${header}.${forgedPayload}.${signature}`),
    ).rejects.toThrow()
  })

  it('rejects an invalid kind claim', async () => {
    const token = await forge({ claims: { kind: 'folder' } })
    await expect(verifyRenderToken(token)).rejects.toThrow(/kind/)
  })

  it('rejects a missing boardId claim', async () => {
    const token = await forge({ claims: { boardId: '' } })
    await expect(verifyRenderToken(token)).rejects.toThrow(/boardId/)
  })

  it('rejects a missing sub claim', async () => {
    const token = await forge({ sub: null })
    await expect(verifyRenderToken(token)).rejects.toThrow(/sub/)
  })

  it('rejects garbage', async () => {
    await expect(verifyRenderToken('not-a-jwt')).rejects.toThrow()
  })
})
