// src/lib/react-flow/highlighting.test.ts
// Unit tests for filterValidEdges and getDirectlyRelatedTableIds
// (GitHub issue #99 hover preview)

import { describe, expect, it } from 'vitest'
import {
  calculateHighlighting,
  filterValidEdges,
  getDirectlyRelatedTableIds,
} from './highlighting'
import { Z_INDEX } from './types'
import type { RelationshipEdgeType, TableNodeType } from './types'

function makeNode(
  id: string,
  columnIds: Array<string> = [`${id}-col-1`],
): TableNodeType {
  return {
    id,
    type: 'table',
    position: { x: 0, y: 0 },
    data: {
      table: {
        id,
        whiteboardId: 'wb-1',
        name: `Table ${id}`,
        description: null,
        positionX: 0,
        positionY: 0,
        width: null,
        height: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        columns: columnIds.map((colId, idx) => ({
          id: colId,
          tableId: id,
          name: `col_${idx}`,
          dataType: 'text',
          isPrimaryKey: idx === 0,
          isForeignKey: false,
          isUnique: false,
          isNullable: true,
          description: null,
          order: idx,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      isActiveHighlighted: false,
      isHighlighted: false,
      showMode: 'ALL_FIELDS',
    },
  } as unknown as TableNodeType
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceColumnId: string,
  targetColumnId: string,
): RelationshipEdgeType {
  return {
    id,
    type: 'relationship',
    source,
    target,
    data: {
      relationship: {
        id,
        whiteboardId: 'wb-1',
        sourceTableId: source,
        targetTableId: target,
        sourceColumnId,
        targetColumnId,
        cardinality: 'ONE_TO_MANY',
        label: null,
        routingPoints: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        sourceColumn: {} as any,
        targetColumn: {} as any,
      },
      cardinality: 'ONE_TO_MANY',
      isHighlighted: false,
    },
  } as unknown as RelationshipEdgeType
}

describe('filterValidEdges', () => {
  it('excludes edges referencing stale/deleted column ids', () => {
    const nodeA = makeNode('a', ['a-col-1'])
    const nodeB = makeNode('b', ['b-col-1'])
    // nodeC's column referenced by the edge no longer exists on nodeC —
    // simulates a column deletion where the edge wasn't cleaned up yet.
    const nodeC = makeNode('c', ['c-col-2'])
    const nodes = [nodeA, nodeB, nodeC]
    const edges = [
      makeEdge('e-ab', 'a', 'b', 'a-col-1', 'b-col-1'),
      // References 'c-col-1', which does not exist on nodeC (only 'c-col-2' does).
      makeEdge('e-ac-stale', 'a', 'c', 'a-col-1', 'c-col-1'),
    ]

    const validEdges = filterValidEdges(nodes, edges)

    expect(validEdges.map((e) => e.id)).toEqual(['e-ab'])
  })

  it('keeps edges whose source and target columns both still exist', () => {
    const nodeA = makeNode('a', ['a-col-1'])
    const nodeB = makeNode('b', ['b-col-1'])
    const edges = [makeEdge('e-ab', 'a', 'b', 'a-col-1', 'b-col-1')]

    const validEdges = filterValidEdges([nodeA, nodeB], edges)

    expect(validEdges.map((e) => e.id)).toEqual(['e-ab'])
  })
})

describe('getDirectlyRelatedTableIds', () => {
  it('returns the seed id plus all 1-hop neighbors', () => {
    const edges = [
      makeEdge('e-ab', 'a', 'b', 'a-col-1', 'b-col-1'),
      makeEdge('e-ac', 'a', 'c', 'a-col-1', 'c-col-1'),
    ]

    const { relatedTableIds, relatedEdges } = getDirectlyRelatedTableIds(
      'a',
      edges,
    )

    expect(relatedTableIds).toEqual(new Set(['a', 'b', 'c']))
    expect(relatedEdges.map((e) => e.id).sort()).toEqual(['e-ab', 'e-ac'])
  })

  it('returns an empty relatedTableIds beyond the seed and empty relatedEdges for an isolated table', () => {
    const edges = [makeEdge('e-ab', 'a', 'b', 'a-col-1', 'b-col-1')]

    const { relatedTableIds, relatedEdges } = getDirectlyRelatedTableIds(
      'isolated',
      edges,
    )

    expect(relatedTableIds).toEqual(new Set(['isolated']))
    expect(relatedEdges).toEqual([])
  })

  it('dedupes a self-referencing edge (source === target === tableId) instead of returning it twice', () => {
    // buildEdgeMap pushes a self-loop edge into map.get(tableId) once via the
    // source loop and once via the target loop — getDirectlyRelatedTableIds
    // must collapse that back down to a single entry in relatedEdges.
    const selfEdge = makeEdge('e-self', 'a', 'a', 'a-col-1', 'a-col-1')
    const edges = [selfEdge]

    const { relatedTableIds, relatedEdges } = getDirectlyRelatedTableIds(
      'a',
      edges,
    )

    expect(relatedTableIds).toEqual(new Set(['a']))
    expect(relatedEdges).toHaveLength(1)
    expect(relatedEdges[0].id).toBe('e-self')
  })

  it('excludes edges pre-filtered out by the caller (e.g. stale columns) — combined pipeline', () => {
    const nodeA = makeNode('a', ['a-col-1'])
    const nodeB = makeNode('b', ['b-col-1'])
    const nodeC = makeNode('c', ['c-col-2'])
    const nodes = [nodeA, nodeB, nodeC]
    const edges = [
      makeEdge('e-ab', 'a', 'b', 'a-col-1', 'b-col-1'),
      makeEdge('e-ac-stale', 'a', 'c', 'a-col-1', 'c-col-1'),
    ]

    const validEdges = filterValidEdges(nodes, edges)
    const { relatedTableIds, relatedEdges } = getDirectlyRelatedTableIds(
      'a',
      validEdges,
    )

    expect(relatedTableIds).toEqual(new Set(['a', 'b']))
    expect(relatedEdges.map((e) => e.id)).toEqual(['e-ab'])
  })
})

describe('calculateHighlighting — relationsPreviewTableId (5th param)', () => {
  it('gives the matching node the NODE_RELATIONS_PREVIEW z-index tier and isRelationsPreviewOpen: true', () => {
    const nodeA = makeNode('a')
    const nodeB = makeNode('b')
    const edges: Array<RelationshipEdgeType> = []

    const result = calculateHighlighting([nodeA, nodeB], edges, null, null, 'a')

    const highlightedA = result.nodes.find((n) => n.id === 'a')!
    expect(highlightedA.zIndex).toBe(Z_INDEX.NODE_RELATIONS_PREVIEW)
    expect(highlightedA.data.isRelationsPreviewOpen).toBe(true)
  })

  it('gives a non-matching node isRelationsPreviewOpen: false and leaves its z-index tier unaffected', () => {
    const nodeA = makeNode('a')
    const nodeB = makeNode('b')
    const edges: Array<RelationshipEdgeType> = []

    const result = calculateHighlighting([nodeA, nodeB], edges, null, null, 'a')

    const highlightedB = result.nodes.find((n) => n.id === 'b')!
    expect(highlightedB.data.isRelationsPreviewOpen).toBe(false)
    expect(highlightedB.zIndex).toBe(Z_INDEX.NODE_DEFAULT)
  })

  it('is backward compatible with existing call sites that omit the 5th parameter', () => {
    const nodeA = makeNode('a')
    const edges: Array<RelationshipEdgeType> = []

    const result = calculateHighlighting([nodeA], edges, null, null)

    const highlightedA = result.nodes.find((n) => n.id === 'a')!
    expect(highlightedA.data.isRelationsPreviewOpen).toBe(false)
    expect(highlightedA.zIndex).toBe(Z_INDEX.NODE_DEFAULT)
  })
})
