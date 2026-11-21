// Security response headers for the production server (audit M10).
// Applied to every response, static and SSR, by server.prod.ts.

const TURNSTILE = 'https://challenges.cloudflare.com'

/** Request header that carries the per-request CSP nonce to the SSR handler. */
export const CSP_NONCE_HEADER = 'x-csp-nonce'

interface HeaderStampTarget {
  headers: Record<string, string | Array<string> | undefined>
  rawHeaders: Array<string>
}

/**
 * Set the nonce request header, replacing any value the client sent, in both
 * `headers` and `rawHeaders` (the web Request is built from `rawHeaders`).
 */
export function stampCspNonce(req: HeaderStampTarget, nonce: string): void {
  req.headers[CSP_NONCE_HEADER] = nonce
  for (let i = req.rawHeaders.length - 2; i >= 0; i -= 2) {
    if (req.rawHeaders[i].toLowerCase() === CSP_NONCE_HEADER) {
      req.rawHeaders.splice(i, 2)
    }
  }
  req.rawHeaders.push(CSP_NONCE_HEADER, nonce)
}

/** A fresh, unguessable per-request nonce (server side only). */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64')
}

/** ws/wss origin that matches APP_BASE_URL, or null when it is unset/invalid. */
function websocketOrigin(baseUrl: string | undefined): string | null {
  if (!baseUrl?.trim()) return null
  try {
    const url = new URL(baseUrl.trim())
    if (url.protocol === 'https:') return `wss://${url.host}`
    if (url.protocol === 'http:') return `ws://${url.host}`
  } catch {
    return null
  }
  return null
}

/**
 * Content-Security-Policy.
 *
 * script-src carries a per-request nonce instead of 'unsafe-inline': TanStack
 * Start stamps the nonce on every inline <script> it streams (router
 * `ssr.nonce`). The nonce is generated per request by server.prod.ts.
 * connect-src names the websocket origin from APP_BASE_URL instead of the
 * blanket `ws: wss:`.
 * style-src 'unsafe-inline': Tailwind/React Flow set inline style attributes.
 * form-action 'self' is safe: the OAuth consent page leaves through
 * window.location.assign(), not a form post, so redirects to registered
 * client redirect_uris are not subject to form-action.
 */
export function buildContentSecurityPolicy(
  nonce: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const ws = websocketOrigin(env.APP_BASE_URL)
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${TURNSTILE}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${ws ? `${ws} ` : ''}${TURNSTILE}`,
    `frame-src ${TURNSTILE}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export function buildSecurityHeaders(
  env: Record<string, string | undefined> = process.env,
  nonce: string = generateCspNonce(),
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': buildContentSecurityPolicy(nonce, env),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  }
  if (env.APP_BASE_URL?.trim().toLowerCase().startsWith('https://')) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  }
  return headers
}

/** Default cap on a request body, in bytes (10 MB). */
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024

export function maxBodyBytes(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env.MAX_REQUEST_BODY_BYTES)
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_BODY_BYTES
}

export type BodyVerdict = 'ok' | 'too-large' | 'length-required'

/**
 * Decide whether a request body may be read. A declared Content-Length over
 * the cap is refused (413). A body of unknown length (chunked, no
 * Content-Length) cannot be bounded before it is read, so it is refused
 * (411) — every client of this app sends a Content-Length.
 */
export function checkBodyLimit(
  method: string,
  headers: Record<string, string | Array<string> | undefined>,
  limit: number,
): BodyVerdict {
  const contentLength = headers['content-length']
  if (typeof contentLength === 'string') {
    const n = Number(contentLength)
    if (!Number.isFinite(n) || n < 0) return 'length-required'
    return n > limit ? 'too-large' : 'ok'
  }
  if (headers['transfer-encoding'] && method !== 'GET' && method !== 'HEAD') {
    return 'length-required'
  }
  return 'ok'
}
