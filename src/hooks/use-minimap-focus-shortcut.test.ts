// src/hooks/use-minimap-focus-shortcut.test.ts
// Tests for the `m` minimap-focus keyboard shortcut (Issue #102).
// Covers: m toggles, Escape collapses only when expanded, modifier/
// input-focus/suppressed/enabled=false no-ops, and listener cleanup.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMinimapFocusShortcut } from './use-minimap-focus-shortcut'

/** Dispatch a keydown on window with the given key and options. */
function pressKey(
  key: string,
  opts: Partial<KeyboardEventInit> & { target?: EventTarget } = {},
) {
  const { target, ...init } = opts
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  if (target) {
    Object.defineProperty(event, 'target', { value: target, writable: false })
  }
  window.dispatchEvent(event)
  return event
}

describe('useMinimapFocusShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('calls onToggle when bare `m` is pressed', () => {
    const onToggle = vi.fn()
    const onCollapse = vi.fn()
    renderHook(() =>
      useMinimapFocusShortcut({ expanded: false, onToggle, onCollapse }),
    )

    pressKey('m')

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onCollapse).not.toHaveBeenCalled()
  })

  it('calls preventDefault on `m`', () => {
    renderHook(() =>
      useMinimapFocusShortcut({
        expanded: false,
        onToggle: vi.fn(),
        onCollapse: vi.fn(),
      }),
    )

    const event = pressKey('m')
    expect(event.defaultPrevented).toBe(true)
  })

  it('calls onCollapse on Escape only when expanded', () => {
    const onCollapse = vi.fn()

    // Not expanded → Escape is ignored
    const { rerender } = renderHook(
      ({ expanded }) =>
        useMinimapFocusShortcut({
          expanded,
          onToggle: vi.fn(),
          onCollapse,
        }),
      { initialProps: { expanded: false } },
    )
    pressKey('Escape')
    expect(onCollapse).not.toHaveBeenCalled()

    // Expanded → Escape collapses
    rerender({ expanded: true })
    pressKey('Escape')
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['metaKey', { metaKey: true }],
    ['altKey', { altKey: true }],
    ['shiftKey', { shiftKey: true }],
  ])('ignores `m` when %s modifier is held', (_name, modifier) => {
    const onToggle = vi.fn()
    renderHook(() =>
      useMinimapFocusShortcut({
        expanded: false,
        onToggle,
        onCollapse: vi.fn(),
      }),
    )

    pressKey('m', modifier)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it.each(['INPUT', 'TEXTAREA'])(
    'ignores `m` while typing in a %s element',
    (tag) => {
      const onToggle = vi.fn()
      renderHook(() =>
        useMinimapFocusShortcut({
          expanded: false,
          onToggle,
          onCollapse: vi.fn(),
        }),
      )

      const el = document.createElement(tag)
      document.body.appendChild(el)
      pressKey('m', { target: el })

      expect(onToggle).not.toHaveBeenCalled()
    },
  )

  it('ignores `m` while focus is in a contenteditable element', () => {
    const onToggle = vi.fn()
    renderHook(() =>
      useMinimapFocusShortcut({
        expanded: false,
        onToggle,
        onCollapse: vi.fn(),
      }),
    )

    const el = document.createElement('div')
    el.setAttribute('contenteditable', 'true')
    document.body.appendChild(el)
    // jsdom derives isContentEditable from the attribute
    pressKey('m', { target: el })

    expect(onToggle).not.toHaveBeenCalled()
  })

  it('does nothing when suppressed', () => {
    const onToggle = vi.fn()
    const onCollapse = vi.fn()
    renderHook(() =>
      useMinimapFocusShortcut({
        expanded: true,
        onToggle,
        onCollapse,
        suppressed: true,
      }),
    )

    pressKey('m')
    pressKey('Escape')

    expect(onToggle).not.toHaveBeenCalled()
    expect(onCollapse).not.toHaveBeenCalled()
  })

  it('does nothing when not enabled (minimap hidden)', () => {
    const onToggle = vi.fn()
    const onCollapse = vi.fn()
    renderHook(() =>
      useMinimapFocusShortcut({
        expanded: true,
        onToggle,
        onCollapse,
        enabled: false,
      }),
    )

    pressKey('m')
    pressKey('Escape')

    expect(onToggle).not.toHaveBeenCalled()
    expect(onCollapse).not.toHaveBeenCalled()
  })

  it('removes the keydown listener on unmount', () => {
    const onToggle = vi.fn()
    const { unmount } = renderHook(() =>
      useMinimapFocusShortcut({
        expanded: false,
        onToggle,
        onCollapse: vi.fn(),
      }),
    )

    unmount()
    pressKey('m')

    expect(onToggle).not.toHaveBeenCalled()
  })
})
