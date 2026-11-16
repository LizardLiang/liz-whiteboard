// src/lib/schema-changelog/index.ts
// Schema change log: every user-started write to a table, column, relationship,
// table reference or area records one SchemaChangeEvent row. The data layer
// calls recordChange() inside the same synchronous transaction as the write,
// so the row and its event commit together or not at all.

import { z } from 'zod'
import { clientBatchSchema } from './client-batch'
import type { ClientBatch } from './client-batch'
import { db, genId, nowMs, toDbBool, toDbJson } from '@/db'

export type ChangeCategory = 'schema' | 'layout'
export type ChangeEntityType =
  'table' | 'column' | 'relationship' | 'reference' | 'area' | 'board'
export type ChangeAction =
  'create' | 'update' | 'delete' | 'reorder' | 'move' | 'resize'
export type ChangeBatchKind =
  | 'sql-import'
  | 'restore'
  | 'auto-layout'
  | 'bulk-move'
  | 'area-move'
  | 'table-delete'
  | 'agent-batch'
  | 'reference'

/** Who made a change, on which whiteboard, and the batch it belongs to. */
export interface ActorContext {
  whiteboardId: string
  actorUserId: string | null
  actorName: string
  viaAgent: boolean
  batchId?: string
  batchKind?: ChangeBatchKind
}

/** Marks a write the server makes on its own. recordChange ignores it. */
export const SYSTEM = { system: true } as const

export type ChangeContext = ActorContext | typeof SYSTEM

export interface ChangeEventInput {
  category: ChangeCategory
  entityType: ChangeEntityType
  action: ChangeAction
  entityId: string
  entityName?: string | null
  tableId?: string | null
  tableName?: string | null
  before?: unknown
  after?: unknown
}

/**
 * Fields of a row that describe where it sits, how big it is or which path an
 * edge takes. Dragging an edge path is the same visual placement as dragging a
 * table, so `routingPoints` is layout.
 */
export const LAYOUT_FIELDS: ReadonlyArray<string> = [
  'positionX',
  'positionY',
  'width',
  'height',
  'routingPoints',
]

export function isSystemContext(ctx: ChangeContext): ctx is typeof SYSTEM {
  return 'system' in ctx
}

/** Copy of `ctx` that groups its events under one batch. */
export function withBatch(
  ctx: ChangeContext,
  batchId: string,
  batchKind: ChangeBatchKind,
): ChangeContext {
  if (isSystemContext(ctx)) return ctx
  return { ...ctx, batchId, batchKind }
}

/** Copy of `ctx` that has a batch id, minting one when `ctx` has none. */
export function ensureBatch(
  ctx: ChangeContext,
  batchKind: ChangeBatchKind,
): ChangeContext {
  if (isSystemContext(ctx) || ctx.batchId) return ctx
  return withBatch(ctx, genId(), batchKind)
}

/**
 * Insert one event. Synchronous on purpose: callers run it inside the same
 * transaction() as the write. A no-op for SYSTEM.
 */
export function recordChange(
  ctx: ChangeContext,
  event: ChangeEventInput,
): void {
  if (isSystemContext(ctx)) return
  db.prepare(
    `INSERT INTO "SchemaChangeEvent" ("id","whiteboardId","batchId","batchKind","actorUserId","actorName","viaAgent","category","entityType","action","entityId","entityName","tableId","tableName","before","after","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    genId(),
    ctx.whiteboardId,
    ctx.batchId ?? null,
    ctx.batchKind ?? null,
    ctx.actorUserId,
    ctx.actorName,
    toDbBool(ctx.viaAgent),
    event.category,
    event.entityType,
    event.action,
    event.entityId,
    event.entityName ?? null,
    event.tableId ?? null,
    event.tableName ?? null,
    toDbJson(event.before),
    toDbJson(event.after),
    nowMs(),
  )
}

/** A row as an event stores it: the row without its two timestamps. */
export function eventRow(row: object): Record<string, unknown> {
  const {
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = row as Record<string, unknown>
  return rest
}

export interface FieldDiff {
  before: Record<string, unknown>
  after: Record<string, unknown>
}

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The keys of `keys` whose value differs, as before/after maps. Null when none differ. */
export function diffFields(
  before: object,
  after: object,
  keys: ReadonlyArray<string>,
): FieldDiff | null {
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const diff: FieldDiff = { before: {}, after: {} }
  let changed = false
  for (const key of keys) {
    if (sameValue(b[key], a[key])) continue
    diff.before[key] = b[key] ?? null
    diff.after[key] = a[key] ?? null
    changed = true
  }
  return changed ? diff : null
}

/** Split a diff into its layout part (position, size) and its schema part. */
export function splitCategory(diff: FieldDiff): {
  schema: FieldDiff | null
  layout: FieldDiff | null
} {
  const schema: FieldDiff = { before: {}, after: {} }
  const layout: FieldDiff = { before: {}, after: {} }
  for (const key of Object.keys(diff.after)) {
    const target = LAYOUT_FIELDS.includes(key) ? layout : schema
    target.before[key] = diff.before[key]
    target.after[key] = diff.after[key]
  }
  return {
    schema: Object.keys(schema.after).length > 0 ? schema : null,
    layout: Object.keys(layout.after).length > 0 ? layout : null,
  }
}

type UpdateBase = Omit<
  ChangeEventInput,
  'category' | 'action' | 'before' | 'after'
>

/**
 * Record an update: one event for the schema fields that changed and one for
 * the layout fields that changed. Writes nothing when no field changed.
 */
export function recordUpdate(
  ctx: ChangeContext,
  base: UpdateBase,
  beforeRow: object,
  afterRow: object,
  keys: ReadonlyArray<string>,
  schemaAction: ChangeAction = 'update',
): void {
  const diff = diffFields(beforeRow, afterRow, keys)
  if (!diff) return
  const { schema, layout } = splitCategory(diff)
  if (schema) {
    recordChange(ctx, {
      ...base,
      category: 'schema',
      action: schemaAction,
      before: schema.before,
      after: schema.after,
    })
  }
  if (layout) {
    const moved =
      'positionX' in layout.after ||
      'positionY' in layout.after ||
      'routingPoints' in layout.after
    recordChange(ctx, {
      ...base,
      category: 'layout',
      action: moved ? 'move' : 'resize',
      before: layout.before,
      after: layout.after,
    })
  }
}

/** The display name of a table, for events on its columns. */
export function tableNameOf(tableId: string): string | null {
  const row = db
    .prepare('SELECT "name" FROM "DiagramTable" WHERE "id" = ?')
    .get(tableId) as { name?: string } | undefined
  return row?.name ?? null
}

/** The user's name, or null when no such user exists. */
function usernameOf(userId: string): string | null {
  const row = db
    .prepare('SELECT "username" FROM "User" WHERE "id" = ?')
    .get(userId) as { username?: string } | undefined
  return row?.username ?? null
}

/**
 * Build the context a request from a signed-in user passes to data writes.
 * A user id that has no row (the account was deleted while the socket stayed
 * open) is stored as null: the event keeps its name instead of failing the
 * foreign key and the edit with it.
 */
export function userContext(
  whiteboardId: string,
  userId: string,
  options: { viaAgent?: boolean } = {},
): ActorContext {
  const name = usernameOf(userId)
  return {
    whiteboardId,
    actorUserId: name === null ? null : userId,
    actorName: name ?? 'Unknown user',
    viaAgent: options.viaAgent ?? false,
  }
}

/** "Orders.userId -> Users.id" for a relationship, or its label when it has one. */
export function relationshipDisplayName(relationship: {
  label: string | null
  sourceTableId: string
  targetTableId: string
  sourceColumnId: string
  targetColumnId: string
}): string {
  if (relationship.label) return relationship.label
  const end = (tableId: string, columnId: string): string => {
    const column = db
      .prepare('SELECT "name" FROM "Column" WHERE "id" = ?')
      .get(columnId) as { name?: string } | undefined
    return `${tableNameOf(tableId) ?? '?'}.${column?.name ?? '?'}`
  }
  return `${end(relationship.sourceTableId, relationship.sourceColumnId)} -> ${end(relationship.targetTableId, relationship.targetColumnId)}`
}

/** The `batchId` a socket payload may carry: a non-empty string of 64 characters at most. */
export const batchIdSchema = z.string().min(1).max(64).optional()

/**
 * Put `ctx` into the client-chosen batch `batchId`. A batch another whiteboard
 * or another user already owns is refused: the context keeps no batch, so the
 * write logs as a single event.
 */
export function acceptBatchId(
  ctx: ChangeContext,
  batchId: string,
  batchKind: ChangeBatchKind,
): ChangeContext {
  if (isSystemContext(ctx)) return ctx
  const foreign = db
    .prepare(
      'SELECT 1 AS "x" FROM "SchemaChangeEvent" WHERE "batchId" = ? AND ("whiteboardId" != ? OR "actorUserId" IS NOT ?) LIMIT 1',
    )
    .get(batchId, ctx.whiteboardId, ctx.actorUserId)
  return foreign === undefined ? withBatch(ctx, batchId, batchKind) : ctx
}

/**
 * Split the batch fields a client sent off a payload and validate them.
 * Returns the payload without them, and `ctx` placed in the client's batch
 * when the client sent one (see acceptBatchId for the ownership rule).
 */
export function withClientBatch<T extends ClientBatch>(
  ctx: ChangeContext,
  data: T,
): { rest: Omit<T, 'batchId' | 'batchKind'>; ctx: ChangeContext } {
  const { batchId, batchKind, ...rest } = data
  const batch = clientBatchSchema.parse({ batchId, batchKind })
  return {
    rest,
    ctx: batch.batchId
      ? acceptBatchId(ctx, batch.batchId, batch.batchKind ?? 'sql-import')
      : ctx,
  }
}
