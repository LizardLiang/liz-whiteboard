// @vitest-environment node
// src/lib/oauth/handlers/as-metadata.test.ts
// Unit tests for the registration_endpoint / isDcrEnabled() pairing
// (mcp-oauth-dcr-consent): the AS metadata document must advertise
// registration_endpoint exactly when DCR itself is enabled, and omit it
// otherwise — the two must never drift apart.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAsMetadata } from './as-metadata'

const TEST_ISSUER = 'http://localhost:3000'
vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)
})

describe('registration_endpoint / DCR flag pairing', () => {
  it('advertises registration_endpoint when OAUTH_ALLOW_DCR is unset (on by default)', async () => {
    vi.stubEnv('OAUTH_ALLOW_DCR', '')
    const metadata = await buildAsMetadata()
    expect(metadata.registration_endpoint).toBe(
      `${TEST_ISSUER}/oauth/register`,
    )
  })

  it('omits registration_endpoint when OAUTH_ALLOW_DCR=false', async () => {
    vi.stubEnv('OAUTH_ALLOW_DCR', 'false')
    const metadata = await buildAsMetadata()
    expect(metadata.registration_endpoint).toBeUndefined()
  })

  it('always advertises client_id_metadata_document_supported (CIMD, unaffected by the DCR flag)', async () => {
    vi.stubEnv('OAUTH_ALLOW_DCR', 'false')
    const metadata = await buildAsMetadata()
    expect(metadata.client_id_metadata_document_supported).toBe(true)
  })
})
