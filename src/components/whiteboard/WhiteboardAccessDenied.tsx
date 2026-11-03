// src/components/whiteboard/WhiteboardAccessDenied.tsx
// Shared "access denied" state for the whiteboard route. Used by both the
// outer route (src/routes/whiteboard/$whiteboardId.tsx) and the inner
// ReactFlowWhiteboard component, which fetches whiteboard data via its own
// separate query and previously fell back to a generic, non-actionable
// "Failed to load whiteboard" message on any denial.

import { Link } from '@tanstack/react-router'
import { useT } from '@/lib/i18n/use-t'

interface WhiteboardAccessDeniedProps {
  message?: string
}

export function WhiteboardAccessDenied({
  message,
}: WhiteboardAccessDeniedProps) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
      <p className="text-lg font-semibold">
        {t('whiteboard.accessDenied.title')}
      </p>
      <p className="text-sm text-muted-foreground max-w-sm">
        {message ?? t('whiteboard.accessDenied.default')}
      </p>
      <Link
        to="/"
        className="text-sm text-primary underline underline-offset-4"
      >
        {t('common.backToDashboard')}
      </Link>
    </div>
  )
}
