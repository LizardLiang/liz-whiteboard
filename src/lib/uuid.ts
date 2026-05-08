/**
 * Generate a UUID v4 string.
 *
 * Uses `crypto.randomUUID()` when available (secure contexts), and falls back
 * to a `crypto.getRandomValues()`-based implementation for non-HTTPS dev
 * environments (e.g. accessing the dev server over LAN via IP).
 */
export function uuid(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }

  // Fallback: build UUID v4 from getRandomValues (works in all contexts)
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Set version (4) and variant (10xx) bits per RFC 4122
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
