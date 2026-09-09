// src/components/whiteboard/ExternalTableNode.test.tsx
// The cross-file reference node (LizMeter #83): what it shows, and that it
// jumps to its source only when jumping is actually available.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { ExternalTableNode } from './ExternalTableNode'
import type { ExternalTableNodeData } from '@/lib/react-flow/types'

// React Flow's Handle needs a provider/store; the reference node's own
// behaviour does not, so stub it down to a marker element.
vi.mock('@xyflow/react', () => ({
  Handle: ({ id }: { id: string }) => <div data-handle-id={id} />,
  Position: { Left: 'left', Right: 'right' },
}))

const NODE_ID = 'ref-1'

function makeData(over: Partial<ExternalTableNodeData> = {}) {
  return {
    tableId: NODE_ID,
    sourceWhiteboardId: 'wb-source',
    sourceTableId: 'tbl-orders',
    sourceTableName: 'orders',
    sourceWhiteboardName: 'Billing',
    columns: [
      {
        id: 'stub-1',
        name: 'id',
        dataType: 'uuid',
        isPrimaryKey: true,
        isForeignKey: false,
        missing: false,
      },
    ],
    missing: false,
    isActiveHighlighted: false,
    isHighlighted: false,
    showMode: 'ALL_FIELDS' as const,
    ...over,
  } as ExternalTableNodeData
}

describe('ExternalTableNode', () => {
  it('names the source file and the source table', () => {
    render(<ExternalTableNode id={NODE_ID} data={makeData()} />)

    expect(screen.getByText('Billing')).toBeTruthy()
    expect(screen.getByText('orders')).toBeTruthy()
  })

  it('shows the picked column with its type', () => {
    render(<ExternalTableNode id={NODE_ID} data={makeData()} />)

    expect(screen.getByText('id')).toBeTruthy()
    expect(screen.getByText('uuid')).toBeTruthy()
  })

  it('renders a connect handle keyed to the LOCAL stub column id', () => {
    const { container } = render(
      <ExternalTableNode id={NODE_ID} data={makeData()} />,
    )

    // Every handle must key off the stub column, since that is what a
    // Relationship row actually points at.
    const handles = container.querySelectorAll('[data-handle-id]')
    expect(handles.length).toBeGreaterThan(0)
    for (const handle of handles) {
      expect(handle.getAttribute('data-handle-id')).toContain('stub-1')
    }
  })

  it('jumps to the source on double-click', () => {
    const onJumpToSource = vi.fn()
    render(
      <ExternalTableNode id={NODE_ID} data={makeData({ onJumpToSource })} />,
    )

    fireEvent.doubleClick(screen.getByTestId(`external-table-node-${NODE_ID}`))

    expect(onJumpToSource).toHaveBeenCalledWith('wb-source', 'tbl-orders')
  })

  it('does not navigate when jumping is unavailable (public share link)', () => {
    render(<ExternalTableNode id={NODE_ID} data={makeData()} />)

    // No onJumpToSource — the node still renders, it just does nothing.
    expect(() =>
      fireEvent.doubleClick(
        screen.getByTestId(`external-table-node-${NODE_ID}`),
      ),
    ).not.toThrow()
  })

  it('marks itself missing when the source is gone, keeping the last-known name', () => {
    render(
      <ExternalTableNode
        id={NODE_ID}
        data={makeData({ missing: true, sourceWhiteboardName: null })}
      />,
    )

    const node = screen.getByTestId(`external-table-node-${NODE_ID}`)
    expect(node.getAttribute('data-missing')).toBe('true')
    expect(screen.getByText('Source table no longer exists')).toBeTruthy()
    expect(screen.getByText('orders')).toBeTruthy()
    expect(screen.getByText('Missing file')).toBeTruthy()
  })

  it('marks a vanished column without hiding it', () => {
    render(
      <ExternalTableNode
        id={NODE_ID}
        data={makeData({
          columns: [
            {
              id: 'stub-1',
              name: 'customer_id',
              dataType: 'uuid',
              isPrimaryKey: false,
              isForeignKey: true,
              missing: true,
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('customer_id')).toBeTruthy()
    expect(screen.getByText('missing')).toBeTruthy()
  })
})
