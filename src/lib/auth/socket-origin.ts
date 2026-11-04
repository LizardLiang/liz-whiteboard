// src/lib/auth/socket-origin.ts
// Origin policy for Socket.IO handshakes (cross-site WebSocket hijacking).
//
// A session cookie is sent on any same-SITE request, including one from a
// page on another port or subdomain, so the cookie alone does not prove the
// handshake came from our own pages. The Origin header does.
//
// Rules (see isHandshakeAllowed):
//  - Origin present: must be an allowed origin, whatever the auth method.
//  - Origin absent (non-browser client): allowed here; the cookie auth path
//    in socket-handshake.ts additionally refuses a cookie handshake with no
//    Origin unless the browser marked it same-origin via Sec-Fetch-Site.
//    Bearer-JWT clients (the MCP service) send no Origin and no cookie.
//
// Allowed origins: the origins of APP_BASE_URL and CLIENT_URL (CLIENT_URL may
// be a comma-separated list); plus, when neither is set in production, an
// Origin whose host equals the request Host / X-Forwarded-Host. Outside
// production, loopback and private-LAN hosts on any port are also allowed so
// LAN development keeps working.

export interface HandshakeRequestLike {
  headers: Record<string, string | Array<string> | undefined>
}

function first(v: string | Array<string> | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function originOf(value: string): string | null {
  try {
    const u = new URL(value.trim())
    return u.origin === 'null' ? null : u.origin
  } catch {
    return null
  }
}

export function configuredOrigins(env: NodeJS.ProcessEnv = process.env): Array<string> {
  const out = new Set<string>()
  for (const raw of [env.APP_BASE_URL, ...(env.CLIENT_URL ?? '').split(',')]) {
    if (!raw) continue
    const o = originOf(raw)
    if (o) out.add(o)
  }
  return [...out]
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost')) return true
  if (h.endsWith('.local') || h.endsWith('.lan')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** True when `origin` (an Origin header value) is allowed to open a handshake. */
export function isOriginAllowed(
  origin: string,
  req: HandshakeRequestLike,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const o = originOf(origin)
  if (!o) return false
  const configured = configuredOrigins(env)
  if (configured.includes(o)) return true

  const url = new URL(o)
  if (env.NODE_ENV !== 'production') {
    return isPrivateHost(url.hostname)
  }
  if (configured.length === 0) {
    const host = first(req.headers['x-forwarded-host']) ?? first(req.headers.host)
    return !!host && host.toLowerCase() === url.host.toLowerCase()
  }
  return false
}

/**
 * Socket.IO `allowRequest` decision. A missing Origin is allowed here (see the
 * header comment); a present Origin must be allowed.
 */
export function isHandshakeAllowed(
  req: HandshakeRequestLike,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const origin = first(req.headers.origin)
  if (origin === undefined) return true
  return isOriginAllowed(origin, req, env)
}

/**
 * Cookie-authenticated handshakes need positive proof they came from our own
 * pages: an allowed Origin, or (when the browser omitted Origin on a
 * same-origin request) Sec-Fetch-Site same-origin/none. Called by the cookie
 * path in socket-handshake.ts, which is the only place that knows the
 * handshake authenticates by cookie rather than by auth.token.
 */
export function cookieHandshakeOriginOk(
  headers: Record<string, string | Array<string> | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const origin = first(headers.origin)
  if (origin !== undefined) return isOriginAllowed(origin, { headers }, env)
  const site = first(headers['sec-fetch-site'])
  return site === 'same-origin' || site === 'none'
}
