// src/data/already-exists.ts
// A create that names its own id (an MCP client) must never overwrite or
// duplicate a stored row. These helpers refuse an id that is already taken by
// ANY row of the table, on any whiteboard.
//
// The refusal must not reveal a row the caller cannot see. `refuseTakenId` is
// the one place that decides what the caller learns: ALREADY_EXISTS when the
// row holding the id is on the caller's own whiteboard (a re-sent create of its
// own), otherwise the same generic failure as any other failed create.

import { db, genId } from '@/db'

/** The ack/error code of a create refused for a taken id on the caller's own board. */
export const ALREADY_EXISTS = 'ALREADY_EXISTS' as const

/**
 * A create was refused because a row on the caller's own whiteboard already
 * has the requested id. The `code` makes `clientErrorMessage` pass the message
 * through and lets the socket handlers ack `ALREADY_EXISTS`.
 */
export class AlreadyExistsError extends Error {
  readonly code = ALREADY_EXISTS

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

/**
 * The tables a client id can be claimed in, with how to find a row's whiteboard
 * (or canvas board). Each query returns one row, with a null `wb` when the
 * whiteboard cannot be placed, so one lookup both finds the holder and places it.
 */
const WHITEBOARD_OF_ROW = {
  DiagramTable:
    'SELECT "whiteboardId" AS "wb" FROM "DiagramTable" WHERE "id" = ?',
  Column:
    'SELECT (SELECT t."whiteboardId" FROM "DiagramTable" t WHERE t."id" = c."tableId") AS "wb" FROM "Column" c WHERE c."id" = ?',
  Relationship:
    'SELECT "whiteboardId" AS "wb" FROM "Relationship" WHERE "id" = ?',
  Area: 'SELECT "whiteboardId" AS "wb" FROM "Area" WHERE "id" = ?',
  CanvasElement: 'SELECT "boardId" AS "wb" FROM "CanvasElement" WHERE "id" = ?',
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

/** True for a SQLite UNIQUE constraint violation (bun:sqlite and node:sqlite). */
export function isUniqueViolation(error: unknown): error is Error {
  return (
    error instanceof Error && error.message.includes('UNIQUE constraint failed')
  )
}

/** The whiteboard of the row of `claim.table` holding `claim.id`, if any. */
function holderWhiteboard(claim: IdClaim & { id: string }): {
  found: boolean
  whiteboardId: string | null
} {
  const row = db.prepare(WHITEBOARD_OF_ROW[claim.table]).get(claim.id) as
    { wb?: string | null } | undefined
  if (row === undefined) return { found: false, whiteboardId: null }
  return { found: true, whiteboardId: row.wb ?? null }
}

/**
 * True when `claim.id` was last held by a row on a DIFFERENT whiteboard (see
 * the RetiredId table in schema-sql.ts). A deleted row's id must not be
 * claimable from another tenant: a later restore of the home whiteboard would
 * collide with the squatter. The home whiteboard may re-use it (undo, restore).
 */
function retiredElsewhere(claim: IdClaim & { id: string }): boolean {
  const row = db
    .prepare(
      'SELECT "whiteboardId" AS "wb" FROM "RetiredId" WHERE "id" = ? AND "entity" = ?',
    )
    .get(claim.id, claim.table) as { wb?: string } | undefined
  return row !== undefined && row.wb !== claim.whiteboardId
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
  const withId = { ...claim, id: claim.id }
  const holder = holderWhiteboard(withId)
  if (holder.found) refuseTakenId(claim, holder.whiteboardId)
  if (retiredElsewhere(withId)) {
    throw new GenericCreateFailure(`Failed to create ${claim.noun}`)
  }
}

/**
 * Claim the id of a create: refuse a taken or retired id, then return the id
 * to insert (the client's, or a fresh one) with the claim that
 * `refuseTakenIdAfterInsertError` needs if the insert fails.
 */
export function claimClientId(
  table: IdTable,
  noun: string,
  validated: { id?: string | undefined; whiteboardId: string },
): { id: string; claim: IdClaim } {
  const claim: IdClaim = {
    table,
    id: validated.id,
    whiteboardId: validated.whiteboardId,
    noun,
  }
  assertIdFree(claim)
  return { id: validated.id ?? genId(), claim }
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
  if (!isUniqueViolation(error)) return
  const holder = holderWhiteboard({ ...claim, id: claim.id })
  if (holder.found) refuseTakenId(claim, holder.whiteboardId)
}

/** The whiteboard a table lives on: the whiteboard a column create writes to. */
export function whiteboardOfTable(tableId: string): string | undefined {
  const row = db.prepare(WHITEBOARD_OF_ROW.DiagramTable).get(tableId) as
    { wb?: string } | undefined
  return row?.wb
}
