// src/lib/oauth/jwt-leeway.ts
// Clock leeway for verifying the JWTs this server signs (collab and render
// tokens).
//
// The dev host's WSL2 kernel clock was measured stepping +14.7 s for about
// 200 ms every 5 s. A token minted inside a step carries an `nbf` up to 15 s
// ahead of the clock that checks it after the step. RFC 7519 §4.1.4 (exp) and
// §4.1.5 (nbf) allow "some small leeway, usually no more than a few minutes".
// The MCP server uses the same pair (liz-whiteboard-mcp commit 730d333).

import { errors, jwtVerify } from 'jose'
import type { JWTVerifyOptions, JWTVerifyResult, KeyObject } from 'jose'

/** How far in the future `nbf` may be and still be accepted. */
export const JWT_NOT_BEFORE_LEEWAY_SECONDS = 30
/** How far in the past `exp` may be and still be accepted. */
export const JWT_EXPIRY_LEEWAY_SECONDS = 5

/**
 * `jwtVerify` with the leeway pair above. jose's `clockTolerance` applies one
 * value to both `nbf` and `exp`, so it gets the `nbf` leeway and `exp` is
 * checked again here with the smaller expiry leeway.
 */
export async function jwtVerifyWithLeeway(
  token: string,
  key: CryptoKey | KeyObject,
  options: Omit<JWTVerifyOptions, 'clockTolerance' | 'currentDate'>,
): Promise<JWTVerifyResult> {
  const currentDate = new Date()
  const result = await jwtVerify(token, key, {
    ...options,
    clockTolerance: JWT_NOT_BEFORE_LEEWAY_SECONDS,
    currentDate,
  })
  const { exp } = result.payload
  const now = Math.floor(currentDate.getTime() / 1000)
  if (exp !== undefined && exp <= now - JWT_EXPIRY_LEEWAY_SECONDS) {
    throw new errors.JWTExpired(
      '"exp" claim timestamp check failed',
      result.payload,
      'exp',
      'check_failed',
    )
  }
  return result
}
