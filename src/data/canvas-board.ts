// src/data/canvas-board.ts
// Data access layer for the CanvasBoard entity (FigJam-style canvas engine,
// milestone 1). Mirrors src/data/whiteboard.ts's style exactly: raw
// db.prepare calls, insert/update/genId/nowMs helpers from @/db.
//
// A canvas board is a SEPARATE board kind from `Whiteboard`. It shares the
// project/folder placement so both can sit in the same navigator, and shares
// nothing else — no DiagramTable, no Shape, no Connector, no snapshot.

import { createCanvasBoardSchema, updateCanvasBoardSchema } from './schema'
import type { CreateCanvasBoard, UpdateCanvasBoard } from './schema'
import type { CanvasBoard } from './models'
import { db, genId, insert, mapCanvasBoard, nowMs, update } from '@/db'

/**
 * Create a canvas board.
 *
 * This exists in milestone 1 for a concrete reason: without it the canvas
 * route is reachable only by hand-inserting a row, which would make the
 * feature untestable end to end.
 */
export async function createCanvasBoard(
  data: CreateCanvasBoard,
): Promise<CanvasBoard> {
  const validated = createCanvasBoardSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    insert('CanvasBoard', {
      id,
      name: validated.name,
      projectId: validated.projectId,
      folderId: validated.folderId ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    return mapCanvasBoard(
      db.prepare('SELECT * FROM "CanvasBoard" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to create canvas board: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/** Find a canvas board by ID. Returns null when it does not exist. */
export async function findCanvasBoardById(
  id: string,
): Promise<CanvasBoard | null> {
  try {
    return mapCanvasBoard(
      db.prepare('SELECT * FROM "CanvasBoard" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch canvas board: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/** All canvas boards in a project, most recently updated first. */
export async function findCanvasBoardsByProject(
  projectId: string,
): Promise<Array<CanvasBoard>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "CanvasBoard" WHERE "projectId" = ? ORDER BY "updatedAt" DESC',
      )
      .all(projectId)
      .map((r) => mapCanvasBoard(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch canvas boards: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/** Rename or re-file a canvas board. */
export async function updateCanvasBoard(
  id: string,
  data: UpdateCanvasBoard,
): Promise<CanvasBoard> {
  const validated = updateCanvasBoardSchema.parse(data)

  try {
    const prior = mapCanvasBoard(
      db.prepare('SELECT * FROM "CanvasBoard" WHERE "id" = ?').get(id),
    )
    if (!prior) throw new Error('Canvas board not found')

    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.name !== undefined) values.name = validated.name
    // `folderId` is nullable AND optional, so absent and explicitly-null are
    // different intents: absent leaves the board where it is, null moves it
    // to the project root.
    if (validated.folderId !== undefined)
      values.folderId = validated.folderId ?? null

    update('CanvasBoard', id, values)
    return mapCanvasBoard(
      db.prepare('SELECT * FROM "CanvasBoard" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update canvas board: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a canvas board. Its elements go with it via the schema's
 * `ON DELETE CASCADE` — there is no un-cascaded delete.
 */
export async function deleteCanvasBoard(id: string): Promise<CanvasBoard> {
  try {
    const existing = mapCanvasBoard(
      db.prepare('SELECT * FROM "CanvasBoard" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Canvas board not found')

    db.prepare('DELETE FROM "CanvasBoard" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete canvas board: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
