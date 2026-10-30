// src/lib/canvas-engine/render-todo.test.ts
// Hit-testing of todo checkboxes: the target comes from the same layout the
// draw uses.

import { describe, expect, it } from 'vitest'
import { TEXT_PADDING, layoutElementText, todoBoxAt } from './render'
import { DEFAULT_ELEMENT_STYLE } from './scene'
import type { CanvasElement } from './scene'

const measure = (text: string, spec?: { fontSize: number }) =>
  [...text].length * (spec?.fontSize ?? 16) * 0.5

function todoElement(patch: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: 'todo',
    kind: 'text',
    x: 100,
    y: 200,
    width: 300,
    height: 120,
    rotation: 0,
    zIndex: 0,
    text: '☐ one\nplain\n☑ two',
    style: {
      ...DEFAULT_ELEMENT_STYLE,
      fontSize: 16,
      textAlign: 'left',
      verticalAlign: 'top',
    },
    ...patch,
  }
}

describe('todoBoxAt', () => {
  const element = todoElement()
  const left = element.x + TEXT_PADDING
  const top = element.y + TEXT_PADDING
  // Line height 16 * 1.4 = 22.4; the box is 14.4 square, 1.6 below the line top.

  it('returns the marker index for a point inside a box', () => {
    expect(todoBoxAt(element, { x: left + 5, y: top + 8 }, measure)).toBe(0)
    expect(
      todoBoxAt(element, { x: left + 5, y: top + 22.4 * 2 + 8 }, measure),
    ).toBe(12)
  })

  it('returns null beside the box, on plain lines and on the text', () => {
    expect(todoBoxAt(element, { x: left + 40, y: top + 8 }, measure)).toBeNull()
    expect(
      todoBoxAt(element, { x: left + 5, y: top + 22.4 + 8 }, measure),
    ).toBeNull()
    expect(todoBoxAt(element, { x: left - 20, y: top + 8 }, measure)).toBeNull()
  })

  it('widens the target by the pad', () => {
    const point = { x: left + 14.4 + 3, y: top + 8 }
    expect(todoBoxAt(element, point, measure)).toBeNull()
    expect(todoBoxAt(element, point, measure, 4)).toBe(0)
  })

  it('follows the layout under right alignment', () => {
    const right = todoElement({
      style: { ...element.style, textAlign: 'right' },
    })
    const box = layoutElementText(right, measure).lines[0].todo?.box
    expect(box).toBeDefined()
    const x = left + (box?.x ?? 0) + 2
    expect(todoBoxAt(right, { x, y: top + 8 }, measure)).toBe(0)
    expect(todoBoxAt(right, { x: left + 2, y: top + 8 }, measure)).toBeNull()
  })

  it('follows the vertical origin under middle alignment', () => {
    const middle = todoElement({
      height: 400,
      style: { ...element.style, verticalAlign: 'middle' },
    })
    expect(todoBoxAt(middle, { x: left + 5, y: top + 8 }, measure)).toBeNull()
    const shift = (400 - TEXT_PADDING * 2 - 22.4 * 3) / 2
    expect(
      todoBoxAt(middle, { x: left + 5, y: top + shift + 8 }, measure),
    ).toBe(0)
  })

  it('returns null for empty text', () => {
    expect(
      todoBoxAt(todoElement({ text: '' }), { x: left, y: top }, measure),
    ).toBeNull()
  })
})
