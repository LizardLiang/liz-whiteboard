// src/lib/react-flow/optimistic-table.test.tsx
// Pending created rows with a real QueryClient: a failed reload must not retire
// a row, and a read-only mount must not touch the live board's rows.
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import {
  insertOptimisticTable,
  settleOptimisticTableAfterReload,
  useBoardSelectWithPending,
  withPendingTables,
} from './optimistic-table'

const WB = 'wb-1'
const KEY = ['whiteboard', WB]

interface Board {
  tables: Array<{ id: string; name: string }>
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const gates: Array<{
    resolve: (b: Board) => void
    reject: (e: Error) => void
  }> = []
  const queryFn = vi.fn(
    () =>
      new Promise<Board>((resolve, reject) => gates.push({ resolve, reject })),
  )
  const observer = new QueryObserver(qc, {
    queryKey: KEY,
    queryFn,
    staleTime: 60_000,
  })
  const unsubscribe = observer.subscribe(() => undefined)
  const shown = () =>
    withPendingTables(qc, WB, qc.getQueryData<Board>(KEY)!).tables.map(
      (t) => t.name,
    )
  return { qc, gates, shown, unsubscribe }
}

async function loaded() {
  const t = setup()
  await vi.waitFor(() => expect(t.gates).toHaveLength(1))
  t.gates[0].resolve({ tables: [{ id: 't1', name: 'users' }] })
  await vi.waitFor(() => expect(t.qc.isFetching()).toBe(0))
  return t
}

describe('settleOptimisticTableAfterReload', () => {
  it('keeps the new table when the create reload fails, and one row shows once a later reload carries the real table', async () => {
    const t = await loaded()
    const tempId = insertOptimisticTable(t.qc, WB, {
      whiteboardId: WB,
      name: 'fresh',
    })
    expect(t.shown()).toContain('fresh')

    const settled = settleOptimisticTableAfterReload(t.qc, WB, tempId)
    await vi.waitFor(() => expect(t.gates).toHaveLength(2))
    t.gates[1].reject(new Error('network'))
    await settled

    expect(t.shown()).toEqual(['users', 'fresh'])

    // The next successful reload carries the real row.
    void t.qc.invalidateQueries({ queryKey: KEY })
    await vi.waitFor(() => expect(t.gates).toHaveLength(3))
    t.gates[2].resolve({
      tables: [
        { id: 't1', name: 'users' },
        { id: 'real', name: 'fresh' },
      ],
    })
    await vi.waitFor(() => expect(t.qc.isFetching()).toBe(0))

    expect(t.shown()).toEqual(['users', 'fresh'])
    expect(
      withPendingTables(t.qc, WB, t.qc.getQueryData<Board>(KEY)!).tables.map(
        (x) => x.id,
      ),
    ).toEqual(['t1', 'real'])
    t.unsubscribe()
  })

  it('retires the row once the reload landed without it (a peer removed the table meanwhile)', async () => {
    const t = await loaded()
    const tempId = insertOptimisticTable(t.qc, WB, {
      whiteboardId: WB,
      name: 'fresh',
    })

    const settled = settleOptimisticTableAfterReload(t.qc, WB, tempId)
    await vi.waitFor(() => expect(t.gates).toHaveLength(2))
    t.gates[1].resolve({ tables: [{ id: 't1', name: 'users' }] })
    await settled

    expect(t.shown()).toEqual(['users'])
    t.unsubscribe()
  })
})

describe('useBoardSelectWithPending', () => {
  it('a read-only mount (the history preview) leaves the live board pending rows alone on unmount', async () => {
    const t = await loaded()
    insertOptimisticTable(t.qc, WB, { whiteboardId: WB, name: 'fresh' })

    const preview = renderHook(() => useBoardSelectWithPending(t.qc, WB, false))
    preview.unmount()

    expect(t.shown()).toContain('fresh')
    t.unsubscribe()
  })

  it('the live board clears its pending rows when it unmounts', async () => {
    const t = await loaded()
    insertOptimisticTable(t.qc, WB, { whiteboardId: WB, name: 'fresh' })

    const live = renderHook(() => useBoardSelectWithPending(t.qc, WB))
    live.unmount()

    expect(t.shown()).not.toContain('fresh')
    t.unsubscribe()
  })

  it('subscribes once, not on every render', () => {
    const qc = new QueryClient()
    const add = vi.spyOn(Set.prototype, 'add')
    const hook = renderHook(() => useBoardSelectWithPending(qc, WB))
    const afterMount = add.mock.calls.length
    hook.rerender()
    hook.rerender()
    expect(add.mock.calls.length).toBe(afterMount)
    add.mockRestore()
    hook.unmount()
  })
})
