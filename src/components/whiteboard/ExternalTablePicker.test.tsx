// src/components/whiteboard/ExternalTablePicker.test.tsx
// The file → table → column cascade behind a cross-file reference (LizMeter #83).

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { ExternalTablePicker } from './ExternalTablePicker'
import type { ReferenceTargetFile } from '@/data/table-reference'

// cmdk observes its list via ResizeObserver and scrolls the active item into
// view — neither exists in jsdom. Mirrors WhiteboardSearch.test.tsx.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- lib.dom types scrollIntoView as always-present, but jsdom does not implement it at runtime.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {}
}

const TARGETS: Array<ReferenceTargetFile> = [
  {
    whiteboardId: 'wb-billing',
    whiteboardName: 'Billing',
    tables: [
      {
        id: 'tbl-orders',
        name: 'orders',
        columns: [
          {
            id: 'col-id',
            name: 'id',
            dataType: 'uuid',
            isPrimaryKey: true,
            isForeignKey: false,
          },
          {
            id: 'col-customer',
            name: 'customer_id',
            dataType: 'uuid',
            isPrimaryKey: false,
            isForeignKey: true,
          },
        ],
      },
      { id: 'tbl-payments', name: 'payments', columns: [] },
    ],
  },
  { whiteboardId: 'wb-crm', whiteboardName: 'CRM', tables: [] },
]

function renderPicker(
  over: Partial<React.ComponentProps<typeof ExternalTablePicker>> = {},
) {
  const onConfirm = vi.fn()
  render(
    <ExternalTablePicker
      open
      onOpenChange={vi.fn()}
      targets={TARGETS}
      onConfirm={onConfirm}
      {...over}
    />,
  )
  return { onConfirm }
}

describe('ExternalTablePicker', () => {
  it("starts on the file step, listing the project's other files", () => {
    renderPicker()

    expect(screen.getByText('Billing')).toBeTruthy()
    expect(screen.getByText('CRM')).toBeTruthy()
    expect(screen.getByText(/only files in this project/i)).toBeTruthy()
  })

  it('walks file → table → column and confirms the full selection', () => {
    const { onConfirm } = renderPicker()

    fireEvent.click(screen.getByText('Billing'))
    fireEvent.click(screen.getByText('orders'))
    fireEvent.click(screen.getByText('id'))
    fireEvent.click(screen.getByRole('button', { name: /add reference/i }))

    expect(onConfirm).toHaveBeenCalledWith({
      sourceWhiteboardId: 'wb-billing',
      sourceTableId: 'tbl-orders',
      sourceColumnIds: ['col-id'],
    })
  })

  it('takes more than one column', () => {
    const { onConfirm } = renderPicker()

    fireEvent.click(screen.getByText('Billing'))
    fireEvent.click(screen.getByText('orders'))
    fireEvent.click(screen.getByText('id'))
    fireEvent.click(screen.getByText('customer_id'))
    fireEvent.click(screen.getByRole('button', { name: /add reference/i }))

    expect(onConfirm.mock.calls[0][0].sourceColumnIds).toEqual([
      'col-id',
      'col-customer',
    ])
  })

  it('will not confirm before a column is picked', () => {
    renderPicker()

    fireEvent.click(screen.getByText('Billing'))
    fireEvent.click(screen.getByText('orders'))

    expect(
      screen
        .getByRole('button', { name: /add reference/i })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('goes back from the table step to the file step', () => {
    renderPicker()

    fireEvent.click(screen.getByText('Billing'))
    expect(screen.getByText('payments')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(screen.getByText('CRM')).toBeTruthy()
  })

  it('explains an empty project instead of showing a bare empty list', () => {
    renderPicker({ targets: [] })

    expect(screen.getByText(/no other files yet/i)).toBeTruthy()
  })

  it('names how many relationships a re-target will delete', () => {
    renderPicker({
      initial: {
        sourceWhiteboardId: 'wb-billing',
        sourceTableId: 'tbl-orders',
        sourceColumnIds: ['col-id'],
      },
      pendingDeleteCount: 2,
    })

    expect(screen.getByText(/deletes 2 relationships/i)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /change reference/i }),
    ).toBeTruthy()
  })

  it('says "relationship" in the singular for one', () => {
    renderPicker({
      initial: {
        sourceWhiteboardId: 'wb-billing',
        sourceTableId: 'tbl-orders',
        sourceColumnIds: ['col-id'],
      },
      pendingDeleteCount: 1,
    })

    expect(screen.getByText(/deletes 1 relationship\b/i)).toBeTruthy()
  })
})
