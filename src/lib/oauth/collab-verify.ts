// src/lib/oauth/collab-verify.ts
// Validates collab-audience JWTs issued by /api/collab-token.
//
// Since the collab server runs in the same process as the AS, we can verify
// the JWT directly using the AS signing key (via getSigningKeyPair()) rather
// than making an HTTP round-trip to the JWKS endpoint.
//
// Validated claims: RS256 algorithm, correct signature, iss == AS issuer,
// aud contains collabResourceUri, exp not in the past.

import { jwtVerify } from 'jose'
import { getSigningKeyPair } from './keys'

export interface CollabTokenPayload {
  /** User.id of the acting user */
  sub: string
  /** JWT expiration (Unix seconds) */
  exp: number
}

/**
 * Validate a collab-audience JWT.
 * Throws on any validation failure (invalid signature, wrong aud, expired, etc.).
 * Returns the verified payload on success.
 */
export async function validateCollabToken(token: string): Promise<CollabTokenPayload> {
  const issuer = process.env.OAUTH_ISSUER ?? 'http://localhost:3000'
  const collabResourceUri = process.env.COLLAB_RESOURCE_URI ?? 'http://localhost:3010'

  const { publicKey } = await getSigningKeyPair()

  const { payload } = await jwtVerify(token, publicKey, {
    issuer,
    audience: collabResourceUri,
    algorithms: ['RS256'],
  })

  const sub = payload.sub
  if (!sub || typeof sub !== 'string') {
    throw new Error('collab JWT missing or invalid sub claim')
  }

  const exp = payload.exp
  if (exp === undefined || typeof exp !== 'number') {
    throw new Error('collab JWT missing exp claim')
  }

  return { sub, exp }
}
