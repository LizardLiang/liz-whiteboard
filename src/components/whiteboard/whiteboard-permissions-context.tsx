// src/components/whiteboard/whiteboard-permissions-context.tsx
// Lightweight context carrying the current viewer's write permission for the
// whiteboard canvas. Lets deeply-nested React Flow node components (rendered
// by xyflow, not directly wired through ReactFlowWhiteboardInner's props)
// gate write affordances without threading canEdit through every node's
// `data` object and the many setNodes call sites that mutate it.
//
// Default is `canEdit: false` (fail-closed) — any component rendered outside
// an explicit Provider (a bug, or a test that forgot to wrap) gets view-only
// affordances rather than silently exposing writes. Real callers always wrap
// with WhiteboardPermissionsProvider using the server-resolved viewerRole.
// This context is UX-only, additive gating — server-side RBAC
// (requireServerFnRole) remains the actual enforcement boundary regardless
// of what this default is.

import { createContext, useContext } from 'react'

interface WhiteboardPermissions {
  canEdit: boolean
}

const WhiteboardPermissionsContext = createContext<WhiteboardPermissions>({
  canEdit: false,
})

export const WhiteboardPermissionsProvider =
  WhiteboardPermissionsContext.Provider

export function useWhiteboardPermissions(): WhiteboardPermissions {
  return useContext(WhiteboardPermissionsContext)
}
