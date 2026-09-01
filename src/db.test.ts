// src/db.test.ts
// Regression test for the CanvasElement.revision additive-column migration
// (Hermes review, BLOCKER B3).
//
// `db` is a module-level singleton whose schema guards run once, at import
// time, against the vitest `:memory:` database that `SCHEMA_SQL` already
// creates WITH the `revision` column — so `ensureCanvasElementRevisionColumn`'s
// ALTER branch never runs under the ordinary test suite. This file rigs the
// table back into its pre-migration shape (no `revision` column, mirroring
// any `data/app.db` that predates board-undo) and drives the exported guard
// directly, proving it actually repairs that shape rather than trusting that
// the two lines of SQL merely exist somewhere in the file.

import { beforeEach, describe, expect, it } from 'vitest'
import { db, ensureCanvasElementRevisionColumn, genId, insert, nowMs } from '@/db'
import { resetDb } from '@/test/db-helpers'

/**
 * Rebuild "CanvasElement" without its `revision` column — SQLite's
 * table-rebuild technique, the same one `db.ts`'s own `DiagramTable`
 * migration uses, since older SQLite has no `ALTER TABLE ... DROP COLUMN`.
 * The rebuilt table carries no FOREIGN KEY constraint, which is irrelevant
 * to the column fault under test here and keeps the fixture minimal.
 */
function dropRevisionColumn(): void {
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec(`
    CREATE TABLE "CanvasElement_pre_migration" (
      "id"        TEXT NOT NULL PRIMARY KEY,
      "boardId"   TEXT NOT NULL,
      "kind"      TEXT NOT NULL,
      "positionX" REAL NOT NULL,
      "positionY" REAL NOT NULL,
      "width"     REAL NOT NULL,
      "height"    REAL NOT NULL,
      "rotation"  REAL NOT NULL DEFAULT 0,
      "zIndex"    INTEGER NOT NULL DEFAULT 0,
      "text"      TEXT,
      "style"     JSONB,
      "props"     JSONB,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `)
  db.exec(
    `INSERT INTO "CanvasElement_pre_migration" ("id","boardId","kind","positionX","positionY","width","height","rotation","zIndex","text","style","props","createdAt","updatedAt") SELECT "id","boardId","kind","positionX","positionY","width","height","rotation","zIndex","text","style","props","createdAt","updatedAt" FROM "CanvasElement"`,
  )
  db.exec(`DROP TABLE "CanvasElement"`)
  db.exec(`ALTER TABLE "CanvasElement_pre_migration" RENAME TO "CanvasElement"`)
  db.exec('PRAGMA foreign_keys = ON')
}

function insertElement(): void {
  insert('CanvasElement', {
    id: genId(),
    boardId: 'nonexistent-board-no-fk-on-the-rebuilt-table',
    kind: 'rectangle',
    positionX: 0,
    positionY: 0,
    width: 10,
    height: 10,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: '{}',
    props: '{}',
    revision: 1,
    createdAt: nowMs(),
    updatedAt: nowMs(),
  })
}

beforeEach(() => resetDb())

describe('CanvasElement.revision additive migration (Hermes review, BLOCKER B3)', () => {
  it('adds the column to a table that predates it, and a write no longer throws', () => {
    dropRevisionColumn()
    const before = db
      .prepare(`PRAGMA table_info("CanvasElement")`)
      .all() as Array<{ name: string }>
    expect(before.some((c) => c.name === 'revision')).toBe(false)

    // RED: against the pre-migration shape, a write throws exactly the
    // fault this blocker describes — "no such column: revision".
    expect(() => insertElement()).toThrow()

    ensureCanvasElementRevisionColumn(db)

    const after = db
      .prepare(`PRAGMA table_info("CanvasElement")`)
      .all() as Array<{ name: string }>
    expect(after.some((c) => c.name === 'revision')).toBe(true)

    // GREEN: the same write now succeeds.
    expect(() => insertElement()).not.toThrow()
  })

  it('is a no-op when the column already exists (idempotent, matching its precedent)', () => {
    const before = db.prepare(`PRAGMA table_info("CanvasElement")`).all()
    ensureCanvasElementRevisionColumn(db)
    const after = db.prepare(`PRAGMA table_info("CanvasElement")`).all()
    expect(after).toEqual(before)
  })
})
