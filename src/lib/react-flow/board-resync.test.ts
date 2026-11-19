// src/lib/react-flow/board-resync.test.ts
// resyncBoardAfterReconnect with a real QueryClient: the wait for a running
// reload always ends, and a reconcile never runs against data that no reload
// has refreshed.
import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { resyncBoardAfterReconnect } from './board-resync'
import { noteBoardReloadStart } from './table-edit-sync'

const KEY = ['whiteboard', 'wb-1']

const board = (order: Array<string>) => ({
  tables: [
    {
      id: 't1',
      name: 'A',
      description: null,
      columns: order.map((id) => ({ id, order: 0 })),
    },
  ],
  tableReferences: [],
})

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
}

/** A reload that stays in flight: fetching, no observer, no data. */
function startReload(qc: QueryClient) {
  let land!: (data: unknown) => void
  const loading = qc.fetchQuery({
    queryKey: KEY,
    queryFn: () => new Promise((resolve) => (land = resolve)),
  })
  return { land: (data: unknown) => land(data), loading }
}

/** Counts refetchQueries calls and fails the test at a bound: a spinning loop never yields to the test runner. */
function guardRefetch(qc: QueryClient, run?: () => void) {
  const real = qc.refetchQueries.bind(qc)
  const spy = vi.spyOn(qc, 'refetchQueries')
  spy.mockImplementation(async (...args) => {
    if (spy.mock.calls.length > 100) throw new Error('busy loop')
    run?.()
    return real(...args)
  })
  return spy
}

describe('resyncBoardAfterReconnect', () => {
  it('stops at once on a reload that refetchQueries cannot await, and does not reconcile', async () => {
    const qc = client()
    // refetchQueries skips a query with no observer and no data, and resolves.
    const reload = startReload(qc)
    expect(qc.isFetching({ queryKey: KEY })).toBe(1)
    const refetch = guardRefetch(qc)
    const reconcile = vi.fn()

    await resyncBoardAfterReconnect({
      queryClient: qc,
      whiteboardId: 'wb-1',
      isCurrent: () => true,
      reconcile,
    })

    // invalidateQueries refetches once itself; the wait loop adds one call and stops.
    expect(refetch.mock.calls.length).toBeLessThanOrEqual(2)
    expect(reconcile).not.toHaveBeenCalled()
    reload.land(board(['c1']))
    await reload.loading
  })

  it('gives up after a bounded number of waits when the query keeps changing under a reload it cannot await', async () => {
    const qc = client()
    const reload = startReload(qc)
    let n = 0
    // Every wait sees the query move (a cache write) and resolves at once, so
    // only the bound ends the loop.
    const refetch = vi.spyOn(qc, 'refetchQueries').mockImplementation(() => {
      if (n > 100) throw new Error('busy loop')
      qc.setQueryData(KEY, board([`c${n++}`]))
      return Promise.resolve()
    })
    const reconcile = vi.fn()

    await resyncBoardAfterReconnect({
      queryClient: qc,
      whiteboardId: 'wb-1',
      isCurrent: () => true,
      reconcile,
    })

    expect(refetch.mock.calls.length).toBeLessThanOrEqual(21)
    expect(reconcile).not.toHaveBeenCalled()
    reload.land(board(['c1']))
    await reload.loading
  })

  it('keeps waiting when a restart cancels the reload the wait joined, and reconciles once on the restarted reload', async () => {
    const qc = client()
    qc.setQueryData(KEY, board(['c1']))
    const gates: Array<(data: unknown) => void> = []
    const queryFn = vi.fn(() => {
      noteBoardReloadStart(qc, 'wb-1')
      return new Promise((resolve) => gates.push(resolve))
    })
    // A reload already running when the socket reconnects. No observer is
    // active, so invalidateQueries does not wait on it and the wait loop joins it.
    void qc.fetchQuery({ queryKey: KEY, queryFn, staleTime: 0 })
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    const reconcile = vi.fn()

    const done = resyncBoardAfterReconnect({
      queryClient: qc,
      whiteboardId: 'wb-1',
      isCurrent: () => true,
      reconcile,
    })
    await new Promise((r) => setTimeout(r, 10))
    // A local create's invalidate restarts the reload the wait joined.
    void qc.refetchQueries({ queryKey: KEY })
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(reconcile).not.toHaveBeenCalled()

    gates[1](board(['c2', 'c1']))
    await done

    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledWith('t1', ['c2', 'c1'])
  })
})
