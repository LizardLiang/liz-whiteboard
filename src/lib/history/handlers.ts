// src/lib/history/handlers.ts
// Whiteboard version history / snapshot server-fn HANDLER LOGIC (GH #107) —
// deliberately kept out of src/routes/api/history.ts, mirroring
// src/lib/share/handlers.ts exactly.
//
// src/components/whiteboard/WhiteboardHistoryPanel.tsx (a client component)
// imports the createServerFn-wrapped consts from src/routes/api/history.ts
// (saveSnapshot, listSnapshots, getSnapshot, restoreSnapshot). TanStack
// Start's client-bundle transform only strips the INLINE closure passed to
// `.handler(...)` — it cannot strip a plain top-level function that's merely
// REFERENCED there. Because this module has NO export that any
// client-importable file ever references, Rollup can tree-shake it out of
// the client bundle entirely, keeping this module's `@/db`- and
// Socket.IO-touching imports (via emitToWhiteboard) out of the browser
// bundle. (Mirrors src/routes/api/invites.ts's identical split — see that
// file's header comment for the real `bun run build` failure this pattern
// avoids.)
//
// Each handler is a plain, directly-testable function — src/routes/api/
// history.ts's createServerFn wrappers just delegate to them
// (`.handler(requireAuth(saveSnapshotHandler))`), and
// src/routes/api/history.test.ts calls them directly against the real test
// DB (no mirror-copy of this logic).

import type { AuthContext } from '@/lib/auth/middleware'
import type {
  GetSnapshot,
  ListSnapshots,
  RestoreSnapshot,
  SaveSnapshot,
} from '@/data/schema'
import type { PersistedSnapshotPayload } from '@/data/models'
import { getWhiteboardProjectId } from '@/data/resolve-project'
import { requireServerFnRole } from '@/lib/auth/require-role'
import {
  captureWhiteboardState,
  createWhiteboardSnapshot,
  findSnapshotById,
  findSnapshotsByWhiteboardId,
  restoreWhiteboardFromSnapshot,
} from '@/data/whiteboard-snapshot'
import { emitToWhiteboard } from '@/routes/api/collaboration'

/**
 * Reshape a flat, self-contained (DB-reloaded) SnapshotPayload into the
 * nested `{ tables, relationships }` shape `ReactFlowWhiteboard`'s `isPublic`
 * preview mode expects (mirrors `attachTableRelations`/
 * `attachRelationshipDetails` in src/data/diagram-table.ts and
 * src/data/relationship.ts, but sourced entirely from the payload — no live
 * DB reads — since a preview must render exactly what was captured, not the
 * current live state). Only ever called with a snapshot loaded via
 * `findSnapshotById`, hence `PersistedSnapshotPayload` (not the freshly-
 * captured `SnapshotPayload` shape).
 *
 * R2 (spec delta): areas are NOT included in the preview shape — the
 * read-only ReactFlowWhiteboard renderer's public `data` prop only accepts
 * `{ tables, relationships }` today. Areas are still fully captured/restored
 * (AC1/AC4); only preview rendering defers them.
 */
function buildPreviewData(payload: PersistedSnapshotPayload) {
  const tableById = new Map(payload.tables.map((t) => [t.id, t] as const))
  const columnById = new Map(
    payload.tables.flatMap((t) => t.columns.map((c) => [c.id, c] as const)),
  )

  const tables = payload.tables.map((table) => ({
    ...table,
    outgoingRelationships: payload.relationships.filter(
      (r) => r.sourceTableId === table.id,
    ),
    incomingRelationships: payload.relationships.filter(
      (r) => r.targetTableId === table.id,
    ),
  }))

  const relationships = payload.relationships.map((relationship) => ({
    ...relationship,
    sourceTable: tableById.get(relationship.sourceTableId)!,
    targetTable: tableById.get(relationship.targetTableId)!,
    sourceColumn: columnById.get(relationship.sourceColumnId)!,
    targetColumn: columnById.get(relationship.targetColumnId)!,
  }))

  return { tables, relationships }
}

/**
 * Save a manual version snapshot of a whiteboard's current diagram state.
 * Requires EDITOR+ effective role on the whiteboard's project (AC1/AC6).
 */
export async function saveSnapshotHandler(
  { user }: AuthContext,
  data: SaveSnapshot,
) {
  const projectId = await getWhiteboardProjectId(data.whiteboardId)
  await requireServerFnRole(user.id, projectId, 'EDITOR')

  const payload = await captureWhiteboardState(data.whiteboardId)
  const snapshot = await createWhiteboardSnapshot({
    whiteboardId: data.whiteboardId,
    label: data.label ?? null,
    createdByUserId: user.id,
    isAuto: false,
    payload,
  })

  return {
    success: true as const,
    snapshot: {
      id: snapshot.id,
      whiteboardId: snapshot.whiteboardId,
      label: snapshot.label,
      isAuto: snapshot.isAuto,
      createdAt: snapshot.createdAt,
    },
  }
}

/**
 * List every snapshot for a whiteboard, newest first — metadata only
 * (never includes `payload`). Requires VIEWER+ (AC2/AC6).
 */
export async function listSnapshotsHandler(
  { user }: AuthContext,
  data: ListSnapshots,
) {
  const projectId = await getWhiteboardProjectId(data.whiteboardId)
  await requireServerFnRole(user.id, projectId, 'VIEWER')

  const snapshots = await findSnapshotsByWhiteboardId(data.whiteboardId)
  return { snapshots }
}

/**
 * Load a single snapshot for read-only preview, shaped for
 * `ReactFlowWhiteboard`'s `isPublic` mode.
 *
 * AC7 / IDOR: the whiteboard (and therefore the project used for the
 * VIEWER+ gate) is resolved EXCLUSIVELY from the snapshot row — this handler
 * never accepts a client-supplied whiteboardId, so a snapshot id can never
 * be used to preview or infer state about a different whiteboard.
 *
 * A nonexistent snapshot returns a plain NOT_FOUND — there is no whiteboard
 * to resolve a project from, so there is nothing to disclose either way.
 */
export async function getSnapshotHandler(
  { user }: AuthContext,
  data: GetSnapshot,
) {
  const snapshot = await findSnapshotById(data.snapshotId)
  if (!snapshot) {
    return { error: 'NOT_FOUND' as const, status: 404 as const }
  }

  const projectId = await getWhiteboardProjectId(snapshot.whiteboardId)
  await requireServerFnRole(user.id, projectId, 'VIEWER')

  const preview = buildPreviewData(snapshot.payload)

  return {
    whiteboardId: snapshot.whiteboardId,
    label: snapshot.label,
    isAuto: snapshot.isAuto,
    createdAt: snapshot.createdAt,
    tables: preview.tables,
    relationships: preview.relationships,
  }
}

/**
 * Restore a whiteboard to a previously-saved snapshot — non-destructively
 * (AC4): the CURRENT live state is captured as an automatic "before
 * restore" snapshot first, then the live diagram is atomically replaced
 * with the target snapshot's payload (single transaction, AC8), and every
 * connected collaborator is notified to refresh (AC5).
 *
 * Requires EDITOR+ (AC6). AC7 / IDOR: whiteboardId is resolved exclusively
 * from the snapshot row, never from client input — restoring a snapshot for
 * whiteboard A can never mutate whiteboard B.
 */
export async function restoreSnapshotHandler(
  { user }: AuthContext,
  data: RestoreSnapshot,
) {
  const snapshot = await findSnapshotById(data.snapshotId)
  if (!snapshot) {
    return { error: 'NOT_FOUND' as const, status: 404 as const }
  }

  const projectId = await getWhiteboardProjectId(snapshot.whiteboardId)
  await requireServerFnRole(user.id, projectId, 'EDITOR')

  // AC4a: capture the current live state as an automatic snapshot BEFORE
  // overwriting anything, so the pre-restore state remains recoverable.
  const currentPayload = await captureWhiteboardState(snapshot.whiteboardId)
  await createWhiteboardSnapshot({
    whiteboardId: snapshot.whiteboardId,
    label: 'Auto-saved before restore',
    createdByUserId: user.id,
    isAuto: true,
    payload: currentPayload,
  })

  // AC8: single transaction — any failure mid-restore leaves the live
  // diagram completely unchanged (see restoreWhiteboardFromSnapshot).
  await restoreWhiteboardFromSnapshot(snapshot.whiteboardId, snapshot.payload)

  // AC5: notify every client connected to this whiteboard's namespace
  // (including the acting client's own socket — emitToWhiteboard broadcasts
  // to the whole namespace, not "everyone except sender") to refresh.
  emitToWhiteboard(snapshot.whiteboardId, 'whiteboard:restored', {
    whiteboardId: snapshot.whiteboardId,
  })

  return { success: true as const }
}
