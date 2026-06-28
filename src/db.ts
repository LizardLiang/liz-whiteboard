// src/db.ts
// Raw SQLite data access — no ORM.
//
// The app's server functions run under TWO runtimes: Node.js in dev (Nitro
// node-worker) and Bun in prod (`server.prod.ts`). Neither built-in SQLite
// module works in both, so we pick the matching one at load time:
//   - Bun  -> `bun:sqlite`  (Database)
//   - Node -> `node:sqlite` (DatabaseSync, Node >= 22.5)
// Both expose an identical `prepare().get()/.all()/.run()` synchronous API and
// return identical plain-object rows. See memory: project_sqlite_runtime_split.

import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA_SQL } from './data/schema-sql'
import type {
  CollaborationSession,
  Column,
  DiagramTable,
  Folder,
  JsonValue,
  Project,
  ProjectMember,
  Relationship,
  Session,
  User,
  Whiteboard,
} from './data/models'
import type { Cardinality, ProjectRoleValue } from './data/schema'

const require = createRequire(import.meta.url)
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

/** Minimal shared surface of bun:sqlite / node:sqlite we rely on. */
interface SqliteStatement {
  get(...params: Array<unknown>): Record<string, unknown> | undefined
  all(...params: Array<unknown>): Array<Record<string, unknown>>
  run(...params: Array<unknown>): unknown
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
}

function openDatabase(): SqliteDatabase {
  const path = resolveDbPath()
  // Ensure the parent directory exists (drivers create the file, not the dir).
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  if (isBun) {
    const { Database } = require('bun:sqlite')
    return new Database(path, { create: true }) as SqliteDatabase
  }
  const { DatabaseSync } = require('node:sqlite')
  return new DatabaseSync(path) as SqliteDatabase
}

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db'
  if (url.startsWith('file:')) return url.slice('file:'.length)
  return url
}

export const db: SqliteDatabase = openDatabase()

// Enforce foreign keys (cascade deletes) + better concurrency, then ensure the
// schema exists. CREATE TABLE/INDEX IF NOT EXISTS makes this a no-op on an
// already-populated database.
db.exec('PRAGMA foreign_keys = ON;')
db.exec('PRAGMA journal_mode = WAL;')
db.exec(SCHEMA_SQL)

// ── Primitive helpers ────────────────────────────────────────────────────────

/** Generate a v4 UUID (server-side; node:crypto works over HTTP, unlike browser Web Crypto). */
export function genId(): string {
  return randomUUID()
}

/** Current time as unix-ms (the datetime storage format). */
export function nowMs(): number {
  return Date.now()
}

/**
 * Generic INSERT. `values` keys are column names; values must already be in
 * storage form (use toDbBool/toDbDate/toDbJson). Omit a key to leave it default.
 */
export function insert(table: string, values: Record<string, unknown>): void {
  const keys = Object.keys(values)
  const cols = keys.map((k) => `"${k}"`).join(', ')
  const placeholders = keys.map(() => '?').join(', ')
  db.prepare(`INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`).run(
    ...keys.map((k) => values[k]),
  )
}

/**
 * Generic UPDATE by id. `values` keys are column names in storage form. A no-op
 * if `values` is empty. Returns the number of changed rows is not needed here.
 */
export function update(
  table: string,
  id: string,
  values: Record<string, unknown>,
): void {
  const keys = Object.keys(values)
  if (keys.length === 0) return
  const setClause = keys.map((k) => `"${k}" = ?`).join(', ')
  db.prepare(`UPDATE "${table}" SET ${setClause} WHERE "id" = ?`).run(
    ...keys.map((k) => values[k]),
    id,
  )
}

/** Run a function inside a transaction; commits on success, rolls back on throw. */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

// ── Value <-> storage converters (match Prisma's SQLite storage format) ──────
// Booleans stored as 0/1 INTEGER; datetimes as unix-ms INTEGER; JSON as TEXT.

export const toDbBool = (b: boolean): number => (b ? 1 : 0)
export const fromDbBool = (n: unknown): boolean => n === 1 || n === true

export const toDbDate = (d: Date | number): number =>
  typeof d === 'number' ? d : d.getTime()
export const fromDbDate = (n: unknown): Date => new Date(Number(n))

export const toDbJson = (v: unknown): string | null =>
  v === undefined || v === null ? null : JSON.stringify(v)
export const fromDbJson = (s: unknown): JsonValue | null => {
  if (s === null || s === undefined) return null
  if (typeof s !== 'string') return s as JsonValue
  try {
    return JSON.parse(s) as JsonValue
  } catch {
    return null
  }
}

// ── Row mappers: raw DB row -> typed model ───────────────────────────────────

type Row = Record<string, unknown> | undefined | null

export function mapUser(r: Row): User | null {
  if (!r) return null
  return {
    id: r.id as string,
    username: r.username as string,
    email: r.email as string,
    passwordHash: r.passwordHash as string,
    failedLoginAttempts: Number(r.failedLoginAttempts),
    lockedUntil: r.lockedUntil == null ? null : fromDbDate(r.lockedUntil),
    createdAt: fromDbDate(r.createdAt),
    updatedAt: fromDbDate(r.updatedAt),
  }
}

export function mapSession(r: Row): Session | null {
  if (!r) return null
  return {
    id: r.id as string,
    tokenHash: r.tokenHash as string,
    userId: r.userId as string,
    expiresAt: fromDbDate(r.expiresAt),
    createdAt: fromDbDate(r.createdAt),
  }
}

export function mapProjectMember(r: Row): ProjectMember | null {
  if (!r) return null
  return {
    id: r.id as string,
    projectId: r.projectId as string,
    userId: r.userId as string,
    role: r.role as ProjectRoleValue,
    createdAt: fromDbDate(r.createdAt),
    updatedAt: fromDbDate(r.updatedAt),
  }
}

export function mapProject(r: Row): Project | null {
  if (!r) return null
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    createdAt: fromDbDate(r.createdAt),
    updatedAt: fromDbDate(r.updatedAt),
    ownerId: (r.ownerId as string | null) ?? null,
  }
}

export function mapFolder(r: Row): Folder | null {
  if (!r) return null
  return {
    id: r.id as string,
    name: r.name as string,
    projectId: r.projectId as string,
    parentFolderId: (r.parentFolderId as string | null) ?? null,
    createdAt: fromDbDate(r.createdAt),
    updatedAt: fromDbDate(r.updatedAt),
  }
}

export function mapWhiteboard(r: Row): Whiteboard | null {
  if (!r) return null
  return {
    id: r.id as string,
    name: r.name as string,
    projectId: r.projectId as string,
    folderId: (r.folderId as string | null) ?? null,
    canvasState: fromDbJson(r.canvasState),
    textSource: (r.textSource as string | null) ?? null,
    createdAt: fromDbDate(r.createdAt),
    updatedAt: fromDbDate(r.updatedAt),
  }
}

export function mapDiagramTable(r: Row): DiagramTable | null {
  if (!r) return null
  return {
    id: r.id as string,
    whiteboardId: r.whiteboardId as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    positionX: Number(r.positionX),
    positionY: Number(r.positionY),
    width: r.width == null ? null : Number(r.width),
    height: r.height == null ? null : Number(r.height),
    createdAt: fromDbDate(r.createdAt),
    updatedAt: fromDbDate(r.updatedAt),
  }
}

export function mapColumn(r: Row): Column | null {
  if (!r) return null
  return {
    id: r.id as string,
    tableId: r.tableId as string,
    name: r.name as string,
    dataType: r.dataType as string,
    isPrimaryKey: fromDbBool(r.isPrimaryKey),
    isForeignKey: fromDbBool(r.isForeignKey),
    isUnique: fromDbBool(r.isUnique),
    isNullable: fromDbBool(r.isNullable),
    description: (r.description as string | null) ?? null,
    order: Number(r.order),
    createdAt: fromDbDate(r.createdAt),
    updatedAt: fromDbDate(r.updatedAt),
  }
}

export function mapRelationship(r: Row): Relationship | null {
  if (!r) return null
  return {
    id: r.id as string,
    whiteboardId: r.whiteboardId as string,
    sourceTableId: r.sourceTableId as string,
    targetTableId: r.targetTableId as string,
    sourceColumnId: r.sourceColumnId as string,
    targetColumnId: r.targetColumnId as string,
    cardinality: r.cardinality as Cardinality,
    label: (r.label as string | null) ?? null,
    routingPoints: fromDbJson(r.routingPoints),
    createdAt: fromDbDate(r.createdAt),
    updatedAt: fromDbDate(r.updatedAt),
  }
}

export function mapCollaborationSession(r: Row): CollaborationSession | null {
  if (!r) return null
  return {
    id: r.id as string,
    whiteboardId: r.whiteboardId as string,
    userId: r.userId as string,
    socketId: r.socketId as string,
    cursor: fromDbJson(r.cursor),
    lastActivityAt: fromDbDate(r.lastActivityAt),
    createdAt: fromDbDate(r.createdAt),
  }
}
