// src/lib/schema-changelog/handlers.ts
// Server-function handler logic of the change-log read API. Kept out of
// src/routes/api/schema-changes.ts for the same reason as
// src/lib/history/handlers.ts: the client imports the createServerFn
// wrappers, and this module's `@/db` imports must stay out of that bundle.

import {
  getSchemaChangeBatch,
  listChangeLogFacets,
  listSchemaChanges,
} from './queries'
import type { AuthContext } from '@/lib/auth/middleware'
import type {
  GetSchemaChangeBatch,
  ListChangeLogFacets,
  ListSchemaChanges,
} from '@/data/schema'
import { getWhiteboardProjectId } from '@/data/resolve-project'
import { requireServerFnRole } from '@/lib/auth/require-role'

async function requireViewer(userId: string, whiteboardId: string) {
  const projectId = await getWhiteboardProjectId(whiteboardId)
  await requireServerFnRole(userId, projectId, 'VIEWER')
}

/**
 * Newest-first page of a whiteboard's change log. VIEWER+ (the same gate as
 * the Versions tab); share-link guests have no session and never reach it.
 */
export async function listSchemaChangesHandler(
  { user }: AuthContext,
  data: ListSchemaChanges,
) {
  await requireViewer(user.id, data.whiteboardId)
  const { whiteboardId, cursor, limit, ...filters } = data
  return listSchemaChanges(whiteboardId, filters, { cursor, limit })
}

/** The items of one batch, oldest first. VIEWER+. */
export async function getSchemaChangeBatchHandler(
  { user }: AuthContext,
  data: GetSchemaChangeBatch,
) {
  await requireViewer(user.id, data.whiteboardId)
  return getSchemaChangeBatch(
    data.whiteboardId,
    data.batchId,
    { tableName: data.tableName, includeLayout: data.includeLayout },
    { cursor: data.cursor, limit: data.limit },
  )
}

/** Table names and people for the filter pickers. VIEWER+. */
export async function listChangeLogFacetsHandler(
  { user }: AuthContext,
  data: ListChangeLogFacets,
) {
  await requireViewer(user.id, data.whiteboardId)
  return listChangeLogFacets(data.whiteboardId)
}
