// Security response headers for the production server (audit M10).
// Applied to every response, static and SSR, by server.prod.ts.

const TURNSTILE = 'https://challenges.cloudflare.com'

/**
 * Content-Security-Policy.
 *
 * script-src needs 'unsafe-inline': TanStack Start streams inline <script>
 * tags for SSR hydration/dehydration and the app ships an inline theme
 * bootstrap. Nonces would need router-level support for every streamed
 * script; until then, inline script is allowed while eval, remote origins
 * (other than Turnstile), objects and framing stay blocked.
 * style-src 'unsafe-inline': Tailwind/React Flow set inline style attributes.
 * form-action 'self' is safe: the OAuth consent page leaves through
 * window.location.assign(), not a form post, so redirects to registered
 * client redirect_uris are not subject to form-action.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ws: wss: ${TURNSTILE}`,
  `frame-src ${TURNSTILE}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export function buildSecurityHeaders(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
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
  headers: Record<string, string | string[] | undefined>,
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
