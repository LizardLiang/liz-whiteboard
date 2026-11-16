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
    ? parsed
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
      `("entityName" LIKE ? ESCAPE '\\' OR "tableName" LIKE ? ESCAPE '\\' OR "actorName" LIKE ? ESCAPE '\\')`,
    )
    params.push(like, like, like)
  }
  return { sql: parts.join(' AND '), params }
}

function parseCursor(cursor: string): { ts: number; rid: number } | null {
  const match = /^(\d+):(\d+)$/.exec(cursor)
  return match ? { ts: Number(match[1]), rid: Number(match[2]) } : null
}

/** `?,?,?` for `count` parameters. */
const placeholders = (count: number): string =>
  Array.from({ length: count }, () => '?').join(',')

/** A batch's counts, first event, newest time and the rows its title reads. */
interface BatchFacts {
  first: EventRowRaw
  counts: Array<{ entityType: string; action: string; count: number }>
  total: number
  lastAt: number
  restoredVersion: RestoredVersionDto | null
  subject: string | null
}

function restoredVersionFrom(after: unknown): RestoredVersionDto | null {
  const restored = asRecord(after)?.restoredVersion
  if (restored === null || typeof restored !== 'object') return null
  const version = restored as Record<string, unknown>
  if (typeof version.snapshotId !== 'string') return null
  return {
    snapshotId: version.snapshotId,
    label: typeof version.label === 'string' ? version.label : null,
    createdAt: String(version.createdAt ?? ''),
  }
}

/** The entity type whose name titles a batch of this kind. */
function subjectTypes(batchKind: string | null): ReadonlyArray<string> {
  return batchKind === 'table-delete'
    ? ['table', 'reference']
    : batchKind === 'area-move'
      ? ['area']
      : []
}

/**
 * The summary facts of every batch in `batchIds`, in four grouped queries
 * whatever the number of batches: counts, newest time, first event, and the
 * marker and subject rows.
 */
function loadBatchFacts(
  whiteboardId: string,
  batchIds: ReadonlyArray<string>,
  filters: ChangeFilters,
): Map<string, BatchFacts> {
  const facts = new Map<string, BatchFacts>()
  if (batchIds.length === 0) return facts
  const where = whereClause(whiteboardId, filters)
  const inList = `"batchId" IN (${placeholders(batchIds.length)})`

  const groups = db
    .prepare(
      `SELECT "batchId","entityType","action",COUNT(*) AS "count",MAX("createdAt") AS "lastAt",MIN("rowid") AS "firstRid" FROM "SchemaChangeEvent" WHERE ${where.sql} AND ${inList} GROUP BY "batchId","entityType","action" ORDER BY "batchId", MIN("rowid")`,
    )
    .all(...where.params, ...batchIds) as unknown as Array<{
    batchId: string
    entityType: string
    action: string
    count: number
    lastAt: number
    firstRid: number
  }>
  const firstRids = new Map<string, number>()
  const partial = new Map<
    string,
    Pick<BatchFacts, 'counts' | 'total' | 'lastAt'>
  >()
  for (const g of groups) {
    const entry = partial.get(g.batchId) ?? { counts: [], total: 0, lastAt: 0 }
    entry.counts.push({
      entityType: g.entityType,
      action: g.action,
      count: Number(g.count),
    })
    entry.total += Number(g.count)
    entry.lastAt = Math.max(entry.lastAt, Number(g.lastAt))
    partial.set(g.batchId, entry)
    firstRids.set(
      g.batchId,
      Math.min(firstRids.get(g.batchId) ?? Infinity, Number(g.firstRid)),
    )
  }

  const firstRows = db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM "SchemaChangeEvent" WHERE "rowid" IN (${placeholders(firstRids.size)})`,
    )
    .all(...firstRids.values()) as unknown as Array<EventRowRaw>

  // Marker and subject rows read the whole batch, not the filtered part of it.
  const titleRows = db
    .prepare(
      `SELECT "batchId","entityType","entityName","after" FROM "SchemaChangeEvent" WHERE "whiteboardId" = ? AND ${inList} AND "entityType" IN ('board','table','reference','area') ORDER BY "rowid"`,
    )
    .all(whiteboardId, ...batchIds) as unknown as Array<{
    batchId: string
    entityType: string
    entityName: string | null
    after: unknown
  }>

  for (const first of firstRows) {
    const batchId = first.batchId!
    const entry = partial.get(batchId)!
    const types = subjectTypes(first.batchKind)
    let restoredVersion: RestoredVersionDto | null = null
    let subject: string | null = null
    // The last matching row wins, as an ORDER BY "rowid" DESC LIMIT 1 did.
    for (const row of titleRows) {
      if (row.batchId !== batchId) continue
      if (first.batchKind === 'restore' && row.entityType === 'board')
        restoredVersion = restoredVersionFrom(row.after)
      if (types.includes(row.entityType)) subject = row.entityName ?? null
    }
    facts.set(batchId, { first, ...entry, restoredVersion, subject })
  }
  return facts
}

function summariseBatch(batchId: string, facts: BatchFacts): BatchSummaryDto {
  const { first } = facts
  return {
    batchId,
    batchKind: first.batchKind,
    subject: facts.subject,
    actorUserId: first.actorUserId,
    actorName: first.actorName,
    viaAgent: fromDbBool(first.viaAgent),
    createdAt: facts.lastAt,
    total: facts.total,
    counts: facts.counts,
    restoredVersion: facts.restoredVersion,
  }
}

interface GroupHead {
  rowid: number
  createdAt: number
  batchId: string | null
}

const SCAN_CHUNK = 400

/**
 * One page of the log. Events that share a batchId collapse into one summary
 * row, positioned by the batch's newest event; a batch with a single matching
 * event shows as that event. The cursor is "<createdAt>:<rowid>" of the last
 * group's newest event.
 *
 * The page cost does not depend on the log size. The scan walks events newest
 * first from the cursor (WHERE, index on whiteboardId and createdAt) and keeps
 * the first event of each group: that is the group's newest. A group that has
 * a matching event at or after the cursor belongs to an earlier page, so one
 * grouped query per chunk drops it. Batch summaries come from grouped queries
 * over the page's batches only.
 */
export function listSchemaChanges(
  whiteboardId: string,
  filters: ChangeFilters,
  page: { cursor?: string; limit: number },
): ListSchemaChangesResult {
  const where = whereClause(whiteboardId, filters)
  const cursor = page.cursor ? parseCursor(page.cursor) : null
  const heads: Array<GroupHead> = []
  const taken = new Set<string>()
  const earlier = new Set<string>()
  let from = cursor
  let exhausted = false

  while (heads.length <= page.limit && !exhausted) {
    const rows = db
      .prepare(
        `SELECT "rowid" AS "rowid","createdAt","batchId" FROM "SchemaChangeEvent" WHERE ${where.sql}${from ? ' AND ("createdAt" < ? OR ("createdAt" = ? AND "rowid" < ?))' : ''} ORDER BY "createdAt" DESC, "rowid" DESC LIMIT ?`,
      )
      .all(
        ...where.params,
        ...(from ? [from.ts, from.ts, from.rid] : []),
        SCAN_CHUNK,
      ) as unknown as Array<GroupHead>
    exhausted = rows.length < SCAN_CHUNK

    if (cursor) {
      const unchecked = [
        ...new Set(
          rows.flatMap((r) =>
            r.batchId !== null &&
            !taken.has(r.batchId) &&
            !earlier.has(r.batchId)
              ? [r.batchId]
              : [],
          ),
        ),
      ]
      if (unchecked.length > 0) {
        const shown = db
          .prepare(
            `SELECT DISTINCT "batchId" FROM "SchemaChangeEvent" WHERE ${where.sql} AND "batchId" IN (${placeholders(unchecked.length)}) AND ("createdAt" > ? OR ("createdAt" = ? AND "rowid" >= ?))`,
          )
          .all(
            ...where.params,
            ...unchecked,
            cursor.ts,
            cursor.ts,
            cursor.rid,
          ) as Array<{ batchId: string }>
        for (const row of shown) earlier.add(row.batchId)
      }
    }

    for (const row of rows) {
      if (row.batchId !== null) {
        if (taken.has(row.batchId) || earlier.has(row.batchId)) continue
        taken.add(row.batchId)
      }
      heads.push({
        rowid: Number(row.rowid),
        createdAt: Number(row.createdAt),
        batchId: row.batchId,
      })
      if (heads.length > page.limit) break
    }
    const last = rows.at(-1)
    if (last) from = { ts: Number(last.createdAt), rid: Number(last.rowid) }
  }

  const pageHeads = heads.slice(0, page.limit)
  const facts = loadBatchFacts(
    whiteboardId,
    pageHeads.flatMap((h) => (h.batchId === null ? [] : [h.batchId])),
    filters,
  )
  const loneRowIds = pageHeads.flatMap((h) =>
    h.batchId === null || facts.get(h.batchId)?.total === 1 ? [h.rowid] : [],
  )
  const loneRows = new Map<number, EventRowRaw>()
  if (loneRowIds.length > 0) {
    const rows = db
      .prepare(
        `SELECT ${EVENT_COLUMNS} FROM "SchemaChangeEvent" WHERE "rowid" IN (${placeholders(loneRowIds.length)})`,
      )
      .all(...loneRowIds) as unknown as Array<EventRowRaw>
    for (const row of rows) loneRows.set(Number(row.rowid), row)
  }

  const items = pageHeads.map((head) => {
    const batchFacts =
      head.batchId === null ? undefined : facts.get(head.batchId)
    if (
      head.batchId === null ||
      batchFacts === undefined ||
      batchFacts.total === 1
    ) {
      return {
        kind: 'event' as const,
        event: toEventDto(loneRows.get(head.rowid)!),
      }
    }
    return {
      kind: 'batch' as const,
      batch: summariseBatch(head.batchId, batchFacts),
    }
  })
  const last = pageHeads.at(-1)
  return {
    items,
    nextCursor:
      heads.length > page.limit && last
        ? `${last.createdAt}:${last.rowid}`
        : null,
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
