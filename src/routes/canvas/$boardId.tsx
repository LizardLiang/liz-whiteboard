// src/routes/canvas/$boardId.tsx
// The canvas board route (tactical plan Wave 3, step 12).
//
// A canvas board is its OWN board kind on its OWN route — plan decision
// C2/G3: the separate route is the gate, so there is no feature flag and no
// way for this surface to affect `/whiteboard/$whiteboardId`.
//
// Authorisation is the existing project-role machinery. The server refuses
// the read below VIEWER (`getCanvasBoardPage`), and the role it returns gates
// the write affordances here. Wave 4's mutations re-check server side; a role
// that has crossed the wire is client-controlled and is never the boundary.

import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CanvasBoard } from '@/components/canvas/CanvasBoard'
import { CanvasShareDialog } from '@/components/canvas/CanvasShareDialog'
import { getCanvasBoardPage } from '@/lib/canvas-board/server-functions'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { getSessionUserId } from '@/lib/session-user-id'
import { classifyQueryFailure, isUnauthorizedError } from '@/lib/auth/errors'

export const Route = createFileRoute('/canvas/$boardId')({
  component: CanvasBoardPage,
})

function CenteredMessage({
  title,
  detail,
  withHomeLink = false,
}: {
  title: string
  detail?: string
  withHomeLink?: boolean
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
      <p className="text-lg font-semibold">{title}</p>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      {withHomeLink && (
        <Link
          to="/"
          className="text-sm text-primary underline underline-offset-4"
        >
          Back to dashboard
        </Link>
      )}
    </div>
  )
}

function CanvasBoardPage() {
  const { boardId } = Route.useParams()

  // The authenticated user's DB id, so the server's `createdBy` on broadcasts
  // matches this client. getSessionUserId() is only a fallback for a render
  // before the route context has a user — it is a random per-tab value and
  // would never match a server row.
  const { user } = Route.useRouteContext()
  const userId = user?.id ?? getSessionUserId()

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['canvas-board', boardId],
    queryFn: () => getCanvasBoardPage({ data: boardId }),
  })

  if (isLoading) {
    return <CenteredMessage title="Loading board..." />
  }

  // A rejected query is not automatically a permissions denial — it can be a
  // network failure or a 500. Only a real ForbiddenError renders as
  // access-denied, so other failures are not mislabelled.
  if (isError) {
    if (classifyQueryFailure({ error }) === 'forbidden') {
      return (
        <CenteredMessage
          title="You do not have access to this board"
          detail="Ask a project admin for access, then reload."
          withHomeLink
        />
      )
    }
    return (
      <CenteredMessage
        title="Failed to load board"
        detail="Something went wrong loading this canvas board. Please try again."
        withHomeLink
      />
    )
  }

  // The session expired between page load and this fetch. `requireAuth`
  // returns the auth error as the resolved value, so the QueryClient's global
  // onSuccess handler has already opened the session-expired modal; this is
  // the render-side guard so we do not read `.board` off an error payload.
  if (isUnauthorizedError(data)) {
    return (
      <CenteredMessage
        title="Your session expired"
        detail="Please sign in again."
      />
    )
  }

  if (!data) {
    return (
      <CenteredMessage
        title="Board not found"
        detail="This canvas board does not exist or you don't have access to it."
        withHomeLink
      />
    )
  }

  const canEdit = hasMinimumRole(data.viewerRole, 'EDITOR')
  // Creating and revoking share links is ADMIN+, matching the whiteboard
  // share handlers. Hiding the control below that role is an affordance
  // only — every one of those handlers re-checks the role server side.
  const canShare = hasMinimumRole(data.viewerRole, 'ADMIN')

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-xl font-semibold">{data.board.name}</h1>
        <div className="flex items-center gap-2">
          {!canEdit && (
            <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Read-only
            </span>
          )}
          {canShare && <CanvasShareDialog boardId={boardId} />}
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <CanvasBoard
          // A different boardId is a different canvas, not a prop update:
          // remounting resets the scene and camera rather than letting the
          // previous board's local state leak across a client-side
          // navigation. Same reasoning as the ER route's `key`.
          key={boardId}
          boardId={boardId}
          userId={userId}
          initialElements={data.elements}
          readOnly={!canEdit}
        />
      </div>
    </div>
  )
}
