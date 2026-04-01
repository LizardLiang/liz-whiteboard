// src/hooks/use-table-deletion.test.ts
// TS-TD-04: useTableDeletion hook unit tests (keyboard shortcut)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTableDeletion } from './use-table-deletion'

// Mock useReactFlow so we can control getNodes() return value
const mockGetNodes = vi.fn()

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({
    getNodes: mockGetNodes,
  }),
}))

describe('useTableDeletion', () => {
  let onRequestDelete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onRequestDelete = vi.fn()
    mockGetNodes.mockReturnValue([])
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up any lingering focus state
    if (document.activeElement && document.activeElement !== document.body) {
      ;(document.activeElement as HTMLElement).blur()
    }
  })

  it('TC-TD-04-01: Delete key fires onRequestDelete with selected node ID', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: true, type: 'table' },
    ])

    renderHook(() => useTableDeletion(onRequestDelete))

    // document.body is the default active element — not an input
    document.body.focus()
    fireKeydown('Delete')

    expect(onRequestDelete).toHaveBeenCalledWith('tbl-001')
  })

  it('TC-TD-04-02: Backspace key fires onRequestDelete with selected node ID', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: true, type: 'table' },
    ])

    renderHook(() => useTableDeletion(onRequestDelete))

    document.body.focus()
    fireKeydown('Backspace')

    expect(onRequestDelete).toHaveBeenCalledWith('tbl-001')
  })

  it('TC-TD-04-03: Delete key does NOT fire when activeElement is an input', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: true, type: 'table' },
    ])

    renderHook(() => useTableDeletion(onRequestDelete))

    // Create and focus an input
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    fireKeydown('Delete')

    expect(onRequestDelete).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('TC-TD-04-04: Delete key does NOT fire when activeElement is a textarea', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: true, type: 'table' },
    ])

    renderHook(() => useTableDeletion(onRequestDelete))

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    fireKeydown('Delete')

    expect(onRequestDelete).not.toHaveBeenCalled()
    document.body.removeChild(textarea)
  })

  it('TC-TD-04-05: Delete key does NOT fire when activeElement is contenteditable', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: true, type: 'table' },
    ])

    renderHook(() => useTableDeletion(onRequestDelete))

    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    document.body.appendChild(div)
    div.focus()

    fireKeydown('Delete')

    expect(onRequestDelete).not.toHaveBeenCalled()
    document.body.removeChild(div)
  })

  it('TC-TD-04-06: Delete key does nothing when no node is selected', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: false, type: 'table' },
    ])

    renderHook(() => useTableDeletion(onRequestDelete))

    document.body.focus()
    fireKeydown('Delete')

    expect(onRequestDelete).not.toHaveBeenCalled()
  })

  it('TC-TD-04-07: Delete key does nothing when multiple nodes are selected', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: true, type: 'table' },
      { id: 'tbl-002', selected: true, type: 'table' },
    ])

    renderHook(() => useTableDeletion(onRequestDelete))

    document.body.focus()
    fireKeydown('Delete')

    expect(onRequestDelete).not.toHaveBeenCalled()
  })

  it('TC-TD-04-08: Delete key does NOT fire when activeElement is inside a .column-row element', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: true, type: 'table' },
    ])

    renderHook(() => useTableDeletion(onRequestDelete))

    const columnRow = document.createElement('div')
    columnRow.className = 'column-row'
    const innerEl = document.createElement('div')
    innerEl.setAttribute('tabindex', '0')
    columnRow.appendChild(innerEl)
    document.body.appendChild(columnRow)
    innerEl.focus()

    fireKeydown('Delete')

    expect(onRequestDelete).not.toHaveBeenCalled()
    document.body.removeChild(columnRow)
  })

  it('TC-TD-04-09: Delete key does NOT fire when activeElement is inside .add-column-row element', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: true, type: 'table' },
    ])

    renderHook(() => useTableDeletion(onRequestDelete))

    const addColumnRow = document.createElement('div')
    addColumnRow.className = 'add-column-row'
    const innerEl = document.createElement('div')
    innerEl.setAttribute('tabindex', '0')
    addColumnRow.appendChild(innerEl)
    document.body.appendChild(addColumnRow)
    innerEl.focus()

    fireKeydown('Delete')

    expect(onRequestDelete).not.toHaveBeenCalled()
    document.body.removeChild(addColumnRow)
  })

  it('TC-TD-04-10: event listener is cleaned up on unmount', () => {
    mockGetNodes.mockReturnValue([
      { id: 'tbl-001', selected: true, type: 'table' },
    ])

    const { unmount } = renderHook(() => useTableDeletion(onRequestDelete))

    // Verify it fires before unmount
    document.body.focus()
    fireKeydown('Delete')
    expect(onRequestDelete).toHaveBeenCalledOnce()

    // Unmount should remove the listener
    unmount()
    onRequestDelete.mockClear()

    // Fire again after unmount — should NOT call onRequestDelete
    fireKeydown('Delete')
    expect(onRequestDelete).not.toHaveBeenCalled()
  })
})

// Helper to dispatch a keydown event on the document
function fireKeydown(key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(event)
}
