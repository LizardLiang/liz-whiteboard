// src/routes/render.canvas.$token.tsx
// Headless render page for a canvas board. The canvas counterpart of
// render.whiteboard.$token.tsx: same token, same framing modes, same readiness
// attributes (RenderPage.tsx). Reuses CanvasBoard's `isPublic` mode - no
// toolbar, no mutations, no Socket.IO.

import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getRenderBoard } from '@/routes/api/render'
import { CanvasBoard } from '@/components/canvas/CanvasBoard'
import {
  RenderRoot,
  useRenderFraming,
  validateRenderSearch,
} from '@/components/render/RenderPage'

export const Route = createFileRoute('/render/canvas/$token')({
  validateSearch: validateRenderSearch,
  component: RenderCanvasPage,
})

/** Constant stand-in for CanvasBoard's `userId`; no socket is ever opened. */
const RENDER_VIEWER_ID = 'render-viewer'

function RenderCanvasPage() {
  const { token } = Route.useParams()
  const search = Route.useSearch()
  const { framing, plan } = useRenderFraming(search)

  const { data: result, isError } = useQuery({
    queryKey: ['render-board', token],
    queryFn: () => getRenderBoard({ data: token }),
    retry: false,
    staleTime: Infinity,
  })

  if (isError) {
    return <RenderRoot theme={search.theme} plan={null} error="invalid-token" />
  }
  if (!result) {
    return <RenderRoot theme={search.theme} plan={null} />
  }
  if (!result.valid) {
    return (
      <RenderRoot
        theme={search.theme}
        plan={null}
        error={result.reason === 'EXPIRED' ? 'token-expired' : 'invalid-token'}
      />
    )
  }
  if (result.kind !== 'canvas') {
    return <RenderRoot theme={search.theme} plan={null} error="invalid-token" />
  }

  return (
    <RenderRoot theme={search.theme} plan={plan}>
      <CanvasBoard
        boardId={result.canvasBoardId}
        boardName={result.canvasBoardName}
        userId={RENDER_VIEWER_ID}
        initialElements={result.elements}
        isPublic
        renderFraming={framing}
      />
    </RenderRoot>
  )
}
