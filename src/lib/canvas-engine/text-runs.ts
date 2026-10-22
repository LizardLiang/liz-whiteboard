// src/lib/canvas-engine/text-runs.ts
// Per-range text styles for the canvas engine.
//
// A label's `style.textRuns` overrides the whole-label style over character
// ranges. The runs are stored beside the text and may disagree with it after a
// concurrent edit, so every reader goes through `normalizeRuns` /
// `resolveRuns`, which clamp them to the text instead of trusting them.
//
// Pure module: no React, no DOM, no canvas.

import type {
  CanvasElementStyle,
  CanvasFontStyle,
  CanvasFontWeight,
  CanvasTextRun,
} from './scene'

/** The attributes a run may override. */
export type TextRunAttrs = Omit<CanvasTextRun, 'start' | 'end'>

export type TextRunKey = keyof TextRunAttrs

const RUN_KEYS: ReadonlyArray<TextRunKey> = [
  'fontWeight',
  'fontStyle',
  'underline',
  'strikethrough',
  'fontSize',
  'color',
]

/** A contiguous stretch of text with its effective style. */
export interface TextSegment {
  start: number
  end: number
  fontSize: number
  fontWeight: CanvasFontWeight
  fontStyle: CanvasFontStyle
  underline: boolean
  strikethrough: boolean
  color: string
}

function attrsOf(run: CanvasTextRun): TextRunAttrs {
  const attrs: TextRunAttrs = {}
  for (const key of RUN_KEYS) {
    if (run[key] !== undefined)
      (attrs as Record<string, unknown>)[key] = run[key]
  }
  return attrs
}

function hasAttrs(attrs: TextRunAttrs): boolean {
  return RUN_KEYS.some((key) => attrs[key] !== undefined)
}

function sameAttrs(a: TextRunAttrs, b: TextRunAttrs): boolean {
  return RUN_KEYS.every((key) => a[key] === b[key])
}

/** True when `runs` is already sorted, disjoint, in range, non-empty and merged. */
function isNormal(runs: Array<CanvasTextRun>, textLength: number): boolean {
  let previous: CanvasTextRun | null = null
  for (const run of runs) {
    if (run.start < 0 || run.end > textLength || run.start >= run.end) {
      return false
    }
    if (!hasAttrs(run)) return false
    if (previous) {
      if (run.start < previous.end) return false
      if (run.start === previous.end && sameAttrs(previous, run)) return false
    }
    previous = run
  }
  return true
}

/**
 * The most runs a label may carry. The schema enforces it on write; readers
 * enforce it again because a peer's broadcast can skip validation, and layout
 * runs every frame.
 */
export const MAX_TEXT_RUNS = 512

/** Normalized results by input array, so a malformed input is repaired once. */
const normalizedCache = new WeakMap<
  Array<CanvasTextRun>,
  { textLength: number; runs: Array<CanvasTextRun> }
>()

/**
 * Clamp runs to `[0, textLength)`, drop empty and attribute-less runs, repair
 * order and overlap, and merge neighbours with equal attributes. Returns the
 * same array when it is already normal, so a per-frame caller pays one pass
 * and no allocation.
 *
 * Valid input is sorted and disjoint (the schema says so). Input that is not
 * — a peer write that skipped validation — is repaired in O(n log n): only the
 * first `MAX_TEXT_RUNS` runs are read, they are sorted by start, and where two
 * overlap the earlier-starting one keeps the overlap. The repaired result is
 * cached per input array.
 */
export function normalizeRuns(
  runs: Array<CanvasTextRun> | undefined,
  textLength: number,
): Array<CanvasTextRun> {
  if (!runs) return []
  if (runs.length === 0) return runs
  if (runs.length <= MAX_TEXT_RUNS && isNormal(runs, textLength)) return runs

  const cached = normalizedCache.get(runs)
  if (cached && cached.textLength === textLength) return cached.runs

  const sorted = runs.slice(0, MAX_TEXT_RUNS).sort((a, b) => a.start - b.start)
  const out: Array<CanvasTextRun> = []
  let cursor = 0
  for (const run of sorted) {
    const start = Math.max(cursor, Math.min(textLength, run.start))
    const end = Math.max(0, Math.min(textLength, run.end))
    if (start >= end) continue
    const attrs = attrsOf(run)
    if (!hasAttrs(attrs)) continue
    const last = out.length > 0 ? out[out.length - 1] : null
    if (last && last.end === start && sameAttrs(last, attrs)) {
      last.end = end
    } else {
      out.push({ start, end, ...attrs })
    }
    cursor = end
  }
  normalizedCache.set(runs, { textLength, runs: out })
  return out
}

/** Resolved segments by style object; styles are replaced, never mutated. */
const segmentCache = new WeakMap<
  CanvasElementStyle,
  { text: string; segments: Array<TextSegment> }
>()

/**
 * The text split into contiguous segments with their effective style: the
 * label style, overridden by whichever run covers the segment. Empty text has
 * no segments. Cached per style object and text, since layout asks every frame.
 */
export function resolveRuns(
  text: string,
  style: CanvasElementStyle,
): Array<TextSegment> {
  if (text.length === 0) return []
  const cached = segmentCache.get(style)
  if (cached && cached.text === text) return cached.segments

  const base = (start: number, end: number): TextSegment => ({
    start,
    end,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    underline: style.underline,
    strikethrough: style.strikethrough,
    color: style.color,
  })

  const runs = normalizeRuns(style.textRuns, text.length)
  const segments: Array<TextSegment> = []
  let cursor = 0
  for (const run of runs) {
    if (run.start > cursor) segments.push(base(cursor, run.start))
    segments.push({
      ...base(run.start, run.end),
      ...attrsOf(run),
    })
    cursor = run.end
  }
  if (cursor < text.length) segments.push(base(cursor, text.length))
  segmentCache.set(style, { text, segments })
  return segments
}

/**
 * Apply `patch` to `[start, end)`, keeping every other character as it was.
 * One pass over the runs: each is split at the range edges, and the part
 * inside the range takes the patch over its own attributes.
 */
export function applyRunStyle(
  runs: Array<CanvasTextRun>,
  start: number,
  end: number,
  patch: TextRunAttrs,
  textLength: number,
): Array<CanvasTextRun> {
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(textLength, Math.max(start, end))
  const current = normalizeRuns(runs, textLength)
  if (from >= to || !hasAttrs(patch)) return current

  const next: Array<CanvasTextRun> = []
  let cursor = from
  for (const run of current) {
    if (run.end <= from || run.start >= to) {
      next.push(run)
      continue
    }
    if (run.start < from) next.push({ ...run, end: from })
    if (run.start > cursor)
      next.push({ start: cursor, end: run.start, ...patch })
    const inner = Math.max(run.start, from)
    const innerEnd = Math.min(run.end, to)
    next.push({ ...attrsOf(run), ...patch, start: inner, end: innerEnd })
    if (run.end > to) next.push({ ...run, start: to })
    cursor = innerEnd
  }
  if (cursor < to) next.push({ start: cursor, end: to, ...patch })
  next.sort((a, b) => a.start - b.start)
  return normalizeRuns(next, textLength)
}

/**
 * Re-map runs across one text edit that replaced `deleteCount` characters at
 * `editStart` with `insertLength` new ones. Runs before the edit stay, runs
 * after it shift, the deleted stretch is cut out and a run spanning an
 * insertion is split around it. The inserted text takes `insertStyle`.
 */
export function remapRuns(
  runs: Array<CanvasTextRun>,
  editStart: number,
  deleteCount: number,
  insertLength: number,
  insertStyle?: TextRunAttrs,
): Array<CanvasTextRun> {
  const editEnd = editStart + deleteCount
  const delta = insertLength - deleteCount
  const next: Array<CanvasTextRun> = []
  for (const run of runs) {
    const attrs = attrsOf(run)
    const leftEnd = Math.min(run.end, editStart)
    if (leftEnd > run.start)
      next.push({ start: run.start, end: leftEnd, ...attrs })
    const rightStart = Math.max(run.start, editEnd)
    if (run.end > rightStart) {
      next.push({ start: rightStart + delta, end: run.end + delta, ...attrs })
    }
  }
  if (insertLength > 0 && insertStyle && hasAttrs(insertStyle)) {
    next.push({
      start: editStart,
      end: editStart + insertLength,
      ...insertStyle,
    })
  }
  next.sort((a, b) => a.start - b.start)
  const length = next.reduce((max, run) => Math.max(max, run.end), 0)
  return normalizeRuns(next, length)
}

/** Remove one attribute from every run, dropping runs left with none. */
export function stripRunAttribute(
  runs: Array<CanvasTextRun>,
  key: TextRunKey,
): Array<CanvasTextRun> {
  if (!runs.some((run) => run[key] !== undefined)) return runs
  const stripped: Array<CanvasTextRun> = []
  for (const run of runs) {
    const rest: CanvasTextRun = { ...run }
    delete rest[key]
    if (hasAttrs(rest)) stripped.push(rest)
  }
  const length = stripped.reduce((max, run) => Math.max(max, run.end), 0)
  return normalizeRuns(stripped, length)
}
