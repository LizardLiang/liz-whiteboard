// src/components/whiteboard/WhiteboardAccessDenied.tsx
// Shared "access denied" state for the whiteboard route. Used by both the
// outer route (src/routes/whiteboard/$whiteboardId.tsx) and the inner
// ReactFlowWhiteboard component, which fetches whiteboard data via its own
// separate query and previously fell back to a generic, non-actionable
// "Failed to load whiteboard" message on any denial.

import { Link } from '@tanstack/react-router'

interface WhiteboardAccessDeniedProps {
  message?: string
}

export function WhiteboardAccessDenied({
  message,
}: WhiteboardAccessDeniedProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
      <p className="text-lg font-semibold">Access denied</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        {message ?? "You don't have access to this whiteboard."}
      </p>
      <Link
        to="/"
        className="text-sm text-primary underline underline-offset-4"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
