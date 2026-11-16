/**
 * Relationship endpoint patches — the pure part of "drag a line's end onto a
 * new column". Builds the minimal patch a reconnect sends over
 * `relationship:update`, and applies a patch (local or from a peer) to an edge.
 */

import { createColumnHandleId, parseColumnHandleId } from './edge-routing'
import type { Connection } from '@xyflow/react'
import type { Column } from '@/data/models'
import type { RelationshipEdgeType } from './types'

export interface RelationshipEndpointPatch {
  sourceTableId?: string
  sourceColumnId?: string
  targetTableId?: string
  targetColumnId?: string
}

/** Fields a `relationship:update` can carry — a label and/or endpoints. */
export interface RelationshipUpdatePatch extends RelationshipEndpointPatch {
  label?: string
}

/** Looks up a column by table and column id, on the board's current nodes. */
export type ColumnLookup = (
  tableId: string,
  columnId: string,
) => Column | undefined

/**
 * Compare a reconnect drop with the relationship's current endpoints and
 * return only the fields that changed. Null when the drop is not on a column
 * handle; an empty object when it landed back on the same columns.
 */
export function buildReconnectPatch(
  oldEdge: RelationshipEdgeType,
  connection: Connection,
): RelationshipEndpointPatch | null {
  const relationship = oldEdge.data?.relationship
  if (!relationship) return null
  const { source, target, sourceHandle, targetHandle } = connection
  if (!source || !target || !sourceHandle || !targetHandle) return null
  const parsedSource = parseColumnHandleId(sourceHandle)
  const parsedTarget = parseColumnHandleId(targetHandle)
  if (!parsedSource || !parsedTarget) return null

  const patch: RelationshipEndpointPatch = {}
  if (source !== relationship.sourceTableId) patch.sourceTableId = source
  if (parsedSource.columnId !== relationship.sourceColumnId) {
    patch.sourceColumnId = parsedSource.columnId
  }
  if (target !== relationship.targetTableId) patch.targetTableId = target
  if (parsedTarget.columnId !== relationship.targetColumnId) {
    patch.targetColumnId = parsedTarget.columnId
  }
  return patch
}

/** The Socket.IO ack the server returns for a `relationship:update`. */
export interface RelationshipUpdateAck {
  ok: boolean
  code?: string
  message?: string
}

/**
 * True when applying the patch would give the relationship the same
 * (sourceColumnId, targetColumnId) pair as another relationship — the database
 * holds a UNIQUE index on that pair, so the server would reject the update.
 */
export function wouldDuplicateEndpointPair(
  edges: ReadonlyArray<RelationshipEdgeType>,
  oldEdge: RelationshipEdgeType,
  patch: RelationshipEndpointPatch,
): boolean {
  const relationship = oldEdge.data?.relationship
  if (!relationship) return false
  const sourceColumnId = patch.sourceColumnId ?? relationship.sourceColumnId
  const targetColumnId = patch.targetColumnId ?? relationship.targetColumnId
  return edges.some((e) => {
    const other = e.data?.relationship
    return (
      e.id !== oldEdge.id &&
      !!other &&
      other.sourceColumnId === sourceColumnId &&
      other.targetColumnId === targetColumnId
    )
  })
}

/**
 * Undo a rejected endpoint patch on the CURRENT edge: restore only the fields
 * the patch changed, from the edge as it was before the patch. Everything else
 * on the edge (a peer's concurrent label change, for one) is left as it is now.
 */
export function rollbackEndpointPatch(
  current: RelationshipEdgeType,
  previous: RelationshipEdgeType,
  patch: RelationshipEndpointPatch,
  findColumn: ColumnLookup,
): RelationshipEdgeType {
  const before = previous.data?.relationship
  if (!before) return current
  const inverse: RelationshipEndpointPatch = {}
  if (patch.sourceTableId !== undefined) {
    inverse.sourceTableId = before.sourceTableId
  }
  if (patch.sourceColumnId !== undefined) {
    inverse.sourceColumnId = before.sourceColumnId
  }
  if (patch.targetTableId !== undefined) {
    inverse.targetTableId = before.targetTableId
  }
  if (patch.targetColumnId !== undefined) {
    inverse.targetColumnId = before.targetColumnId
  }
  return applyEndpointPatch(
    current,
    inverse,
    (tableId, columnId) =>
      findColumn(tableId, columnId) ??
      [before.sourceColumn, before.targetColumn].find(
        (c) => c.id === columnId,
      ),
  )
}

/**
 * Apply endpoint fields to an edge: node ids, handle ids, and the embedded
 * relationship. Handle sides are kept; side routing re-picks them afterwards.
 * Returns the same edge when the patch carries no endpoint fields.
 */
export function applyEndpointPatch(
  edge: RelationshipEdgeType,
  patch: RelationshipEndpointPatch,
  findColumn: ColumnLookup,
): RelationshipEdgeType {
  const relationship = edge.data?.relationship
  if (!relationship) return edge
  const hasEndpoint =
    patch.sourceTableId !== undefined ||
    patch.sourceColumnId !== undefined ||
    patch.targetTableId !== undefined ||
    patch.targetColumnId !== undefined
  if (!hasEndpoint) return edge

  const sourceTableId = patch.sourceTableId ?? relationship.sourceTableId
  const sourceColumnId = patch.sourceColumnId ?? relationship.sourceColumnId
  const targetTableId = patch.targetTableId ?? relationship.targetTableId
  const targetColumnId = patch.targetColumnId ?? relationship.targetColumnId

  const sourceSide =
    (edge.sourceHandle && parseColumnHandleId(edge.sourceHandle)?.side) ||
    'right'
  const targetSide =
    (edge.targetHandle && parseColumnHandleId(edge.targetHandle)?.side) ||
    'left'

  return {
    ...edge,
    source: sourceTableId,
    target: targetTableId,
    sourceHandle: createColumnHandleId(
      sourceTableId,
      sourceColumnId,
      sourceSide,
      'source',
    ),
    targetHandle: createColumnHandleId(
      targetTableId,
      targetColumnId,
      targetSide,
      'target',
    ),
    data: {
      ...edge.data!,
      relationship: {
        ...relationship,
        sourceTableId,
        sourceColumnId,
        targetTableId,
        targetColumnId,
        sourceColumn:
          findColumn(sourceTableId, sourceColumnId) ??
          relationship.sourceColumn,
        targetColumn:
          findColumn(targetTableId, targetColumnId) ??
          relationship.targetColumn,
      },
    },
  }
}

/**
 * Apply a whole `relationship:updated` payload to an edge. A field absent from
 * the payload is left alone, so an endpoint-only update never clears the label.
 */
export function applyRelationshipUpdate(
  edge: RelationshipEdgeType,
  patch: RelationshipUpdatePatch,
  findColumn: ColumnLookup,
): RelationshipEdgeType {
  const moved = applyEndpointPatch(edge, patch, findColumn)
  if (!('label' in patch) || !moved.data) return moved
  return { ...moved, data: { ...moved.data, label: patch.label || undefined } }
}
