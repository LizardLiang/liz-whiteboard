// src/lib/react-flow/convert-references-to-nodes.test.ts
// Turning resolved cross-file references into React Flow nodes (LizMeter #83).

import { describe, expect, it, vi } from 'vitest'

import { convertReferencesToNodes } from './convert-to-nodes'
import type { ResolvedTableReference } from '@/data/table-reference'

function makeReference(
  over: Partial<ResolvedTableReference> = {},
): ResolvedTableReference {
  return {
    table: {
      id: 'ref-1',
      whiteboardId: 'wb-local',
      name: 'orders',
      description: null,
      positionX: 120,
      positionY: 80,
      width: null,
      height: null,
      sourceWhiteboardId: 'wb-billing',
      sourceTableId: 'tbl-orders',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    sourceTableName: 'orders',
    sourceWhiteboardName: 'Billing',
    columns: [
      {
        id: 'stub-1',
        sourceColumnId: 'col-id',
        name: 'id',
        dataType: 'uuid',
        isPrimaryKey: true,
        isForeignKey: false,
        missing: false,
      },
    ],
    missing: false,
    ...over,
  }
}

describe('convertReferencesToNodes', () => {
  it('uses the externalTable node type, keyed by the local row id', () => {
    const [node] = convertReferencesToNodes([makeReference()])

    expect(node.id).toBe('ref-1')
    expect(node.type).toBe('externalTable')
  })

  it('places the node at the stored position', () => {
    const [node] = convertReferencesToNodes([makeReference()])

    expect(node.position).toEqual({ x: 120, y: 80 })
  })

  it('parks a positionless reference off-canvas for measurement', () => {
    const reference = makeReference()
    const [node] = convertReferencesToNodes([
      {
        ...reference,
        table: { ...reference.table, positionX: null, positionY: null },
      },
    ])

    expect(node.position).toEqual({ x: -99999, y: -99999 })
  })

  it('is never natively deletable, so Delete routes through the dialog', () => {
    const [node] = convertReferencesToNodes([makeReference()])

    expect(node.deletable).toBe(false)
  })

  it('carries the stub column ids, which is what relationships point at', () => {
    const [node] = convertReferencesToNodes([makeReference()])

    expect(node.data.columns.map((c) => c.id)).toEqual(['stub-1'])
  })

  it('passes the resolved source names through', () => {
    const [node] = convertReferencesToNodes([makeReference()])

    expect(node.data.sourceTableName).toBe('orders')
    expect(node.data.sourceWhiteboardName).toBe('Billing')
  })

  it('injects the handlers it is given', () => {
    const onJumpToSource = vi.fn()
    const onRetarget = vi.fn()

    const [node] = convertReferencesToNodes([makeReference()], {
      onJumpToSource,
      onRetarget,
    })

    expect(node.data.onJumpToSource).toBe(onJumpToSource)
    expect(node.data.onRetarget).toBe(onRetarget)
  })

  it('leaves the jump handler undefined when none is given', () => {
    // This is how the public share-link path disables jump-to-source.
    const [node] = convertReferencesToNodes([makeReference()])

    expect(node.data.onJumpToSource).toBeUndefined()
  })

  it('propagates the missing flag', () => {
    const [node] = convertReferencesToNodes([
      makeReference({ missing: true, sourceWhiteboardName: null }),
    ])

    expect(node.data.missing).toBe(true)
    expect(node.data.sourceWhiteboardName).toBeNull()
  })
})
