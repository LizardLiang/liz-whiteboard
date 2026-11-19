// src/lib/react-flow/table-edit-overlay.test.ts
import { describe, expect, it } from 'vitest'
import { createTableEditOverlay } from './table-edit-overlay'

const table = (
  id: string,
  name: string,
  description: string | null = null,
) => ({
  id,
  name,
  description,
})

describe('table edit overlay', () => {
  it('shows nothing and returns the same table when empty', () => {
    const o = createTableEditOverlay()
    const t = table('t1', 'A')
    expect(o.apply(t)).toBe(t)
    expect(o.shown('t1', 'name')).toBeUndefined()
  })

  it('beginLocal shows the pending value over the table; a newer edit replaces it', () => {
    const o = createTableEditOverlay()
    o.beginLocal('t1', { name: 'B' })
    expect(o.apply(table('t1', 'A')).name).toBe('B')
    o.beginLocal('t1', { name: 'C' })
    expect(o.apply(table('t1', 'A')).name).toBe('C')
    expect(o.apply(table('t2', 'A')).name).toBe('A')
  })

  it('applies a cleared note (null) and keeps the table reference when it already matches', () => {
    const o = createTableEditOverlay()
    o.beginLocal('t1', { description: null })
    const unchanged = table('t1', 'A', null)
    expect(o.apply(unchanged)).toBe(unchanged)
    expect(o.apply(table('t1', 'A', 'old')).description).toBeNull()
  })

  describe('ackLocal', () => {
    it('ok: the value stays shown as confirmed after pending is cleared', () => {
      const o = createTableEditOverlay()
      const id = o.beginLocal('t1', { name: 'B' })
      o.ackLocal(id, 't1', true, { name: 'B' })
      expect(o.shown('t1', 'name')).toBe('B')
    })

    it('not ok: pending goes and the table value shows again', () => {
      const o = createTableEditOverlay()
      const id = o.beginLocal('t1', { name: 'B' })
      o.ackLocal(id, 't1', false, { name: 'B' })
      expect(o.shown('t1', 'name')).toBeUndefined()
      expect(o.size()).toBe(0)
    })

    it('a superseded ok ack records confirmed but keeps the newer pending shown', () => {
      const o = createTableEditOverlay()
      const first = o.beginLocal('t1', { name: 'B' })
      const second = o.beginLocal('t1', { name: 'C' })
      o.ackLocal(first, 't1', true, { name: 'B' })
      expect(o.shown('t1', 'name')).toBe('C')
      o.ackLocal(second, 't1', false, { name: 'C' })
      expect(o.shown('t1', 'name')).toBe('B')
    })

    it('a superseded failed ack does not clear the newer pending value', () => {
      const o = createTableEditOverlay()
      const first = o.beginLocal('t1', { name: 'B' })
      o.beginLocal('t1', { name: 'C' })
      o.ackLocal(first, 't1', false, { name: 'B' })
      expect(o.shown('t1', 'name')).toBe('C')
    })
  })

  it('applyPeer confirms a value and leaves a local pending edit on top', () => {
    const o = createTableEditOverlay()
    o.applyPeer('t1', { name: 'P' })
    expect(o.shown('t1', 'name')).toBe('P')
    const id = o.beginLocal('t1', { name: 'B' })
    o.applyPeer('t1', { name: 'Q' })
    expect(o.shown('t1', 'name')).toBe('B')
    o.ackLocal(id, 't1', false, { name: 'B' })
    expect(o.shown('t1', 'name')).toBe('Q')
  })

  it('releasePending drops pending values, keeps confirmed ones, and lists the changed tables', () => {
    const o = createTableEditOverlay()
    o.applyPeer('t1', { name: 'P' })
    o.beginLocal('t1', { name: 'B' })
    o.beginLocal('t2', { description: 'note' })
    o.applyPeer('t3', { name: 'only-confirmed' })
    expect(o.releasePending().sort()).toEqual(['t1', 't2'])
    expect(o.shown('t1', 'name')).toBe('P')
    expect(o.shown('t2', 'description')).toBeUndefined()
    expect(o.shown('t3', 'name')).toBe('only-confirmed')
  })

  describe('reload counting', () => {
    it('a reload in flight when the value was confirmed does not drop it', () => {
      const o = createTableEditOverlay()
      o.onFetchStart()
      o.applyPeer('t1', { name: 'P' })
      o.onFetchSuccess()
      expect(o.shown('t1', 'name')).toBe('P')
    })

    it('a reload that started after the value was confirmed drops it', () => {
      const o = createTableEditOverlay()
      o.onFetchStart()
      o.applyPeer('t1', { name: 'P' })
      o.onFetchStart()
      o.onFetchSuccess()
      expect(o.shown('t1', 'name')).toBeUndefined()
      expect(o.size()).toBe(0)
    })

    it('a landing reload never drops a pending value', () => {
      const o = createTableEditOverlay()
      o.beginLocal('t1', { name: 'B' })
      o.onFetchStart()
      o.onFetchSuccess()
      expect(o.shown('t1', 'name')).toBe('B')
    })
  })

  it('dropTable forgets every entry of the table', () => {
    const o = createTableEditOverlay()
    o.beginLocal('t1', { name: 'B', description: 'n' })
    o.dropTable('t1')
    expect(o.size()).toBe(0)
    expect(o.apply(table('t1', 'A')).name).toBe('A')
  })
})
