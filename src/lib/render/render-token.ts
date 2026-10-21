// src/lib/render/render-token.ts
// Short-lived bearer token that opens one board's headless render page.
//
// WHY A SEPARATE TOKEN:
//   The MCP server drives a headless browser to /render/<kind>/<token>. That
//   browser has no session cookie, and the collab JWT must not travel in a URL
//   or open a page. The render token is signed with the AS key but carries its
//   own audience ("render"), so:
//     - a collab JWT never verifies here (wrong aud), and
//     - a render token never opens a socket (collab verifier rejects its aud).
//   The token names one board and one user. It stores nothing: no DB row to
//   clean up and nothing to list or revoke. It expires in 60 seconds.

import { SignJWT, jwtVerify } from 'jose'
import { getSigningKeyPair } from '@/lib/oauth/keys'

export const RENDER_TOKEN_AUDIENCE = 'render'
export const RENDER_TOKEN_TTL_SECONDS = 60

export type RenderBoardKind = 'whiteboard' | 'canvas'

export interface RenderTokenClaims {
  /** User.id the page acts for. */
  sub: string
  kind: RenderBoardKind
  boardId: string
  /** Expiry, Unix seconds. */
  exp: number
}

function issuer(): string {
  return process.env.OAUTH_ISSUER ?? 'http://localhost:3000'
}

/** Sign a render token for one user and one board. */
export async function signRenderToken(input: {
  sub: string
  kind: RenderBoardKind
  boardId: string
}): Promise<{ token: string; expiresAt: number }> {
  const { kid, privateKey } = await getSigningKeyPair()
  const now = Math.floor(Date.now() / 1000)
  const exp = now + RENDER_TOKEN_TTL_SECONDS
  const token = await new SignJWT({ kind: input.kind, boardId: input.boardId })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(input.sub)
    .setIssuer(issuer())
    .setAudience(RENDER_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(exp)
    .sign(privateKey)
  return { token, expiresAt: exp }
}

/**
 * Verify a render token. Throws on a bad signature, wrong audience, wrong
 * issuer, expiry, or malformed claims.
 */
export async function verifyRenderToken(
  token: string,
): Promise<RenderTokenClaims> {
  const { publicKey } = await getSigningKeyPair()
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: issuer(),
    audience: RENDER_TOKEN_AUDIENCE,
    algorithms: ['RS256'],
  })

  const { sub, exp } = payload
  const { kind, boardId } = payload as { kind?: unknown; boardId?: unknown }
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('render token missing sub claim')
  }
  if (typeof exp !== 'number') {
    throw new Error('render token missing exp claim')
  }
  if (kind !== 'whiteboard' && kind !== 'canvas') {
    throw new Error('render token has an invalid kind claim')
  }
  if (typeof boardId !== 'string' || boardId.length === 0) {
    throw new Error('render token missing boardId claim')
  }
  return { sub, kind, boardId, exp }
}
