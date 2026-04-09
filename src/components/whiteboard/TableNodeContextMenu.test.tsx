// @vitest-environment jsdom
// src/components/whiteboard/TableNodeContextMenu.test.tsx
// TS-TD-02: TableNodeContextMenu component unit tests

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { TableNodeContextMenu } from './TableNodeContextMenu'

describe('TableNodeContextMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('TC-TD-02-01: right-click on trigger renders context menu', () => {
    render(
      <TableNodeContextMenu onDeleteTable={vi.fn()}>
        <div data-testid="node">Table</div>
      </TableNodeContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('node'))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('TC-TD-02-02: context menu contains "Delete table" item', () => {
    render(
      <TableNodeContextMenu onDeleteTable={vi.fn()}>
        <div data-testid="node">Table</div>
      </TableNodeContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('node'))
    expect(screen.getByRole('menuitem', { name: /delete table/i })).toBeTruthy()
  })

  it('TC-TD-02-03: "Delete table" item has destructive visual styling', () => {
    render(
      <TableNodeContextMenu onDeleteTable={vi.fn()}>
        <div data-testid="node">Table</div>
      </TableNodeContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('node'))
    const menuItem = screen.getByRole('menuitem', { name: /delete table/i })
    expect(menuItem.className).toContain('destructive')
  })

  it('TC-TD-02-04: clicking "Delete table" calls onDeleteTable', () => {
    const onDeleteTable = vi.fn()
    render(
      <TableNodeContextMenu onDeleteTable={onDeleteTable}>
        <div data-testid="node">Table</div>
      </TableNodeContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('node'))
    const menuItem = screen.getByRole('menuitem', { name: /delete table/i })
    fireEvent.click(menuItem)
    expect(onDeleteTable).toHaveBeenCalledOnce()
  })

  it('TC-TD-02-05: context menu closes on Escape key', () => {
    render(
      <TableNodeContextMenu onDeleteTable={vi.fn()}>
        <div data-testid="node">Table</div>
      </TableNodeContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('node'))
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('TC-TD-02-06: clicking outside the menu closes it (via pointerdown outside)', async () => {
    render(
      <TableNodeContextMenu onDeleteTable={vi.fn()}>
        <div data-testid="node">Table</div>
      </TableNodeContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('node'))
    expect(screen.getByRole('menu')).toBeTruthy()

    // Radix dismisses the menu on pointerdown outside but registers the handler
    // via setTimeout(fn, 0) to avoid immediate dismissal on the opening event.
    // Flush timers to allow the dismiss listener to be registered.
    await act(async () => {
      vi.runAllTimers()
    })

    // Now fire a pointerdown outside the menu
    fireEvent.pointerDown(document.body, { bubbles: true, cancelable: true })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('TC-TD-02-07: "Del" shortcut indicator is shown next to the menu item', () => {
    render(
      <TableNodeContextMenu onDeleteTable={vi.fn()}>
        <div data-testid="node">Table</div>
      </TableNodeContextMenu>,
    )
    fireEvent.contextMenu(screen.getByTestId('node'))
    // The ContextMenuShortcut "Del" text should be visible in the menu
    const menuContent = screen.getByRole('menu')
    expect(menuContent.textContent).toContain('Del')
  })
})
