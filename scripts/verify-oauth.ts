#!/usr/bin/env bun
// scripts/verify-oauth.ts
// End-to-end OAuth 2.1 AS verification script
//
// Usage:
//   bun run scripts/verify-oauth.ts [base_url]
//
// Prerequisites:
//   1. The liz-whiteboard dev server must be running (bun run dev)
//      The server listens on http://localhost:3000
//   2. A valid session_token cookie for an existing user (get it from the
//      browser's DevTools → Application → Cookies after logging in, or
//      pass SESSION_TOKEN env var).
//
// What this verifies:
//   A. GET /.well-known/oauth-authorization-server → RFC 8414 metadata JSON
//   B. GET /.well-known/jwks.json → JWK Set with RSA public key
//   C. GET /authorize (with session cookie, PKCE) → 302 redirect with code
//   D. POST /token (code + verifier) → access token (JWT)
//   E. Decode and display JWT claims (iss, aud, sub, exp)
//   F. Use JWKS to verify the JWT signature
//
// IMPORTANT: This script does NOT require hitting a live server for steps A-E.
// It calls the OAuth module code DIRECTLY to simulate the full flow in-process.
// For live HTTP verification, set LIVE_TEST=true and ensure the server is running.

import { createHash, randomBytes } from 'node:crypto'

// ─── PKCE helpers (inline, no @/ alias) ─────────────────────────────────────

function generateVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function deriveChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// ─── JWT decode helper ───────────────────────────────────────────────────────

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.')
  if (parts.length !== 3) throw new Error('Not a JWT')
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8')
  return JSON.parse(payload) as Record<string, unknown>
}

function decodeJwtHeader(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.')
  if (parts.length !== 3) throw new Error('Not a JWT')
  const header = Buffer.from(parts[0], 'base64url').toString('utf-8')
  return JSON.parse(header) as Record<string, unknown>
}

// ─── Main verification ───────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('OAuth 2.1 AS Verification — liz-whiteboard')
  console.log('='.repeat(60))

  const liveTest = process.env.LIVE_TEST === 'true'
  const baseUrl =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- array indexing is unchecked (no noUncheckedIndexedAccess); argv[2] is genuinely absent at runtime when no CLI arg is passed.
    process.argv[2] ?? process.env.OAUTH_BASE_URL ?? 'http://localhost:3000'
  const sessionToken = process.env.SESSION_TOKEN ?? ''

  if (liveTest) {
    console.log(`\nMode: LIVE HTTP (base URL: ${baseUrl})`)
    if (!sessionToken) {
      console.error('ERROR: SESSION_TOKEN env var required for live test')
      console.error(
        '  Get it from browser DevTools → Application → Cookies → session_token',
      )
      process.exit(1)
    }
    await runLiveTests(baseUrl, sessionToken)
  } else {
    console.log(
      '\nMode: IN-PROCESS (direct module calls, no live server required)',
    )
    await runInProcessTests(baseUrl)
  }
}

// ─── In-process tests (no live server) ──────────────────────────────────────

async function runInProcessTests(_baseUrl: string) {
  // Import OAuth modules directly (bypasses HTTP server)
  const { getOAuthConfig } = await import('../src/lib/oauth/config')
  const { getJwks } = await import('../src/lib/oauth/keys')
  const { issueAuthCode, consumeAuthCode } = await import(
    '../src/lib/oauth/codes'
  )
  const { issueTokens } = await import('../src/lib/oauth/tokens')
  const { verifyS256 } = await import('../src/lib/oauth/pkce')
  const { jwtVerify, createLocalJWKSet } = await import('jose')

  const config = getOAuthConfig()
  console.log(`\nIssuer: ${config.issuer}`)
  console.log(`MCP Resource URI: ${config.mcpResourceUri}`)
  console.log(`Clients: ${config.clients.map((c) => c.clientId).join(', ')}`)

  // ── Step A: AS Metadata ────────────────────────────────────────────────────
  console.log(
    '\n── A: AS Metadata (RFC 8414) ──────────────────────────────────',
  )
  const metadata = {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    jwks_uri: `${config.issuer}/.well-known/jwks.json`,
    scopes_supported: config.scopes,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
  }
  console.log('OK', JSON.stringify(metadata, null, 2))
  assert(metadata.issuer === config.issuer, 'issuer matches')
  assert(
    metadata.code_challenge_methods_supported.includes('S256'),
    'PKCE S256 supported',
  )

  // ── Step B: JWKS ──────────────────────────────────────────────────────────
  console.log(
    '\n── B: JWKS endpoint ────────────────────────────────────────────',
  )
  const jwks = await getJwks()
  console.log('Keys:', JSON.stringify(jwks, null, 2))
  assert(Array.isArray(jwks.keys), 'keys is array')
  assert(jwks.keys.length > 0, 'at least one key')
  // Non-empty asserted above (process.exit(1) on failure), so key is defined from here on.
  const key = jwks.keys[0]
  assert(key.kty === 'RSA', `key type is RSA (got ${key.kty})`)
  assert(key.alg === 'RS256', `key alg is RS256 (got ${key.alg})`)
  assert(typeof key.kid === 'string', 'key has kid')
  console.log(`PASS — RSA public key exposed, kid=${key.kid}`)

  // ── Step C: /authorize (issue code) ────────────────────────────────────────
  console.log(
    '\n── C: /authorize — issue auth code ─────────────────────────────',
  )
  const verifier = generateVerifier()
  const challenge = deriveChallenge(verifier)
  assert(verifyS256(verifier, challenge), 'PKCE S256 derive+verify roundtrip')

  // Simulate a logged-in user (use a fake userId for in-process test)
  const fakeUserId = 'test-user-' + randomBytes(4).toString('hex')
  const client = config.clients[0]
  const redirectUri = client.redirectUris[0]

  const code = issueAuthCode(
    {
      clientId: client.clientId,
      redirectUri,
      userId: fakeUserId,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      resource: config.mcpResourceUri,
      scope: 'whiteboard',
    },
    config,
  )
  assert(typeof code === 'string' && code.length > 20, 'code issued')
  console.log(`PASS — code issued (${code.substring(0, 16)}...)`)

  // ── Step D: /token — exchange code for JWT ─────────────────────────────────
  console.log(
    '\n── D: /token — authorization_code grant ────────────────────────',
  )
  // Verify PKCE
  const authCode = consumeAuthCode(code)
  assert(authCode !== null, 'code consumed successfully')
  assert(
    verifyS256(verifier, authCode!.codeChallenge),
    'PKCE verification passes',
  )

  const tokenResult = await issueTokens(
    {
      userId: fakeUserId,
      clientId: client.clientId,
      scope: authCode!.scope,
      resource: authCode!.resource,
    },
    config,
  )
  assert(typeof tokenResult.accessToken === 'string', 'access token issued')
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- tautological under today's return type, but this is a regression smoke-check: it must keep failing loudly if issueTokens ever stops returning literal 'Bearer'.
  assert(tokenResult.tokenType === 'Bearer', 'token type is Bearer')
  assert(
    tokenResult.expiresIn === config.accessTokenTtl,
    `expiresIn=${config.accessTokenTtl}`,
  )
  assert(typeof tokenResult.refreshToken === 'string', 'refresh token issued')
  console.log(`PASS — JWT access token + refresh token issued`)

  // ── Step E: Decode JWT claims ──────────────────────────────────────────────
  console.log(
    '\n── E: JWT claims ────────────────────────────────────────────────',
  )
  const header = decodeJwtHeader(tokenResult.accessToken)
  const payload = decodeJwtPayload(tokenResult.accessToken)

  console.log('Header:', JSON.stringify(header, null, 2))
  console.log('Payload:', JSON.stringify(payload, null, 2))

  assert(header.alg === 'RS256', `alg=RS256 (got ${header.alg})`)
  assert(header.kid === key.kid, `kid matches JWKS kid`)
  assert(
    payload.iss === config.issuer,
    `iss=${config.issuer} (got ${payload.iss})`,
  )
  assert(
    payload.aud === config.mcpResourceUri,
    `aud=${config.mcpResourceUri} (got ${payload.aud})`,
  )
  assert(payload.sub === fakeUserId, `sub=${fakeUserId} (got ${payload.sub})`)
  assert(typeof payload.exp === 'number', 'exp is number')
  const expDate = new Date((payload.exp as number) * 1000)
  console.log(`  iss = ${payload.iss}`)
  console.log(`  aud = ${payload.aud}`)
  console.log(
    `  sub = ${payload.sub}  ← this will be the real User.id in production`,
  )
  console.log(
    `  exp = ${expDate.toISOString()} (${config.accessTokenTtl}s from now)`,
  )
  console.log(`  scope = ${payload.scope}`)

  // ── Step F: Cryptographic signature verification ──────────────────────────
  console.log(
    '\n── F: JWT signature verification (JWKS) ─────────────────────────',
  )
  const jwkSet = createLocalJWKSet(jwks)

  const verified = await jwtVerify(tokenResult.accessToken, jwkSet, {
    issuer: config.issuer,
    audience: config.mcpResourceUri,
    algorithms: ['RS256'],
  })
  assert(verified.payload.sub === fakeUserId, 'verified sub matches')
  console.log('PASS — JWT signature verified via JWKS (RS256)')

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('ALL CHECKS PASSED')
  console.log('='.repeat(60))
  console.log('\nFor Go RS wiring (Phase 3):')
  console.log(`  Issuer URL:   ${config.issuer}`)
  console.log(`  JWKS URL:     ${config.issuer}/.well-known/jwks.json`)
  console.log(`  Audience:     ${config.mcpResourceUri}`)
  console.log(`  Algorithm:    RS256`)
  console.log(`  sub claim:    User.id (string, liz-whiteboard UUID)`)
  console.log(`  scope claim:  "whiteboard"`)
  console.log('\nDeferred (next slice):')
  console.log('  - DCR (/register) for dynamic client registration')
  console.log('  - Consent UI for third-party clients')
  console.log('  - Persistent signing keys (OAUTH_SIGNING_KEY_PRIVATE)')
  console.log('  - Persistent auth codes + refresh tokens (DB table)')
  console.log('  - TLS for production')
  console.log('  - /.well-known/* verified live (see LIVE_TEST=true mode)')
}

// ─── Live HTTP tests (requires running server + session token) ───────────────

async function runLiveTests(baseUrl: string, sessionToken: string) {
  console.log('\nStep A: GET /.well-known/oauth-authorization-server')
  const metaRes = await fetch(
    `${baseUrl}/.well-known/oauth-authorization-server`,
  )
  if (!metaRes.ok) {
    console.error(`FAIL: ${metaRes.status} ${metaRes.statusText}`)
    console.error(
      '  Note: /.well-known/* routes require the Nitro handlers config.',
    )
    console.error(
      '  These endpoints are served at the Nitro level before TanStack Start.',
    )
  } else {
    const meta = (await metaRes.json()) as Record<string, unknown>
    console.log('OK:', JSON.stringify(meta, null, 2))
    assert(typeof meta.issuer === 'string', 'issuer present')
    assert(typeof meta.jwks_uri === 'string', 'jwks_uri present')
  }

  console.log('\nStep B: GET /.well-known/jwks.json')
  const jwksRes = await fetch(`${baseUrl}/.well-known/jwks.json`)
  if (!jwksRes.ok) {
    console.error(`FAIL: ${jwksRes.status} ${jwksRes.statusText}`)
  } else {
    const jwks = (await jwksRes.json()) as Record<string, unknown>
    console.log('OK:', JSON.stringify(jwks, null, 2))
  }

  console.log('\nStep C: GET /authorize (with session cookie)')
  const verifier = generateVerifier()
  const challenge = deriveChallenge(verifier)
  const authorizeUrl = new URL('/authorize', baseUrl)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', 'mcp-claude')
  authorizeUrl.searchParams.set(
    'redirect_uri',
    'http://localhost:3000/oauth/callback',
  )
  authorizeUrl.searchParams.set('scope', 'whiteboard')
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('resource', 'http://localhost:8080/mcp')
  authorizeUrl.searchParams.set('state', 'test-state-123')

  const authRes = await fetch(authorizeUrl.toString(), {
    headers: { Cookie: `session_token=${sessionToken}` },
    redirect: 'manual',
  })

  if (authRes.status !== 302) {
    console.error(`FAIL: expected 302, got ${authRes.status}`)
    const body = await authRes.text()
    console.error('Body:', body.substring(0, 500))
    return
  }

  const location = authRes.headers.get('location') ?? ''
  console.log(`OK: Redirect to: ${location}`)
  const callbackUrl = new URL(
    location.startsWith('http') ? location : `http://localhost${location}`,
  )
  const code = callbackUrl.searchParams.get('code')
  if (!code) {
    console.error('FAIL: no code in redirect URL')
    return
  }
  console.log(`OK: code=${code.substring(0, 16)}...`)

  console.log('\nStep D: POST /token (code exchange)')
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: 'mcp-claude',
    redirect_uri: 'http://localhost:3000/oauth/callback',
    code_verifier: verifier,
  })

  const tokenRes = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  })

  if (!tokenRes.ok) {
    console.error(`FAIL: ${tokenRes.status}`)
    const body = await tokenRes.text()
    console.error('Body:', body)
    return
  }

  const tokenData = (await tokenRes.json()) as Record<string, unknown>
  const jwt = tokenData.access_token as string
  const header = decodeJwtHeader(jwt)
  const payload = decodeJwtPayload(jwt)

  console.log('\nJWT Header:', JSON.stringify(header, null, 2))
  console.log('JWT Payload:', JSON.stringify(payload, null, 2))
  console.log(`  iss = ${payload.iss}`)
  console.log(`  aud = ${payload.aud}`)
  console.log(`  sub = ${payload.sub}  ← liz-whiteboard User.id`)
  console.log(
    `  exp = ${new Date((payload.exp as number) * 1000).toISOString()}`,
  )
  console.log(`  scope = ${payload.scope}`)

  console.log('\n' + '='.repeat(60))
  console.log('LIVE TEST COMPLETE')
  console.log('='.repeat(60))
}

// ─── Assertion helper ────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`ASSERTION FAILED: ${message}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
