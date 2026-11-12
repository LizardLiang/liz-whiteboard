// src/data/already-exists.test.ts
// The id refusal's one decision point. A taken id is ALREADY_EXISTS only when
// the row holding it is on the caller's own whiteboard; a row elsewhere gets
// the generic "Failed to create <noun>" failure, so a refusal never reveals a
// row the caller cannot see. The primary-key path covers two creates with the
// same id that both pass the pre-insert check (a concurrent create).

import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AlreadyExistsError,
  assertIdFree,
  isIdRefusal,
  refuseTakenIdAfterInsertError,
} from './already-exists'
import type { IdClaim } from './already-exists'
import { adaptStatement, db, insert } from '@/db'
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

function caught(fn: () => void): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

function boards(): { mine: string; theirs: string } {
  const projectId = makeProject().id
  return {
    mine: makeWhiteboard({ projectId }).id,
    theirs: makeWhiteboard({ projectId }).id,
  }
}

function claim(id: string | undefined, whiteboardId: string): IdClaim {
  return { table: 'DiagramTable', id, whiteboardId, noun: 'table' }
}

/** The refusal `fn` throws, checked to be one of the two refusal kinds. */
function refusal(fn: () => void): Error {
  const error = caught(fn)
  expect(isIdRefusal(error)).toBe(true)
  return error as Error
}

beforeEach(() => {
  resetDb()
})

describe('assertIdFree', () => {
  it('passes a free id and an absent id', () => {
    const { mine } = boards()
    expect(() => assertIdFree(claim(randomUUID(), mine))).not.toThrow()
    expect(() => assertIdFree(claim(undefined, mine))).not.toThrow()
  })

  it('refuses an id on the caller whiteboard with AlreadyExistsError', () => {
    const { mine } = boards()
    const id = randomUUID()
    insertTable(id, mine, 't')

    const error = refusal(() => assertIdFree(claim(id, mine)))

    expect(error).toBeInstanceOf(AlreadyExistsError)
  })

  it('refuses an id on another whiteboard with the generic failure only', () => {
    const { mine, theirs } = boards()
    const id = randomUUID()
    insertTable(id, theirs, 't')

    const error = refusal(() => assertIdFree(claim(id, mine)))

    expect(error).not.toBeInstanceOf(AlreadyExistsError)
    expect(error.name).toBe('Error')
    expect(error.message).toBe('Failed to create table')
    expect((error as { code?: unknown }).code).toBeUndefined()
  })
})

describe('refuseTakenIdAfterInsertError', () => {
  it('turns a primary-key violation on the caller whiteboard into AlreadyExistsError', () => {
    const { mine } = boards()
    const id = randomUUID()
    insertTable(id, mine, 'first')

    const error = caught(() => insertTable(id, mine, 'second'))

    expect(() => refuseTakenIdAfterInsertError(error, claim(id, mine))).toThrow(
      AlreadyExistsError,
    )
    expect(
      db.prepare('SELECT "name" FROM "DiagramTable" WHERE "id" = ?').get(id),
    ).toEqual({ name: 'first' })
  })

  it('turns a primary-key violation against another whiteboard into the generic failure', () => {
    const { mine, theirs } = boards()
    const id = randomUUID()
    insertTable(id, theirs, 'theirs')

    const error = caught(() => insertTable(id, mine, 'mine'))
    const refused = refusal(() =>
      refuseTakenIdAfterInsertError(error, claim(id, mine)),
    )

    expect(refused).not.toBeInstanceOf(AlreadyExistsError)
    expect(refused.message).toBe('Failed to create table')
  })

  it('reads the id even when another unique index fires first', () => {
    // Same id AND same (whiteboardId, name): whichever index SQLite checks
    // first, the id is taken, so the create is refused.
    const { mine } = boards()
    const id = randomUUID()
    insertTable(id, mine, 'same')

    const error = caught(() => insertTable(id, mine, 'same'))

    expect(() => refuseTakenIdAfterInsertError(error, claim(id, mine))).toThrow(
      AlreadyExistsError,
    )
  })

  it('leaves a unique violation on a free id alone', () => {
    const { mine } = boards()
    insertTable(randomUUID(), mine, 'dup')
    const freeId = randomUUID()

    const error = caught(() => insertTable(freeId, mine, 'dup'))

    expect(() =>
      refuseTakenIdAfterInsertError(error, claim(freeId, mine)),
    ).not.toThrow()
  })

  it('does nothing for a create without an id', () => {
    const { mine } = boards()
    expect(() =>
      refuseTakenIdAfterInsertError(
        new Error('UNIQUE constraint failed: DiagramTable.id'),
        claim(undefined, mine),
      ),
    ).not.toThrow()
  })
})

// bun:sqlite (production) answers a query with no row with `null`; node:sqlite
// (vitest, dev) answers `undefined`. This suite runs on node:sqlite, so these
// tests make the driver answer `null` the way bun:sqlite does.
describe('under bun:sqlite, where get() returns null for no row', () => {
  beforeEach(() => {
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql)
      // A bun:sqlite statement, read through the adapter as in production.
      return adaptStatement({
        get: (...params: Array<unknown>) => statement.get(...params) ?? null,
        all: (...params: Array<unknown>) => statement.all(...params),
        run: (...params: Array<unknown>) => statement.run(...params),
      })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes a free id', () => {
    const { mine } = boards()
    expect(() => assertIdFree(claim(randomUUID(), mine))).not.toThrow()
  })

  it('still refuses a taken id on the caller whiteboard', () => {
    const { mine } = boards()
    const id = randomUUID()
    insertTable(id, mine, 't')

    expect(() => assertIdFree(claim(id, mine))).toThrow(AlreadyExistsError)
  })

  it('leaves a duplicate name on a free id alone, so its own error stands', () => {
    const { mine } = boards()
    insertTable(randomUUID(), mine, 'dup')
    const freeId = randomUUID()

    const error = caught(() => insertTable(freeId, mine, 'dup'))

    expect(() =>
      refuseTakenIdAfterInsertError(error, claim(freeId, mine)),
    ).not.toThrow()
  })
})
