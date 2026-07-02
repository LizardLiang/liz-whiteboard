// src/components/project/InviteInvalid.tsx
// Friendly invalid-invite-link state for the /invite/$token landing page.
// Mirrors ProjectAccessDenied.tsx's exact visual pattern (ShieldAlert icon,
// message, "Back to dashboard" link) with reason-specific copy.

import { Link } from '@tanstack/react-router'
import { ShieldAlert } from 'lucide-react'
import type { InviteDenialReason } from '@/lib/invite/denial-reasons'
import { INVITE_DENIAL_MESSAGES } from '@/lib/invite/denial-reasons'

export type InviteInvalidReason = InviteDenialReason

interface InviteInvalidProps {
  reason?: InviteInvalidReason
}

export function InviteInvalid({ reason }: InviteInvalidProps) {
  const message = reason
    ? INVITE_DENIAL_MESSAGES[reason]
    : 'This invite link is no longer valid.'

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <ShieldAlert
        className="h-10 w-10 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-lg font-semibold">Invite link unavailable</p>
      <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
      <Link
        to="/"
        className="text-sm text-primary underline underline-offset-4"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
