// src/lib/schema-changelog/queries.ts
// Read side of the change log. Pure database reads, no auth: handlers.ts
// checks access first. Newest first by (createdAt, rowid): the clock can step
// backwards, so rowid breaks ties.

import type {
  BatchSummaryDto,
  ChangeEventDto,
  ChangeFieldsDto,
  ChangeLogFacets,
  GetSchemaChangeBatchResult,
  ListSchemaChangesResult,
  RestoredVersionDto,
} from './types'
import { db, fromDbBool, fromDbJson } from '@/db'

export interface ChangeFilters {
  tableName?: string
  actorUserId?: string
  viaAgent?: boolean
  from?: number
  to?: number
  q?: string
  includeLayout: boolean
}

interface EventRowRaw {
  rowid: number
  id: string
  batchId: string | null
  batchKind: string | null
  actorUserId: string | null
  actorName: string
  viaAgent: number
  category: 'schema' | 'layout'
  entityType: string
  action: string
  entityId: string
  entityName: string | null
  tableId: string | null
  tableName: string | null
  before: unknown
  after: unknown
  createdAt: number
}

const EVENT_COLUMNS =
  '"rowid","id","batchId","batchKind","actorUserId","actorName","viaAgent","category","entityType","action","entityId","entityName","tableId","tableName","before","after","createdAt"'

function asRecord(value: unknown): ChangeFieldsDto | null {
  const parsed = fromDbJson(value)
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed)
    : null
}

function toEventDto(row: EventRowRaw): ChangeEventDto {
  return {
    id: row.id,
    batchId: row.batchId,
    batchKind: row.batchKind,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    viaAgent: fromDbBool(row.viaAgent),
    category: row.category,
    entityType: row.entityType,
    action: row.action,
    entityId: row.entityId,
    entityName: row.entityName,
    tableId: row.tableId,
    tableName: row.tableName,
    before: asRecord(row.before),
    after: asRecord(row.after),
    createdAt: Number(row.createdAt),
  }
}

/** Escape the LIKE wildcards of a user's search text. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** The WHERE clause (and its parameters) every read of one whiteboard shares. */
function whereClause(
  whiteboardId: string,
  filters: ChangeFilters,
): { sql: string; params: Array<string | number> } {
  const parts = ['"whiteboardId" = ?']
  const params: Array<string | number> = [whiteboardId]
  if (!filters.includeLayout) parts.push(`"category" = 'schema'`)
  if (filters.tableName !== undefined) {
    parts.push('"tableName" = ?')
    params.push(filters.tableName)
  }
  if (filters.actorUserId !== undefined) {
    parts.push('"actorUserId" = ?')
    params.push(filters.actorUserId)
  }
  if (filters.viaAgent) parts.push('"viaAgent" = 1')
  if (filters.from !== undefined) {
    parts.push('"createdAt" >= ?')
    params.push(filters.from)
  }
  if (filters.to !== undefined) {
    parts.push('"createdAt" <= ?')
    params.push(filters.to)
  }
  const q = filters.q?.trim()
  if (q) {
    const like = likePattern(q)
    parts.push(
      `("entityName" LIKE ? ESCAPE '\\' OR "tableName" LIKE ? ESCAPE '\\' OR "actorName" LIKE ? ESCAPE '\\' OR "before" LIKE ? ESCAPE '\\' OR "after" LIKE ? ESCAPE '\\')`,
    )
    params.push(like, like, like, like, like)
  }
  return { sql: parts.join(' AND '), params }
}

function parseCursor(cursor: string): { ts: number; rid: number } | null {
  const match = /^(\d+):(\d+)$/.exec(cursor)
  return match ? { ts: Number(match[1]), rid: Number(match[2]) } : null
}

function restoredVersionOf(
  whiteboardId: string,
  batchId: string,
): RestoredVersionDto | null {
  const marker = db
    .prepare(
      `SELECT "after" FROM "SchemaChangeEvent" WHERE "whiteboardId" = ? AND "batchId" = ? AND "entityType" = 'board' ORDER BY "rowid" DESC LIMIT 1`,
    )
    .get(whiteboardId, batchId) as { after: unknown } | undefined
  const restored = asRecord(marker?.after)?.restoredVersion
  if (restored === null || typeof restored !== 'object') return null
  const version = restored as Record<string, unknown>
  if (typeof version.snapshotId !== 'string') return null
  return {
    snapshotId: version.snapshotId,
    label: typeof version.label === 'string' ? version.label : null,
    createdAt: String(version.createdAt ?? ''),
  }
}

function summariseBatch(
  whiteboardId: string,
  batchId: string,
  filters: ChangeFilters,
): BatchSummaryDto {
  const where = whereClause(whiteboardId, filters)
  const counts = db
    .prepare(
      `SELECT "entityType","action",COUNT(*) AS "count" FROM "SchemaChangeEvent" WHERE ${where.sql} AND "batchId" = ? GROUP BY "entityType","action" ORDER BY MIN("rowid")`,
    )
    .all(...where.params, batchId) as Array<{
    entityType: string
    action: string
    count: number
  }>
  const first = db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM "SchemaChangeEvent" WHERE ${where.sql} AND "batchId" = ? ORDER BY "rowid" LIMIT 1`,
    )
    .get(...where.params, batchId) as unknown as EventRowRaw
  const last = db
    .prepare(
      `SELECT MAX("createdAt") AS "createdAt" FROM "SchemaChangeEvent" WHERE ${where.sql} AND "batchId" = ?`,
    )
    .get(...where.params, batchId) as { createdAt: number }
  return {
    batchId,
    batchKind: first.batchKind,
    actorUserId: first.actorUserId,
    actorName: first.actorName,
    viaAgent: fromDbBool(first.viaAgent),
    createdAt: Number(last.createdAt),
    total: counts.reduce((sum, c) => sum + Number(c.count), 0),
    counts: counts.map((c) => ({ ...c, count: Number(c.count) })),
    restoredVersion:
      first.batchKind === 'restore'
        ? restoredVersionOf(whiteboardId, batchId)
        : null,
  }
}

/**
 * One page of the log. Events that share a batchId collapse into one summary
 * row, positioned by the batch's newest event; a batch with a single matching
 * event shows as that event. The cursor is "<createdAt>:<rowid>" of the last
 * group on the page.
 */
export function listSchemaChanges(
  whiteboardId: string,
  filters: ChangeFilters,
  page: { cursor?: string; limit: number },
): ListSchemaChangesResult {
  const where = whereClause(whiteboardId, filters)
  const cursor = page.cursor ? parseCursor(page.cursor) : null
  const having = cursor ? 'HAVING ("ts" < ? OR ("ts" = ? AND "rid" < ?))' : ''
  const cursorParams = cursor ? [cursor.ts, cursor.ts, cursor.rid] : []
  const groups = db
    .prepare(
      `SELECT "batchId", MAX("createdAt") AS "ts", MAX("rowid") AS "rid", COUNT(*) AS "n" FROM "SchemaChangeEvent" WHERE ${where.sql} GROUP BY COALESCE("batchId","id") ${having} ORDER BY "ts" DESC, "rid" DESC LIMIT ?`,
    )
    .all(...where.params, ...cursorParams, page.limit + 1) as Array<{
    batchId: string | null
    ts: number
    rid: number
    n: number
  }>

  const pageGroups = groups.slice(0, page.limit)
  const items = pageGroups.map((group) => {
    if (group.batchId === null || Number(group.n) === 1) {
      const row = db
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM "SchemaChangeEvent" WHERE "rowid" = ?`,
        )
        .get(group.rid) as unknown as EventRowRaw
      return { kind: 'event' as const, event: toEventDto(row) }
    }
    return {
      kind: 'batch' as const,
      batch: summariseBatch(whiteboardId, group.batchId, filters),
    }
  })
  const last = pageGroups.at(-1)
  return {
    items,
    nextCursor:
      groups.length > page.limit && last ? `${last.ts}:${last.rid}` : null,
  }
}

/** The events of one batch, oldest first. The cursor is the last rowid seen. */
export function getSchemaChangeBatch(
  whiteboardId: string,
  batchId: string,
  filters: Pick<ChangeFilters, 'tableName' | 'includeLayout'>,
  page: { cursor?: number; limit: number },
): GetSchemaChangeBatchResult {
  const where = whereClause(whiteboardId, filters)
  const rows = db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM "SchemaChangeEvent" WHERE ${where.sql} AND "batchId" = ? AND "rowid" > ? ORDER BY "rowid" LIMIT ?`,
    )
    .all(
      ...where.params,
      batchId,
      page.cursor ?? 0,
      page.limit + 1,
    ) as unknown as Array<EventRowRaw>
  const pageRows = rows.slice(0, page.limit)
  const last = pageRows.at(-1)
  return {
    events: pageRows.map(toEventDto),
    nextCursor: rows.length > page.limit && last ? last.rowid : null,
  }
}

/** The values the filter pickers offer. Deleted tables stay: names come from the log. */
export function listChangeLogFacets(whiteboardId: string): ChangeLogFacets {
  const tables = db
    .prepare(
      `SELECT DISTINCT "tableName" FROM "SchemaChangeEvent" WHERE "whiteboardId" = ? AND "tableName" IS NOT NULL ORDER BY "tableName" COLLATE NOCASE`,
    )
    .all(whiteboardId) as Array<{ tableName: string }>
  const actors = db
    .prepare(
      `SELECT "actorUserId" AS "userId", "actorName" AS "name" FROM "SchemaChangeEvent" WHERE "whiteboardId" = ? AND "actorUserId" IS NOT NULL GROUP BY "actorUserId" HAVING "createdAt" = MAX("createdAt") ORDER BY "actorName" COLLATE NOCASE`,
    )
    .all(whiteboardId) as Array<{ userId: string; name: string }>
  const agent = db
    .prepare(
      `SELECT 1 AS "x" FROM "SchemaChangeEvent" WHERE "whiteboardId" = ? AND "viaAgent" = 1 LIMIT 1`,
    )
    .get(whiteboardId)
  return {
    tables: tables.map((t) => t.tableName),
    actors,
    hasAgentEdits: agent !== undefined,
  }
}
