// src/data/connector.ts
// Data access layer for the Connector entity (Phase 1: shapes-and-connectors).
// Mirrors src/data/relationship.ts's endpoint-validation pattern
// (assertRelationshipEndpointsValid) and src/data/area.ts's raw-db.prepare
// style.
//
// FR-031: endpoints are dedicated indexed columns, never a JSON-embedded
// lookup. FR-018: `deleteShapeWithConnectors` is the ONE atomic operation
// that removes a shape and every connector touching it — see tech-spec.md §7.

import { createConnectorSchema } from './schema'
import type { CreateConnector } from './schema'
import type { Connector, Shape } from './models'
import {
  db,
  genId,
  insert,
  mapConnector,
  mapShape,
  nowMs,
  toDbJson,
  transaction,
} from '@/db'

/**
 * Validate a connector's endpoints before any write (tech-spec §4):
 * both shapes must exist and belong to the given whiteboard (IDOR guard,
 * FR-037), and neither may be a `line` shape — a zero-area shape has no
 * meaningful boundary (server enforcement point 3 of 3; render and client
 * `isValidConnection` are the other two).
 */
async function assertConnectorEndpointsValid(endpoints: {
  whiteboardId: string
  sourceShapeId: string
  targetShapeId: string
}): Promise<void> {
  const { whiteboardId, sourceShapeId, targetShapeId } = endpoints

  const source = mapShape(
    db.prepare('SELECT * FROM "Shape" WHERE "id" = ?').get(sourceShapeId),
  )
  if (!source || source.whiteboardId !== whiteboardId) {
    throw new Error(
      `sourceShapeId ${sourceShapeId} does not belong to whiteboard ${whiteboardId}.`,
    )
  }

  const target = mapShape(
    db.prepare('SELECT * FROM "Shape" WHERE "id" = ?').get(targetShapeId),
  )
  if (!target || target.whiteboardId !== whiteboardId) {
    throw new Error(
      `targetShapeId ${targetShapeId} does not belong to whiteboard ${whiteboardId}.`,
    )
  }

  if (source.kind === 'line' || target.kind === 'line') {
    throw new Error('Line shapes cannot be connected')
  }
}

/**
 * Create a connector between two shapes.
 * @throws if either endpoint is missing, belongs to a different whiteboard,
 * is a `line` shape, or a connector already exists in that exact direction
 * (unique index on sourceShapeId+targetShapeId).
 */
export async function createConnector(
  data: CreateConnector,
): Promise<Connector> {
  const validated = createConnectorSchema.parse(data)

  await assertConnectorEndpointsValid({
    whiteboardId: validated.whiteboardId,
    sourceShapeId: validated.sourceShapeId,
    targetShapeId: validated.targetShapeId,
  })

  try {
    const id = genId()
    const ts = nowMs()
    insert('Connector', {
      id,
      whiteboardId: validated.whiteboardId,
      sourceShapeId: validated.sourceShapeId,
      targetShapeId: validated.targetShapeId,
      style: toDbJson(validated.style ?? {}),
      createdAt: ts,
      updatedAt: ts,
    })
    return mapConnector(
      db.prepare('SELECT * FROM "Connector" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    // Map the SQLite unique-index violation (a second A->B connector) to the
    // user-facing message tech-spec §3 specifies. B->A remains allowed.
    if (
      message.includes('UNIQUE constraint failed') &&
      message.includes('sourceShapeId') &&
      message.includes('targetShapeId')
    ) {
      throw new Error('These shapes are already connected in that direction')
    }
    throw new Error(`Failed to create connector: ${message}`)
  }
}

/** Find all connectors in a whiteboard, oldest first. */
export async function findConnectorsByWhiteboard(
  whiteboardId: string,
): Promise<Array<Connector>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Connector" WHERE "whiteboardId" = ? ORDER BY "createdAt" ASC',
      )
      .all(whiteboardId)
      .map((r) => mapConnector(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch connectors: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find every connector touching a shape (as either endpoint), via the
 * indexed `sourceShapeId`/`targetShapeId` columns — never a JSON scan (FR-031).
 */
export async function findConnectorsByShapeId(
  shapeId: string,
): Promise<Array<Connector>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Connector" WHERE "sourceShapeId" = ? OR "targetShapeId" = ?',
      )
      .all(shapeId, shapeId)
      .map((r) => mapConnector(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch connectors for shape: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/** Find a connector by ID. @returns Connector or null if not found. */
export async function findConnectorById(id: string): Promise<Connector | null> {
  try {
    return mapConnector(
      db.prepare('SELECT * FROM "Connector" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch connector: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a single connector (not a cascade — used for the standalone
 * `connector:delete` event, e.g. removing a mis-drawn arrow).
 * @returns the deleted connector's pre-delete row (Phase-2 pre-compliance —
 * the ack needs its `updatedAt`).
 */
export async function deleteConnector(id: string): Promise<Connector> {
  try {
    const existing = mapConnector(
      db.prepare('SELECT * FROM "Connector" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Connector not found')
    db.prepare('DELETE FROM "Connector" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete connector: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Atomically delete a shape AND every connector touching it (FR-018) — the
 * one operation that keeps a collaborator from ever observing a connector
 * with a missing endpoint. Reads both the shape row and its attached
 * connector rows BEFORE deleting (Phase-2 pre-compliance: the broadcast
 * cannot name `connectorIds` without it, and this is also the ack's
 * `updatedAt` source).
 *
 * Uses raw `db.prepare` inside `transaction()` directly — never a
 * higher-level data-layer function that opens its own transaction, since
 * SQLite has no nested BEGIN (mirrors `restoreWhiteboardFromSnapshot`).
 *
 * @returns `null` if the shape no longer exists (a concurrent delete raced
 * in between the caller's ownership lookup and this call) — the caller
 * (socket handler) must ack `NOT_FOUND`, never treat this as a thrown error.
 */
export async function deleteShapeWithConnectors(shapeId: string): Promise<{
  shape: Shape
  connectors: Array<Connector>
} | null> {
  return transaction(() => {
    const shape = mapShape(
      db.prepare('SELECT * FROM "Shape" WHERE "id" = ?').get(shapeId),
    )
    if (!shape) return null
    const connectors = db
      .prepare(
        'SELECT * FROM "Connector" WHERE "sourceShapeId" = ? OR "targetShapeId" = ?',
      )
      .all(shapeId, shapeId)
      .map((r) => mapConnector(r)!)
    db.prepare(
      'DELETE FROM "Connector" WHERE "sourceShapeId" = ? OR "targetShapeId" = ?',
    ).run(shapeId, shapeId)
    db.prepare('DELETE FROM "Shape" WHERE "id" = ?').run(shapeId)
    return { shape, connectors }
  })
}
