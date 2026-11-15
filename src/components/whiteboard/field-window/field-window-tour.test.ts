import { describe, expect, it } from 'vitest'
import {
  TOUR_STEP_COUNT,
  buildFieldWindowTour,
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
