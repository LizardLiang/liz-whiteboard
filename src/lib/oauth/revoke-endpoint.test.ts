// @vitest-environment node
// src/lib/oauth/revoke-endpoint.test.ts
// /revoke must work for DCR/CIMD clients (not only the static config list),
// bind revocation to the token's own client_id, and return 200 for unknown
// tokens (RFC 7009 §2.2). Real data layer.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRevokePost } from './revoke-endpoint'
import { _resetClientStoreForTests, registerClient } from '@/lib/oauth/clients'
import { getOAuthConfig } from '@/lib/oauth/config'
import { _resetKeyPairForTests } from '@/lib/oauth/keys'
import {
  _resetTokenStoresForTests,
  getRefreshTokenClientId,
  issueTokens,
} from '@/lib/oauth/tokens'
import { makeUser, resetDb } from '@/test/db-helpers'

vi.stubEnv('OAUTH_ISSUER', 'http://localhost:3000')

function post(form: Record<string, string>): Request {
  return new Request('http://localhost/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
}

beforeEach(() => {
  resetDb()
  _resetClientStoreForTests()
  _resetTokenStoresForTests()
  _resetKeyPairForTests()
})

async function tokenFor(clientId: string) {
  const config = getOAuthConfig()
  const issued = await issueTokens(
    {
      userId: makeUser().id,
      clientId,
      scope: 'whiteboard',
      resource: config.mcpResourceUri,
    },
    config,
  )
  return issued.refreshToken
}

describe('/revoke', () => {
  it('revokes the refresh token of a DCR-registered client', async () => {
    const dcr = registerClient({ redirectUris: ['http://127.0.0.1:19999/cb'] })
    const token = await tokenFor(dcr.clientId)
    expect(getRefreshTokenClientId(token)).toBe(dcr.clientId)

    const res = await handleRevokePost(
      post({ token, client_id: dcr.clientId }),
    )
    expect(res.status).toBe(200)
    expect(getRefreshTokenClientId(token)).toBeNull()
  })

  it('revokes the refresh token of a CIMD (https URL) client without resolving it', async () => {
    const cimd = 'https://claude.ai/oauth/client.json'
    const token = await tokenFor(cimd)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const res = await handleRevokePost(post({ token, client_id: cimd }))
    expect(res.status).toBe(200)
    expect(getRefreshTokenClientId(token)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("does not revoke another client's token, but still answers 200", async () => {
    const owner = registerClient({ redirectUris: ['http://127.0.0.1:19999/cb'] })
    const other = registerClient({ redirectUris: ['http://127.0.0.1:19998/cb'] })
    const token = await tokenFor(owner.clientId)

    const res = await handleRevokePost(
      post({ token, client_id: other.clientId }),
    )
    expect(res.status).toBe(200)
    expect(getRefreshTokenClientId(token)).toBe(owner.clientId)
  })

  it('answers 200 for an unknown token', async () => {
    const res = await handleRevokePost(
      post({ token: 'unknown', client_id: 'whatever' }),
    )
    expect(res.status).toBe(200)
  })
})
