// src/lib/invite/denial-reasons.ts
// Shared invite-redemption/preview denial reasons and user-facing messages.
// Client-safe (no server-only imports) — used by both the server-side
// src/routes/api/invites.ts (redeemInvite/getInvitePreview responses) and the
// client-side src/components/project/InviteInvalid.tsx, so the two never
// drift out of sync.

export type InviteDenialReason = 'INVALID' | 'REVOKED' | 'EXPIRED' | 'EXHAUSTED'

export const INVITE_DENIAL_MESSAGES: Record<InviteDenialReason, string> = {
  INVALID: 'This invite link is invalid.',
  REVOKED: 'This invite link has been revoked.',
  EXPIRED: 'This invite link has expired.',
  EXHAUSTED: 'This invite link has already been used.',
}
