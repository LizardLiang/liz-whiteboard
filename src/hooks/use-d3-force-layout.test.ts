// src/hooks/use-d3-force-layout.test.ts
// Unit tests for useD3ForceLayout hook — TC-AL-E-12 and TC-AL-E-13

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useD3ForceLayout } from './use-d3-force-layout'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock computeD3ForceLayout so tests are synchronous and controlled
vi.mock('@/lib/auto-layout/d3-force-layout', () => ({
  computeD3ForceLayout: vi.fn(),
}))

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

const EDGES = [] as any[]

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

  it('TC-AL-E-12 (cont): returns positions array on success', async () => {
    mockComputeLayout.mockResolvedValueOnce(POSITIONS)

    const { result } = renderHook(() => useD3ForceLayout())

    let positions: any
    await act(async () => {
      positions = await result.current.runLayout(NODES, EDGES)
    })

    expect(positions).toEqual(POSITIONS)
  })

  // TC-AL-E-13 — Error surfaced without mutating nodes
  it('TC-AL-E-13: on error, sets error state and returns null; does not throw', async () => {
    const testError = new Error('simulation exploded')
    mockComputeLayout.mockRejectedValueOnce(testError)

    const onLayoutError = vi.fn()
    const { result } = renderHook(() =>
      useD3ForceLayout({ onLayoutError }),
    )

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

    let positions: any
    await act(async () => {
      positions = await result.current.runLayout(NODES, EDGES)
    })
    expect(positions).toEqual(POSITIONS)
    expect(result.current.error).toBeNull()
  })

  it('uses measured dimensions when available', async () => {
    mockComputeLayout.mockResolvedValueOnce(POSITIONS)

    const nodes = [
      {
        id: 'T1',
        position: { x: 0, y: 0 },
        measured: { width: 320, height: 180 },
        data: { table: { id: 'T1', name: 'T1', columns: [] } },
        type: 'tableNode',
      } as any,
    ]

    const { result } = renderHook(() => useD3ForceLayout())

    await act(async () => {
      await result.current.runLayout(nodes, [])
    })

    expect(mockComputeLayout).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'T1', width: 320, height: 180 }),
      ]),
      expect.any(Array),
    )
  })

  it('falls back to 250×150 when measured dimensions are unavailable', async () => {
    mockComputeLayout.mockResolvedValueOnce(POSITIONS)

    const noMeasureNode = {
      id: 'T1',
      position: { x: 0, y: 0 },
      // no measured field
      data: { table: { id: 'T1', name: 'T1', columns: [] } },
      type: 'tableNode',
    } as any

    const { result } = renderHook(() => useD3ForceLayout())

    await act(async () => {
      await result.current.runLayout([noMeasureNode], [])
    })

    expect(mockComputeLayout).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'T1', width: 250, height: 150 }),
      ]),
      expect.any(Array),
    )
  })
})
