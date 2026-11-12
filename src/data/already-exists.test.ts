// src/data/already-exists.test.ts
// The primary-key path of the id refusal: two creates with the same id that
// both pass the pre-insert check (a concurrent create) must still end with one
// row and an AlreadyExistsError, decided by SQLite's own constraint.

import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  AlreadyExistsError,
  assertIdFree,
  refuseTakenIdAfterInsertError,
} from './already-exists'
import { db, insert } from '@/db'
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

beforeEach(() => {
  resetDb()
})

describe('refuseTakenIdAfterInsertError', () => {
  it('turns a primary-key violation into AlreadyExistsError', () => {
    const whiteboardId = makeWhiteboard({ projectId: makeProject().id }).id
    const id = randomUUID()
    insertTable(id, whiteboardId, 'first')

    const error = caught(() => insertTable(id, whiteboardId, 'second'))

    expect(() =>
      refuseTakenIdAfterInsertError(error, 'DiagramTable', id, 'taken'),
    ).toThrow(AlreadyExistsError)
    expect(
      db.prepare('SELECT "name" FROM "DiagramTable" WHERE "id" = ?').get(id),
    ).toEqual({ name: 'first' })
  })

  it('reads the id even when another unique index fires first', () => {
    // Same id AND same (whiteboardId, name): whichever index SQLite checks
    // first, the id is taken, so the create is ALREADY_EXISTS.
    const whiteboardId = makeWhiteboard({ projectId: makeProject().id }).id
    const id = randomUUID()
    insertTable(id, whiteboardId, 'same')

    const error = caught(() => insertTable(id, whiteboardId, 'same'))

    expect(() =>
      refuseTakenIdAfterInsertError(error, 'DiagramTable', id, 'taken'),
    ).toThrow(AlreadyExistsError)
  })

  it('leaves a unique violation on a free id alone', () => {
    const whiteboardId = makeWhiteboard({ projectId: makeProject().id }).id
    insertTable(randomUUID(), whiteboardId, 'dup')
    const freeId = randomUUID()

    const error = caught(() => insertTable(freeId, whiteboardId, 'dup'))

    expect(() =>
      refuseTakenIdAfterInsertError(error, 'DiagramTable', freeId, 'taken'),
    ).not.toThrow()
  })

  it('does nothing for a create without an id', () => {
    expect(() =>
      refuseTakenIdAfterInsertError(
        new Error('UNIQUE constraint failed: DiagramTable.id'),
        'DiagramTable',
        undefined,
        'taken',
      ),
    ).not.toThrow()
  })
})

describe('assertIdFree', () => {
  it('passes a free id and an absent id, refuses a taken one', () => {
    const whiteboardId = makeWhiteboard({ projectId: makeProject().id }).id
    const id = randomUUID()
    insertTable(id, whiteboardId, 't')

    expect(() =>
      assertIdFree('DiagramTable', randomUUID(), 'taken'),
    ).not.toThrow()
    expect(() => assertIdFree('DiagramTable', undefined, 'taken')).not.toThrow()
    expect(() => assertIdFree('DiagramTable', id, 'taken')).toThrow(
      AlreadyExistsError,
    )
  })
})
