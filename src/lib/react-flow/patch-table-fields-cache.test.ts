// src/lib/react-flow/patch-table-fields-cache.test.ts
// Regression: an inline rename must survive a refetch that was already in
// flight (it carries the pre-rename snapshot) — local optimistic path and
// peer table:updated path both go through patchTableFieldsInCache.
import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  hasDeferredWhiteboardRefetch,
  patchTableFieldsInCache,
  settleCancelledWhiteboardRefetch,
} from './patch-table-fields-cache'

const KEY = ['whiteboard', 'wb-1']
const snapshot = (name: string) => ({
  id: 'wb-1',
  tables: [
    { id: 't1', name, description: null, columns: [] },
    { id: 't2', name: 'other', description: null, columns: [] },
  ],
})
const nameOf = (qc: QueryClient, id = 't1') =>
  qc
    .getQueryData<ReturnType<typeof snapshot>>(KEY)
    ?.tables.find((t) => t.id === id)?.name

describe('patchTableFieldsInCache', () => {
  it('patches only the targeted table', async () => {
    const qc = new QueryClient()
    qc.setQueryData(KEY, snapshot('A'))
    await patchTableFieldsInCache(qc, 'wb-1', 't1', { name: 'B' })
    expect(nameOf(qc)).toBe('B')
    expect(nameOf(qc, 't2')).toBe('other')
  })

  it('keeps the new name when a refetch that started before the rename resolves with the old snapshot', async () => {
    const qc = new QueryClient()
    qc.setQueryData(KEY, snapshot('A'))
    let resolveStale!: (v: unknown) => void
    const stale = new Promise((r) => (resolveStale = r))
    const refetch = qc
      .fetchQuery({ queryKey: KEY, queryFn: () => stale, staleTime: 0 })
      .catch(() => undefined)

    await patchTableFieldsInCache(qc, 'wb-1', 't1', { name: 'B' })
    resolveStale(snapshot('A'))
    await refetch

    expect(nameOf(qc)).toBe('B')
  })

  describe('refetches cancelled by the patch are re-run', () => {
    const withRelationship = (name: string) => ({
      ...snapshot(name),
      relationships: [{ id: 'r1' }],
    })
    const startInFlight = (qc: QueryClient) => {
      let calls = 0
      let resolveFirst!: (v: unknown) => void
      const first = new Promise((r) => (resolveFirst = r))
      const queryFn = () => {
        calls += 1
        return calls === 1 ? first : Promise.resolve(withRelationship('B'))
      }
      const refetch = qc
        .fetchQuery({ queryKey: KEY, queryFn, staleTime: 0 })
        .catch(() => undefined)
      return { resolveFirst, refetch, calls: () => calls }
    }
    const relsOf = (qc: QueryClient) =>
      (qc.getQueryData<any>(KEY)?.relationships ?? []).length

    it('keeps data a cancelled invalidate-style refetch carried (new relationship) after a peer patch', async () => {
      const qc = new QueryClient()
      qc.setQueryData(KEY, snapshot('A'))
      const f = startInFlight(qc)

      await patchTableFieldsInCache(qc, 'wb-1', 't1', { name: 'B' })
      f.resolveFirst(withRelationship('A'))
      await f.refetch
      await new Promise((r) => setTimeout(r, 0))

      expect(f.calls()).toBeGreaterThanOrEqual(2)
      expect(relsOf(qc)).toBe(1)
      expect(nameOf(qc)).toBe('B')
    })

    it('defers the re-run of a local patch until the server settles', async () => {
      const qc = new QueryClient()
      qc.setQueryData(KEY, snapshot('A'))
      const f = startInFlight(qc)

      await patchTableFieldsInCache(qc, 'wb-1', 't1', { name: 'B' }, 'defer')
      f.resolveFirst(withRelationship('A'))
      await f.refetch
      expect(f.calls()).toBe(1)
      expect(hasDeferredWhiteboardRefetch(qc, 'wb-1')).toBe(true)
      expect(nameOf(qc)).toBe('B')

      settleCancelledWhiteboardRefetch(qc, 'wb-1')
      await new Promise((r) => setTimeout(r, 0))
      expect(f.calls()).toBe(2)
      expect(hasDeferredWhiteboardRefetch(qc, 'wb-1')).toBe(false)
      expect(relsOf(qc)).toBe(1)
    })

    it('does not refetch when nothing was in flight', async () => {
      const qc = new QueryClient()
      qc.setQueryData(KEY, snapshot('A'))
      await patchTableFieldsInCache(qc, 'wb-1', 't1', { name: 'B' }, 'defer')
      expect(hasDeferredWhiteboardRefetch(qc, 'wb-1')).toBe(false)
    })
  })

  it('is a no-op while the cache has not loaded', async () => {
    const qc = new QueryClient()
    await patchTableFieldsInCache(qc, 'wb-1', 't1', { name: 'B' })
    expect(qc.getQueryData(KEY)).toBeUndefined()
  })
})
