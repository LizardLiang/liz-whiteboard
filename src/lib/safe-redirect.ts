// src/lib/safe-redirect.ts
// Guards against open-redirect payloads smuggled through a `redirect` search
// param (e.g. register.tsx/login.tsx, the invite-by-URL flow). Client-safe
// (no server-only imports) — usable in both route components and tests.

/**
 * Returns true only for a same-origin-relative path: must start with a
 * single '/' and must not be protocol-relative ("//host/...", which browsers
 * resolve against a different origin) or a backslash-prefixed variant
 * ("/\host/...", which some browsers normalize to "//host/...").
 */
export function isSafeRedirect(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  if (path.startsWith('/\\')) return false
  // Browsers strip tab/CR/LF and treat backslash as '/' when parsing URLs, so
  // "/\t/evil.com" resolves to "//evil.com". Reject any control character,
  // space, DEL or backslash anywhere in the path.
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i)
    if (c <= 0x20 || c === 0x7f || c === 0x5c) return false
  }
  // Final proof: the path must resolve to the same origin it is based on.
  try {
    if (new URL(path, 'http://x').origin !== 'http://x') return false
  } catch {
    return false
  }
  return true
}

/** Returns `path` if it's a safe same-origin-relative redirect, else `fallback` (default '/'). */
export function sanitizeRedirect(path: string, fallback = '/'): string {
  return isSafeRedirect(path) ? path : fallback
}
