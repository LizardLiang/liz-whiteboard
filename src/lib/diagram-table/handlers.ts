// src/lib/diagram-table/handlers.ts
// createTableFn's handler logic (GH #125), split out of
// src/routes/api/tables.ts for the same reason src/lib/history/handlers.ts /
// src/lib/invite/handlers.ts / src/lib/share/handlers.ts are split out of
// their THIN route-fn wrappers: src/routes/api/tables.ts is imported
// directly by client components (src/routes/whiteboard/$whiteboardId.tsx et
// al.) via its createServerFn-wrapped consts, and TanStack Start's
// client-bundle transform only strips the INLINE closure passed to
// `.handler(...)` — it cannot strip a plain top-level function that file
// merely references. emitToWhiteboard's home module
// (src/routes/api/collaboration.ts) top-level-imports `socket.io` (Node-
// only); keeping this handler body in a separate, never-client-imported
// module is what lets Rollup tree-shake that import out of the browser
// bundle instead of pulling `socket.io` into it (see history.ts/invites.ts's
// header comments for the real `bun run build` failure this pattern avoids).
import type { AuthContext } from '@/lib/auth/middleware'
import type { CreateTable } from '@/data/schema'
import { createDiagramTable } from '@/data/diagram-table'
import { getWhiteboardProjectId } from '@/data/resolve-project'
import { requireServerFnRole } from '@/lib/auth/require-role'
import { emitToWhiteboard } from '@/routes/api/collaboration'

/**
 * Create a new table, then broadcast `table:created` to every client
 * connected to the whiteboard's namespace (GH #125). This is now the ONLY
 * place a live `table:created` broadcast originates from — the client's
 * previous re-emit through the `table:create` socket handler
 * (`$whiteboardId.tsx`'s `createTableMutation.onSuccess`) has been removed;
 * it re-submitted the already-persisted row (with DB `null`s) back through
 * `createTableSchema` validation, which always threw before the socket
 * handler could broadcast, and would have hit a UNIQUE
 * `(whiteboardId, name)` violation on the resulting re-insert even if
 * validation were relaxed.
 *
 * Namespace-wide emit (includes the sender) is intentional: the creating
 * client's own `useWhiteboardCollaboration` hook already ignores its own
 * event via `createdBy === userId`, exactly like `emitToWhiteboard`'s other
 * caller (`src/lib/history/handlers.ts`'s `whiteboard:restored` broadcast).
 *
 * In dev, `getSocketIO()`'s backing `io` singleton is null (the dev
 * Vite/server.dev.ts split never calls `initializeSocketIO`), so
 * `emitToWhiteboard` no-ops there — consistent with the project's prod/dev
 * Socket.IO split. The broadcast is exercised by the prod-build e2e
 * (e2e/coedit-table-create.spec.ts).
 */
export async function createTableHandler(
  { user }: AuthContext,
  data: CreateTable,
) {
  const projectId = await getWhiteboardProjectId(data.whiteboardId)
  await requireServerFnRole(user.id, projectId, 'EDITOR')
  try {
    const table = await createDiagramTable(data)
    emitToWhiteboard(data.whiteboardId, 'table:created', {
      ...table,
      createdBy: user.id,
    })
    return table
  } catch (error) {
    throw new Error(
      `Failed to create table: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
