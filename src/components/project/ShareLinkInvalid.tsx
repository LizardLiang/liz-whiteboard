// src/components/project/ShareLinkInvalid.tsx
// Friendly invalid-share-link state for the /share/$token public landing
// page. Mirrors InviteInvalid.tsx's exact visual pattern (ShieldAlert icon,
// message, "Back to dashboard" link) with reason-specific copy.

import { Link } from '@tanstack/react-router'
import { ShieldAlert } from 'lucide-react'
import type { ShareDenialReason } from '@/lib/share/denial-reasons'
import { SHARE_DENIAL_MESSAGES } from '@/lib/share/denial-reasons'

interface ShareLinkInvalidProps {
  reason?: ShareDenialReason
}

export function ShareLinkInvalid({ reason }: ShareLinkInvalidProps) {
  const message = reason
    ? SHARE_DENIAL_MESSAGES[reason]
    : 'This shared link is no longer valid.'

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <ShieldAlert
        className="h-10 w-10 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-lg font-semibold">Shared link unavailable</p>
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
