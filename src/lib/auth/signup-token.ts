// src/lib/auth/signup-token.ts
// Email-link signup token lifetime. The token itself is generated and hashed
// with src/lib/auth/opaque-token.ts.

/** A signup link is valid for 24 hours from issuance. */
export const SIGNUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
