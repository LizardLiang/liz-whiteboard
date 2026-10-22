// src/components/canvas/TextEditBar.test.tsx
// The text bar shown while editing a label: visibility, active state and picks.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TextEditBar, textEditBarState } from './TextEditBar'
import { applyStyleChange } from './SelectionToolbar'
import type { CanvasElement, CanvasTextRun } from '@/lib/canvas-engine/scene'
import { DEFAULT_CAMERA } from '@/lib/canvas-engine/camera'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from '@/lib/canvas-engine/scene'

function label(textRuns: Array<CanvasTextRun> = []): CanvasElement {
  return {
    id: 't1',
    kind: 'text',
    x: 100,
    y: 100,
    width: 240,
    height: 48,
    rotation: 0,
    zIndex: 0,
    text: 'hello world',
    style: { ...DEFAULT_ELEMENT_STYLE, textRuns },
  }
}

function setup(overrides: Record<string, unknown> = {}) {
  const onPick = vi.fn()
  const props = {
    scene: sceneFrom([label([{ start: 0, end: 5, fontWeight: 'bold' }])]),
    editing: { elementId: 't1', anchor: 0, caret: 5 },
    camera: DEFAULT_CAMERA,
    readOnly: false,
    onPick,
    ...overrides,
  }
  render(<TextEditBar {...(props as any)} />)
  return { onPick }
}

describe('TextEditBar', () => {
  it('shows nothing when not editing or on a read-only board', () => {
    setup({ editing: null })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('shows nothing on a read-only board', () => {
    setup({ readOnly: true })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('reports the selection state and emits picks', () => {
    const { onPick } = setup()
    expect(screen.getByLabelText('Bold').getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByLabelText('Italic').getAttribute('aria-pressed')).toBe(
      'false',
    )
    fireEvent.click(screen.getByLabelText('Italic'))
    expect(onPick).toHaveBeenCalledWith({ kind: 'toggle', key: 'fontStyle' })
    fireEvent.click(screen.getByLabelText('Text size XL'))
    expect(onPick).toHaveBeenCalledWith({
      kind: 'set',
      key: 'fontSize',
      value: 36,
    })
    fireEvent.click(screen.getByLabelText('Text color Red'))
    expect(onPick).toHaveBeenCalledWith({
      kind: 'set',
      key: 'color',
      value: '#ef4444',
    })
  })

  it('cancels mousedown so the text proxy keeps focus', () => {
    setup()
    const notCancelled = fireEvent.mouseDown(screen.getByLabelText('Bold'))
    expect(notCancelled).toBe(false)
  })
})

describe('textEditBarState', () => {
  it('is null where the selected characters disagree', () => {
    const element = label([{ start: 0, end: 5, fontWeight: 'bold' }])
    const state = textEditBarState(element, { anchor: 0, caret: 11 }, null)
    expect(state.fontWeight).toBeNull()
    expect(state.fontSize).toBe(16)
  })

  it('reads the character before a collapsed caret, overridden by pending', () => {
    const element = label([{ start: 0, end: 5, fontWeight: 'bold' }])
    expect(
      textEditBarState(element, { anchor: 3, caret: 3 }, null).fontWeight,
    ).toBe(true)
    expect(
      textEditBarState(
        element,
        { anchor: 3, caret: 3 },
        {
          fontWeight: 'normal',
        },
      ).fontWeight,
    ).toBe(false)
  })
})

describe('whole-label picks strip the matching runs', () => {
  it('clears the picked attribute from the runs and keeps the others', () => {
    const style = {
      ...DEFAULT_ELEMENT_STYLE,
      textRuns: [
        { start: 0, end: 2, fontWeight: 'bold' as const, underline: true },
        { start: 3, end: 4, fontWeight: 'bold' as const },
      ],
    }
    const next = applyStyleChange(style, {
      target: 'fontWeight',
      value: 'bold',
    })
    expect(next.fontWeight).toBe('bold')
    expect(next.textRuns).toEqual([{ start: 0, end: 2, underline: true }])
  })
})
