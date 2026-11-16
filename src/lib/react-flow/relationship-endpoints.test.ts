import { describe, expect, it } from 'vitest'
import {
  applyEndpointPatch,
  applyRelationshipUpdate,
  buildReconnectPatch,
} from './relationship-endpoints'
import type { RelationshipEdgeType } from './types'

const col = (id: string, name: string) => ({ id, name }) as any

const makeEdge = (): RelationshipEdgeType => ({
  id: 'rel-1',
  source: 'orders',
  target: 'users',
  sourceHandle: 'orders__o-user-id__right__source',
  targetHandle: 'users__u-id__left__target',
  type: 'relationship',
  data: {
    relationship: {
      id: 'rel-1',
      sourceTableId: 'orders',
      sourceColumnId: 'o-user-id',
      targetTableId: 'users',
      targetColumnId: 'u-id',
      sourceColumn: col('o-user-id', 'user_id'),
      targetColumn: col('u-id', 'id'),
    },
    cardinality: 'MANY_TO_ONE',
    isHighlighted: false,
    label: 'places',
  } as any,
})

const columns: Record<string, any> = {
  'orders:o-id': col('o-id', 'id'),
  'accounts:a-id': col('a-id', 'id'),
}
const findColumn = (t: string, c: string) => columns[`${t}:${c}`]

describe('buildReconnectPatch', () => {
  it('returns only the target fields when the target end moved', () => {
    const patch = buildReconnectPatch(makeEdge(), {
      source: 'orders',
      target: 'accounts',
      sourceHandle: 'orders__o-user-id__right__source',
      targetHandle: 'accounts__a-id__left__target',
    })
    expect(patch).toEqual({ targetTableId: 'accounts', targetColumnId: 'a-id' })
  })

  it('returns only the column when the source end moved within its table', () => {
    const patch = buildReconnectPatch(makeEdge(), {
      source: 'orders',
      target: 'users',
      sourceHandle: 'orders__o-id__right__source',
      targetHandle: 'users__u-id__left__target',
    })
    expect(patch).toEqual({ sourceColumnId: 'o-id' })
  })

  it('returns an empty patch when the end lands on the same column', () => {
    const patch = buildReconnectPatch(makeEdge(), {
      source: 'orders',
      target: 'users',
      sourceHandle: 'orders__o-user-id__left__source',
      targetHandle: 'users__u-id__right__target',
    })
    expect(patch).toEqual({})
  })

  it('returns null when a handle is not a column handle', () => {
    expect(
      buildReconnectPatch(makeEdge(), {
        source: 'orders',
        target: 'users',
        sourceHandle: 'shape-src-top',
        targetHandle: 'users__u-id__left__target',
      }),
    ).toBeNull()
  })
})

describe('applyEndpointPatch / applyRelationshipUpdate', () => {
  it('moves the edge, its handles and the embedded relationship', () => {
    const edge = applyEndpointPatch(
      makeEdge(),
      { targetTableId: 'accounts', targetColumnId: 'a-id' },
      findColumn,
    )
    expect(edge.target).toBe('accounts')
    expect(edge.targetHandle).toBe('accounts__a-id__left__target')
    expect(edge.data!.relationship.targetTableId).toBe('accounts')
    expect(edge.data!.relationship.targetColumn.id).toBe('a-id')
    expect(edge.source).toBe('orders')
    expect(edge.data!.cardinality).toBe('MANY_TO_ONE')
  })

  it('keeps the label when a peer payload carries only endpoints', () => {
    const edge = applyRelationshipUpdate(
      makeEdge(),
      { sourceColumnId: 'o-id' },
      findColumn,
    )
    expect(edge.data!.label).toBe('places')
    expect(edge.sourceHandle).toBe('orders__o-id__right__source')
  })

  it('applies a label-only payload without touching endpoints', () => {
    const original = makeEdge()
    const edge = applyRelationshipUpdate(
      original,
      { label: 'owns' },
      findColumn,
    )
    expect(edge.data!.label).toBe('owns')
    expect(edge.source).toBe(original.source)
    expect(edge.data!.relationship).toBe(original.data!.relationship)
  })

  it('clears the label when the payload carries an empty label', () => {
    const edge = applyRelationshipUpdate(makeEdge(), { label: '' }, findColumn)
    expect(edge.data!.label).toBeUndefined()
  })
})
