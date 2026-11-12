// src/lib/diagram-relationship/handlers.ts
// createRelationshipFn's handler logic, split out of src/lib/server-functions.ts
// for the same reason src/lib/diagram-table/handlers.ts is (GH #125):
// server-functions.ts is imported by client components, and TanStack Start's
// client-bundle transform only strips the INLINE closure passed to
// `.handler(...)`. emitToWhiteboard's home module
// (src/routes/api/collaboration.ts) top-level-imports `socket.io`; keeping this
// body in a module no client imports lets Rollup tree-shake that import out of
// the browser bundle.
import type { AuthContext } from '@/lib/auth/middleware'
import type { CreateRelationship } from '@/data/schema'
import { createRelationship } from '@/data/relationship'
import { getWhiteboardProjectId } from '@/data/resolve-project'
import { requireServerFnRole } from '@/lib/auth/require-role'
import { emitToWhiteboard } from '@/routes/api/collaboration'

/**
 * Create a relationship, then broadcast `relationship:created` to every client
 * connected to the whiteboard's namespace. Both UI create paths (the toolbar
 * dialog and drag-to-connect) and the SQL import reach peers through this one
 * broadcast.
 *
 * The emit includes the sender; a client that receives its own create only
 * refetches the relationships it already shows.
 *
 * In dev, Socket.IO's `io` is null in the Vite process, so `emitToWhiteboard`
 * has no effect there. The prod-build e2e
 * (e2e/coedit-relationship-create.spec.ts) exercises the broadcast.
 */
export async function createRelationshipHandler(
  { user }: AuthContext,
  data: CreateRelationship,
) {
  const projectId = await getWhiteboardProjectId(data.whiteboardId)
  await requireServerFnRole(user.id, projectId, 'EDITOR')
  const relationship = await createRelationship(data)
  // The row is already persisted: a broadcast failure must not turn into a
  // create failure, or the client would report an error for a saved line.
  try {
    emitToWhiteboard(data.whiteboardId, 'relationship:created', {
      ...relationship,
      createdBy: user.id,
    })
  } catch (broadcastError) {
    console.error(
      'relationship:created broadcast failed (relationship was created):',
      broadcastError,
    )
  }
  return relationship
}
