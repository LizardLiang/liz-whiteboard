// src/lib/canvas-engine/text-layout-todo.test.ts
// Todo lines in the layout: a fixed marker advance, a hanging indent on wrapped
// lines, and the per-line checkbox rectangle.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_STYLE,
  TODO_BOX_RATIO,
  TODO_GAP_RATIO,
  caretFromPoint,
  layoutText,
} from './text-layout'
import { DEFAULT_ELEMENT_STYLE } from './scene'
import { resolveRuns } from './text-runs'
import type { TextMeasurer } from './text-layout'

/** Half the font size per character, so a glyph is 5 wide at 10px. */
const measure: TextMeasurer = (text, spec) =>
  [...text].length * (spec?.fontSize ?? 10) * 0.5

const STYLE = { ...DEFAULT_TEXT_STYLE, fontSize: 10, lineHeight: 2 }
const ADVANCE = 10 * (TODO_BOX_RATIO + TODO_GAP_RATIO)

describe('layoutText with todo lines', () => {
  it('measures the marker as a fixed advance, not as its glyph', () => {
    const [line] = layoutText('☐ ab', STYLE, 1000, measure).lines
    expect(line.carets).toEqual([
      0,
      ADVANCE,
      ADVANCE + 5,
      ADVANCE + 10,
      ADVANCE + 15,
    ])
    expect(line.width).toBe(ADVANCE + 15)
  })

  it('exposes the checkbox square on the marker line only', () => {
    const [line] = layoutText('☑ ab', STYLE, 1000, measure).lines
    expect(line.todo).toEqual({
      state: 'done',
      box: { x: 0, y: 1, width: 9, height: 9 },
    })
  })

  it('leaves plain lines without a todo', () => {
    const { lines } = layoutText('☐ a\nplain', STYLE, 1000, measure)
    expect(lines[0].todo?.state).toBe('open')
    expect(lines[1].todo).toBeUndefined()
    expect(lines[1].carets).toEqual([0, 5, 10, 15, 20, 25])
  })

  it('treats a marker that is not at a line start as ordinary text', () => {
    const [line] = layoutText('a ☐', STYLE, 1000, measure).lines
    expect(line.todo).toBeUndefined()
    expect(line.carets).toEqual([0, 5, 10, 15])
  })

  it('indents wrapped lines of a todo line to the text after the box', () => {
    const { lines } = layoutText('☐ aaaa bbbb\nplain', STYLE, 45, measure)
    expect(lines.map((line) => line.text)).toEqual(['☐ aaaa', 'bbbb', 'plain'])
    expect(lines[1].carets[0]).toBe(ADVANCE)
    expect(lines[1].carets[4]).toBe(ADVANCE + 20)
    expect(lines[1].todo).toEqual({ state: 'open' })
    expect(lines[2].carets[0]).toBe(0)
  })

  it('keeps the wrapped line starts and ends as indexes into the text', () => {
    const { lines } = layoutText('☐ aaaa bbbb', STYLE, 45, measure)
    expect(lines.map((line) => [line.start, line.end])).toEqual([
      [0, 6],
      [7, 11],
    ])
  })

  it('shifts a todo line by its alignment offset', () => {
    const [line] = layoutText(
      '☐',
      { ...STYLE, align: 'right' },
      100,
      measure,
    ).lines
    expect(line.carets[0]).toBe(100 - ADVANCE)
    expect(line.todo?.box?.x).toBe(100 - ADVANCE)
  })

  it('places a click on the box at the marker slot', () => {
    const layout = layoutText('☐ ab', STYLE, 1000, measure)
    expect(caretFromPoint(layout, { x: 2, y: 5 })).toBe(0)
    expect(caretFromPoint(layout, { x: ADVANCE + 1, y: 5 })).toBe(1)
  })

  it('keeps wrapping finite when the frame is narrower than the indent', () => {
    const { lines } = layoutText('☐ abc', STYLE, 10, measure)
    expect(lines.map((line) => line.text).join('')).toContain('abc'.slice(-1))
    expect(lines.length).toBeGreaterThan(1)
  })
})

describe('layoutText with todo lines and runs', () => {
  function layout(text: string, fontSize: number, maxWidth = 1000) {
    const segments = resolveRuns(text, {
      ...DEFAULT_ELEMENT_STYLE,
      fontSize: 10,
      textRuns: [{ start: 0, end: text.length, fontSize }],
    })
    return layoutText(text, STYLE, maxWidth, measure, segments)
  }

  it('sizes the marker advance and box from the marker font size', () => {
    const [line] = layout('☐ ab', 20).lines
    expect(line.carets[1]).toBe(ADVANCE * 2)
    expect(line.todo?.box).toEqual({ x: 0, y: 2, width: 18, height: 18 })
  })

  it('drops the marker from the drawn pieces', () => {
    const [line] = layout('☐ ab', 20).lines
    expect(line.pieces?.map((piece) => [piece.text, piece.x])).toEqual([
      [' ab', ADVANCE * 2],
    ])
  })

  it('drops the piece entirely when the line holds only the marker', () => {
    const [line] = layout('☐', 20).lines
    expect(line.pieces).toEqual([])
    expect(line.todo?.state).toBe('open')
  })

  it('indents wrapped lines like the uniform layout', () => {
    const { lines } = layout('☐ aaaa bbbb', 10, 45)
    expect(lines.map((line) => line.text)).toEqual(['☐ aaaa', 'bbbb'])
    expect(lines[1].carets[0]).toBe(ADVANCE)
    expect(lines[1].pieces?.[0].x).toBe(ADVANCE)
  })

  it('matches the uniform layout carets when every run is the base size', () => {
    const uniform = layoutText('☐ aaaa bbbb', STYLE, 45, measure)
    const runs = layout('☐ aaaa bbbb', 10, 45)
    expect(runs.lines.map((line) => line.carets)).toEqual(
      uniform.lines.map((line) => line.carets),
    )
  })
})
