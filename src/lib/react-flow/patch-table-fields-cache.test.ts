// src/lib/react-flow/patch-table-fields-cache.test.ts
// Regression: an inline rename must survive a refetch that was already in
// flight (it carries the pre-rename snapshot) — local optimistic path and
// peer table:updated path both go through patchTableFieldsInCache.
import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { patchTableFieldsInCache } from './patch-table-fields-cache'

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

  it('is a no-op while the cache has not loaded', async () => {
    const qc = new QueryClient()
    await patchTableFieldsInCache(qc, 'wb-1', 't1', { name: 'B' })
    expect(qc.getQueryData(KEY)).toBeUndefined()
  })
})
