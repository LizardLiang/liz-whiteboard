// src/data/canvas-element.ts
// Data access layer for the CanvasElement entity (FigJam-style canvas engine,
// milestone 1). Mirrors src/data/shape.ts's style exactly: raw db.prepare
// calls, parameterised everywhere, insert/update/genId/nowMs from @/db.
//
// This layer speaks the ROW vocabulary (positionX/positionY, per the schema)
// and returns `CanvasElementRecord`. The engine's own `CanvasElement` — x/y in
// world space — is produced by src/lib/canvas-element-adapter.ts. Keeping the
// rename in exactly one place is deliberate: W1 and W3 were both a coordinate
// space used where another was meant.
//
// Convention carried over from the shape layer: every mutating function reads
// the full prior row before writing.

import { createCanvasElementSchema, updateCanvasElementSchema } from './schema'
import type { CreateCanvasElement, UpdateCanvasElement } from './schema'
import type { CanvasElementRecord } from './models'
import { db, genId, insert, mapCanvasElement, nowMs, toDbJson, update } from '@/db'

/**
 * Create a canvas element.
 *
 * `rotation` is written as 0 and is not accepted from the caller: the column
 * exists so rotation needs no schema change later, but milestone 1 has no way
 * to set it. `createShape` does the same thing for the same reason.
 */
export async function createCanvasElement(
  data: CreateCanvasElement,
): Promise<CanvasElementRecord> {
  const validated = createCanvasElementSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    insert('CanvasElement', {
      id,
      boardId: validated.boardId,
      kind: validated.kind,
      positionX: validated.positionX,
      positionY: validated.positionY,
      width: validated.width,
      height: validated.height,
      rotation: 0,
      zIndex: validated.zIndex,
      text: validated.text ?? null,
      style: toDbJson(validated.style ?? {}),
      props: toDbJson(validated.props),
      createdAt: ts,
      updatedAt: ts,
    })
    return mapCanvasElement(
      db.prepare('SELECT * FROM "CanvasElement" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to create canvas element: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Every element on a board, in PAINT ORDER: ascending zIndex, ties broken by
 * creation order so the ordering is stable across reloads.
 *
 * The order matters more here than it does for shapes. The engine's scene
 * re-sorts on construction, but hit-testing walks this list in reverse and
 * takes the first match — so a list that came back in an arbitrary order
 * would make "click the thing on top" non-deterministic.
 */
export async function findCanvasElementsByBoard(
  boardId: string,
): Promise<Array<CanvasElementRecord>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "CanvasElement" WHERE "boardId" = ? ORDER BY "zIndex" ASC, "createdAt" ASC',
      )
      .all(boardId)
      .map((r) => mapCanvasElement(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch canvas elements: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/** Find one canvas element by ID. Returns null when it does not exist. */
export async function findCanvasElementById(
  id: string,
): Promise<CanvasElementRecord | null> {
  try {
    return mapCanvasElement(
      db.prepare('SELECT * FROM "CanvasElement" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch canvas element: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Patch a canvas element. Only explicitly-provided fields are written.
 */
export async function updateCanvasElement(
  id: string,
  data: UpdateCanvasElement,
): Promise<CanvasElementRecord> {
  const validated = updateCanvasElementSchema.parse(data)

  try {
    // Read the full prior row before writing (shape-layer convention).
    const prior = mapCanvasElement(
      db.prepare('SELECT * FROM "CanvasElement" WHERE "id" = ?').get(id),
    )
    if (!prior) throw new Error('Canvas element not found')

    // The update schema has no `kind` — an element's kind never changes — but
    // `props` is still an independently-validated discriminated union with no
    // visibility into the ROW's kind. Cross-check against the prior row this
    // function already read, so `props: { kind: 'text' }` sent against a
    // rectangle is rejected rather than persisted mismatched. Same defect the
    // shape layer's W2 fix closes.
    if (validated.props !== undefined && validated.props.kind !== prior.kind) {
      throw new Error("props.kind must match the element's existing kind")
    }

    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.positionX !== undefined)
      values.positionX = validated.positionX
    if (validated.positionY !== undefined)
      values.positionY = validated.positionY
    if (validated.width !== undefined) values.width = validated.width
    if (validated.height !== undefined) values.height = validated.height
    if (validated.zIndex !== undefined) values.zIndex = validated.zIndex
    if (validated.text !== undefined) values.text = validated.text
    // A style patch REPLACES the stored object rather than merging into it.
    // The schema fills every field with a default, so a partial patch would
    // silently reset the fields it omitted either way — replacing makes that
    // explicit instead of surprising. Callers send the full style.
    if (validated.style !== undefined) values.style = toDbJson(validated.style)
    if (validated.props !== undefined) values.props = toDbJson(validated.props)

    update('CanvasElement', id, values)
    return mapCanvasElement(
      db.prepare('SELECT * FROM "CanvasElement" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update canvas element: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/** Delete a canvas element, returning the row as it was. */
export async function deleteCanvasElement(
  id: string,
): Promise<CanvasElementRecord> {
  try {
    const existing = mapCanvasElement(
      db.prepare('SELECT * FROM "CanvasElement" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Canvas element not found')

    db.prepare('DELETE FROM "CanvasElement" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete canvas element: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * The next free zIndex on a board — one above the current top.
 *
 * Computed in SQL rather than by loading the board: creating an element is
 * the one moment the client may not have the whole scene in hand (a second
 * tab may have added something), and `MAX(zIndex) + 1` is correct regardless.
 */
export async function nextCanvasZIndex(boardId: string): Promise<number> {
  try {
    const row = db
      .prepare(
        'SELECT MAX("zIndex") AS "top" FROM "CanvasElement" WHERE "boardId" = ?',
      )
      .get(boardId)
    const top = row?.top
    return top == null ? 0 : Number(top) + 1
  } catch (error) {
    throw new Error(
      `Failed to compute next z-index: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
