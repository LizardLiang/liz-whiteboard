// src/lib/canvas-engine/text-layout.ts
// Text layout and caret geometry for the canvas engine (tactical plan
// Wave 1, step 5).
//
// This is the module the plan names as its largest risk, and the reason is
// structural: choosing pure Canvas 2D means the browser gives us NOTHING
// for text beyond "how wide is this string". No wrapping, no caret, no
// selection, no cursor movement — a `<textarea>` does all of that for free
// and here we own every line of it.
//
// So it is isolated behind a pure interface and tested exhaustively without
// a browser. It takes a `measure` FUNCTION rather than a CanvasRenderingContext2D
// precisely so tests can supply a deterministic metric and assert exact
// caret positions; the React layer passes a closure over `ctx.measureText`.
//
// Pure module: no React, no DOM, no canvas.

import { todoMarkerAt } from './text-todo'
import type { CanvasFontSpec } from './render-target'
import type { TextSegment } from './text-runs'
import type { TodoState } from './text-todo'

/**
 * Measures a string's advance width in world units. Without `spec` it uses the
 * caller's own font (the label's); a run-aware layout passes each segment's
 * font explicitly.
 */
export type TextMeasurer = (text: string, spec?: CanvasFontSpec) => number

export interface TextStyle {
  fontSize: number
  lineHeight: number
  /**
   * Where each line sits across `maxWidth`. Optional, defaulting to `'left'`,
   * which is the layout every caller got before alignment existed — so an
   * omitted `align` reproduces the previous geometry exactly rather than
   * merely closely.
   */
  align?: 'left' | 'center' | 'right'
}

export const DEFAULT_TEXT_STYLE: TextStyle = { fontSize: 16, lineHeight: 1.4 }

/**
 * How far into `maxWidth` a line of `width` starts, for each alignment.
 *
 * The shift is baked into every line's `carets` (below) rather than left for
 * the renderer to add, and that is the decision that makes alignment safe
 * here. `caretFromPoint` and `pointFromCaret` are the ONLY readers of caret
 * geometry, both of them read `carets` and nothing else, and every consumer
 * downstream of them — drawing, click-to-caret, arrow-key navigation, the IME
 * candidate window — is therefore aligned by construction. The alternative,
 * an offset applied at each call site, is the same shape as the bug
 * `textFrame`'s own docstring warns about: one site insetting and another not,
 * so every click lands a character early.
 */
function alignOffset(
  width: number,
  maxWidth: number,
  align: TextStyle['align'],
): number {
  // A line WIDER than its frame (one unbreakable glyph, a zero/negative
  // maxWidth) would otherwise get a negative offset and hang off the left
  // edge under centre or right alignment. Overflow goes right, as it always
  // has, whatever the alignment says.
  const slack = Math.max(0, maxWidth - width)
  if (align === 'center') return slack / 2
  if (align === 'right') return slack
  return 0
}

/** One laid-out line and where its characters sit. */
export interface LaidOutLine {
  /** The line's text, without the newline or the space it broke on. */
  text: string
  /** Index into the ORIGINAL string of this line's first character. */
  start: number
  /** Index into the original string one past this line's last character. */
  end: number
  /** Advance width of this line. */
  width: number
  /**
   * `x` offset of each caret slot in this line: `carets[i]` is the offset
   * of the caret BEFORE the line's i-th character, so it has
   * `text.length + 1` entries.
   *
   * ALIGNMENT-ADJUSTED. `carets[0]` is the line's left edge within the text
   * frame — 0 under left alignment, and the alignment offset otherwise — so
   * these are block-local absolute offsets, not distances from the line's own
   * start. Readers add the frame's origin and nothing else.
   */
  carets: Array<number>
  /** `y` of this line's top within the text block. */
  top: number
  /** This line's height: its largest run's font size times the line-height ratio. */
  height: number
  /**
   * The line cut at run boundaries, each piece with its own font. Only present
   * for a run-aware layout; a uniform label draws `text` as one piece.
   */
  pieces?: Array<LinePiece>
  /**
   * Present on every visual line of a todo line (a hard line that starts with
   * a marker). Only the line holding the marker has `box`, the checkbox square
   * in block-local space. The marker is not drawn as a glyph: its caret slot
   * is `TODO_BOX_RATIO + TODO_GAP_RATIO` em wide, and wrapped continuation
   * lines start that far in (hanging indent), so `carets[0]` is the left edge
   * of the text on every such line.
   */
  todo?: { state: TodoState; box?: LocalRect }
}

/** One stretch of a line drawn in a single font. */
export interface LinePiece {
  text: string
  /** Block-local `x` of the piece's left edge (alignment-adjusted). */
  x: number
  width: number
  /**
   * Distance from the line's top to the piece's em-box top. Mixed sizes share
   * one baseline, placed 0.8 em below the em-box top: a piece sits
   * `(largest size on the line - its size) * BASELINE_ASCENT` lower than the
   * line's largest piece.
   */
  offsetY: number
  segment: TextSegment
}

export interface TextLayout {
  lines: Array<LaidOutLine>
  /** The base (label) line height; a mixed line may be taller. */
  lineHeight: number
  width: number
  height: number
  /** True when lines can differ in height, so rows are found by `top`. */
  mixed?: boolean
}

/** Checkbox side, as a fraction of the marker's font size. */
export const TODO_BOX_RATIO = 0.9
/** Gap between the checkbox and the text, as a fraction of the font size. */
export const TODO_GAP_RATIO = 0.35

/** The fixed advance a todo marker takes in place of its glyph. */
function todoAdvance(fontSize: number): number {
  return fontSize * (TODO_BOX_RATIO + TODO_GAP_RATIO)
}

/** The checkbox of a todo line whose text sits at `left` on a line `top` down. */
function todoBox(left: number, top: number, fontSize: number): LocalRect {
  const side = fontSize * TODO_BOX_RATIO
  return { x: left, y: top + fontSize * 0.1, width: side, height: side }
}

/** Where the shared baseline sits below an em box's top, as a fraction of its size. */
export const BASELINE_ASCENT = 0.8

/**
 * Break `text` into lines that fit `maxWidth`, honouring explicit newlines.
 *
 * Greedy word wrapping, breaking on spaces. A single word longer than
 * `maxWidth` is broken mid-word rather than allowed to overflow — without
 * that, one long unbroken string (a URL, or any CJK text, which has no
 * spaces at all) would run off the element forever.
 *
 * With `segments` (the label split at run boundaries, from `resolveRuns`) the
 * same wrapping measures each stretch in its own font and each line is as tall
 * as its largest piece. Without them the layout is the single-font one every
 * label had before runs existed.
 */
export function layoutText(
  text: string,
  style: TextStyle,
  maxWidth: number,
  measure: TextMeasurer,
  segments?: ReadonlyArray<TextSegment>,
): TextLayout {
  if (segments && segments.length > 0) {
    return layoutRuns(text, style, maxWidth, measure, segments)
  }
  const lineHeight = style.fontSize * style.lineHeight
  const lines: Array<LaidOutLine> = []

  // Explicit newlines always break, and an empty string still yields one
  // (empty) line — otherwise an empty text element has no caret to place.
  const paragraphs = text.split('\n')
  let cursor = 0

  for (const paragraph of paragraphs) {
    const state = todoMarkerAt(paragraph, 0)
    const advance = state ? todoAdvance(style.fontSize) : 0
    // The marker is measured as the fixed advance, not as its glyph.
    const markerWidth = state ? measure(paragraph[0]) : 0
    const wrapped = wrapParagraph(paragraph, maxWidth, (from, to) => {
      const raw = measure(paragraph.slice(from, to))
      if (!state) return raw
      return from === 0 ? raw - markerWidth + advance : raw + advance
    })
    for (const piece of wrapped) {
      const start = cursor + piece.offset
      const holdsMarker = state !== null && piece.offset === 0
      let width = measure(piece.text)
      let carets: Array<number>
      if (state === null) {
        carets = caretOffsets(
          piece.text,
          measure,
          alignOffset(width, maxWidth, style.align),
        )
      } else {
        const offsets = caretOffsets(piece.text, measure, 0).map((x, i) =>
          holdsMarker ? (i === 0 ? x : x - markerWidth + advance) : x + advance,
        )
        width = offsets[offsets.length - 1]
        const origin = alignOffset(width, maxWidth, style.align)
        carets = offsets.map((x) => x + origin)
      }
      const top = lines.length * lineHeight
      lines.push({
        text: piece.text,
        start,
        end: start + piece.text.length,
        width,
        carets,
        top,
        height: lineHeight,
        ...(state && {
          todo: {
            state,
            ...(holdsMarker && {
              box: todoBox(carets[0], top, style.fontSize),
            }),
          },
        }),
      })
    }
    // +1 for the newline that split() consumed.
    cursor += paragraph.length + 1
  }

  return {
    lines,
    lineHeight,
    width: lines.reduce((widest, line) => Math.max(widest, line.width), 0),
    height: lines.length * lineHeight,
  }
}

/** Run-aware counterpart of the uniform branch of `layoutText`. */
function layoutRuns(
  text: string,
  style: TextStyle,
  maxWidth: number,
  measure: TextMeasurer,
  segments: ReadonlyArray<TextSegment>,
): TextLayout {
  const lineHeight = style.fontSize * style.lineHeight
  const specOf = (segment: TextSegment): CanvasFontSpec => ({
    fontSize: segment.fontSize,
    fontWeight: segment.fontWeight,
    fontStyle: segment.fontStyle,
  })
  const specs = segments.map(specOf)
  // A segment's full width is asked for on every wrap step; measure it once.
  const fullWidths: Array<number | undefined> = []
  const widthOfRange = (from: number, to: number): number => {
    let total = 0
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (segment.end <= from) continue
      if (segment.start >= to) break
      const a = Math.max(from, segment.start)
      const b = Math.min(to, segment.end)
      if (a === segment.start && b === segment.end) {
        const cached =
          fullWidths[index] ?? measure(text.slice(a, b), specs[index])
        fullWidths[index] = cached
        total += cached
      } else {
        total += measure(text.slice(a, b), specs[index])
      }
    }
    return total
  }
  const segmentIndexAt = (position: number): number => {
    for (let index = 0; index < segments.length; index += 1) {
      if (position < segments[index].end) return index
    }
    return segments.length - 1
  }

  const lines: Array<LaidOutLine> = []
  let top = 0
  let cursor = 0
  for (const paragraph of text.split('\n')) {
    const state = todoMarkerAt(paragraph, 0)
    const markerIndex = segmentIndexAt(cursor)
    const markerSize = segments[markerIndex].fontSize
    const advance = state ? todoAdvance(markerSize) : 0
    // The marker is measured as the fixed advance, not as its glyph.
    const markerDelta = state
      ? advance - measure(paragraph[0], specs[markerIndex])
      : 0
    const wrapped = wrapParagraph(paragraph, maxWidth, (from, to) => {
      const raw = widthOfRange(cursor + from, cursor + to)
      if (!state) return raw
      return from === 0 ? raw + markerDelta : raw + advance
    })
    for (const piece of wrapped) {
      const start = cursor + piece.offset
      const end = start + piece.text.length
      const first = segmentIndexAt(start)
      const holdsMarker = state !== null && piece.offset === 0
      const indent = state !== null && piece.offset > 0 ? advance : 0

      // Cut the line at segment boundaries; caret slots accumulate across
      // pieces so each is measured in its own font.
      const relative: Array<number> = [indent]
      const cuts: Array<{ segment: TextSegment; from: number; to: number }> = []
      // An empty line has no piece; it is as tall as the run it sits in.
      let largest = end === start ? segments[first].fontSize : 0
      let x = indent
      for (let index = first; index < segments.length; index += 1) {
        const segment = segments[index]
        if (segment.start >= end) break
        const from = Math.max(start, segment.start)
        const to = Math.min(end, segment.end)
        if (to <= from) continue
        largest = Math.max(largest, segment.fontSize)
        const spec = specs[index]
        const shift = holdsMarker && from === start ? markerDelta : 0
        for (let at = from + 1; at <= to; at += 1) {
          relative.push(x + measure(text.slice(from, at), spec) + shift)
        }
        cuts.push({ segment, from, to })
        x = relative[relative.length - 1]
      }
      const width = x
      const origin = alignOffset(width, maxWidth, style.align)
      const carets = relative.map((offset) => offset + origin)
      const height = largest * style.lineHeight
      lines.push({
        text: piece.text,
        start,
        end,
        width,
        carets,
        top,
        height,
        pieces: cuts.flatMap(({ segment, from, to }) => {
          // The marker is drawn as a checkbox, so its piece starts after it.
          const skip = holdsMarker && from === start ? 1 : 0
          if (to - from <= skip) return []
          return [
            {
              text: text.slice(from + skip, to),
              x: carets[from + skip - start],
              width: carets[to - start] - carets[from + skip - start],
              offsetY: (largest - segment.fontSize) * BASELINE_ASCENT,
              segment,
            },
          ]
        }),
        ...(state && {
          todo: {
            state,
            ...(holdsMarker && {
              box: todoBox(
                carets[0],
                top + (largest - markerSize) * BASELINE_ASCENT,
                markerSize,
              ),
            }),
          },
        }),
      })
      top += height
    }
    cursor += paragraph.length + 1
  }

  return {
    lines,
    lineHeight,
    width: lines.reduce((widest, line) => Math.max(widest, line.width), 0),
    height: top,
    mixed: true,
  }
}

/**
 * Greedy wrap of one newline-free paragraph. `widthOf(from, to)` is the width
 * of `paragraph.slice(from, to)`, so a run-aware caller can measure each
 * stretch in its own font.
 */
function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  widthOf: (from: number, to: number) => number,
): Array<{ text: string; offset: number }> {
  if (paragraph.length === 0) return [{ text: '', offset: 0 }]
  if (maxWidth <= 0 || widthOf(0, paragraph.length) <= maxWidth) {
    return [{ text: paragraph, offset: 0 }]
  }

  const pieces: Array<{ text: string; offset: number }> = []
  let lineStart = 0
  let lastBreak = -1 // index of the last space seen on the current line
  let i = 0

  while (i < paragraph.length) {
    if (widthOf(lineStart, i + 1) > maxWidth && i > lineStart) {
      // Break at the last space if there was one, otherwise mid-word.
      const breakAt = lastBreak > lineStart ? lastBreak : i
      pieces.push({
        text: paragraph.slice(lineStart, breakAt),
        offset: lineStart,
      })
      // A space we broke ON is consumed; a mid-word break is not.
      lineStart = lastBreak > lineStart ? breakAt + 1 : breakAt
      lastBreak = -1
      i = lineStart
      continue
    }
    if (paragraph[i] === ' ') lastBreak = i
    i += 1
  }

  if (lineStart < paragraph.length) {
    pieces.push({ text: paragraph.slice(lineStart), offset: lineStart })
  }
  return pieces
}

/**
 * Caret x-offsets for every slot in a line, including before and after.
 *
 * `origin` is the line's alignment offset, added to every slot so the whole
 * array is block-local rather than line-local — see `LaidOutLine.carets`.
 */
function caretOffsets(
  text: string,
  measure: TextMeasurer,
  origin: number,
): Array<number> {
  const offsets = [origin]
  for (let i = 1; i <= text.length; i += 1) {
    offsets.push(origin + measure(text.slice(0, i)))
  }
  return offsets
}

/** The row a block-local `y` falls on, clamped to the first and last line. */
function lineIndexAt(layout: TextLayout, y: number): number {
  if (!layout.mixed) {
    return Math.min(
      layout.lines.length - 1,
      Math.max(0, Math.floor(y / layout.lineHeight)),
    )
  }
  let index = 0
  for (let i = 1; i < layout.lines.length; i += 1) {
    if (layout.lines[i].top <= y) index = i
    else break
  }
  return index
}

/**
 * The caret index (into the ORIGINAL string) nearest a local point.
 *
 * `point` is relative to the text block's top-left. Clicking past the end
 * of a line puts the caret at that line's end, and clicking below the last
 * line puts it at the very end — both are what every text editor does, and
 * both are easy to get wrong by clamping to the wrong line.
 */
export function caretFromPoint(
  layout: TextLayout,
  point: { x: number; y: number },
): number {
  if (layout.lines.length === 0) return 0

  const line = layout.lines[lineIndexAt(layout, point.y)]

  // Nearest caret slot by distance, so clicking the left half of a glyph
  // puts the caret before it and the right half after it.
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let slot = 0; slot < line.carets.length; slot += 1) {
    const distance = Math.abs(line.carets[slot] - point.x)
    if (distance < bestDistance) {
      bestDistance = distance
      best = slot
    }
  }
  return line.start + best
}

/**
 * Where to draw the caret for an index into the original string.
 *
 * Returns the block-local position and the caret's height, so the renderer
 * can draw it without knowing anything about layout.
 */
export function pointFromCaret(
  layout: TextLayout,
  caret: number,
): { x: number; y: number; height: number } {
  if (layout.lines.length === 0) {
    return { x: 0, y: 0, height: layout.lineHeight }
  }

  // The LAST line whose start is at or before the caret — so a caret
  // sitting exactly on a line boundary belongs to the line it starts.
  let lineIndex = 0
  for (let i = 0; i < layout.lines.length; i += 1) {
    if (layout.lines[i].start <= caret) lineIndex = i
    else break
  }

  const line = layout.lines[lineIndex]
  const slot = Math.min(line.carets.length - 1, Math.max(0, caret - line.start))
  return {
    x: line.carets[slot],
    y: line.top,
    height: line.height,
  }
}

/** Clamp a caret index into a string's valid range. */
export function clampCaret(text: string, caret: number): number {
  return Math.min(text.length, Math.max(0, caret))
}

/** Insert text at a caret, returning the new string and caret position. */
export function insertAt(
  text: string,
  caret: number,
  insertion: string,
): { text: string; caret: number } {
  const at = clampCaret(text, caret)
  return {
    text: text.slice(0, at) + insertion + text.slice(at),
    caret: at + insertion.length,
  }
}

/**
 * Delete one character before the caret (Backspace).
 *
 * Steps by CODE POINT, not by UTF-16 unit: a single Backspace must not
 * leave half a surrogate pair behind, which is what naive `slice(caret - 1)`
 * does to emoji and to any character outside the BMP.
 */
export function deleteBackward(
  text: string,
  caret: number,
): { text: string; caret: number } {
  const at = clampCaret(text, caret)
  if (at === 0) return { text, caret: 0 }
  const before = text.slice(0, at)
  const codePoints = [...before]
  const removed = codePoints[codePoints.length - 1] ?? ''
  const nextCaret = at - removed.length
  return { text: text.slice(0, nextCaret) + text.slice(at), caret: nextCaret }
}

/** Delete one character after the caret (Delete), also code-point aware. */
export function deleteForward(
  text: string,
  caret: number,
): { text: string; caret: number } {
  const at = clampCaret(text, caret)
  if (at >= text.length) return { text, caret: at }
  const after = text.slice(at)
  const removed = [...after][0] ?? ''
  return {
    text: text.slice(0, at) + text.slice(at + removed.length),
    caret: at,
  }
}

/**
 * Move the caret one character left (`direction: -1`) or right (`+1`).
 *
 * Added in Wave 3 for arrow-key navigation, in this module rather than in the
 * input hook because it is the same code-point-stepping rule `deleteBackward`
 * and `deleteForward` already own — and because a pure function is testable
 * without a browser, which a hook is not.
 *
 * Steps by CODE POINT: `'🎉'.length` is 2, so a caret moved by one UTF-16
 * unit lands inside the surrogate pair and every subsequent slice yields a
 * replacement glyph. Stopping at both ends is deliberate — a caret that ran
 * negative would make `insertAt` clamp silently instead of the caret visibly
 * not moving.
 */
export function stepCaret(
  text: string,
  caret: number,
  direction: 1 | -1,
): number {
  const at = clampCaret(text, caret)
  if (direction === -1) {
    if (at === 0) return 0
    const codePoints = [...text.slice(0, at)]
    return at - (codePoints[codePoints.length - 1]?.length ?? 1)
  }
  if (at >= text.length) return text.length
  const next = [...text.slice(at)][0] ?? ''
  return at + (next.length || 1)
}

/** A rectangle in the text block's local space. */
export interface LocalRect {
  x: number
  y: number
  width: number
  height: number
}

/** Extra highlight width, as a fraction of line height, where a newline is selected. */
const NEWLINE_HIGHLIGHT_RATIO = 0.3

/**
 * The highlight rectangles for the selected range `[start, end)`, one per
 * visual line the range touches, in the text block's local space.
 *
 * `start` and `end` may arrive in either order (anchor and caret). A range
 * that runs past the end of a line gets a short extra stub there so a selected
 * newline is visible; the space a wrap consumes is not in any line and gets
 * none.
 */
export function selectionRects(
  layout: TextLayout,
  start: number,
  end: number,
): Array<LocalRect> {
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  if (from === to) return []

  const rects: Array<LocalRect> = []
  for (let index = 0; index < layout.lines.length; index += 1) {
    const line = layout.lines[index]
    const lineEnd = line.start + line.text.length
    const lo = Math.max(from, line.start)
    const hi = Math.min(to, lineEnd)
    if (lo > hi) continue
    const x0 = line.carets[lo - line.start]
    let x1 = line.carets[hi - line.start]
    const isLast = index === layout.lines.length - 1
    // The range runs on past this line's last character: the line break (or
    // the space a wrap consumed) is selected too, so give it a visible stub.
    if (!isLast && to > lineEnd) x1 += line.height * NEWLINE_HIGHLIGHT_RATIO
    if (x1 <= x0) continue
    rects.push({
      x: x0,
      y: line.top,
      width: x1 - x0,
      height: line.height,
    })
  }
  return rects
}

/**
 * Replace `[a, b)` (either order) with `insertion`, returning the new text and
 * the caret just after the insertion. With `a === b` this is `insertAt`.
 */
export function replaceRange(
  text: string,
  a: number,
  b: number,
  insertion: string,
): { text: string; caret: number } {
  const from = clampCaret(text, Math.min(a, b))
  const to = clampCaret(text, Math.max(a, b))
  return {
    text: text.slice(0, from) + insertion + text.slice(to),
    caret: from + insertion.length,
  }
}

type CharClass = 'word' | 'space' | 'other'

function classOf(char: string): CharClass {
  if (/[\p{L}\p{N}_]/u.test(char)) return 'word'
  if (/\s/u.test(char)) return 'space'
  return 'other'
}

/**
 * The word range `[start, end)` around a caret index, for double-click.
 *
 * A caret index is the nearest SLOT, so it sits between two characters: the
 * word character on either side wins, the one after first. With no word
 * character beside it, the run of whitespace or punctuation there is selected.
 */
export function wordRangeAt(
  text: string,
  index: number,
): { start: number; end: number } {
  if (text.length === 0) return { start: 0, end: 0 }
  const at = clampCaret(text, index)
  const after = at < text.length ? text[at] : undefined
  const before = at > 0 ? text[at - 1] : undefined
  const pick =
    after !== undefined && classOf(after) === 'word'
      ? at
      : before !== undefined && classOf(before) === 'word'
        ? at - 1
        : after !== undefined
          ? at
          : at - 1
  const kind = classOf(text[pick])
  let start = pick
  let end = pick + 1
  while (
    start > 0 &&
    classOf(text[start - 1]) === kind &&
    text[start - 1] !== '\n'
  )
    start -= 1
  while (end < text.length && classOf(text[end]) === kind && text[end] !== '\n')
    end += 1
  return { start, end }
}
