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

  console.log('db-bun-smoke: ok')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
