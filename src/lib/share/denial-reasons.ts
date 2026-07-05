// src/lib/share/denial-reasons.ts
// Shared whiteboard-share-link denial reasons and user-facing messages.
// Client-safe (no server-only imports) — used by both the server-side
// src/routes/api/share.ts (getSharedWhiteboard responses) and the
// client-side src/components/project/ShareLinkInvalid.tsx, so the two never
// drift out of sync. Mirrors src/lib/invite/denial-reasons.ts, minus
// EXHAUSTED (share links have no use-count concept).

export type ShareDenialReason = 'INVALID' | 'REVOKED' | 'EXPIRED'

export const SHARE_DENIAL_MESSAGES: Record<ShareDenialReason, string> = {
  INVALID: 'This shared link is invalid.',
  REVOKED: 'This shared link has been revoked.',
  EXPIRED: 'This shared link has expired.',
}
