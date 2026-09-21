// src/hooks/use-space-held.test.ts
// The focus rules that decide whether a window-level space press belongs to a
// board. The pan behaviour those rules feed is covered on each surface —
// use-canvas-input.test.ts for the Canvas 2D board, e2e/space-pan.spec.ts for
// both — so this file asserts only the arming decision itself.

import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSpaceHeld } from './use-space-held'

const mounted: Array<HTMLElement> = []

function mount<T extends HTMLElement>(element: T): T {
  document.body.appendChild(element)
  mounted.push(element)
  return element
}

function root(): HTMLDivElement {
  return mount(document.createElement('div'))
}

function press(key = ' ', code = 'Space') {
  const event = new KeyboardEvent('keydown', { key, code, cancelable: true })
  window.dispatchEvent(event)
  return event
}

function release(key = ' ', code = 'Space') {
  window.dispatchEvent(new KeyboardEvent('keyup', { key, code }))
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.remove()
})

describe('useSpaceHeld', () => {
  it('arms while focus rests nowhere, and disarms on keyup', () => {
    const element = root()
    const { result } = renderHook(() => useSpaceHeld({ current: element }))

    act(() => {
      press()
    })
    expect(result.current).toBe(true)

    act(() => {
      release()
    })
    expect(result.current).toBe(false)
  })

  it('arms when a toolbar button OUTSIDE the board has focus', () => {
    // The bug this whole hook exists for. The ER board's Toolbar renders in a
    // sibling subtree of `.react-flow-wrapper`, so scoping the modifier to
    // focus-inside-the-board would leave space dead after every tool click.
    const element = root()
    const button = mount(document.createElement('button'))
    button.focus()

    const { result } = renderHook(() => useSpaceHeld({ current: element }))
    act(() => {
      press()
    })

    expect(result.current).toBe(true)
  })

  it('preventDefaults the press it claims', () => {
    const element = root()
    renderHook(() => useSpaceHeld({ current: element }))

    let event: KeyboardEvent | null = null
    act(() => {
      event = press()
    })

    // Without this the page scrolls under the board on every pan.
    expect(event!.defaultPrevented).toBe(true)
  })

  it('ignores a press while a text field has focus', () => {
    const element = root()
    const input = mount(document.createElement('input'))
    input.focus()

    const { result } = renderHook(() => useSpaceHeld({ current: element }))
    let event: KeyboardEvent | null = null
    act(() => {
      // `bubbles` matters: without it the event never reaches the hook's
      // window listener and the assertion would pass for the wrong reason.
      event = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        cancelable: true,
        bubbles: true,
      })
      input.dispatchEvent(event)
    })

    expect(result.current).toBe(false)
    // preventDefault here would stop the space character being typed.
    expect(event!.defaultPrevented).toBe(false)
  })

  it('ignores a press while a modal dialog has focus', () => {
    // A shadcn dialog renders into a portal. Space must keep activating its
    // focused button rather than panning the board behind it.
    const element = root()
    const dialog = mount(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const confirm = document.createElement('button')
    dialog.appendChild(confirm)
    confirm.focus()

    const { result } = renderHook(() => useSpaceHeld({ current: element }))
    let event: KeyboardEvent | null = null
    act(() => {
      event = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        cancelable: true,
        bubbles: true,
      })
      confirm.dispatchEvent(event)
    })

    expect(result.current).toBe(false)
    expect(event!.defaultPrevented).toBe(false)
  })

  it('ignores every key that is not space', () => {
    const element = root()
    const { result } = renderHook(() => useSpaceHeld({ current: element }))

    act(() => {
      press('a', 'KeyA')
    })

    expect(result.current).toBe(false)
  })

  it('refuses to arm while disabled, and releases a key already held', () => {
    const element = root()
    const { result, rerender } = renderHook(
      ({ disabled }: { disabled: boolean }) =>
        useSpaceHeld({ current: element }, disabled),
      { initialProps: { disabled: false } },
    )

    act(() => {
      press()
    })
    expect(result.current).toBe(true)

    // Text editing opens mid-press: the modifier must drop, not stick.
    act(() => {
      rerender({ disabled: true })
    })
    expect(result.current).toBe(false)

    act(() => {
      press()
    })
    expect(result.current).toBe(false)
  })

  it('releases on window blur, which delivers no keyup at all', () => {
    const element = root()
    const { result } = renderHook(() => useSpaceHeld({ current: element }))

    act(() => {
      press()
    })
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(result.current).toBe(false)
  })

  it('stays disarmed while the board has not mounted', () => {
    const { result } = renderHook(() => useSpaceHeld({ current: null }))

    act(() => {
      press()
    })

    expect(result.current).toBe(false)
  })
})
