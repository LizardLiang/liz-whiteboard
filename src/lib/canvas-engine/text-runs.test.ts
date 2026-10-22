// src/lib/canvas-engine/text-runs.test.ts
// Pure helpers for per-range text styles: normalize, resolve, apply, remap.

import { describe, expect, it } from 'vitest'
import {
  applyRunStyle,
  normalizeRuns,
  remapRuns,
  resolveRuns,
  stripRunAttribute,
} from './text-runs'
import { DEFAULT_ELEMENT_STYLE } from './scene'
import type { CanvasTextRun } from './scene'

const style = (textRuns: Array<CanvasTextRun>) => ({
  ...DEFAULT_ELEMENT_STYLE,
  textRuns,
})

describe('normalizeRuns', () => {
  it('returns an already-normal array untouched', () => {
    const runs = [{ start: 0, end: 2, fontWeight: 'bold' as const }]
    expect(normalizeRuns(runs, 5)).toBe(runs)
  })

  it('clamps to the text and drops empty or attribute-less runs', () => {
    const runs: Array<CanvasTextRun> = [
      { start: 3, end: 99, underline: true },
      { start: 7, end: 9, underline: true },
      { start: 1, end: 2 },
    ]
    expect(normalizeRuns(runs, 5)).toEqual([
      { start: 3, end: 5, underline: true },
    ])
  })

  it('sorts unsorted input and lets the earlier-starting run keep an overlap', () => {
    const runs: Array<CanvasTextRun> = [
      { start: 2, end: 6, color: '#00ff00' },
      { start: 0, end: 4, fontWeight: 'bold' },
    ]
    expect(normalizeRuns(runs, 6)).toEqual([
      { start: 0, end: 4, fontWeight: 'bold' },
      { start: 4, end: 6, color: '#00ff00' },
    ])
  })

  it('reads at most MAX_TEXT_RUNS runs of a hostile array', () => {
    const runs: Array<CanvasTextRun> = Array.from({ length: 50_000 }, () => ({
      start: 0,
      end: 10_000,
      underline: true,
    }))
    const began = performance.now()
    const result = normalizeRuns(runs, 10_000)
    expect(performance.now() - began).toBeLessThan(200)
    expect(result).toEqual([{ start: 0, end: 10_000, underline: true }])
  })

  it('repairs a malformed array once and reuses the result', () => {
    const runs: Array<CanvasTextRun> = [
      { start: 3, end: 5, underline: true },
      { start: 0, end: 2, underline: true },
    ]
    expect(normalizeRuns(runs, 5)).toBe(normalizeRuns(runs, 5))
  })

  it('merges adjacent runs with equal attributes', () => {
    const runs: Array<CanvasTextRun> = [
      { start: 0, end: 2, fontWeight: 'bold' },
      { start: 2, end: 4, fontWeight: 'bold' },
    ]
    expect(normalizeRuns(runs, 4)).toEqual([
      { start: 0, end: 4, fontWeight: 'bold' },
    ])
  })
})

describe('resolveRuns', () => {
  it('yields no segments for empty text', () => {
    expect(resolveRuns('', style([]))).toEqual([])
  })

  it('yields one label-styled segment without runs', () => {
    const segments = resolveRuns('abc', style([]))
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ start: 0, end: 3, fontSize: 16 })
  })

  it('covers the text contiguously with the run overriding the label', () => {
    const segments = resolveRuns(
      'abcdef',
      style([{ start: 2, end: 4, fontSize: 36, fontWeight: 'bold' }]),
    )
    expect(segments.map((s) => [s.start, s.end, s.fontSize])).toEqual([
      [0, 2, 16],
      [2, 4, 36],
      [4, 6, 16],
    ])
    expect(segments[1].fontWeight).toBe('bold')
    expect(segments[0].fontWeight).toBe('normal')
  })

  it('clamps a run that points past the text', () => {
    const segments = resolveRuns(
      'abc',
      style([{ start: 2, end: 50, underline: true }]),
    )
    expect(segments.map((s) => [s.start, s.end, s.underline])).toEqual([
      [0, 2, false],
      [2, 3, true],
    ])
  })
})

describe('resolveRuns cache', () => {
  it('returns the same segments for the same style object and text', () => {
    const s = style([{ start: 1, end: 2, fontWeight: 'bold' }])
    expect(resolveRuns('abc', s)).toBe(resolveRuns('abc', s))
    expect(resolveRuns('abcd', s)).not.toBe(resolveRuns('abc', s))
  })
})

describe('applyRunStyle', () => {
  it('splits an existing run and keeps the rest of its attributes', () => {
    const runs = [{ start: 0, end: 6, fontWeight: 'bold' as const }]
    expect(applyRunStyle(runs, 2, 4, { color: '#ff0000' }, 6)).toEqual([
      { start: 0, end: 2, fontWeight: 'bold' },
      { start: 2, end: 4, fontWeight: 'bold', color: '#ff0000' },
      { start: 4, end: 6, fontWeight: 'bold' },
    ])
  })

  it('lets the patch override a run it overlaps and fills the gaps', () => {
    const runs = [
      { start: 2, end: 4, fontWeight: 'bold' as const, color: '#111' },
    ]
    expect(applyRunStyle(runs, 0, 6, { color: '#222' }, 6)).toEqual([
      { start: 0, end: 2, color: '#222' },
      { start: 2, end: 4, fontWeight: 'bold', color: '#222' },
      { start: 4, end: 6, color: '#222' },
    ])
  })

  it('accepts a reversed range and ignores an empty one', () => {
    expect(applyRunStyle([], 4, 2, { underline: true }, 6)).toEqual([
      { start: 2, end: 4, underline: true },
    ])
    expect(applyRunStyle([], 3, 3, { underline: true }, 6)).toEqual([])
  })
})

describe('remapRuns', () => {
  const bold = { fontWeight: 'bold' as const }

  it('shifts runs after an insertion', () => {
    expect(remapRuns([{ start: 4, end: 6, ...bold }], 1, 0, 3)).toEqual([
      { start: 7, end: 9, ...bold },
    ])
  })

  it('splits a run around an insertion that takes no style', () => {
    expect(remapRuns([{ start: 0, end: 6, ...bold }], 3, 0, 2)).toEqual([
      { start: 0, end: 3, ...bold },
      { start: 5, end: 8, ...bold },
    ])
  })

  it('keeps a run whole when the insertion takes the same style', () => {
    expect(remapRuns([{ start: 0, end: 6, ...bold }], 3, 0, 2, bold)).toEqual([
      { start: 0, end: 8, ...bold },
    ])
  })

  it('keeps the surviving half of a run cut by a deletion', () => {
    expect(remapRuns([{ start: 2, end: 8, ...bold }], 0, 5, 0)).toEqual([
      { start: 0, end: 3, ...bold },
    ])
  })

  it('drops a run whose characters were all deleted', () => {
    expect(remapRuns([{ start: 2, end: 4, ...bold }], 1, 4, 0)).toEqual([])
  })

  it('replaces a selection and styles the replacement', () => {
    expect(
      remapRuns([{ start: 0, end: 4, ...bold }], 1, 2, 3, { underline: true }),
    ).toEqual([
      { start: 0, end: 1, ...bold },
      { start: 1, end: 4, underline: true },
      { start: 4, end: 5, ...bold },
    ])
  })
})

describe('stripRunAttribute', () => {
  it('removes one attribute and drops runs left with none', () => {
    const runs: Array<CanvasTextRun> = [
      { start: 0, end: 2, fontWeight: 'bold' },
      { start: 2, end: 4, fontWeight: 'bold', color: '#ff0000' },
    ]
    expect(stripRunAttribute(runs, 'fontWeight')).toEqual([
      { start: 2, end: 4, color: '#ff0000' },
    ])
  })

  it('returns the same array when no run carries the attribute', () => {
    const runs = [{ start: 0, end: 2, underline: true }]
    expect(stripRunAttribute(runs, 'color')).toBe(runs)
  })
})
