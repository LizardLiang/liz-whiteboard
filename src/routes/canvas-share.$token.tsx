// src/routes/canvas-share.$token.tsx
// Public, no-auth read-only CANVAS board share page. The canvas counterpart
// of src/routes/share.$token.tsx and deliberately the same shape: a public
// route that resolves a bearer token through an unauthenticated server fn
// and renders either an invalid/expired state or the resolved board.
//
// A separate path from /share/$token rather than a widened one. That route's
// resolver reads WhiteboardShareLink; teaching it to fall back to a second
// table would put every existing public whiteboard visit behind an extra
// miss-then-retry lookup, for a token space that never overlaps anyway.
//
// The board renders through CanvasBoard's `isPublic` mode: no toolbar, no
// mutations, and no Socket.IO connection is ever opened on this path.

import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getSharedCanvasBoard } from '@/routes/api/canvas-share'
import { ShareLinkInvalid } from '@/components/project/ShareLinkInvalid'
import { CanvasBoard } from '@/components/canvas/CanvasBoard'

export const Route = createFileRoute('/canvas-share/$token')({
  component: SharedCanvasBoardPage,
})

/**
 * Fixed, non-persisted anonymous identifier, matching share.$token.tsx's
 * PUBLIC_VIEWER_ID. It exists only to satisfy CanvasBoard's `userId` prop:
 * on this path no socket is opened, so it is never sent anywhere and never
 * identifies a presence, which is why a constant is correct here and a
 * per-visitor random value would be pointless ceremony.
 */
const PUBLIC_VIEWER_ID = 'public-viewer'

export function SharedCanvasBoardPage() {
  const { token } = Route.useParams()

  // Public endpoint that resolves rather than throws, same as
  // getSharedWhiteboard — retry:false avoids a multi-retry spinner delay in
  // front of the invalid state.
  const {
    data: result,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['shared-canvas-board', token],
    queryFn: () => getSharedCanvasBoard({ data: token }),
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading board...</p>
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
        <h1 className="text-xl font-semibold">{result.canvasBoardName}</h1>
        <span className="text-xs text-muted-foreground">Read-only</span>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <CanvasBoard
          boardId={result.canvasBoardId}
          userId={PUBLIC_VIEWER_ID}
          initialElements={result.elements}
          isPublic
        />
      </div>
    </div>
  )
}
