// src/lib/canvas-engine/text-layout-runs.test.ts
// Run-aware layout: mixed line heights, per-piece wrapping, and caret /
// click / selection geometry on lines of different heights.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_STYLE,
  caretFromPoint,
  layoutText,
  pointFromCaret,
  selectionRects,
} from './text-layout'
import { DEFAULT_ELEMENT_STYLE } from './scene'
import { resolveRuns } from './text-runs'
import type { CanvasTextRun } from './scene'
import type { TextMeasurer } from './text-layout'

/** Half the font size per character; bold adds 2 so weight is observable. */
const measure: TextMeasurer = (text, spec) => {
  const size = spec?.fontSize ?? 10
  const per = size * 0.5 + (spec?.fontWeight === 'bold' ? 2 : 0)
  return [...text].length * per
}

const STYLE = { ...DEFAULT_TEXT_STYLE, fontSize: 10, lineHeight: 2 }

function layout(text: string, runs: Array<CanvasTextRun>, maxWidth = 1000) {
  const segments = resolveRuns(text, {
    ...DEFAULT_ELEMENT_STYLE,
    fontSize: 10,
    textRuns: runs,
  })
  return layoutText(text, STYLE, maxWidth, measure, segments)
}

describe('layoutText with runs', () => {
  it('measures each piece in its own font', () => {
    const result = layout('abcd', [{ start: 2, end: 4, fontSize: 20 }])
    // 'ab' at 10px = 5 each, 'cd' at 20px = 10 each.
    expect(result.lines[0].carets).toEqual([0, 5, 10, 20, 30])
    expect(result.lines[0].pieces?.map((p) => [p.text, p.x, p.width])).toEqual([
      ['ab', 0, 10],
      ['cd', 10, 20],
    ])
  })

  it('gives a line the height of its largest run', () => {
    const result = layout('ab\ncd', [{ start: 3, end: 4, fontSize: 30 }])
    expect(result.lines.map((line) => line.height)).toEqual([20, 60])
    expect(result.lines.map((line) => line.top)).toEqual([0, 20])
    expect(result.height).toBe(80)
    expect(result.mixed).toBe(true)
  })

  it('shares a baseline: smaller pieces sit lower by 0.8 of the size gap', () => {
    const result = layout('abcd', [{ start: 2, end: 4, fontSize: 20 }])
    expect(result.lines[0].pieces?.map((p) => p.offsetY)).toEqual([8, 0])
  })

  it('wraps by the width each run actually takes', () => {
    // Plain 'aaaa bbbb' is 9 * 5 = 45 wide and fits 50; at 20px 'bbbb' is 40 wide, so it wraps.
    const plain = layout('aaaa bbbb', [], 50)
    expect(plain.lines.map((line) => line.text)).toEqual(['aaaa bbbb'])
    const wide = layout('aaaa bbbb', [{ start: 5, end: 9, fontSize: 20 }], 50)
    expect(wide.lines.map((line) => line.text)).toEqual(['aaaa', 'bbbb'])
  })

  it('sizes an empty line by the run it sits in', () => {
    const result = layout('a\n\nb', [{ start: 2, end: 3, fontSize: 30 }])
    expect(result.lines.map((line) => line.height)).toEqual([20, 60, 20])
  })

  it('aligns each line by its own mixed width', () => {
    const segments = resolveRuns('abcd', {
      ...DEFAULT_ELEMENT_STYLE,
      fontSize: 10,
      textRuns: [{ start: 2, end: 4, fontSize: 20 }],
    })
    const result = layoutText(
      'abcd',
      { ...STYLE, align: 'right' },
      100,
      measure,
      segments,
    )
    expect(result.lines[0].carets[0]).toBe(70)
    expect(result.lines[0].pieces?.[0].x).toBe(70)
  })
})

describe('caret geometry on mixed-height lines', () => {
  const result = layout('ab\ncd', [{ start: 3, end: 4, fontSize: 30 }])

  it('puts the caret on its own line with that line height', () => {
    expect(pointFromCaret(result, 4)).toEqual({ x: 15, y: 20, height: 60 })
    expect(pointFromCaret(result, 1)).toEqual({ x: 5, y: 0, height: 20 })
  })

  it('maps a click to the row whose box holds it', () => {
    // Row 2 spans y 20..80, so y = 70 is still row 2, not a row 3.
    expect(caretFromPoint(result, { x: 0, y: 70 })).toBe(3)
    expect(caretFromPoint(result, { x: 1000, y: 70 })).toBe(5)
    expect(caretFromPoint(result, { x: 0, y: 10 })).toBe(0)
    expect(caretFromPoint(result, { x: 0, y: 500 })).toBe(3)
  })

  it('draws selection rects at each line top and height', () => {
    expect(selectionRects(result, 1, 4)).toEqual([
      { x: 5, y: 0, width: 5 + 20 * 0.3, height: 20 },
      { x: 0, y: 20, width: 15, height: 60 },
    ])
  })
})
