// @vitest-environment node
// src/lib/oauth/resource.test.ts
// M1: RFC 8707 resource allowlist + OAuth tokens never pass as collab tokens.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetKeyPairForTests } from './keys'
import { getOAuthConfig } from './config'
import { isAllowedResource } from './resource'
import { getRefreshTokenResource, issueTokens } from './tokens'
import { validateCollabToken } from './collab-verify'

vi.stubEnv('OAUTH_ISSUER', 'http://localhost:3000')
vi.stubEnv('MCP_RESOURCE_URI', 'http://localhost:3011/mcp')
vi.stubEnv('COLLAB_RESOURCE_URI', 'http://localhost:3010')

beforeEach(() => _resetKeyPairForTests())

describe('isAllowedResource', () => {
  const config = getOAuthConfig()

  it('accepts exactly the MCP resource URI', () => {
    expect(isAllowedResource(config.mcpResourceUri, config)).toBe(true)
  })

  it('rejects the collab resource URI', () => {
    expect(isAllowedResource(config.collabResourceUri, config)).toBe(false)
  })

  it('rejects near-misses (trailing slash, prefix, empty)', () => {
    expect(isAllowedResource(`${config.mcpResourceUri}/`, config)).toBe(false)
    expect(isAllowedResource('http://localhost:3011', config)).toBe(false)
    expect(isAllowedResource('', config)).toBe(false)
  })
})

describe('OAuth-flow tokens vs collab verifier', () => {
  it('rejects an OAuth access token even when its aud is the collab URI', async () => {
    const config = getOAuthConfig()
    const result = await issueTokens(
      {
        userId: 'u1',
        clientId: 'c1',
        scope: 'whiteboard',
        resource: config.collabResourceUri,
      },
      config,
    )
    await expect(validateCollabToken(result.accessToken)).rejects.toThrow()
    expect(getRefreshTokenResource(result.refreshToken)).toBe(
      config.collabResourceUri,
    )
  })

  it('returns null for an unknown refresh token', () => {
    expect(getRefreshTokenResource('nope')).toBeNull()
  })
})
