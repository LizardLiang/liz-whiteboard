// src/lib/email/base-url.ts
// The one resolver for the absolute base URL that email links carry (signup,
// invite and password-reset emails).

/**
 * APP_BASE_URL without a trailing slash. Outside production, the request origin
 * keeps the flow usable on a dev server. In production, an unset APP_BASE_URL
 * returns null and the caller sends no email.
 */
export function resolveBaseUrl(requestOrigin: string | null): string | null {
  const configured = process.env.APP_BASE_URL
  if (configured) return configured.replace(/\/$/, '')
  if (process.env.NODE_ENV !== 'production' && requestOrigin) {
    return requestOrigin.replace(/\/$/, '')
  }
  return null
}
