// Runs the orchestrator against a REAL ReactFlowProvider: setNodes only
// queues there, which the mocked-store tests in the sibling file imitate.

import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useAutoLayoutOrchestrator } from './use-auto-layout-orchestrator'
import type { ReactNode } from 'react'
import { updateTablePositionsBulk } from '@/lib/server-functions'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/server-functions', () => ({
  updateTablePositionsBulk: vi.fn(),
}))
vi.mock('@/components/auth/AuthContext', () => ({
  useAuthContext: () => ({ triggerSessionExpired: vi.fn() }),
}))

const WB_ID = '11111111-1111-1111-1111-111111111111'
const AREA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const FREE_ID = '33333333-3333-3333-3333-333333333333'
const areaNode = {
  id: AREA_ID,
  type: 'area',
  position: { x: 0, y: 0 },
  width: 200,
  height: 150,
  data: {
    area: {
      id: AREA_ID,
      positionX: 0,
      positionY: 0,
      width: 200,
      height: 150,
      memberTableIds: [MEMBER_ID],
    },
  },
}
const memberNode = {
  id: MEMBER_ID,
  type: 'table',
  parentId: AREA_ID,
  position: { x: 10, y: 10 },
  data: {},
}
const freeNode = {
  id: FREE_ID,
  type: 'table',
  position: { x: 0, y: 0 },
  data: {},
}
const NEW_AREA = {
  id: AREA_ID,
  positionX: 500,
  positionY: 300,
  width: 400,
  height: 260,
}
const OLD_AREA = {
  id: AREA_ID,
  positionX: 0,
  positionY: 0,
  width: 200,
  height: 150,
}

describe('useAutoLayoutOrchestrator with a real ReactFlowProvider', () => {
  it('a failed save restores the store and hands the previous layout to the cache', async () => {
    // The save fails after React Flow applied the optimistic layout, as a
    // network failure does; a same-tick rejection would beat the store.
    ;(updateTablePositionsBulk as any).mockImplementationOnce(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('network')), 20),
        ),
    )
    const onAreaBoundsChange = vi.fn()
    const onTablePositionsChange = vi.fn()
    const runD3ForceLayout = vi.fn().mockResolvedValue({
      positions: [
        { id: MEMBER_ID, x: 524, y: 344 },
        { id: FREE_ID, x: 50, y: 60 },
      ],
      areas: [NEW_AREA],
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ReactFlowProvider
        defaultNodes={[areaNode, memberNode, freeNode]}
        defaultEdges={[]}
      >
        {children}
      </ReactFlowProvider>
    )
    const { result } = renderHook(
      () => ({
        rf: useReactFlow(),
        orch: useAutoLayoutOrchestrator({
          whiteboardId: WB_ID,
          runD3ForceLayout,
          emitBulkPositionUpdate: vi.fn(),
          onAreaBoundsChange,
          onTablePositionsChange,
        }),
      }),
      { wrapper },
    )
    let run!: Promise<void>
    await act(async () => {
      run = Promise.resolve(result.current.orch.handleAutoLayoutClick(2))
      await new Promise((r) => setTimeout(r, 5))
    })
    // The optimistic layout reached the store before the save failed.
    expect(
      result.current.rf.getNodes().find((n) => n.id === AREA_ID)?.position,
    ).toEqual({ x: 500, y: 300 })
    await act(async () => {
      await run
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const byId = new Map(result.current.rf.getNodes().map((n) => [n.id, n]))
    expect(byId.get(AREA_ID)?.position).toEqual({ x: 0, y: 0 })
    expect(byId.get(MEMBER_ID)?.position).toEqual({ x: 10, y: 10 })
    expect(byId.get(FREE_ID)?.position).toEqual({ x: 0, y: 0 })
    expect(onAreaBoundsChange).toHaveBeenLastCalledWith([OLD_AREA])
    expect(onTablePositionsChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        { id: MEMBER_ID, x: 10, y: 10 },
        { id: FREE_ID, x: 0, y: 0 },
      ]),
    )
  })

  it('a save failing in the same tick as the apply restores the store and hands the previous layout to the cache', async () => {
    // The save fails after React Flow applied the optimistic layout, as a
    // network failure does; a same-tick rejection would beat the store.
    ;(updateTablePositionsBulk as any).mockImplementationOnce(
      () => new Promise((_, reject) => reject(new Error('network'))),
    )
    const onAreaBoundsChange = vi.fn()
    const onTablePositionsChange = vi.fn()
    const runD3ForceLayout = vi.fn().mockResolvedValue({
      positions: [
        { id: MEMBER_ID, x: 524, y: 344 },
        { id: FREE_ID, x: 50, y: 60 },
      ],
      areas: [NEW_AREA],
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ReactFlowProvider
        defaultNodes={[areaNode, memberNode, freeNode]}
        defaultEdges={[]}
      >
        {children}
      </ReactFlowProvider>
    )
    const { result } = renderHook(
      () => ({
        rf: useReactFlow(),
        orch: useAutoLayoutOrchestrator({
          whiteboardId: WB_ID,
          runD3ForceLayout,
          emitBulkPositionUpdate: vi.fn(),
          onAreaBoundsChange,
          onTablePositionsChange,
        }),
      }),
      { wrapper },
    )
    await act(async () => {
      await result.current.orch.handleAutoLayoutClick(2)
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const byId = new Map(result.current.rf.getNodes().map((n) => [n.id, n]))
    expect(byId.get(AREA_ID)?.position).toEqual({ x: 0, y: 0 })
    expect(byId.get(MEMBER_ID)?.position).toEqual({ x: 10, y: 10 })
    expect(byId.get(FREE_ID)?.position).toEqual({ x: 0, y: 0 })
    expect(onAreaBoundsChange).toHaveBeenLastCalledWith([OLD_AREA])
    expect(onTablePositionsChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        { id: MEMBER_ID, x: 10, y: 10 },
        { id: FREE_ID, x: 0, y: 0 },
      ]),
    )
  })
})
