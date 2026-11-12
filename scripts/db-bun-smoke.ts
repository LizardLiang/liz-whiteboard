// scripts/db-bun-smoke.ts
// Runs the db.ts adapter on the real bun:sqlite driver (production's driver)
// against a temporary database file. Vitest runs on node:sqlite only, so
// src/db-bun-runtime.test.ts starts this script under Bun.
// Run by hand: `bun scripts/db-bun-smoke.ts` (exits non-zero on failure).

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

assert.ok(
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined',
  'this script must run under Bun',
)

const dir = mkdtempSync(join(tmpdir(), 'liz-db-bun-smoke-'))
process.env.DATABASE_URL = `file:${join(dir, 'smoke.db')}`

try {
  const { db } = await import('../src/db')

  db.exec('CREATE TABLE "Smoke" ("id" TEXT PRIMARY KEY, "n" INTEGER)')
  const inserted = db
    .prepare('INSERT INTO "Smoke" ("id", "n") VALUES (?, ?)')
    .run('a', 1)
  assert.equal(inserted.changes, 1)
  assert.equal(typeof inserted.changes, 'number')

  const select = db.prepare('SELECT * FROM "Smoke" WHERE "id" = ?')
  assert.deepEqual({ ...select.get('a') }, { id: 'a', n: 1 })
  assert.equal(select.get('missing'), undefined)

  assert.deepEqual(
    db
      .prepare('SELECT * FROM "Smoke" ORDER BY "id"')
      .all()
      .map((row) => ({ ...row })),
    [{ id: 'a', n: 1 }],
  )
  assert.deepEqual(db.prepare('SELECT * FROM "Smoke" WHERE 0').all(), [])

  const untouched = db
    .prepare('UPDATE "Smoke" SET "n" = 2 WHERE "id" = ?')
    .run('missing')
  assert.equal(untouched.changes, 0)

  // The RetiredId tombstone triggers (schema-sql.ts) on the production driver:
  // a deleted table and its cascaded column are recorded against their
  // whiteboard, and deleting the whiteboard prunes them again.
  const ts = Date.now()
  db.prepare(
    'INSERT INTO "Project" ("id","name","createdAt","updatedAt") VALUES (?,?,?,?)',
  ).run('p1', 'P', ts, ts)
  db.prepare(
    'INSERT INTO "Whiteboard" ("id","name","projectId","createdAt","updatedAt") VALUES (?,?,?,?,?)',
  ).run('w1', 'W', 'p1', ts, ts)
  db.prepare(
    'INSERT INTO "DiagramTable" ("id","whiteboardId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)',
  ).run('t1', 'w1', 'T', ts, ts)
  db.prepare(
    'INSERT INTO "Column" ("id","tableId","name","dataType","createdAt","updatedAt") VALUES (?,?,?,?,?,?)',
  ).run('c1', 't1', 'C', 'text', ts, ts)
  db.prepare('DELETE FROM "DiagramTable" WHERE "id" = ?').run('t1')
  const retired = db
    .prepare(
      'SELECT "id","entity","whiteboardId" FROM "RetiredId" ORDER BY "id"',
    )
    .all()
    .map((row) => ({ ...row }))
  assert.deepEqual(retired, [
    { id: 'c1', entity: 'Column', whiteboardId: 'w1' },
    { id: 't1', entity: 'DiagramTable', whiteboardId: 'w1' },
  ])
  db.prepare('DELETE FROM "Whiteboard" WHERE "id" = ?').run('w1')
  assert.deepEqual(db.prepare('SELECT * FROM "RetiredId"').all(), [])

  console.log('db-bun-smoke: ok')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
