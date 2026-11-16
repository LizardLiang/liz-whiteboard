import { describe, expect, it } from 'vitest'
import {
  TOUR_STEP_COUNT,
  buildFieldWindowTour,
  buildIntroStep,
  pickIntroTable,
  planTablePan,
} from './field-window-tour'
import type { FieldWindowTourDeps } from './field-window-tour'

const viewport = { width: 1600, height: 1000 }
const win = { left: 820, top: 76, width: 768, height: 600 }
const table = { width: 300, height: 400 }

describe('planTablePan', () => {
  it('keeps a table that is visible and clear of the window', () => {
    const plan = planTablePan({
      viewport,
      win,
      table: { left: 100, top: 200, ...table },
      bottomReserve: 78,
    })
    expect(plan).toEqual({ kind: 'keep' })
  })

  it('pans a table under the window into the largest free area', () => {
    const plan = planTablePan({
      viewport,
      win,
      table: { left: 900, top: 200, ...table },
      bottomReserve: 78,
    })
    expect(plan.kind).toBe('pan')
    if (plan.kind !== 'pan') return
    // Left free area spans x 0..820 and y 64..922: centre (410, 493).
    expect(900 + 150 + plan.dx).toBeCloseTo(410)
    expect(200 + 200 + plan.dy).toBeCloseTo(493)
  })

  it('pans a table that is outside the viewport', () => {
    const plan = planTablePan({
      viewport,
      win,
      table: { left: -500, top: 200, ...table },
      bottomReserve: 78,
    })
    expect(plan.kind).toBe('pan')
  })

  it('reports none when no free area can show the table', () => {
    const phone = { width: 390, height: 844 }
    const plan = planTablePan({
      viewport: phone,
      win: { left: 12, top: 76, width: 366, height: 690 },
      table: { left: 20, top: 100, ...table },
      bottomReserve: 78,
    })
    expect(plan).toEqual({ kind: 'none' })
  })
})

describe('buildFieldWindowTour', () => {
  const deps: FieldWindowTourDeps = {
    t: (key) => key,
    getWindowEl: () => null,
    getTable: () => null,
    getFlow: () => null,
    getBottomReserve: () => 78,
  }

  it('lists the seven steps in order', () => {
    const steps = buildFieldWindowTour(deps)
    expect(steps).toHaveLength(TOUR_STEP_COUNT)
    expect(steps.map((s) => s.id)).toEqual([
      'window',
      'header',
      'pin',
      'canvas',
      'mode',
      'minimize',
      'help',
    ])
  })

  it('has no target when its window is gone', () => {
    for (const step of buildFieldWindowTour(deps)) {
      expect(step.target()).toBeNull()
    }
  })
})

describe('pickIntroTable', () => {
  const size = { width: 300, height: 200 }
  const input = (tables: Array<{ id: string; left: number; top: number }>) => ({
    viewport,
    bottomReserve: 78,
    tables: tables.map((t) => ({
      id: t.id,
      rect: { left: t.left, top: t.top, ...size },
    })),
  })

  it('picks the fully visible table nearest the viewport centre', () => {
    const pick = pickIntroTable(
      input([
        { id: 'edge', left: 20, top: 100 },
        { id: 'centre', left: 650, top: 400 },
        { id: 'far', left: 1200, top: 700 },
      ]),
    )
    expect(pick).toEqual({ id: 'centre', pan: null })
  })

  it('skips a table that is cut off even when it is nearest', () => {
    const pick = pickIntroTable(
      input([
        { id: 'cut', left: 750, top: 900 },
        { id: 'whole', left: 100, top: 150 },
      ]),
    )
    expect(pick).toEqual({ id: 'whole', pan: null })
  })

  it('pans the nearest table into view when none is fully visible', () => {
    const pick = pickIntroTable(
      input([
        { id: 'near', left: 2000, top: 400 },
        { id: 'far', left: 5000, top: 400 },
      ]),
    )
    expect(pick?.id).toBe('near')
    expect(pick?.pan).not.toBeNull()
    // Work area centre is (800, 493); the table centre was (2150, 500).
    expect(2000 + 150 + (pick?.pan?.dx ?? 0)).toBeCloseTo(800)
  })

  it('returns null without tables', () => {
    expect(pickIntroTable(input([]))).toBeNull()
  })
})

describe('buildIntroStep', () => {
  it('has no target before a table is chosen and uses the intro copy', () => {
    const step = buildIntroStep({
      t: (key) => key,
      getTables: () => [],
      getIntroId: () => null,
      setIntroId: () => {},
      getWindowEl: () => null,
      getFlow: () => null,
      getBottomReserve: () => 78,
    })
    expect(step.id).toBe('intro')
    expect(step.title).toBe('whiteboard.fieldsTour.introTitle')
    expect(step.target()).toBeNull()
  })
})
