// src/components/canvas/TextInputProxy.test.tsx
// Tests for the off-screen IME proxy (Hermes review, W4).
//
// jsdom does not run a real input method, so nothing here proves CJK input
// works — that is Wave 5's e2e job. What jsdom CAN do is dispatch the same
// composition and input events a browser does, in the same orders, which is
// exactly where this component's bugs live: the double-commit on
// `compositionend`, and the composing flag that never clears.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TextInputProxy } from './TextInputProxy'

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    active: true,
    caretScreenPoint: { x: 10, y: 20 },
    onInsertText: vi.fn(),
    onCompositionChange: vi.fn(),
    onKeyDown: vi.fn(() => false),
    onBlur: vi.fn(),
    ...overrides,
  }
  render(<TextInputProxy {...(props as any)} />)
  return {
    props,
    field: screen.getByLabelText<HTMLTextAreaElement>('Canvas text input'),
  }
}

describe('composing flag lifecycle (W4)', () => {
  it('keeps accepting keystrokes after a blur that never fired compositionend', () => {
    // `handleChange` returns early while composing. A browser that blurs
    // mid-composition without firing `compositionend` would leave the flag
    // stuck true and silently drop EVERY later keystroke for the rest of the
    // session — total, silent data loss with no error path.
    const { props, field } = setup()

    fireEvent.compositionStart(field, { data: '' })
    fireEvent.blur(field)

    fireEvent.change(field, { target: { value: 'a' } })

    expect(props.onInsertText).toHaveBeenCalledWith('a')
  })

  it('still suppresses input while a composition is genuinely in flight', () => {
    const { props, field } = setup()

    fireEvent.compositionStart(field, { data: '' })
    fireEvent.change(field, { target: { value: 'n' } })

    expect(props.onInsertText).not.toHaveBeenCalled()
  })

  it('commits composed text once on compositionend and empties the field', () => {
    // Chrome fires `input` AFTER `compositionend`; emptying the field inside
    // compositionend is what stops the composed text arriving twice.
    const { props, field } = setup()

    fireEvent.compositionStart(field, { data: '' })
    fireEvent.compositionUpdate(field, { data: 'ni' })
    fireEvent.compositionEnd(field, { data: '你' })
    fireEvent.change(field, { target: { value: field.value } })

    expect(props.onInsertText).toHaveBeenCalledTimes(1)
    expect(props.onInsertText).toHaveBeenCalledWith('你')
  })

  it('reports composition progress and clears it on end', () => {
    const { props, field } = setup()

    fireEvent.compositionStart(field, { data: '' })
    fireEvent.compositionUpdate(field, { data: 'ni' })
    fireEvent.compositionEnd(field, { data: '你' })

    expect(props.onCompositionChange).toHaveBeenLastCalledWith('')
    expect(props.onCompositionChange).toHaveBeenCalledWith('ni')
  })

  it('forwards blur to the caller so the edit commits', () => {
    const { props, field } = setup()
    fireEvent.blur(field)
    expect(props.onBlur).toHaveBeenCalledTimes(1)
  })
})

describe('key handling', () => {
  it('prevents default only for keys the board consumed', () => {
    const onKeyDown = vi.fn(() => true)
    const { field } = setup({ onKeyDown })

    const consumed = fireEvent.keyDown(field, { key: 'ArrowLeft' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    // fireEvent returns false when preventDefault was called.
    expect(consumed).toBe(false)
  })

  it('leaves keys to the browser while the IME owns them', () => {
    // Enter and Escape accept and cancel a candidate. Interpreting them as
    // board commands mid-composition would make CJK input unusable.
    const onKeyDown = vi.fn(() => true)
    const { field } = setup({ onKeyDown })

    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })

    expect(onKeyDown).not.toHaveBeenCalled()
  })
})
