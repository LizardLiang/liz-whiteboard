import { describe, expect, it } from 'vitest'
import { initialTourState, tourReducer } from './use-spotlight-tour'

describe('tourReducer', () => {
  const started = tourReducer(initialTourState, { type: 'start', total: 3 })

  it('start opens at step 0', () => {
    expect(started).toEqual({ open: true, step: 0, total: 3 })
  })

  it('start with no steps stays closed', () => {
    expect(tourReducer(initialTourState, { type: 'start', total: 0 })).toBe(
      initialTourState,
    )
  })

  it('next advances and back retreats', () => {
    const s1 = tourReducer(started, { type: 'next' })
    expect(s1.step).toBe(1)
    expect(tourReducer(s1, { type: 'back' }).step).toBe(0)
  })

  it('back on the first step is a no-op', () => {
    expect(tourReducer(started, { type: 'back' })).toBe(started)
  })

  it('next on the last step closes the tour', () => {
    let s = started
    s = tourReducer(s, { type: 'next' })
    s = tourReducer(s, { type: 'next' })
    expect(s.step).toBe(2)
    s = tourReducer(s, { type: 'next' })
    expect(s.open).toBe(false)
  })

  it('end closes; actions on a closed tour are no-ops', () => {
    const ended = tourReducer(started, { type: 'end' })
    expect(ended.open).toBe(false)
    expect(tourReducer(ended, { type: 'next' })).toBe(ended)
    expect(tourReducer(ended, { type: 'back' })).toBe(ended)
    expect(tourReducer(ended, { type: 'end' })).toBe(ended)
  })

  it('restart after end begins at step 0', () => {
    let s = tourReducer(started, { type: 'next' })
    s = tourReducer(s, { type: 'end' })
    expect(tourReducer(s, { type: 'start', total: 3 }).step).toBe(0)
  })
})
