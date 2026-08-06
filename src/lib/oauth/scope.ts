// src/lib/oauth/scope.ts
// Shared space-delimited OAuth scope string parsing (RFC 6749 §3.3). S8 fix:
// `scope.split(' ').filter(Boolean)` was duplicated across grants.ts,
// connections-handlers.ts, consent-handlers.ts, and authorize.ts.

/**
 * Parse a space-delimited scope string into its individual scope tokens,
 * dropping empty segments produced by leading/trailing/repeated spaces.
 * Returns an empty array for an empty/whitespace-only string.
 */
export function parseScopeString(scope: string): Array<string> {
  return scope.split(' ').filter(Boolean)
}
