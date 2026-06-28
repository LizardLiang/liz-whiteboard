// src/lib/oauth/keys.ts
// RS256 signing key management for the OAuth Authorization Server
//
// KEY STORAGE DECISION (first increment):
//   Load from environment variables:
//     OAUTH_SIGNING_KEY_PRIVATE  — PEM-encoded PKCS#8 RSA private key
//     OAUTH_SIGNING_KEY_KID      — Key ID string (default: "as-key-1")
//   If OAUTH_SIGNING_KEY_PRIVATE is absent, generate an ephemeral 2048-bit
//   RSA keypair at module load time. Ephemeral keys are lost on restart;
//   all issued tokens become invalid. This is acceptable for local dev/testing.
//   Production: generate a persistent keypair (e.g., via `openssl genrsa`) and
//   set OAUTH_SIGNING_KEY_PRIVATE in the server environment.
//
// How to generate a persistent keypair:
//   openssl genrsa -out oauth-private.pem 2048
//   Then set:
//     OAUTH_SIGNING_KEY_PRIVATE="$(cat oauth-private.pem)"
//     OAUTH_SIGNING_KEY_KID="as-key-1"

import {
  generateKeyPair,
  importPKCS8,
  exportJWK,
  importJWK,
  type JWK,
} from 'jose'

export interface SigningKeyPair {
  kid: string
  privateKey: CryptoKey
  publicKey: CryptoKey
  publicJwk: JWK
}

let _keyPair: SigningKeyPair | null = null

/**
 * Load or generate the RS256 signing keypair.
 * Called once at startup; subsequent calls return the cached pair.
 */
export async function getSigningKeyPair(): Promise<SigningKeyPair> {
  if (_keyPair) return _keyPair

  const kid = process.env.OAUTH_SIGNING_KEY_KID ?? 'as-key-1'
  // Prefer an inline PEM (OAUTH_SIGNING_KEY_PRIVATE); otherwise read it from a
  // mounted file (OAUTH_SIGNING_KEY_FILE) — friendlier for Docker secrets and
  // multi-line PEMs that don't fit cleanly in an env var.
  let privatePem = process.env.OAUTH_SIGNING_KEY_PRIVATE
  if (!privatePem && process.env.OAUTH_SIGNING_KEY_FILE) {
    const { readFileSync } = await import('node:fs')
    privatePem = readFileSync(process.env.OAUTH_SIGNING_KEY_FILE, 'utf8')
  }

  if (privatePem) {
    // Load from environment (PKCS#8 PEM).
    // extractable: true is required so the public components can be exported
    // to a JWK for the /.well-known/jwks.json endpoint.
    const privateKey = (await importPKCS8(privatePem, 'RS256', { extractable: true })) as CryptoKey

    // Derive public key from private key via JWK round-trip
    const privateJwk = await exportJWK(privateKey)
    // Strip private components to get public-only JWK
    const { d, p, q, dp, dq, qi, ...publicJwkFields } = privateJwk
    // Suppress "declared but its value is never read" for extracted private fields
    void [d, p, q, dp, dq, qi]
    const publicJwk: JWK = { ...publicJwkFields, kid, use: 'sig', alg: 'RS256' }

    const publicKey = (await importJWK(publicJwk, 'RS256')) as CryptoKey

    _keyPair = { kid, privateKey, publicKey, publicJwk }
    console.log(`[oauth/keys] Loaded RS256 signing key from environment (kid=${kid})`)
  } else {
    // Generate ephemeral keypair
    console.warn(
      '[oauth/keys] OAUTH_SIGNING_KEY_PRIVATE not set — generating EPHEMERAL RS256 keypair. ' +
      'Tokens will be invalidated on server restart. Set OAUTH_SIGNING_KEY_PRIVATE for persistence.',
    )
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
      modulusLength: 2048,
    })

    const publicJwk = await exportJWK(publicKey)
    publicJwk.kid = kid
    publicJwk.use = 'sig'
    publicJwk.alg = 'RS256'

    _keyPair = {
      kid,
      privateKey: privateKey as CryptoKey,
      publicKey: publicKey as CryptoKey,
      publicJwk,
    }
    console.log(`[oauth/keys] Generated ephemeral RS256 keypair (kid=${kid})`)
  }

  return _keyPair
}

/**
 * Return the JWKS document (public key set) for the /.well-known/jwks.json endpoint.
 */
export async function getJwks(): Promise<{ keys: JWK[] }> {
  const pair = await getSigningKeyPair()
  return {
    keys: [pair.publicJwk],
  }
}

/** Reset cached keypair (for testing only) */
export function _resetKeyPairForTests(): void {
  _keyPair = null
}
