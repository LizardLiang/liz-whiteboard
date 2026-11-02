// Unit tests for the inscribed text frame of each shape kind.

import { describe, expect, it } from 'vitest'
import {
  TEXT_PADDING,
  layoutElementText,
  textFrame,
  textOriginY,
} from './render'
import { diamondContainsPoint } from './hit-test'
import { DEFAULT_ELEMENT_STYLE } from './scene'
import type { CanvasElement } from './scene'

function shape(kind: CanvasElement['kind']): CanvasElement {
  return {
    id: 'e1',
    kind,
    x: 100,
    y: 50,
    width: 200,
    height: 120,
    rotation: 0,
    zIndex: 0,
    text: 'Hi',
    style: { ...DEFAULT_ELEMENT_STYLE },
  }
}

const measure = (value: string) => value.length * 8

describe('textFrame per shape kind', () => {
  it('keeps the whole box for rectangle, ellipse and text', () => {
    for (const kind of ['rectangle', 'ellipse', 'text'] as const) {
      expect(textFrame(shape(kind))).toEqual({
        x: 100 + TEXT_PADDING,
        y: 50 + TEXT_PADDING,
        maxWidth: 200 - TEXT_PADDING * 2,
      })
    }
  })

  it('insets a diamond to its centred half-size box', () => {
    expect(textFrame(shape('diamond'))).toEqual({
      x: 100 + 50 + TEXT_PADDING,
      y: 50 + 30 + TEXT_PADDING,
      maxWidth: 100 - TEXT_PADDING * 2,
    })
  })

  it('puts a triangle text box in its lower half', () => {
    expect(textFrame(shape('triangle'))).toEqual({
      x: 100 + 50 + TEXT_PADDING,
      y: 50 + 60 + TEXT_PADDING,
      maxWidth: 100 - TEXT_PADDING * 2,
    })
  })

  it('aligns vertically inside the inscribed box', () => {
    const el = shape('diamond')
    const layout = layoutElementText(el, measure)
    const top = textOriginY(el, layout)
    const middle = textOriginY(
      {
        ...el,
        style: { ...el.style, verticalAlign: 'middle' },
      },
      layout,
    )
    const bottom = textOriginY(
      {
        ...el,
        style: { ...el.style, verticalAlign: 'bottom' },
      },
      layout,
    )
    expect(top).toBe(50 + 30 + TEXT_PADDING)
    expect(middle).toBeGreaterThan(top)
    expect(bottom + layout.height).toBeCloseTo(50 + 30 + 60 - TEXT_PADDING)
  })

  it('keeps default left/top diamond text inside the diamond polygon', () => {
    const el = shape('diamond')
    expect(el.style.textAlign).toBe('left')
    expect(el.style.verticalAlign).toBe('top')
    const layout = layoutElementText(el, measure)
    const frame = textFrame(el)
    const originY = textOriginY(el, layout)
    const rect = { x: el.x, y: el.y, width: el.width, height: el.height }
    const right = frame.x + Math.max(...layout.lines.map((l) => l.width))
    const bottom = originY + layout.height
    for (const [x, y] of [
      [frame.x, originY],
      [right, originY],
      [frame.x, bottom],
      [right, bottom],
    ]) {
      expect(diamondContainsPoint(rect, { x, y })).toBe(true)
    }
  })
})
