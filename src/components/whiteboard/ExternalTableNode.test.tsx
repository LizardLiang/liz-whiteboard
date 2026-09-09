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

// Everything below was found by dogfooding the node in a browser, not by
// review — each unit test above passed the whole time.
describe('ExternalTableNode — reachability of what it renders', () => {
  it('does not clip its own box, so the column handles outside it stay hit-testable', () => {
    const { container } = render(
      <ExternalTableNode id={NODE_ID} data={makeData()} />,
    )

    const card = container.querySelector(
      `[data-testid="external-table-node-${NODE_ID}"]`,
    ) as HTMLElement
    // ColumnHandles sits at left/right -14px. `overflow: hidden` here made the
    // connection dots invisible AND unclickable, so no relationship could be
    // drawn to a reference at all.
    expect(card.style.overflow).not.toBe('hidden')
  })

  it('paints the missing-source header in a colour that is not the header background', () => {
    const { container } = render(
      <ExternalTableNode id={NODE_ID} data={makeData({ missing: true })} />,
    )

    const card = container.querySelector(
      `[data-testid="external-table-node-${NODE_ID}"]`,
    ) as HTMLElement
    const header = card.firstElementChild as HTMLElement
    // This app's light theme defines --destructive-foreground as the SAME
    // colour as --destructive, so using it here painted red on red.
    expect(header.style.background).toBe('var(--destructive)')
    expect(header.style.color).not.toBe('var(--destructive-foreground)')
  })

  it('offers re-target and remove once the pointer is on the node', () => {
    const onRetarget = vi.fn()
    const onDelete = vi.fn()
    const { container } = render(
      <ExternalTableNode
        id={NODE_ID}
        data={makeData({ onRetarget, onDelete })}
      />,
    )
    const card = container.querySelector(
      `[data-testid="external-table-node-${NODE_ID}"]`,
    ) as HTMLElement

    // Both callbacks were threaded into node data from the start with no
    // control to fire them: re-targeting and removing were unreachable.
    fireEvent.pointerEnter(card)
    fireEvent.click(screen.getByTestId(`reference-retarget-${NODE_ID}`))
    fireEvent.click(screen.getByTestId(`reference-delete-${NODE_ID}`))

    expect(onRetarget).toHaveBeenCalledWith(NODE_ID)
    expect(onDelete).toHaveBeenCalledWith(NODE_ID)
  })

  it('hides both actions for a viewer who may not edit (no handlers wired)', () => {
    const { container } = render(
      <ExternalTableNode id={NODE_ID} data={makeData()} />,
    )
    const card = container.querySelector(
      `[data-testid="external-table-node-${NODE_ID}"]`,
    ) as HTMLElement

    fireEvent.pointerEnter(card)

    expect(screen.queryByTestId(`reference-retarget-${NODE_ID}`)).toBeNull()
    expect(screen.queryByTestId(`reference-delete-${NODE_ID}`)).toBeNull()
  })
})
