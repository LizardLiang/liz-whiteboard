// src/data/whiteboard-snapshot.ts
// Data access layer for WhiteboardSnapshot (manual version history, GH #107).
// Mirrors src/data/whiteboard-share-link.ts's style exactly: raw db.prepare
// calls, insert/genId/nowMs/transaction helpers from @/db.
//
// D1: the entire diagram is captured as a single self-contained JSON blob
// (`payload`) — immune to future live-schema drift, trivial to capture and
// restore. D3: restore reuses the original entity UUIDs, so relationship
// column references and Area.memberTableIds survive a restore for free. The
// one exception is a row whose id another whiteboard now holds (a row deleted
// before ids were tombstoned, see RetiredId in schema-sql.ts): it is restored
// under a fresh id and every reference to it inside the snapshot is remapped.

import {
  TABLE_EVENT_FIELDS,
  findDiagramTablesByWhiteboardId,
} from './diagram-table'
import { COLUMN_EVENT_FIELDS, findColumnsByTableId } from './column'
import {
  RELATIONSHIP_EVENT_FIELDS,
  findRelationshipsByWhiteboardId,
} from './relationship'
import { AREA_EVENT_FIELDS, findAreasByWhiteboard } from './area'
import { findShapesByWhiteboard } from './shape'
import { findConnectorsByWhiteboard } from './connector'
import { findWhiteboardById } from './whiteboard'
import type { ChangeContext } from '@/lib/schema-changelog'
import type { DiffEntityType, DiffEntry } from '@/lib/schema-diff'
import type {
  Area,
  Column,
  DiagramTable,
  PersistedSnapshotPayload,
  Relationship,
  SnapshotPayload,
  WhiteboardSnapshot,
} from './models'
import {
  db,
  genId,
  insert,
  mapArea,
  mapColumn,
  mapDiagramTable,
  mapRelationship,
  mapWhiteboardSnapshot,
  nowMs,
  toDbBool,
  toDbJson,
  transaction,
  update,
} from '@/db'
import {
  eventRow,
  isSystemContext,
  recordChange,
  recordUpdate,
  withBatch,
} from '@/lib/schema-changelog'
import { diffBoards } from '@/lib/schema-diff'

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
  const shapes = await findShapesByWhiteboard(whiteboardId)
  const connectors = await findConnectorsByWhiteboard(whiteboardId)

  return {
    whiteboard: {
      name: whiteboard.name,
      canvasState: whiteboard.canvasState,
      textSource: whiteboard.textSource,
    },
    tables: tablesWithColumns,
    relationships,
    areas,
    shapes,
    connectors,
  }
}

/** Newest snapshots kept per board; older rows are pruned on every insert. */
export const MAX_SNAPSHOTS_PER_BOARD = 100

/**
 * Persist a captured payload as a new immutable snapshot row, then prune the
 * board's oldest snapshots beyond MAX_SNAPSHOTS_PER_BOARD in the same
 * transaction.
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
  transaction(() => {
    insert('WhiteboardSnapshot', {
      id,
      whiteboardId: data.whiteboardId,
      label: data.label,
      payload: toDbJson(data.payload),
      createdByUserId: data.createdByUserId,
      isAuto: toDbBool(data.isAuto),
      createdAt: ts,
    })
    db.prepare(
      `DELETE FROM "WhiteboardSnapshot"
        WHERE "whiteboardId" = ?
          AND "id" NOT IN (
            SELECT "id" FROM "WhiteboardSnapshot"
             WHERE "whiteboardId" = ?
             ORDER BY "createdAt" DESC, "rowid" DESC
             LIMIT ?
          )`,
    ).run(data.whiteboardId, data.whiteboardId, MAX_SNAPSHOTS_PER_BOARD)
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

/** The saved version a restore brings back. */
export interface RestoredVersion {
  snapshotId: string
  label: string | null
  createdAt: Date
}

interface BoardRows {
  tables: Array<DiagramTable & { columns: Array<Column> }>
  relationships: Array<Relationship>
  areas: Array<Area>
}

/** The rows of a whiteboard, read synchronously so a restore can do it inside its transaction. */
function readBoardRows(whiteboardId: string): BoardRows {
  const tables = db
    .prepare('SELECT * FROM "DiagramTable" WHERE "whiteboardId" = ?')
    .all(whiteboardId)
    .map((r) => mapDiagramTable(r)!)
  return {
    tables: tables.map((table) => ({
      ...table,
      columns: db
        .prepare('SELECT * FROM "Column" WHERE "tableId" = ? ORDER BY "order"')
        .all(table.id)
        .map((r) => mapColumn(r)!),
    })),
    relationships: db
      .prepare('SELECT * FROM "Relationship" WHERE "whiteboardId" = ?')
      .all(whiteboardId)
      .map((r) => mapRelationship(r)!),
    areas: db
      .prepare('SELECT * FROM "Area" WHERE "whiteboardId" = ?')
      .all(whiteboardId)
      .map((r) => mapArea(r)!),
  }
}

function indexRows(rows: BoardRows) {
  const columns = new Map<string, { column: Column; table: DiagramTable }>()
  for (const table of rows.tables)
    for (const column of table.columns)
      columns.set(column.id, { column, table })
  return {
    tables: new Map(rows.tables.map((t) => [t.id, t])),
    columns,
    relationships: new Map(rows.relationships.map((r) => [r.id, r])),
    areas: new Map(rows.areas.map((a) => [a.id, a])),
  }
}

const tableEntityType = (table: DiagramTable) =>
  table.sourceTableId ? ('reference' as const) : ('table' as const)

/**
 * Log what a restore changed, not what it rewrote: `diffBoards` compares the
 * board as it was with the board as restored (both read from the database, so
 * a row that got a fresh id from `idFor` shows under that id). Rows that came
 * back equal log nothing. Deletes come first (columns, relationships, tables,
 * areas), then creates, then updates; a position, size or edge-path change is
 * a layout event.
 *
 * A remapped id has no counterpart in the board as it was, so its old row
 * logs as a delete and the restored row as a create.
 */
function logRestoreChanges(
  before: BoardRows,
  after: BoardRows,
  ctx: ChangeContext,
): void {
  const diff = diffBoards(before, after)
  const was = indexRows(before)
  const now = indexRows(after)
  const tableNameIn = (rows: ReturnType<typeof indexRows>, id: string) =>
    rows.tables.get(id)?.name ?? null
  const ofType = (entries: Array<DiffEntry>, type: DiffEntityType) =>
    entries.filter((e) => e.entityType === type)

  const logColumns = (
    table: DiagramTable & { columns: Array<Column> },
    action: 'create' | 'delete',
  ) => {
    for (const column of table.columns) {
      recordChange(ctx, {
        category: 'schema',
        entityType: 'column',
        action,
        entityId: column.id,
        entityName: column.name,
        tableId: table.id,
        tableName: table.name,
        [action === 'create' ? 'after' : 'before']: eventRow(column),
      })
    }
  }
  const logTable = (table: DiagramTable, action: 'create' | 'delete') =>
    recordChange(ctx, {
      category: 'schema',
      entityType: tableEntityType(table),
      action,
      entityId: table.id,
      entityName: table.name,
      tableId: table.id,
      tableName: table.name,
      [action === 'create' ? 'after' : 'before']: eventRow(table),
    })
  const logRelationship = (
    entry: DiffEntry,
    relationship: Relationship,
    rows: ReturnType<typeof indexRows>,
    action: 'create' | 'delete',
  ) =>
    recordChange(ctx, {
      category: 'schema',
      entityType: 'relationship',
      action,
      entityId: relationship.id,
      entityName: entry.name,
      tableId: relationship.sourceTableId,
      tableName: tableNameIn(rows, relationship.sourceTableId),
      [action === 'create' ? 'after' : 'before']: eventRow(relationship),
    })
  const logArea = (area: Area, action: 'create' | 'delete') =>
    recordChange(ctx, {
      category: 'schema',
      entityType: 'area',
      action,
      entityId: area.id,
      entityName: area.name,
      [action === 'create' ? 'after' : 'before']: eventRow(area),
    })

  // Deletes.
  const removedTables = ofType(diff.removed, 'table')
  for (const entry of removedTables)
    logColumns(was.tables.get(entry.entityId)!, 'delete')
  for (const entry of ofType(diff.removed, 'column')) {
    const old = was.columns.get(entry.entityId)!
    recordChange(ctx, {
      category: 'schema',
      entityType: 'column',
      action: 'delete',
      entityId: old.column.id,
      entityName: old.column.name,
      tableId: old.table.id,
      tableName: old.table.name,
      before: eventRow(old.column),
    })
  }
  for (const entry of ofType(diff.removed, 'relationship'))
    logRelationship(
      entry,
      was.relationships.get(entry.entityId)!,
      was,
      'delete',
    )
  for (const entry of removedTables)
    logTable(was.tables.get(entry.entityId)!, 'delete')
  for (const entry of ofType(diff.removed, 'area'))
    logArea(was.areas.get(entry.entityId)!, 'delete')

  // Creates.
  for (const entry of ofType(diff.added, 'table')) {
    const table = now.tables.get(entry.entityId)!
    logTable(table, 'create')
    logColumns(table, 'create')
  }
  for (const entry of ofType(diff.added, 'column')) {
    const added = now.columns.get(entry.entityId)!
    recordChange(ctx, {
      category: 'schema',
      entityType: 'column',
      action: 'create',
      entityId: added.column.id,
      entityName: added.column.name,
      tableId: added.table.id,
      tableName: added.table.name,
      after: eventRow(added.column),
    })
  }
  for (const entry of ofType(diff.added, 'relationship'))
    logRelationship(
      entry,
      now.relationships.get(entry.entityId)!,
      now,
      'create',
    )
  for (const entry of ofType(diff.added, 'area'))
    logArea(now.areas.get(entry.entityId)!, 'create')

  // Updates.
  for (const entry of ofType(diff.changed, 'table')) {
    const old = was.tables.get(entry.entityId)!
    const table = now.tables.get(entry.entityId)!
    recordUpdate(
      ctx,
      {
        entityType: tableEntityType(table),
        entityId: table.id,
        entityName: table.name,
        tableId: table.id,
        tableName: table.name,
      },
      old,
      table,
      TABLE_EVENT_FIELDS,
    )
  }
  for (const entry of ofType(diff.changed, 'column')) {
    const old = was.columns.get(entry.entityId)!
    const next = now.columns.get(entry.entityId)!
    recordUpdate(
      ctx,
      {
        entityType: 'column',
        entityId: next.column.id,
        entityName: next.column.name,
        tableId: next.table.id,
        tableName: next.table.name,
      },
      old.column,
      next.column,
      COLUMN_EVENT_FIELDS,
    )
  }
  for (const entry of ofType(diff.changed, 'relationship')) {
    const old = was.relationships.get(entry.entityId)!
    const relationship = now.relationships.get(entry.entityId)!
    recordUpdate(
      ctx,
      {
        entityType: 'relationship',
        entityId: relationship.id,
        entityName: entry.name,
        tableId: relationship.sourceTableId,
        tableName: tableNameIn(now, relationship.sourceTableId),
      },
      old,
      relationship,
      RELATIONSHIP_EVENT_FIELDS,
    )
  }
  for (const entry of ofType(diff.changed, 'area')) {
    const old = was.areas.get(entry.entityId)!
    const area = now.areas.get(entry.entityId)!
    recordUpdate(
      ctx,
      {
        entityType: 'area',
        entityId: area.id,
        entityName: area.name,
      },
      old,
      area,
      AREA_EVENT_FIELDS,
    )
  }
}

/**
 * One marker event names the version a restore brought back. `entityName` is
 * the version label, or its date (ISO 8601) when it has none; `after` holds
 * `{ restoredVersion: { snapshotId, label, createdAt } }`. The Changes tab
 * reads the summary "restored version <label or date>" from it.
 */
function logRestoreMarker(
  whiteboardId: string,
  ctx: ChangeContext,
  version: RestoredVersion,
): void {
  const createdAt = version.createdAt.toISOString()
  recordChange(ctx, {
    category: 'schema',
    entityType: 'board',
    action: 'update',
    entityId: whiteboardId,
    entityName: version.label ?? createdAt,
    after: {
      restoredVersion: {
        snapshotId: version.snapshotId,
        label: version.label,
        createdAt,
      },
    },
  })
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
 * A row whose id a live row on ANOTHER whiteboard now holds is inserted under
 * a fresh id (`idFor`), and the references to it in this payload follow: a
 * column's table, a relationship's endpoints, an area's member tables. Other
 * whiteboards' rows are never touched.
 *
 * @throws on any failure — the transaction() wrapper rolls back, leaving the
 * live diagram completely unchanged (AC8).
 */
export async function restoreWhiteboardFromSnapshot(
  whiteboardId: string,
  payload: SnapshotPayload | PersistedSnapshotPayload,
  ctx: ChangeContext,
  version?: RestoredVersion,
): Promise<void> {
  transaction(() => {
    const batchCtx = withBatch(ctx, genId(), 'restore')
    const logging = !isSystemContext(ctx)
    const rowsBefore = logging ? readBoardRows(whiteboardId) : null

    // FR-035/FR-035a: the snapshot system enumerates entities in three
    // places (capture above, this wipe, and the re-insert below). A table
    // missing from any one of them means every restore silently deletes
    // every shape on the board — see tech-spec.md §6. Connector is deleted
    // explicitly even though it cascades from Shape via FK — order-
    // independent correctness is worth two lines, and it keeps this wipe
    // readable as a complete enumeration.
    db.prepare('DELETE FROM "Connector" WHERE "whiteboardId" = ?').run(
      whiteboardId,
    )
    db.prepare('DELETE FROM "Shape" WHERE "whiteboardId" = ?').run(whiteboardId)
    db.prepare('DELETE FROM "Area" WHERE "whiteboardId" = ?').run(whiteboardId)
    db.prepare('DELETE FROM "DiagramTable" WHERE "whiteboardId" = ?').run(
      whiteboardId,
    )

    const ts = nowMs()

    // The board is wiped, so any live row still holding an id is not ours.
    const idFor = (entity: string, id: string): string =>
      db.prepare(`SELECT 1 AS "x" FROM "${entity}" WHERE "id" = ?`).get(id) ===
      undefined
        ? id
        : genId()
    const tableIds = new Map<string, string>()
    const columnIds = new Map<string, string>()
    const mapped = (ids: Map<string, string>, id: string): string =>
      ids.get(id) ?? id

    for (const table of payload.tables) {
      const tableId = idFor('DiagramTable', table.id)
      tableIds.set(table.id, tableId)
      insert('DiagramTable', {
        id: tableId,
        whiteboardId,
        name: table.name,
        description: table.description,
        positionX: table.positionX,
        positionY: table.positionY,
        width: table.width,
        height: table.height,
        // A reference node's source lives on ANOTHER whiteboard, so these are
        // never remapped. Snapshots taken before they were captured lack them.
        sourceWhiteboardId: table.sourceWhiteboardId ?? null,
        sourceTableId: table.sourceTableId ?? null,
        createdAt: coerceStoredDate(table.createdAt),
        updatedAt: ts,
      })

      for (const column of table.columns) {
        const columnId = idFor('Column', column.id)
        columnIds.set(column.id, columnId)
        insert('Column', {
          id: columnId,
          tableId,
          name: column.name,
          dataType: column.dataType,
          isPrimaryKey: toDbBool(column.isPrimaryKey),
          isForeignKey: toDbBool(column.isForeignKey),
          isUnique: toDbBool(column.isUnique),
          isNullable: toDbBool(column.isNullable),
          description: column.description,
          order: column.order,
          sourceColumnId: column.sourceColumnId ?? null,
          createdAt: coerceStoredDate(column.createdAt),
          updatedAt: ts,
        })
      }
    }

    for (const relationship of payload.relationships) {
      insert('Relationship', {
        id: idFor('Relationship', relationship.id),
        whiteboardId,
        sourceTableId: mapped(tableIds, relationship.sourceTableId),
        targetTableId: mapped(tableIds, relationship.targetTableId),
        sourceColumnId: mapped(columnIds, relationship.sourceColumnId),
        targetColumnId: mapped(columnIds, relationship.targetColumnId),
        cardinality: relationship.cardinality,
        label: relationship.label,
        routingPoints: toDbJson(relationship.routingPoints),
        createdAt: coerceStoredDate(relationship.createdAt),
        updatedAt: ts,
      })
    }

    for (const area of payload.areas) {
      insert('Area', {
        id: idFor('Area', area.id),
        whiteboardId,
        name: area.name,
        color: area.color,
        positionX: area.positionX,
        positionY: area.positionY,
        width: area.width,
        height: area.height,
        memberTableIds: toDbJson(
          area.memberTableIds.map((id) => mapped(tableIds, id)),
        ),
        createdAt: coerceStoredDate(area.createdAt),
        updatedAt: ts,
      })
    }

    // FR-035a: `payload.shapes`/`payload.connectors` narrow to
    // `Array<...> | undefined` because `PersistedSnapshotPayload` types them
    // optional (every snapshot captured before this feature has neither
    // key). The `?? []` is the ONLY thing that type-checks here under
    // `strictNullChecks` — it is not defensive style. Do NOT "improve" it
    // into logic that distinguishes `null` from `undefined`: `db.ts`'s
    // `fromDbJson` can yield `null` at runtime, and `?? []` treats `null`
    // and `undefined` identically, which is what keeps the compile-time
    // guard and the runtime reality in agreement. See models.ts and
    // tech-spec.md §6 for the full rationale.
    for (const shape of payload.shapes ?? []) {
      insert('Shape', {
        id: shape.id,
        whiteboardId,
        kind: shape.kind,
        positionX: shape.positionX,
        positionY: shape.positionY,
        width: shape.width,
        height: shape.height,
        rotation: shape.rotation,
        zIndex: shape.zIndex,
        text: shape.text,
        style: toDbJson(shape.style),
        props: toDbJson(shape.props),
        createdAt: coerceStoredDate(shape.createdAt),
        updatedAt: ts,
      })
    }
    for (const connector of payload.connectors ?? []) {
      // AFTER shapes — FK ordering (Connector.sourceShapeId/targetShapeId
      // reference Shape.id).
      insert('Connector', {
        id: connector.id,
        whiteboardId,
        sourceShapeId: connector.sourceShapeId,
        targetShapeId: connector.targetShapeId,
        style: toDbJson(connector.style),
        createdAt: coerceStoredDate(connector.createdAt),
        updatedAt: ts,
      })
    }

    update('Whiteboard', whiteboardId, {
      name: payload.whiteboard.name,
      canvasState: toDbJson(payload.whiteboard.canvasState),
      textSource: payload.whiteboard.textSource,
      updatedAt: ts,
    })

    if (rowsBefore)
      logRestoreChanges(rowsBefore, readBoardRows(whiteboardId), batchCtx)
    if (version) logRestoreMarker(whiteboardId, batchCtx, version)
  })
}
