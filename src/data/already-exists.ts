// src/data/already-exists.ts
// A create that names its own id (an MCP client) must never overwrite or
// duplicate a stored row. These helpers refuse an id that is already taken by
// ANY row of the table, on any whiteboard.
//
// The refusal must not reveal a row the caller cannot see. `refuseTakenId` is
// the one place that decides what the caller learns: ALREADY_EXISTS when the
// row holding the id is on the caller's own whiteboard (a re-sent create of its
// own), otherwise the same generic failure as any other failed create.

import { db } from '@/db'

/**
 * A create was refused because a row on the caller's own whiteboard already
 * has the requested id. The `code` makes `clientErrorMessage` pass the message
 * through and lets the socket handlers ack `ALREADY_EXISTS`.
 */
export class AlreadyExistsError extends Error {
  readonly code = 'ALREADY_EXISTS' as const

  constructor(message: string) {
    super(message)
    this.name = 'AlreadyExistsError'
  }
}

/**
 * A create was refused because a row on ANOTHER whiteboard has the requested
 * id. It carries only the generic "Failed to create <noun>" text and the plain
 * `Error` name, so the caller sees exactly what any other failed create shows.
 */
class GenericCreateFailure extends Error {}

/** True for either refusal; the data layer rethrows these unwrapped. */
export function isIdRefusal(error: unknown): boolean {
  return (
    error instanceof AlreadyExistsError || error instanceof GenericCreateFailure
  )
}

/** The tables a client id can be claimed in, with how to find a row's whiteboard. */
const WHITEBOARD_OF_ROW = {
  DiagramTable: 'SELECT "whiteboardId" AS "wb" FROM "DiagramTable" WHERE "id" = ?',
  Column:
    'SELECT t."whiteboardId" AS "wb" FROM "Column" c JOIN "DiagramTable" t ON t."id" = c."tableId" WHERE c."id" = ?',
  Relationship:
    'SELECT "whiteboardId" AS "wb" FROM "Relationship" WHERE "id" = ?',
  Area: 'SELECT "whiteboardId" AS "wb" FROM "Area" WHERE "id" = ?',
} as const

export type IdTable = keyof typeof WHITEBOARD_OF_ROW

/** A create that names its own id. */
export interface IdClaim {
  table: IdTable
  id: string | undefined
  /** The whiteboard the create writes to. */
  whiteboardId: string | undefined
  /** Names the row in messages: "Failed to create <noun>". */
  noun: string
}

/** The whiteboard of the row of `claim.table` holding `claim.id`, if any. */
function holderWhiteboard(claim: IdClaim & { id: string }): {
  found: boolean
  whiteboardId: string | null
} {
  // get() answers a missing row with null under bun:sqlite and with
  // undefined under node:sqlite, so both checks test for either.
  const row = db.prepare(WHITEBOARD_OF_ROW[claim.table]).get(claim.id) as
    | { wb?: string | null }
    | undefined
    | null
  if (row != null) return { found: true, whiteboardId: row.wb ?? null }
  // A row the whiteboard query cannot place still holds the id: it is refused
  // with the generic failure.
  const bare = db
    .prepare(`SELECT 1 AS "x" FROM "${claim.table}" WHERE "id" = ?`)
    .get(claim.id)
  return { found: bare != null, whiteboardId: null }
}

/** Throw the refusal the caller may see for a taken id. */
function refuseTakenId(claim: IdClaim, holderWb: string | null): never {
  if (holderWb !== null && holderWb === claim.whiteboardId) {
    throw new AlreadyExistsError(
      `A ${claim.noun} with this id already exists on this whiteboard`,
    )
  }
  throw new GenericCreateFailure(`Failed to create ${claim.noun}`)
}

/**
 * Refuse a taken id before the insert. `refuseTakenIdAfterInsertError` covers
 * a concurrent create that passes this check at the same moment.
 */
export function assertIdFree(claim: IdClaim): void {
  if (claim.id === undefined) return
  const holder = holderWhiteboard({ ...claim, id: claim.id })
  if (holder.found) refuseTakenId(claim, holder.whiteboardId)
}

/**
 * After an insert failed: refuse the create when the failure is a UNIQUE
 * violation and a row of `claim.table` now holds the id. The primary key
 * decides a race between two creates with the same id. Any other unique index
 * on the table (e.g. a table name on a whiteboard) can fire first, so the
 * check reads the id instead of parsing which index failed.
 */
export function refuseTakenIdAfterInsertError(
  error: unknown,
  claim: IdClaim,
): void {
  if (claim.id === undefined) return
  if (!(error instanceof Error)) return
  if (!error.message.includes('UNIQUE constraint failed')) return
  const holder = holderWhiteboard({ ...claim, id: claim.id })
  if (holder.found) refuseTakenId(claim, holder.whiteboardId)
}

/** The whiteboard a table lives on: the whiteboard a column create writes to. */
export function whiteboardOfTable(tableId: string): string | undefined {
  const row = db
    .prepare('SELECT "whiteboardId" AS "wb" FROM "DiagramTable" WHERE "id" = ?')
    .get(tableId) as { wb?: string } | undefined | null
  return row?.wb
}
