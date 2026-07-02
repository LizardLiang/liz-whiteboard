// src/test/db-helpers.ts
// Helpers for data-layer integration tests. Tests run against an in-memory
// SQLite database (vitest.config sets DATABASE_URL=:memory:), so importing
// `@/db` here opens a throwaway DB and creates the schema automatically.
//
// Usage:
//   import { resetDb, makeUser, makeProject, makeWhiteboard, makeTable } from '@/test/db-helpers'
//   beforeEach(() => resetDb())
import { db, genId, nowMs, toDbBool } from '@/db'

const ALL_TABLES = [
  'CollaborationSession',
  'Relationship',
  'Column',
  'DiagramTable',
  'Whiteboard',
  'Folder',
  'ProjectInvite',
  'ProjectMember',
  'Session',
  'Project',
  'User',
] as const

/** Delete every row from every table. Call in beforeEach for test isolation. */
export function resetDb(): void {
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const t of ALL_TABLES) db.exec(`DELETE FROM "${t}";`)
  db.exec('PRAGMA foreign_keys = ON;')
}

interface UserOpts {
  username?: string
  email?: string
  passwordHash?: string
}
export function makeUser(opts: UserOpts = {}): { id: string } {
  const id = genId()
  const ts = nowMs()
  const suffix = id.slice(0, 8)
  db.prepare(
    'INSERT INTO "User" ("id","username","email","passwordHash","failedLoginAttempts","createdAt","updatedAt") VALUES (?,?,?,?,0,?,?)',
  ).run(
    id,
    opts.username ?? `user_${suffix}`,
    opts.email ?? `user_${suffix}@example.com`,
    opts.passwordHash ?? 'hash',
    ts,
    ts,
  )
  return { id }
}

export function makeProject(opts: { name?: string; ownerId?: string } = {}): {
  id: string
} {
  const id = genId()
  const ts = nowMs()
  db.prepare(
    'INSERT INTO "Project" ("id","name","description","createdAt","updatedAt","ownerId") VALUES (?,?,?,?,?,?)',
  ).run(id, opts.name ?? 'Test Project', null, ts, ts, opts.ownerId ?? null)
  return { id }
}

export function makeWhiteboard(opts: {
  projectId: string
  name?: string
}): { id: string } {
  const id = genId()
  const ts = nowMs()
  db.prepare(
    'INSERT INTO "Whiteboard" ("id","name","projectId","folderId","canvasState","textSource","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, opts.name ?? 'Test WB', opts.projectId, null, null, null, ts, ts)
  return { id }
}

export function makeTable(opts: {
  whiteboardId: string
  name?: string
}): { id: string } {
  const id = genId()
  const ts = nowMs()
  db.prepare(
    'INSERT INTO "DiagramTable" ("id","whiteboardId","name","description","positionX","positionY","width","height","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(id, opts.whiteboardId, opts.name ?? 'Test Table', null, 0, 0, null, null, ts, ts)
  return { id }
}

export function makeColumn(opts: {
  tableId: string
  name?: string
  order?: number
  isPrimaryKey?: boolean
}): { id: string } {
  const id = genId()
  const ts = nowMs()
  db.prepare(
    'INSERT INTO "Column" ("id","tableId","name","dataType","isPrimaryKey","isForeignKey","isUnique","isNullable","description","order","createdAt","updatedAt") VALUES (?,?,?,?,?,0,0,0,?,?,?,?)',
  ).run(
    id,
    opts.tableId,
    opts.name ?? `col_${id.slice(0, 6)}`,
    'string',
    toDbBool(opts.isPrimaryKey ?? false),
    null,
    opts.order ?? 0,
    ts,
    ts,
  )
  return { id }
}
