// src/routes/render.whiteboard.$token.tsx
// Headless render page for an ER whiteboard. Opened by the MCP server's
// headless browser with a short-lived render token (see
// src/lib/render/render-token.ts); never linked from the UI. It reuses
// ReactFlowWhiteboard's `isPublic` static mode - no toolbar, no drag, no
// Socket.IO - and adds framing (fit / focus / tile) and the readiness
// attributes documented in RenderPage.tsx.

import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getRenderBoard } from '@/routes/api/render'
import { ReactFlowWhiteboard } from '@/components/whiteboard/ReactFlowWhiteboard'
import {
  RenderRoot,
  useRenderFraming,
  validateRenderSearch,
} from '@/components/render/RenderPage'

export const Route = createFileRoute('/render/whiteboard/$token')({
  validateSearch: validateRenderSearch,
  component: RenderWhiteboardPage,
})

/** Constant stand-in for the collaboration hooks; no socket is ever opened. */
const RENDER_VIEWER_ID = 'render-viewer'

function RenderWhiteboardPage() {
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
  if (result.kind !== 'whiteboard') {
    return <RenderRoot theme={search.theme} plan={null} error="invalid-token" />
  }

  return (
    <RenderRoot theme={search.theme} plan={plan}>
      <ReactFlowWhiteboard
        whiteboardId={result.whiteboardId}
        userId={RENDER_VIEWER_ID}
        isPublic
        renderFraming={framing}
        data={{
          tables: result.tables,
          relationships: result.relationships,
          shapes: result.shapes,
          connectors: result.connectors,
        }}
        showMinimap={false}
        showControls={false}
        nodesDraggable={false}
        viewerRole={null}
      />
    </RenderRoot>
  )
}
