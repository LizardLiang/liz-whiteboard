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

/** Measures a string's advance width in world units, at the caller's font. */
export type TextMeasurer = (text: string) => number

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
}

export interface TextLayout {
  lines: Array<LaidOutLine>
  lineHeight: number
  width: number
  height: number
}

/**
 * Break `text` into lines that fit `maxWidth`, honouring explicit newlines.
 *
 * Greedy word wrapping, breaking on spaces. A single word longer than
 * `maxWidth` is broken mid-word rather than allowed to overflow — without
 * that, one long unbroken string (a URL, or any CJK text, which has no
 * spaces at all) would run off the element forever.
 */
export function layoutText(
  text: string,
  style: TextStyle,
  maxWidth: number,
  measure: TextMeasurer,
): TextLayout {
  const lineHeight = style.fontSize * style.lineHeight
  const lines: Array<LaidOutLine> = []

  // Explicit newlines always break, and an empty string still yields one
  // (empty) line — otherwise an empty text element has no caret to place.
  const paragraphs = text.split('\n')
  let cursor = 0

  for (const paragraph of paragraphs) {
    const wrapped = wrapParagraph(paragraph, maxWidth, measure)
    for (const piece of wrapped) {
      const start = cursor + piece.offset
      const width = measure(piece.text)
      lines.push({
        text: piece.text,
        start,
        end: start + piece.text.length,
        width,
        carets: caretOffsets(
          piece.text,
          measure,
          alignOffset(width, maxWidth, style.align),
        ),
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

/** Greedy wrap of one newline-free paragraph. */
function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  measure: TextMeasurer,
): Array<{ text: string; offset: number }> {
  if (paragraph.length === 0) return [{ text: '', offset: 0 }]
  if (maxWidth <= 0 || measure(paragraph) <= maxWidth) {
    return [{ text: paragraph, offset: 0 }]
  }

  const pieces: Array<{ text: string; offset: number }> = []
  let lineStart = 0
  let lastBreak = -1 // index of the last space seen on the current line
  let i = 0

  while (i < paragraph.length) {
    const candidate = paragraph.slice(lineStart, i + 1)
    if (measure(candidate) > maxWidth && i > lineStart) {
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

  const lineIndex = Math.min(
    layout.lines.length - 1,
    Math.max(0, Math.floor(point.y / layout.lineHeight)),
  )
  const line = layout.lines[lineIndex]

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
  const lineHeight = layout.lineHeight
  if (layout.lines.length === 0) return { x: 0, y: 0, height: lineHeight }

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
    y: lineIndex * lineHeight,
    height: lineHeight,
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
