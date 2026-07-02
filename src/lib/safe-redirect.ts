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
  return true
}

/** Returns `path` if it's a safe same-origin-relative redirect, else `fallback` (default '/'). */
export function sanitizeRedirect(path: string, fallback = '/'): string {
  return isSafeRedirect(path) ? path : fallback
}
