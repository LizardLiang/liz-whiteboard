// src/lib/auth/cookies.ts
// Cookie utilities for session management
//
// The `Secure` flag is added only when APP_BASE_URL is https:// (production
// behind TLS). Over plain-HTTP LAN dev it is omitted, because browsers drop
// Secure cookies on http:// origins.

import { validateSessionToken } from './session'
import type { AuthSession, AuthUser } from './session'

const COOKIE_NAME = 'session_token'

/** True when the configured public base URL is https (cookie gets `Secure`). */
export function isSecureCookieEnv(): boolean {
  return (process.env.APP_BASE_URL ?? '').trim().toLowerCase().startsWith('https://')
}

function secureAttr(): string {
  return isSecureCookieEnv() ? '; Secure' : ''
}

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
 * HttpOnly and SameSite=Lax are set. Secure is set only for an https APP_BASE_URL.
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
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureAttr()}`
}

/**
 * Build a Set-Cookie header value that clears the session cookie.
 *
 * @returns Set-Cookie header value string with Max-Age=0
 */
export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr()}`
}
