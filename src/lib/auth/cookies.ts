// src/lib/auth/cookies.ts
// Cookie utilities for session management
//
// NOTE: The `Secure` flag is intentionally absent.
// The developer accesses the app over HTTP on a LAN. Adding the Secure flag
// would prevent cookies from being sent over HTTP.

import { validateSessionToken } from './session'
import type { AuthUser, AuthSession } from './session'

const COOKIE_NAME = 'session_token'

/**
 * Parse the session token from a Cookie header string.
 *
 * @param cookieHeader - Value of the Cookie request header (or null)
 * @returns Raw session token string, or null if not present
 */
export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
  if (!match) return null
  return match.slice(COOKIE_NAME.length + 1)
}

/**
 * Extract and validate the session from a Request object's Cookie header.
 *
 * @param request - Web API Request object
 * @returns { user, session } or null
 */
export async function getSessionFromCookie(
  request: Request,
): Promise<{ user: AuthUser; session: AuthSession } | null> {
  const cookieHeader = request.headers.get('cookie')
  const token = parseSessionCookie(cookieHeader)
  if (!token) return null
  return validateSessionToken(token)
}

/**
 * Build a Set-Cookie header value for the session token.
 * HttpOnly and SameSite=Lax are set. Secure flag is NOT set (LAN HTTP).
 *
 * @param token - Raw session token
 * @param rememberMe - true = 30-day Max-Age; false = 24-hour Max-Age
 * @returns Set-Cookie header value string
 */
export function buildSetCookieHeader(
  token: string,
  rememberMe: boolean,
): string {
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

/**
 * Build a Set-Cookie header value that clears the session cookie.
 *
 * @returns Set-Cookie header value string with Max-Age=0
 */
export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}
