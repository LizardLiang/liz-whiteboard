// A rename onto a name another table on the same whiteboard holds is refused
// with DuplicateTableNameError (the readable message the UI toasts), and the
// stored name stays unchanged.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { DuplicateTableNameError, updateDiagramTable } from './diagram-table'
import { db, insert } from '@/db'
import { SYSTEM } from '@/lib/schema-changelog'
import { makeProject, makeWhiteboard, resetDb } from '@/test/db-helpers'

function insertTable(id: string, whiteboardId: string, name: string): void {
  const ts = Date.now()
  insert('DiagramTable', {
    id,
    whiteboardId,
    name,
    createdAt: ts,
    updatedAt: ts,
  })
}

beforeEach(() => {
  resetDb()
})

describe('updateDiagramTable rename', () => {
  it('renames to a free name', async () => {
    const wb = makeWhiteboard({ projectId: makeProject().id }).id
    const id = randomUUID()
    insertTable(id, wb, 'users')

    const updated = await updateDiagramTable(id, { name: 'accounts' }, SYSTEM)

    expect(updated.name).toBe('accounts')
  })

  it('refuses a name another table on the whiteboard holds, naming it', async () => {
    const wb = makeWhiteboard({ projectId: makeProject().id }).id
    const id = randomUUID()
    insertTable(id, wb, 'users')
    insertTable(randomUUID(), wb, 'orders')

    const attempt = updateDiagramTable(id, { name: 'orders' }, SYSTEM)

    await expect(attempt).rejects.toBeInstanceOf(DuplicateTableNameError)
    await expect(attempt).rejects.toThrow(
      'A table named "orders" already exists on this whiteboard',
    )
    const row = db
      .prepare('SELECT name FROM "DiagramTable" WHERE id = ?')
      .get(id) as { name: string }
    expect(row.name).toBe('users')
  })

  it('allows the same name on another whiteboard', async () => {
    const projectId = makeProject().id
    const a = makeWhiteboard({ projectId }).id
    const b = makeWhiteboard({ projectId }).id
    const id = randomUUID()
    insertTable(id, a, 'users')
    insertTable(randomUUID(), b, 'orders')

    const updated = await updateDiagramTable(id, { name: 'orders' }, SYSTEM)

    expect(updated.name).toBe('orders')
  })

  it('keeps the generic error for a unique violation that is not a name clash', async () => {
    const wb = makeWhiteboard({ projectId: makeProject().id }).id
    const id = randomUUID()
    insertTable(id, wb, 'users')
    db.exec(`CREATE TABLE dup_probe (x INTEGER UNIQUE);
      INSERT INTO dup_probe VALUES (1);
      CREATE TRIGGER dup_probe_trg AFTER UPDATE ON "DiagramTable"
      BEGIN INSERT INTO dup_probe VALUES (1); END;`)
    try {
      const attempt = updateDiagramTable(id, { name: 'accounts' }, SYSTEM)

      await expect(attempt).rejects.toThrow('Failed to update table')
      await expect(attempt).rejects.not.toBeInstanceOf(DuplicateTableNameError)
    } finally {
      db.exec('DROP TRIGGER dup_probe_trg; DROP TABLE dup_probe;')
    }
  })
})
