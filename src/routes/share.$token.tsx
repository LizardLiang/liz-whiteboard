// src/routes/share.$token.tsx
// Public, no-auth read-only whiteboard share page (GH #109). Mirrors
// src/routes/invite.$token.tsx's shape: a public route that resolves a
// bearer token via an unauthenticated server fn and renders an
// invalid/expired state or the resolved content.
//
// A4: renders the diagram via ReactFlowWhiteboard in its `isPublic` static
// mode — no toolbar, no drag, and (R1) no Socket.IO collaboration
// connection is ever opened on this path.

import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getSharedWhiteboard } from '@/routes/api/share'
import { ShareLinkInvalid } from '@/components/project/ShareLinkInvalid'
import { ReactFlowWhiteboard } from '@/components/whiteboard/ReactFlowWhiteboard'

export const Route = createFileRoute('/share/$token')({
  component: SharedWhiteboardPage,
})

/**
 * Fixed, non-persisted anonymous identifier for collaboration-hook plumbing
 * on the public path. It is never used to open a socket (collaborationEnabled
 * is false here — see ReactFlowWhiteboard's `isPublic` prop) and is never
 * sent to any server fn, so there is no need for a per-visitor random value
 * (unlike getSessionUserId(), which exists to track presence on the
 * authenticated collaborative path).
 */
const PUBLIC_VIEWER_ID = 'public-viewer'

export function SharedWhiteboardPage() {
  const { token } = Route.useParams()

  // Public endpoint that resolves (never throws), same as getInvitePreview —
  // retry:false avoids a multi-retry spinner delay before the invalid state.
  const {
    data: result,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['shared-whiteboard', token],
    queryFn: () => getSharedWhiteboard({ data: token }),
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading diagram...</p>
      </div>
    )
  }

  if (isError || !result) {
    return (
      <div className="container mx-auto px-4 py-8">
        <ShareLinkInvalid />
      </div>
    )
  }

  if (!result.valid) {
    return (
      <div className="container mx-auto px-4 py-8">
        <ShareLinkInvalid reason={result.reason} />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-xl font-semibold">{result.whiteboardName}</h1>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <ReactFlowWhiteboard
          whiteboardId={result.whiteboardId}
          userId={PUBLIC_VIEWER_ID}
          isPublic
          data={{ tables: result.tables, relationships: result.relationships }}
          showMinimap={result.tables.length > 0}
          showControls={true}
          nodesDraggable={false}
          viewerRole={null}
        />
      </div>
    </div>
  )
}
