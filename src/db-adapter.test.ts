// @vitest-environment node
// src/db-adapter.test.ts
// The driver adapter in db.ts gives bun:sqlite (production) and node:sqlite
// (dev, vitest) one return shape. This suite runs on node:sqlite, so it feeds
// the adapter a fake statement that answers the way bun:sqlite does.

import { describe, expect, it, vi } from 'vitest'
import type { DriverStatement } from '@/db'
import { adaptDatabase, adaptStatement } from '@/db'

function bunStyleStatement(
  overrides: Partial<DriverStatement> = {},
): DriverStatement {
  return {
    // bun:sqlite answers a query with no row with null.
    get: () => null,
    all: () => [],
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    ...overrides,
  }
}

describe('adaptStatement', () => {
  it('answers get() with no row with undefined, as node:sqlite does', () => {
    const statement = adaptStatement(bunStyleStatement())
    expect(statement.get('missing')).toBeUndefined()
  })

  it('answers get() with no row with undefined when the driver says undefined', () => {
    const statement = adaptStatement(
      bunStyleStatement({ get: () => undefined }),
    )
    expect(statement.get('missing')).toBeUndefined()
  })

  it('returns the row get() finds and passes the parameters through', () => {
    const get = vi.fn(() => ({ id: 'a', n: 1 }))
    const statement = adaptStatement(bunStyleStatement({ get }))
    expect(statement.get('a', 2)).toEqual({ id: 'a', n: 1 })
    expect(get).toHaveBeenCalledWith('a', 2)
  })

  it('returns the rows all() finds', () => {
    const statement = adaptStatement(
      bunStyleStatement({ all: () => [{ id: 'a' }, { id: 'b' }] }),
    )
    expect(statement.all()).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('reports run() changes as a number, also when the driver gives a bigint', () => {
    const statement = adaptStatement(
      bunStyleStatement({
        run: () => ({ changes: 2n, lastInsertRowid: 7n }),
      }),
    )
    expect(statement.run()).toEqual({ changes: 2, lastInsertRowid: 7n })
  })
})

describe('adaptDatabase', () => {
  it('adapts every prepared statement and passes exec through', () => {
    const exec = vi.fn()
    const prepare = vi.fn(() => bunStyleStatement())
    const database = adaptDatabase({ prepare, exec })

    expect(database.prepare('SELECT 1').get()).toBeUndefined()
    expect(prepare).toHaveBeenCalledWith('SELECT 1')
    database.exec('PRAGMA x')
    expect(exec).toHaveBeenCalledWith('PRAGMA x')
  })
})
