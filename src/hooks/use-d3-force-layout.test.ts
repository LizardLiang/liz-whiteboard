// src/hooks/use-d3-force-layout.test.ts
// Unit tests for useD3ForceLayout hook — TC-AL-E-12 and TC-AL-E-13

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// Mock the layout engine so tests are synchronous and controlled (vi.mock is hoisted)
vi.mock('@/lib/auto-layout/d3-force-layout', () => ({
  computeD3ForceLayout: vi.fn(),
  // assignLayersBFS and computeEdgeBundleOffsets are called by the hook after
  // computeD3ForceLayout resolves. Return minimal no-op stubs.
  assignLayersBFS: vi.fn(() => new Map<string, number>()),
  computeEdgeBundleOffsets: vi.fn(() => []),
}))

// eslint-disable-next-line import/first
import { useD3ForceLayout } from './use-d3-force-layout'
// eslint-disable-next-line import/first
import { computeD3ForceLayout } from '@/lib/auto-layout/d3-force-layout'

const mockComputeLayout = computeD3ForceLayout as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NODES = [
  {
    id: 'T1',
    position: { x: 0, y: 0 },
    measured: { width: 200, height: 100 },
    data: { table: { id: 'T1', name: 'T1', columns: [] } },
    type: 'tableNode',
  } as any,
  {
    id: 'T2',
    position: { x: 100, y: 100 },
    measured: { width: 200, height: 100 },
    data: { table: { id: 'T2', name: 'T2', columns: [] } },
    type: 'tableNode',
  } as any,
]

const EDGES = [] as Array<any>

const POSITIONS = [
  { id: 'T1', x: 0, y: 0 },
  { id: 'T2', x: 300, y: 0 },
]

// ---------------------------------------------------------------------------
// TC-AL-E-12 — isRunning transitions
// ---------------------------------------------------------------------------

describe('useD3ForceLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TC-AL-E-12: isRunning transitions false → true → false around runLayout', async () => {
    let resolveLayout!: (value: typeof POSITIONS) => void

    mockComputeLayout.mockReturnValueOnce(
      new Promise<typeof POSITIONS>((res) => {
        resolveLayout = res
      }),
    )

    const { result } = renderHook(() => useD3ForceLayout())

    // Initially not running
    expect(result.current.isRunning).toBe(false)
    expect(result.current.error).toBeNull()

    // Start the layout (do not await yet)
    let layoutPromise: Promise<any>
    act(() => {
      layoutPromise = result.current.runLayout(NODES, EDGES)
    })

    // Should be running now
    expect(result.current.isRunning).toBe(true)

    // Resolve and finish
    await act(async () => {
      resolveLayout(POSITIONS)
      await layoutPromise
    })

    // Should be done
    expect(result.current.isRunning).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('TC-AL-E-12 (cont): returns { positions, edgeOffsets } on success', async () => {
    mockComputeLayout.mockResolvedValueOnce(POSITIONS)

    const { result } = renderHook(() => useD3ForceLayout())

    let layoutResult: any
    await act(async () => {
      layoutResult = await result.current.runLayout(NODES, EDGES)
    })

    // runLayout now returns { positions, edgeOffsets } — not a raw array
    expect(layoutResult).not.toBeNull()
    expect(layoutResult.positions).toEqual(POSITIONS)
    expect(Array.isArray(layoutResult.edgeOffsets)).toBe(true)
  })

  // TC-AL-E-13 — Error surfaced without mutating nodes
  it('TC-AL-E-13: on error, sets error state and returns null; does not throw', async () => {
    const testError = new Error('simulation exploded')
    mockComputeLayout.mockRejectedValueOnce(testError)

    const onLayoutError = vi.fn()
    const { result } = renderHook(() => useD3ForceLayout({ onLayoutError }))

    let positions: any
    await act(async () => {
      positions = await result.current.runLayout(NODES, EDGES)
    })

    expect(positions).toBeNull()
    expect(result.current.error).toEqual(testError)
    expect(result.current.isRunning).toBe(false)
    expect(onLayoutError).toHaveBeenCalledWith(testError)
  })

  it('TC-AL-E-13 (cont): error does not prevent subsequent successful runs', async () => {
    mockComputeLayout
      .mockRejectedValueOnce(new Error('first call fails'))
      .mockResolvedValueOnce(POSITIONS)

    const { result } = renderHook(() => useD3ForceLayout())

    await act(async () => {
      await result.current.runLayout(NODES, EDGES)
    })
    expect(result.current.error).toBeTruthy()

    let layoutResult: any
    await act(async () => {
      layoutResult = await result.current.runLayout(NODES, EDGES)
    })
    // After a successful run, positions are inside the LayoutResult wrapper
    expect(layoutResult?.positions).toEqual(POSITIONS)
    expect(result.current.error).toBeNull()
  })

  // GH #151 Bug 1 — table nodes must size from table DATA (full column
  // list + saved width), never from `node.measured`. The measured DOM box
  // is LOD-trimmed (header-only) when zoomed below LOD_ZOOM_THRESHOLD;
  // sizing from it packed positions for the trimmed box and caused overlap
  // once zoomed back to full detail. A large `measured` value here (e.g.
  // from a stale full-detail render) must be IGNORED in favor of the
  // data-derived size so layout stays correct regardless of current zoom.
  it('GH #151: sizes table nodes from table data, ignoring measured dimensions', async () => {
    mockComputeLayout.mockResolvedValueOnce(POSITIONS)

    const nodes = [
      {
        id: 'T1',
        position: { x: 0, y: 0 },
        // Deliberately a LOD-trimmed (small) measured box — must be ignored.
        measured: { width: 90, height: 40 },
        data: {
          table: {
            id: 'T1',
            name: 'T1',
            columns: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
            width: 300, // saved width — acts as a floor
          },
        },
        type: 'tableNode',
      } as any,
    ]

    const { result } = renderHook(() => useD3ForceLayout())

    await act(async () => {
      await result.current.runLayout(nodes, [])
    })

    // width: no canvas 2D context in jsdom → getCachedTableWidth falls back
    // to the saved-width floor (300, since it's above DEFAULT_W).
    // height: calculateTableHeight(3) = 40 + 3*28 + 12 = 136.
    expect(mockComputeLayout).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'T1', width: 300, height: 136 }),
      ]),
      expect.any(Array),
    )
  })

  it('falls back to measured/width when node has no table data (area nodes)', async () => {
    mockComputeLayout.mockResolvedValueOnce(POSITIONS)

    const noTableNode = {
      id: 'A1',
      position: { x: 0, y: 0 },
      measured: { width: 320, height: 180 },
      data: {},
      type: 'area',
    } as any

    const { result } = renderHook(() => useD3ForceLayout())

    await act(async () => {
      await result.current.runLayout([noTableNode], [])
    })

    expect(mockComputeLayout).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'A1', width: 320, height: 180 }),
      ]),
      expect.any(Array),
    )
  })

  it('falls back to 250×150 when a non-table node has no measured dimensions', async () => {
    mockComputeLayout.mockResolvedValueOnce(POSITIONS)

    const noMeasureNode = {
      id: 'A1',
      position: { x: 0, y: 0 },
      // no measured field
      data: {},
      type: 'area',
    } as any

    const { result } = renderHook(() => useD3ForceLayout())

    await act(async () => {
      await result.current.runLayout([noMeasureNode], [])
    })

    expect(mockComputeLayout).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'A1', width: 250, height: 150 }),
      ]),
      expect.any(Array),
    )
  })
})
