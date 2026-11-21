// src/lib/auth/reset-token.ts
// Forgot-password reset link lifetime. The token itself is generated and
// hashed with src/lib/auth/opaque-token.ts.

/** A reset link is valid for 30 minutes from issuance. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000
