// src/data/whiteboard-snapshot.ts
// Data access layer for WhiteboardSnapshot (manual version history, GH #107).
// Mirrors src/data/whiteboard-share-link.ts's style exactly: raw db.prepare
// calls, insert/genId/nowMs/transaction helpers from @/db.
//
// D1: the entire diagram is captured as a single self-contained JSON blob
// (`payload`) — immune to future live-schema drift, trivial to capture and
// restore. D3: restore reuses the original entity UUIDs verbatim (no
// remapping), so relationship column references and Area.memberTableIds
// survive a restore for free.

import { findDiagramTablesByWhiteboardId } from './diagram-table'
import { findColumnsByTableId } from './column'
import { findRelationshipsByWhiteboardId } from './relationship'
import { findAreasByWhiteboard } from './area'
import { findWhiteboardById } from './whiteboard'
import type {
  PersistedSnapshotPayload,
  SnapshotPayload,
  WhiteboardSnapshot,
} from './models'
import {
  db,
  genId,
  insert,
  mapWhiteboardSnapshot,
  nowMs,
  toDbBool,
  toDbJson,
  transaction,
  update,
} from '@/db'

/**
 * Coerce a captured `createdAt` back to the unix-ms storage form expected by
 * `insert()`. Defensive against all three shapes a payload's date fields can
 * actually be at runtime: a real `Date` (the freshly-captured
 * `SnapshotPayload` shape — e.g. a direct `captureWhiteboardState()` result),
 * an ISO string (the `PersistedSnapshotPayload` shape — once a payload has
 * round-tripped through `toDbJson`/`fromDbJson` storage — `JSON.stringify`
 * serializes `Date` to a string and `JSON.parse` never revives it), or a raw
 * number. `restoreWhiteboardFromSnapshot`'s `payload` parameter is typed as
 * the union of both shapes precisely because both are real, valid inputs —
 * see `SnapshotPayload`/`PersistedSnapshotPayload` in `./models`.
 */
function coerceStoredDate(d: Date | string | number): number {
  if (typeof d === 'number') return d
  if (typeof d === 'string') return new Date(d).getTime()
  return d.getTime()
}

/**
 * Read the complete current diagram state of a whiteboard — tables (with
 * their columns), relationships, areas, and whiteboard scalars — into a
 * single self-contained payload. Pure read; does not persist anything.
 *
 * @throws Error if the whiteboard does not exist.
 */
export async function captureWhiteboardState(
  whiteboardId: string,
): Promise<SnapshotPayload> {
  const whiteboard = await findWhiteboardById(whiteboardId)
  if (!whiteboard) {
    throw new Error(`Whiteboard not found: ${whiteboardId}`)
  }

  const tables = await findDiagramTablesByWhiteboardId(whiteboardId)
  const tablesWithColumns = await Promise.all(
    tables.map(async (table) => ({
      ...table,
      columns: await findColumnsByTableId(table.id),
    })),
  )
  const relationships = await findRelationshipsByWhiteboardId(whiteboardId)
  const areas = await findAreasByWhiteboard(whiteboardId)

  return {
    whiteboard: {
      name: whiteboard.name,
      canvasState: whiteboard.canvasState,
      textSource: whiteboard.textSource,
    },
    tables: tablesWithColumns,
    relationships,
    areas,
  }
}

/**
 * Persist a captured payload as a new immutable snapshot row.
 */
export async function createWhiteboardSnapshot(data: {
  whiteboardId: string
  label: string | null
  createdByUserId: string | null
  isAuto: boolean
  payload: SnapshotPayload
}): Promise<WhiteboardSnapshot> {
  const id = genId()
  const ts = nowMs()
  insert('WhiteboardSnapshot', {
    id,
    whiteboardId: data.whiteboardId,
    label: data.label,
    payload: toDbJson(data.payload),
    createdByUserId: data.createdByUserId,
    isAuto: toDbBool(data.isAuto),
    createdAt: ts,
  })
  return mapWhiteboardSnapshot(
    db.prepare('SELECT * FROM "WhiteboardSnapshot" WHERE "id" = ?').get(id),
  )!
}

/** Metadata-only snapshot list item — NEVER includes `payload` (list is a metadata projection). */
export interface SnapshotListItem {
  id: string
  whiteboardId: string
  label: string | null
  authorName: string | null
  isAuto: boolean
  createdAt: Date
}

/**
 * List every snapshot for a whiteboard, newest first. Deliberately omits
 * `payload` from the projection — the list view is metadata-only (id,
 * label, author, timestamp); full state is only ever loaded by
 * `findSnapshotById` for preview/restore.
 */
export async function findSnapshotsByWhiteboardId(
  whiteboardId: string,
): Promise<Array<SnapshotListItem>> {
  const rows = db
    .prepare(
      `SELECT "ws"."id", "ws"."whiteboardId", "ws"."label", "ws"."isAuto", "ws"."createdAt", "u"."username" AS "authorName"
       FROM "WhiteboardSnapshot" "ws"
       LEFT JOIN "User" "u" ON "u"."id" = "ws"."createdByUserId"
       WHERE "ws"."whiteboardId" = ?
       ORDER BY "ws"."createdAt" DESC, "ws"."rowid" DESC`,
    )
    .all(whiteboardId)

  return rows.map((r) => ({
    id: r.id as string,
    whiteboardId: r.whiteboardId as string,
    label: (r.label as string | null) ?? null,
    authorName: (r.authorName as string | null) ?? null,
    isAuto: r.isAuto === 1 || r.isAuto === true,
    createdAt: new Date(Number(r.createdAt)),
  }))
}

/**
 * Find a single snapshot by id, including its full payload — used for
 * preview and restore.
 */
export async function findSnapshotById(
  id: string,
): Promise<WhiteboardSnapshot | null> {
  return mapWhiteboardSnapshot(
    db.prepare('SELECT * FROM "WhiteboardSnapshot" WHERE "id" = ?').get(id),
  )
}

/**
 * Atomically replace a whiteboard's live diagram with a snapshot's payload.
 *
 * Wipe-then-insert: deletes every Area and DiagramTable belonging to the
 * whiteboard (DiagramTable delete cascades Columns + Relationships via FK
 * ON DELETE CASCADE), then re-inserts tables -> columns -> relationships ->
 * areas from the payload using their ORIGINAL ids (D3) — this both
 * preserves relationship column references / Area.memberTableIds with zero
 * remapping, and sidesteps the unique indexes that a naive insert-without-
 * wipe would violate.
 *
 * Runs inside ONE outer transaction() — every write here uses the raw
 * insert()/update() helpers directly (never a higher-level data-layer
 * function that itself opens a transaction()), since SQLite does not
 * support nested BEGIN.
 *
 * @throws on any failure — the transaction() wrapper rolls back, leaving the
 * live diagram completely unchanged (AC8).
 */
export async function restoreWhiteboardFromSnapshot(
  whiteboardId: string,
  payload: SnapshotPayload | PersistedSnapshotPayload,
): Promise<void> {
  transaction(() => {
    db.prepare('DELETE FROM "Area" WHERE "whiteboardId" = ?').run(whiteboardId)
    db.prepare('DELETE FROM "DiagramTable" WHERE "whiteboardId" = ?').run(
      whiteboardId,
    )

    const ts = nowMs()

    for (const table of payload.tables) {
      insert('DiagramTable', {
        id: table.id,
        whiteboardId,
        name: table.name,
        description: table.description,
        positionX: table.positionX,
        positionY: table.positionY,
        width: table.width,
        height: table.height,
        createdAt: coerceStoredDate(table.createdAt),
        updatedAt: ts,
      })

      for (const column of table.columns) {
        insert('Column', {
          id: column.id,
          tableId: table.id,
          name: column.name,
          dataType: column.dataType,
          isPrimaryKey: toDbBool(column.isPrimaryKey),
          isForeignKey: toDbBool(column.isForeignKey),
          isUnique: toDbBool(column.isUnique),
          isNullable: toDbBool(column.isNullable),
          description: column.description,
          order: column.order,
          createdAt: coerceStoredDate(column.createdAt),
          updatedAt: ts,
        })
      }
    }

    for (const relationship of payload.relationships) {
      insert('Relationship', {
        id: relationship.id,
        whiteboardId,
        sourceTableId: relationship.sourceTableId,
        targetTableId: relationship.targetTableId,
        sourceColumnId: relationship.sourceColumnId,
        targetColumnId: relationship.targetColumnId,
        cardinality: relationship.cardinality,
        label: relationship.label,
        routingPoints: toDbJson(relationship.routingPoints),
        createdAt: coerceStoredDate(relationship.createdAt),
        updatedAt: ts,
      })
    }

    for (const area of payload.areas) {
      insert('Area', {
        id: area.id,
        whiteboardId,
        name: area.name,
        color: area.color,
        positionX: area.positionX,
        positionY: area.positionY,
        width: area.width,
        height: area.height,
        memberTableIds: toDbJson(area.memberTableIds),
        createdAt: coerceStoredDate(area.createdAt),
        updatedAt: ts,
      })
    }

    update('Whiteboard', whiteboardId, {
      name: payload.whiteboard.name,
      canvasState: toDbJson(payload.whiteboard.canvasState),
      textSource: payload.whiteboard.textSource,
      updatedAt: ts,
    })
  })
}
