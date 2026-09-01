// src/lib/canvas-engine/text-layout.test.ts
// The plan names text as the engine's largest risk, so this file is the
// most adversarial in Wave 1. It uses a DETERMINISTIC measurer (every
// character is 10 units wide) so caret positions can be asserted exactly
// rather than approximately — a real font would make every expectation a
// guess.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_STYLE,
  caretFromPoint,
  clampCaret,
  deleteBackward,
  deleteForward,
  insertAt,
  layoutText,
  pointFromCaret,
  stepCaret,
} from './text-layout'
import type { TextMeasurer } from './text-layout'

/** Ten units per character — exact, so caret maths is checkable by hand. */
const measure: TextMeasurer = (text) => [...text].length * 10

const STYLE = { ...DEFAULT_TEXT_STYLE, fontSize: 10, lineHeight: 2 } // lineHeight = 20

describe('layoutText', () => {
  it('keeps a short string on one line', () => {
    const layout = layoutText('hello', STYLE, 1000, measure)
    expect(layout.lines).toHaveLength(1)
    expect(layout.lines[0].text).toBe('hello')
    expect(layout.width).toBe(50)
    expect(layout.height).toBe(20)
  })

  it('yields one empty line for empty text, so there is a caret to place', () => {
    // An empty text element with zero lines would have nowhere to draw the
    // caret — the user would type into an invisible void.
    const layout = layoutText('', STYLE, 100, measure)
    expect(layout.lines).toHaveLength(1)
    expect(layout.lines[0].text).toBe('')
    expect(layout.lines[0].carets).toEqual([0])
  })

  it('breaks on explicit newlines', () => {
    const layout = layoutText('a\nb\nc', STYLE, 1000, measure)
    expect(layout.lines.map((l) => l.text)).toEqual(['a', 'b', 'c'])
    // Offsets must point back into the ORIGINAL string, newlines included.
    expect(layout.lines.map((l) => l.start)).toEqual([0, 2, 4])
  })

  it('preserves blank lines', () => {
    const layout = layoutText('a\n\nb', STYLE, 1000, measure)
    expect(layout.lines.map((l) => l.text)).toEqual(['a', '', 'b'])
  })

  it('wraps greedily on spaces', () => {
    // maxWidth 60 = 6 chars. "aaa bbb ccc" -> "aaa" / "bbb" / "ccc".
    const layout = layoutText('aaa bbb ccc', STYLE, 60, measure)
    expect(layout.lines.map((l) => l.text)).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('breaks mid-word when a single word cannot fit', () => {
    // The CJK / long-URL case: no spaces at all. Without mid-word breaking
    // this would run off the element forever.
    const layout = layoutText('aaaaaaaaaa', STYLE, 30, measure)
    expect(layout.lines.length).toBeGreaterThan(1)
    for (const line of layout.lines) {
      expect(line.width).toBeLessThanOrEqual(30)
    }
    expect(layout.lines.map((l) => l.text).join('')).toBe('aaaaaaaaaa')
  })

  it('never loses or duplicates characters when wrapping', () => {
    const text = 'the quick brown fox jumps over the lazy dog'
    for (const maxWidth of [30, 50, 90, 140, 400]) {
      const layout = layoutText(text, STYLE, maxWidth, measure)
      // Compared with whitespace stripped, because a break ON a space
      // legitimately consumes it while a mid-word break does not — so the
      // invariant is about the non-space characters, all of them, once each.
      const rebuilt = layout.lines.map((l) => l.text).join('')
      expect(rebuilt.replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
    }
  })

  it('reports line ranges that are ordered and never overlap', () => {
    // start/end index back into the ORIGINAL string and drive every caret
    // calculation; overlapping or out-of-order ranges would put the caret
    // on the wrong line without any visible layout error.
    const text = 'the quick brown fox jumps over the lazy dog'
    for (const maxWidth of [30, 90, 400]) {
      const layout = layoutText(text, STYLE, maxWidth, measure)
      let previousEnd = -1
      for (const line of layout.lines) {
        expect(line.start).toBeGreaterThan(previousEnd - 1)
        expect(line.end).toBeGreaterThanOrEqual(line.start)
        expect(line.end).toBeLessThanOrEqual(text.length)
        expect(line.end - line.start).toBe(line.text.length)
        previousEnd = line.end
      }
    }
  })

  it('reports the widest line as the layout width', () => {
    const layout = layoutText('a\nabcd\nab', STYLE, 1000, measure)
    expect(layout.width).toBe(40)
  })

  it('does not hang on a zero or negative maxWidth', () => {
    // A collapsed element must not spin the greedy loop forever.
    expect(layoutText('abc', STYLE, 0, measure).lines).toHaveLength(1)
    expect(layoutText('abc', STYLE, -5, measure).lines).toHaveLength(1)
  })
})

describe('caret round-trip', () => {
  it('pointFromCaret and caretFromPoint agree on every slot', () => {
    // The property that matters: click where the caret is drawn and the
    // caret must not move. If this fails, typing lands in the wrong place.
    const text = 'hello world\nsecond line'
    const layout = layoutText(text, STYLE, 1000, measure)
    for (let caret = 0; caret <= text.length; caret += 1) {
      const point = pointFromCaret(layout, caret)
      // Aim at the vertical middle of the line, as a real click would.
      const back = caretFromPoint(layout, {
        x: point.x,
        y: point.y + layout.lineHeight / 2,
      })
      // A caret sitting exactly on a newline boundary is representable at
      // the end of one line or the start of the next; both are correct.
      expect(Math.abs(back - caret)).toBeLessThanOrEqual(1)
    }
  })
})

describe('caretFromPoint', () => {
  const layout = layoutText('abcd', STYLE, 1000, measure)

  it('snaps to the nearest slot, not the containing glyph', () => {
    expect(caretFromPoint(layout, { x: 0, y: 0 })).toBe(0)
    expect(caretFromPoint(layout, { x: 4, y: 0 })).toBe(0) // left half of 'a'
    expect(caretFromPoint(layout, { x: 6, y: 0 })).toBe(1) // right half of 'a'
    expect(caretFromPoint(layout, { x: 40, y: 0 })).toBe(4)
  })

  it('clamps past the end of a line', () => {
    expect(caretFromPoint(layout, { x: 9999, y: 0 })).toBe(4)
  })

  it('clamps above and below the block', () => {
    const multi = layoutText('ab\ncd', STYLE, 1000, measure)
    expect(caretFromPoint(multi, { x: 0, y: -500 })).toBe(0)
    // Below the last line puts the caret on the last line, not line 0.
    expect(caretFromPoint(multi, { x: 20, y: 9999 })).toBe(5)
  })
})

describe('editing operations', () => {
  it('inserts at the caret', () => {
    expect(insertAt('ac', 1, 'b')).toEqual({ text: 'abc', caret: 2 })
    expect(insertAt('', 0, 'hi')).toEqual({ text: 'hi', caret: 2 })
  })

  it('inserts a whole IME composition in one step', () => {
    // Committed CJK composition arrives as a multi-character string, not
    // per-keystroke — the caret must land after all of it.
    expect(insertAt('a', 1, '中文')).toEqual({ text: 'a中文', caret: 3 })
  })

  it('backspaces a whole code point, never half a surrogate pair', () => {
    // Naive slice(caret - 1) corrupts emoji into a lone surrogate, which
    // renders as a replacement glyph and can never be deleted cleanly.
    const emoji = 'a🎉'
    const result = deleteBackward(emoji, emoji.length)
    expect(result.text).toBe('a')
    expect(result.caret).toBe(1)
  })

  it('backspaces CJK correctly', () => {
    expect(deleteBackward('中文', 2)).toEqual({ text: '中', caret: 1 })
  })

  it('is a no-op backspacing at the start', () => {
    expect(deleteBackward('abc', 0)).toEqual({ text: 'abc', caret: 0 })
  })

  it('deletes forward by code point', () => {
    const emoji = '🎉a'
    expect(deleteForward(emoji, 0)).toEqual({ text: 'a', caret: 0 })
    expect(deleteForward('abc', 3)).toEqual({ text: 'abc', caret: 3 })
  })

  it('clamps out-of-range carets rather than producing NaN slices', () => {
    expect(clampCaret('abc', -5)).toBe(0)
    expect(clampCaret('abc', 99)).toBe(3)
    expect(insertAt('abc', 99, 'd').text).toBe('abcd')
  })
})

describe('stepCaret (Wave 3 — arrow-key caret movement)', () => {
  it('steps one code point at a time, not one UTF-16 unit', () => {
    // The same defect deleteBackward was fixed for: '🎉'.length is 2, so a
    // caret stepped by 1 lands INSIDE the surrogate pair, and every
    // subsequent slice produces a replacement glyph.
    const emoji = '🎉a'
    expect(stepCaret(emoji, 0, 1)).toBe(2)
    expect(stepCaret(emoji, 2, -1)).toBe(0)
  })

  it('steps one unit at a time through plain text', () => {
    expect(stepCaret('abc', 1, 1)).toBe(2)
    expect(stepCaret('abc', 1, -1)).toBe(0)
  })

  it('stops at both ends rather than going out of range', () => {
    expect(stepCaret('abc', 0, -1)).toBe(0)
    expect(stepCaret('abc', 3, 1)).toBe(3)
  })

  it('clamps an already-out-of-range caret before stepping', () => {
    expect(stepCaret('abc', 99, 1)).toBe(3)
    expect(stepCaret('abc', -99, -1)).toBe(0)
  })

  it('treats a newline as one ordinary step', () => {
    expect(stepCaret('a\nb', 1, 1)).toBe(2)
  })
})

describe('layoutText alignment', () => {
  // Every case below uses maxWidth 100 = 10 characters at this measurer, so a
  // 3-character line has 70 units of slack and the expected offsets are exact.

  it('leaves carets at zero when align is omitted', () => {
    // The pre-alignment geometry, restated as a regression guard: an omitted
    // align must reproduce it exactly, not merely closely.
    const layout = layoutText('abc', STYLE, 100, measure)
    expect(layout.lines[0].carets).toEqual([0, 10, 20, 30])
  })

  it('leaves carets at zero for explicit left alignment', () => {
    const layout = layoutText('abc', { ...STYLE, align: 'left' }, 100, measure)
    expect(layout.lines[0].carets).toEqual([0, 10, 20, 30])
  })

  it('shifts every caret by half the slack when centred', () => {
    const layout = layoutText(
      'abc',
      { ...STYLE, align: 'center' },
      100,
      measure,
    )
    // slack = 100 - 30 = 70, so the line starts at 35.
    expect(layout.lines[0].carets).toEqual([35, 45, 55, 65])
  })

  it('shifts every caret by the whole slack when right-aligned', () => {
    const layout = layoutText('abc', { ...STYLE, align: 'right' }, 100, measure)
    expect(layout.lines[0].carets).toEqual([70, 80, 90, 100])
  })

  it('aligns each wrapped line INDEPENDENTLY, not the block', () => {
    // The distinction the feature is actually about. "aa bbbb" wraps to lines
    // of different widths; centring the BLOCK would give both the same offset
    // and leave them ragged against each other.
    const layout = layoutText(
      'aa bbbb',
      { ...STYLE, align: 'center' },
      60,
      measure,
    )
    expect(layout.lines.map((line) => line.text)).toEqual(['aa', 'bbbb'])
    // slack 60-20 = 40 -> 20; slack 60-40 = 20 -> 10. Different offsets.
    expect(layout.lines[0].carets[0]).toBe(20)
    expect(layout.lines[1].carets[0]).toBe(10)
  })

  it('leaves an overflowing line at the left edge under every alignment', () => {
    // A single unbreakable run wider than the frame has negative slack. It
    // must overflow to the RIGHT as it always has, not be dragged off the
    // left edge by a negative offset.
    for (const align of ['left', 'center', 'right'] as const) {
      const layout = layoutText('aaaa', { ...STYLE, align }, 0, measure)
      expect(layout.lines[0].carets[0]).toBe(0)
    }
  })

  it('reports the same line widths whatever the alignment', () => {
    // Alignment moves where a line sits; it never changes how wide it is.
    const left = layoutText('abc', { ...STYLE, align: 'left' }, 100, measure)
    const right = layoutText('abc', { ...STYLE, align: 'right' }, 100, measure)
    expect(left.lines[0].width).toBe(right.lines[0].width)
    expect(left.height).toBe(right.height)
  })
})

describe('caret geometry under alignment', () => {
  const CENTRED = { ...STYLE, align: 'center' } as const

  it('round-trips a caret through point and back when centred', () => {
    // The property that actually matters: whatever offset alignment applied,
    // asking for a caret's point and then asking which caret is at that point
    // must return the caret you started with. A shift applied in one direction
    // and not the other is exactly the "click lands a character early" bug.
    const layout = layoutText('abc', CENTRED, 100, measure)
    for (let caret = 0; caret <= 3; caret += 1) {
      const point = pointFromCaret(layout, caret)
      expect(caretFromPoint(layout, point)).toBe(caret)
    }
  })

  it('places the caret at the shifted origin for index 0', () => {
    const layout = layoutText('abc', CENTRED, 100, measure)
    expect(pointFromCaret(layout, 0).x).toBe(35)
  })

  it('reads a click at the block origin as the line start when centred', () => {
    // Clicking left of a centred line — in the empty gutter the alignment
    // created — belongs to that line's first slot, not to nothing.
    const layout = layoutText('abc', CENTRED, 100, measure)
    expect(caretFromPoint(layout, { x: 0, y: 0 })).toBe(0)
  })

  it('reads a click past a centred line as its end', () => {
    const layout = layoutText('abc', CENTRED, 100, measure)
    expect(caretFromPoint(layout, { x: 1000, y: 0 })).toBe(3)
  })
})
