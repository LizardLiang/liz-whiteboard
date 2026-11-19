// src/lib/react-flow/table-edit-sync.test.tsx
// Real QueryClient + a real useQuery, rebuilt like the board's initialNodes
// sync effect: unsaved table names/notes must survive reloads already in
// flight, and no reload is cancelled or lost.
import { createElement, useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createTableEditSync, noteBoardReloadStart } from './table-edit-sync'
import { resyncBoardAfterReconnect } from './board-resync'
import {
  clearPendingTables,
  insertOptimisticTable,
  removeOptimisticTable,
  settleOptimisticTable,
  useBoardSelectWithPending,
} from './optimistic-table'
import type { ReactNode } from 'react'

const WB = 'wb-1'
const KEY = ['whiteboard', WB]

interface Row {
  id: string
  name: string
  description: string | null
  columns: Array<{ id: string; order: number }>
}
interface Board {
  tables: Array<Row>
  tableReferences: Array<never>
  relationships: Array<string>
}

/** Server state plus reloads the test resolves by hand; each reload reads the server when it STARTS. */
function makeServer() {
  const state = {
    names: { t1: 'A', t2: 'X' } as Record<string, string>,
    notes: {} as Record<string, string | null>,
    relationships: [] as Array<string>,
  }
  const snapshot = (): Board => ({
    tables: Object.entries(state.names).map(([id, name]) => ({
      id,
      name,
      description: state.notes[id] ?? null,
      columns: [{ id: `${id}-c1`, order: 0 }],
    })),
    tableReferences: [],
    relationships: [...state.relationships],
  })
  const reloads: Array<{ resolve: () => void; promise: Promise<Board> }> = []
  const queryFn = vi.fn(() => {
    const data = snapshot()
    let resolve!: () => void
    const gate = new Promise<void>((r) => (resolve = r))
    const promise = gate.then(() => data)
    reloads.push({ resolve, promise })
    return promise
  })
  return { state, queryFn, reloads }
}

function setup() {
  const server = makeServer()
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const cancelSpy = vi.spyOn(qc, 'cancelQueries')
  /** Tables the board no longer holds (local or remote delete). */
  const gone = new Set<string>()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)

  const view = renderHook(
    () => {
      const select = useBoardSelectWithPending(qc, WB)
      const { data } = useQuery({
        queryKey: KEY,
        // The board's queryFn announces every start, restarts included.
        queryFn: () => {
          noteBoardReloadStart(qc, WB)
          return server.queryFn()
        },
        select,
        staleTime: 5 * 60_000,
      })
      const [shown, setShown] = useState<Record<string, Partial<Row>>>({})
      const [sync] = useState(() =>
        createTableEditSync({
          queryClient: qc,
          whiteboardId: WB,
          tableExists: (id) => !gone.has(id),
          onShown: (id, fields) =>
            setShown((prev) => ({ ...prev, [id]: { ...prev[id], ...fields } })),
        }),
      )
      useEffect(() => sync.attach(), [sync])
      // Same as the board's initialNodes sync effect: rebuild from the data, lay the overlay over it.
      useEffect(() => {
        if (!data) return
        setShown(
          Object.fromEntries(data.tables.map((t) => [t.id, sync.apply(t)])),
        )
      }, [data, sync])
      return { sync, shown, data, setShown }
    },
    { wrapper },
  )

  const row = (id: string) =>
    view.result.current.shown[id] as Partial<Row> | undefined

  const ctx = {
    qc,
    server,
    view,
    cancelSpy,
    gone,
    name: (id = 't1') => row(id)?.name,
    note: (id = 't1') => row(id)?.description,
    sync: () => view.result.current.sync,
    /**
     * Starts a reload the way invalidateQueries callers do. Each reload carries
     * a new relationship, so its data always differs from the cache and the
     * board rebuilds from it (equal data would keep the same reference).
     */
    reload: () => {
      server.state.relationships.push(`r${server.reloads.length}`)
      return qc.invalidateQueries({ queryKey: KEY })
    },
    /** Lets the oldest unresolved reload land. */
    land: async (index: number) => {
      await act(async () => {
        server.reloads[index].resolve()
        await server.reloads[index].promise.catch(() => undefined)
      })
      // Let the query notify its observers and React rebuild from the new data.
      await waitFor(() => expect(qc.isFetching({ queryKey: KEY })).toBe(0))
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10))
      })
    },
    local: (id: string, fields: { name?: string; description?: string }) => {
      let editId = 0
      act(() => {
        editId = ctx.sync().beginLocal(id, fields)
        // useTableMutations also shows the optimistic value on the node itself.
        view.result.current.setShown((prev) => ({
          ...prev,
          [id]: { ...prev[id], ...fields },
        }))
      })
      return editId
    },
    ack: (
      editId: number,
      id: string,
      ok: boolean,
      fields: { name?: string; description?: string },
    ) => {
      if (ok) {
        if (fields.name !== undefined) server.state.names[id] = fields.name
        if (fields.description !== undefined)
          server.state.notes[id] = fields.description
      }
      act(() => ctx.sync().ackLocal(editId, id, ok, fields, {}))
    },
    peer: (id: string, fields: { name?: string; description?: string }) => {
      if (fields.name !== undefined) server.state.names[id] = fields.name
      act(() => ctx.sync().applyPeer(id, fields))
    },
  }

  return ctx
}

async function loaded() {
  const ctx = setup()
  await waitFor(() => expect(ctx.server.reloads.length).toBe(1))
  await ctx.land(0)
  await waitFor(() => expect(ctx.name()).toBe('A'))
  return ctx
}

describe('table edit sync (real QueryClient)', () => {
  it('(1) a reload already in flight with the old name does not overwrite a pending rename', async () => {
    const t = await loaded()
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    t.local('t1', { name: 'B' })
    expect(t.name()).toBe('B')

    await t.land(1)

    expect(t.name()).toBe('B')
  })

  it('(1) a pending note is kept over an older reload too', async () => {
    const t = await loaded()
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    t.local('t1', { description: 'my note' })
    await t.land(1)
    expect(t.note()).toBe('my note')
  })

  it('(2) a reload in flight lands with its new data and no reload is cancelled or re-run', async () => {
    const t = await loaded()
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    const calls = t.server.queryFn.mock.calls.length
    const edit = t.local('t1', { name: 'B' })
    t.ack(edit, 't1', true, { name: 'B' })

    await t.land(1)

    expect(t.qc.getQueryData<Board>(KEY)?.relationships).toEqual(['r1'])
    expect(t.name()).toBe('B')
    expect(t.cancelSpy).not.toHaveBeenCalled()
    expect(t.server.queryFn.mock.calls.length).toBe(calls)
  })

  it('(3a) two quick renames of one table: the last one shows, also after an old reload lands', async () => {
    const t = await loaded()
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    const first = t.local('t1', { name: 'B' })
    const second = t.local('t1', { name: 'C' })
    t.ack(first, 't1', true, { name: 'B' })
    expect(t.name()).toBe('C')
    await t.land(1)
    expect(t.name()).toBe('C')
    t.ack(second, 't1', true, { name: 'C' })
    expect(t.name()).toBe('C')
  })

  it('(3b) quick renames of two tables both survive an old reload', async () => {
    const t = await loaded()
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    const e1 = t.local('t1', { name: 'B' })
    const e2 = t.local('t2', { name: 'Y' })
    t.ack(e1, 't1', true, { name: 'B' })
    await t.land(1)
    expect(t.name('t1')).toBe('B')
    expect(t.name('t2')).toBe('Y')
    t.ack(e2, 't2', true, { name: 'Y' })
    expect(t.name('t2')).toBe('Y')
  })

  it('(3c) a peer rename during a pending local edit reverts nothing', async () => {
    const t = await loaded()
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    const edit = t.local('t1', { name: 'B' })
    t.peer('t1', { name: 'P' })
    expect(t.name()).toBe('B')
    await t.land(1)
    expect(t.name()).toBe('B')
    t.ack(edit, 't1', false, { name: 'B' })
    expect(t.name()).toBe('P')
  })

  it('(3c) a peer rename is not reverted by an older reload in flight', async () => {
    const t = await loaded()
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    t.peer('t1', { name: 'P' })
    await t.land(1)
    expect(t.name()).toBe('P')
  })

  it('(3d) first rename ok, second rejected: the first value shows, also after an old reload lands', async () => {
    const t = await loaded()
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    const first = t.local('t1', { name: 'B' })
    const second = t.local('t1', { name: 'C' })
    t.ack(first, 't1', true, { name: 'B' })
    t.ack(second, 't1', false, { name: 'C' })
    expect(t.name()).toBe('B')
    await t.land(1)
    expect(t.name()).toBe('B')
  })

  it('a value the server holds is dropped once a reload that started after it lands', async () => {
    const t = await loaded()
    t.peer('t1', { name: 'P' })
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    t.server.state.names.t1 = 'RESTORED'
    await t.land(1)
    await waitFor(() => expect(t.name()).toBe('P'))
    // The reload started before RESTORED was written but after P, so P is
    // dropped and the reload data (P) shows; a later reload shows RESTORED.
    void t.reload()
    await waitFor(() => expect(t.server.reloads.length).toBe(3))
    await t.land(2)
    await waitFor(() => expect(t.name()).toBe('RESTORED'))
  })

  it('(4) a lost ack does not stick: reconnect releases the pending edit and the reload shows the server value', async () => {
    const t = await loaded()
    t.local('t1', { name: 'B' })
    expect(t.name()).toBe('B')
    // The socket dropped: the server never saved B and no ack comes.
    const reconcile = vi.fn()
    act(() => t.sync().releasePending())
    expect(t.name()).toBe('A')
    const done = resyncBoardAfterReconnect({
      queryClient: t.qc,
      whiteboardId: WB,
      isCurrent: () => true,
      reconcile,
    })
    await waitFor(() => expect(t.server.reloads.length).toBe(2))
    await t.land(1)
    await done
    expect(t.name()).toBe('A')
  })

  describe('(5) reconnect reconcile runs once per reconnect, when the reload ends', () => {
    const reconnect = (t: Awaited<ReturnType<typeof loaded>>) => {
      const reconcile = vi.fn()
      let generation = 0
      const start = () => {
        const gen = ++generation
        return resyncBoardAfterReconnect({
          queryClient: t.qc,
          whiteboardId: WB,
          isCurrent: () => generation === gen,
          reconcile,
        })
      }
      return { reconcile, start }
    }

    it('equal reload data still reconciles once per table', async () => {
      const t = await loaded()
      const { reconcile, start } = reconnect(t)
      const done = start()
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      expect(reconcile).not.toHaveBeenCalled()
      await t.land(1)
      await done
      expect(reconcile).toHaveBeenCalledTimes(2)
      expect(reconcile).toHaveBeenCalledWith('t1', ['t1-c1'])
    })

    it('a cache write during the reload does not reconcile; the reload end does, once', async () => {
      const t = await loaded()
      const { reconcile, start } = reconnect(t)
      const done = start()
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      t.peer('t1', { name: 'P' })
      expect(reconcile).not.toHaveBeenCalled()
      await t.land(1)
      await done
      expect(reconcile.mock.calls.filter((c) => c[0] === 't1')).toHaveLength(1)
    })

    it('two reconnects in a row reconcile once, against the latest reload', async () => {
      const t = await loaded()
      const { reconcile, start } = reconnect(t)
      const first = start()
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      const second = start()
      await waitFor(() => expect(t.server.reloads.length).toBe(3))
      await t.land(2)
      await Promise.all([first, second])
      expect(reconcile.mock.calls.filter((c) => c[0] === 't1')).toHaveLength(1)
    })

    it('does nothing once the board unmounts or the reload failed', async () => {
      const t = await loaded()
      const reconcile = vi.fn()
      let alive = true
      const done = resyncBoardAfterReconnect({
        queryClient: t.qc,
        whiteboardId: WB,
        isCurrent: () => alive,
        reconcile,
      })
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      alive = false
      await t.land(1)
      await done
      expect(reconcile).not.toHaveBeenCalled()
    })
  })

  describe('(6) a reload restarted by invalidateQueries', () => {
    it("shows the restarted reload's newer value over a value confirmed during the first run", async () => {
      const t = await loaded()
      void t.reload()
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      // Ack ok while the reload runs: B is confirmed.
      const edit = t.local('t1', { name: 'B' })
      t.ack(edit, 't1', true, { name: 'B' })
      // A version restore changes the name; its invalidate restarts the
      // reload, which reads the server again (query-core dispatches no
      // `fetch` action for a restart).
      t.server.state.names.t1 = 'RESTORED'
      void t.reload()
      await waitFor(() => expect(t.server.reloads.length).toBe(3))

      await t.land(2)

      await waitFor(() => expect(t.name()).toBe('RESTORED'))
      expect(t.cancelSpy).not.toHaveBeenCalled()
    })

    it('counts a restart that dispatches no `fetch` action (same fetch meta), through the query function', async () => {
      const t = await loaded()
      void t.reload()
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      const edit = t.local('t1', { name: 'B' })
      t.ack(edit, 't1', true, { name: 'B' })
      t.server.state.names.t1 = 'RESTORED'
      t.server.state.relationships.push('restart')
      const query = t.qc.getQueryCache().find({ queryKey: KEY })!
      const actions: Array<string> = []
      const stop = t.qc.getQueryCache().subscribe((event) => {
        if (event.type === 'updated') actions.push(event.action.type)
      })
      // query-core dispatches `fetch` on a restart only when the fetch meta
      // differs; with an equal meta it dispatches nothing.
      void query.fetch(undefined, { cancelRefetch: true, meta: null as never })
      stop()
      await waitFor(() => expect(t.server.reloads.length).toBe(3))
      expect(actions).not.toContain('fetch')

      await t.land(2)

      await waitFor(() => expect(t.name()).toBe('RESTORED'))
    })

    it('still keeps a value confirmed after the restart began', async () => {
      const t = await loaded()
      void t.reload()
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      void t.reload()
      await waitFor(() => expect(t.server.reloads.length).toBe(3))
      const edit = t.local('t1', { name: 'B' })
      t.ack(edit, 't1', true, { name: 'B' })

      await t.land(2)

      expect(t.name()).toBe('B')
    })
  })

  describe('(7) a table that is gone', () => {
    it('keeps no entry for an ack ok that arrives after the table was deleted', async () => {
      const t = await loaded()
      const edit = t.local('t1', { name: 'B' })
      t.gone.add('t1')
      t.sync().dropTable('t1')

      t.ack(edit, 't1', true, { name: 'B' })

      // No entry: the overlay leaves a rebuilt row alone, and the cache is untouched.
      expect(t.sync().apply({ id: 't1', name: 'A' }).name).toBe('A')
      expect(t.qc.getQueryData<Board>(KEY)?.tables[0].name).toBe('A')
    })

    it('restoreTable brings back what dropTable returned, so a failed delete keeps the unsaved name', async () => {
      const t = await loaded()
      t.local('t1', { name: 'B' })

      const dropped = t.sync().dropTable('t1')
      expect(t.sync().apply({ id: 't1', name: 'A' }).name).toBe('A')
      act(() => t.sync().restoreTable('t1', dropped))

      expect(t.sync().apply({ id: 't1', name: 'A' }).name).toBe('B')
      expect(t.name()).toBe('B')
    })

    it('a refused delete restores a name whose ack came while the table was gone (ok: shown as confirmed; refused: discarded)', async () => {
      const t = await loaded()
      const ok = t.local('t1', { name: 'B' })
      const bad = t.local('t2', { name: 'Y' })
      const d1 = t.sync().dropTable('t1')
      const d2 = t.sync().dropTable('t2')
      t.gone.add('t1')
      t.gone.add('t2')
      t.ack(ok, 't1', true, { name: 'B' })
      t.ack(bad, 't2', false, { name: 'Y' })

      // The deletes are refused: the tables are back.
      t.gone.clear()
      act(() => {
        t.sync().restoreTable('t1', d1)
        t.sync().restoreTable('t2', d2)
      })

      expect(t.sync().apply({ id: 't1', name: 'A' }).name).toBe('B')
      // t2's edit was refused: no unconfirmed value comes back.
      expect(t.sync().apply({ id: 't2', name: 'X' }).name).toBe('X')
      expect(t.qc.getQueryData<Board>(KEY)?.tables[0].name).toBe('B')
    })

    it('dropTable forgets pending and confirmed values', async () => {
      const t = await loaded()
      const edit = t.local('t1', { name: 'B' })
      t.ack(edit, 't1', true, { name: 'B' })
      t.local('t1', { description: 'note' })

      t.sync().dropTable('t1')

      expect(
        t.sync().apply({ id: 't1', name: 'A', description: null }),
      ).toEqual({ id: 't1', name: 'A', description: null })
    })
  })

  describe('(8) creating a table during the reconnect reload', () => {
    const newTable = { whiteboardId: WB, name: 'fresh' } as never

    it('does not cancel the reload: the reconcile still runs once, on the reloaded data', async () => {
      const t = await loaded()
      const reconcile = vi.fn()
      const done = resyncBoardAfterReconnect({
        queryClient: t.qc,
        whiteboardId: WB,
        isCurrent: () => true,
        reconcile,
      })
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      // The user creates a table while the reload is in flight.
      insertOptimisticTable(t.qc, WB, newTable)
      expect(t.cancelSpy).not.toHaveBeenCalled()
      expect(t.qc.isFetching({ queryKey: KEY })).toBe(1)
      // The resync must still be waiting: reconciling now would read the cache from before the reload.
      await new Promise((r) => setTimeout(r, 20))
      expect(reconcile).not.toHaveBeenCalled()

      await t.land(1)
      await done

      expect(t.server.reloads.length).toBe(2)
      // The reload landed over the optimistic row in the cache; `select` keeps it shown.
      expect(t.qc.getQueryData<Board>(KEY)?.tables.map((x) => x.id)).toEqual([
        't1',
        't2',
      ])
      expect(reconcile.mock.calls.filter((c) => c[0] === 't1')).toHaveLength(1)
    })

    const names = (t: Awaited<ReturnType<typeof loaded>>) =>
      Object.values(t.view.result.current.shown).map((r) => r.name)

    it('keeps the new table visible over a reload that lands without it, and shows one row once the real table arrives', async () => {
      const t = await loaded()
      void t.reload()
      await waitFor(() => expect(t.server.reloads.length).toBe(2))

      insertOptimisticTable(t.qc, WB, {
        whiteboardId: WB,
        name: 'fresh',
      })
      await waitFor(() => expect(names(t)).toContain('fresh'))

      // The reload that was already in flight lands without the new table.
      await t.land(1)
      expect(names(t).filter((n) => n === 'fresh')).toHaveLength(1)

      // The create's own reload carries the real row.
      t.server.state.names.real = 'fresh'
      void t.reload()
      await waitFor(() => expect(t.server.reloads.length).toBe(3))
      await t.land(2)
      await waitFor(() =>
        expect(Object.keys(t.view.result.current.shown).sort()).toEqual([
          'real',
          't1',
          't2',
        ]),
      )
      expect(names(t).filter((n) => n === 'fresh')).toHaveLength(1)
    })

    it('a failed create removes the pending row at once', async () => {
      const t = await loaded()
      const tempId = insertOptimisticTable(t.qc, WB, {
        whiteboardId: WB,
        name: 'fresh',
      })
      await waitFor(() => expect(names(t)).toContain('fresh'))
      removeOptimisticTable(t.qc, WB, tempId)
      await waitFor(() => expect(names(t)).not.toContain('fresh'))
      void t.reload()
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      await t.land(1)
      expect(names(t)).not.toContain('fresh')
    })

    it('(a) leaving the board drops a pending row, so no ghost shows when it opens again', async () => {
      const t = await loaded()
      insertOptimisticTable(t.qc, WB, { whiteboardId: WB, name: 'fresh' })
      await waitFor(() => expect(names(t)).toContain('fresh'))

      // The board closes; a peer deletes the real table; the board opens again.
      clearPendingTables(t.qc, WB)
      await waitFor(() => expect(names(t)).not.toContain('fresh'))
      void t.reload()
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      await t.land(1)
      expect(names(t)).not.toContain('fresh')
    })

    it('(b) a peer renamed the real table before the create reload landed: the row does not linger once that reload has landed', async () => {
      const t = await loaded()
      const tempId = insertOptimisticTable(t.qc, WB, {
        whiteboardId: WB,
        name: 'fresh',
      })
      await waitFor(() => expect(names(t)).toContain('fresh'))

      // The server holds the table under the peer's new name.
      t.server.state.names.real = 'renamed_by_peer'
      void t.reload().then(() => settleOptimisticTable(t.qc, WB, tempId))
      await waitFor(() => expect(t.server.reloads.length).toBe(2))
      await t.land(1)

      await waitFor(() => expect(names(t)).not.toContain('fresh'))
      expect(names(t).filter((n) => n === 'renamed_by_peer')).toHaveLength(1)
    })

    it('two creates in the same millisecond get different ids and both show', async () => {
      const t = await loaded()
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
      const a = insertOptimisticTable(t.qc, WB, {
        whiteboardId: WB,
        name: 'a1',
      })
      const b = insertOptimisticTable(t.qc, WB, {
        whiteboardId: WB,
        name: 'b1',
      })
      now.mockRestore()

      expect(a).not.toBe(b)
      await waitFor(() =>
        expect(names(t)).toEqual(expect.arrayContaining(['a1', 'b1'])),
      )
    })

    it('a failed create removes only its own row', async () => {
      const t = await loaded()
      const tempId = insertOptimisticTable(t.qc, WB, newTable)
      expect(t.qc.getQueryData<Board>(KEY)?.tables.map((x) => x.id)).toContain(
        tempId,
      )

      removeOptimisticTable(t.qc, WB, tempId)

      expect(t.qc.getQueryData<Board>(KEY)?.tables.map((x) => x.id)).toEqual([
        't1',
        't2',
      ])
    })
  })
})
