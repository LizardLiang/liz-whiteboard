// src/data/canvas-text-runs-schema.test.ts
// Stored text runs must be cheap to read every frame: sorted, disjoint,
// capped, and inside the text they sit beside.

import { describe, expect, it } from 'vitest'
import {
  canvasElementStyleSchema,
  createCanvasElementSchema,
  updateCanvasElementSchema,
} from '@/data/schema'
import { MAX_TEXT_RUNS } from '@/lib/canvas-engine/text-runs'

const bold = (start: number, end: number) => ({
  start,
  end,
  fontWeight: 'bold' as const,
})

const create = (text: string | null, textRuns: Array<unknown>) =>
  createCanvasElementSchema.safeParse({
    boardId: '3b1f0c3e-2c5a-4a53-9a0e-6c1d4f0f9a11',
    kind: 'text',
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 40,
    text,
    style: { textRuns },
    props: { kind: 'text' },
  })

describe('textRuns schema', () => {
  it('defaults to no runs, so old rows parse', () => {
    expect(canvasElementStyleSchema.parse({}).textRuns).toEqual([])
  })

  it('accepts sorted, disjoint runs', () => {
    expect(
      create('hello world', [bold(0, 2), bold(2, 5), bold(6, 11)]).success,
    ).toBe(true)
  })

  it('rejects overlapping runs', () => {
    expect(create('hello world', [bold(0, 5), bold(3, 8)]).success).toBe(false)
  })

  it('rejects unsorted runs', () => {
    expect(create('hello world', [bold(6, 8), bold(0, 2)]).success).toBe(false)
  })

  it('rejects an empty run', () => {
    expect(create('hello', [bold(2, 2)]).success).toBe(false)
  })

  it('rejects more than the maximum number of runs', () => {
    const runs = Array.from({ length: MAX_TEXT_RUNS + 1 }, (_, i) =>
      bold(i * 2, i * 2 + 1),
    )
    const text = 'x'.repeat(runs.length * 2)
    expect(create(text, runs.slice(0, MAX_TEXT_RUNS)).success).toBe(true)
    expect(create(text, runs).success).toBe(false)
  })

  it('rejects a run that ends past the text on create', () => {
    expect(create('hello', [bold(2, 6)]).success).toBe(false)
    expect(create(null, [bold(0, 1)]).success).toBe(false)
  })

  it('checks the end against the text on update only when both are sent', () => {
    expect(
      updateCanvasElementSchema.safeParse({
        text: 'hi',
        style: { textRuns: [bold(0, 3)] },
      }).success,
    ).toBe(false)
    expect(
      updateCanvasElementSchema.safeParse({ style: { textRuns: [bold(0, 3)] } })
        .success,
    ).toBe(true)
  })
})
