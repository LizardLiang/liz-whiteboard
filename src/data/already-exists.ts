// src/data/already-exists.ts
// A create that names its own id (an MCP client, an undo restore) must never
// overwrite or duplicate a stored row. These helpers refuse an id that is
// already taken by ANY row of the table, on any board.

import { db } from '@/db'

/**
 * A create was refused because a row with the requested id already exists.
 * The `code` makes `clientErrorMessage` pass the message through and lets the
 * socket handlers ack `ALREADY_EXISTS`.
 */
export class AlreadyExistsError extends Error {
  readonly code = 'ALREADY_EXISTS' as const

  constructor(message: string) {
    super(message)
    this.name = 'AlreadyExistsError'
  }
}

function rowExists(table: string, id: string): boolean {
  return (
    db.prepare(`SELECT 1 AS "x" FROM "${table}" WHERE "id" = ?`).get(id) !==
    undefined
  )
}

/**
 * Throw `AlreadyExistsError` when `id` is given and a row of `table` already
 * has it. Call it before the insert; `refuseTakenIdAfterInsertError` covers a
 * concurrent create that passes this check at the same moment.
 */
export function assertIdFree(
  table: string,
  id: string | undefined,
  message: string,
): void {
  if (id !== undefined && rowExists(table, id)) {
    throw new AlreadyExistsError(message)
  }
}

/**
 * After an insert failed: throw `AlreadyExistsError` when the failure is a
 * UNIQUE violation and a row of `table` now holds `id`. The primary key decides
 * a race between two creates with the same id. Any other unique index on the
 * table (e.g. a table name on a whiteboard) can fire first, so the check reads
 * the id instead of parsing which index failed.
 */
export function refuseTakenIdAfterInsertError(
  error: unknown,
  table: string,
  id: string | undefined,
  message: string,
): void {
  if (id === undefined) return
  if (!(error instanceof Error)) return
  if (!error.message.includes('UNIQUE constraint failed')) return
  if (rowExists(table, id)) throw new AlreadyExistsError(message)
}
