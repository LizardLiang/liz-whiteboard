import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  FLOW_CYCLE_MS,
  flowDotsWanted,
  useFlowAnimation,
} from './use-flow-animation'
import type { FlowAnimationInput } from './use-flow-animation'

let pending: Map<number, FrameRequestCallback>
let nextId: number
let now: number
let reducedMotion: boolean

function flushFrame() {
  const due = [...pending.values()]
  pending.clear()
  act(() => {
    for (const cb of due) cb(0)
  })
}

beforeEach(() => {
  pending = new Map()
  nextId = 1
  now = 0
  reducedMotion = false
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id)
  })
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  })
})

const base: FlowAnimationInput = {
  diagramStyle: 'card',
  flowDots: 'path',
  pathActive: true,
  hasConnectors: true,
}

describe('flowDotsWanted', () => {
  it('runs in path mode only with an active path', () => {
    expect(flowDotsWanted(base)).toBe(true)
    expect(flowDotsWanted({ ...base, pathActive: false })).toBe(false)
  })
  it('runs in always mode whenever the board has connectors', () => {
    const always: FlowAnimationInput = {
      ...base,
      flowDots: 'always',
      pathActive: false,
    }
    expect(flowDotsWanted(always)).toBe(true)
    expect(flowDotsWanted({ ...always, hasConnectors: false })).toBe(false)
  })
  it('never runs under classic', () => {
    expect(flowDotsWanted({ ...base, diagramStyle: 'classic' })).toBe(false)
    expect(
      flowDotsWanted({ ...base, diagramStyle: 'classic', flowDots: 'always' }),
    ).toBe(false)
  })
})

describe('useFlowAnimation', () => {
  it('advances the phase over one cycle and wraps', () => {
    const { result } = renderHook(() => useFlowAnimation(base))
    expect(result.current).toBe(0)
    now = FLOW_CYCLE_MS / 4
    flushFrame()
    expect(result.current).toBeCloseTo(0.25)
    now = FLOW_CYCLE_MS * 1.5
    flushFrame()
    expect(result.current).toBeCloseTo(0.5)
  })

  it('holds no animation frame when idle', () => {
    renderHook(() => useFlowAnimation({ ...base, pathActive: false }))
    expect(pending.size).toBe(0)
  })

  it('stops and clears the phase when the path goes away', () => {
    const { result, rerender } = renderHook(
      (props: FlowAnimationInput) => useFlowAnimation(props),
      { initialProps: base },
    )
    expect(result.current).toBe(0)
    rerender({ ...base, pathActive: false })
    expect(result.current).toBeNull()
    expect(pending.size).toBe(0)
  })

  it('does not run under reduced motion', () => {
    reducedMotion = true
    const { result } = renderHook(() => useFlowAnimation(base))
    expect(result.current).toBeNull()
    expect(pending.size).toBe(0)
  })

  it('does not run in a hidden tab', () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    const { result } = renderHook(() => useFlowAnimation(base))
    expect(result.current).toBeNull()
    expect(pending.size).toBe(0)
  })

  it('does not run under classic', () => {
    const { result } = renderHook(() =>
      useFlowAnimation({ ...base, diagramStyle: 'classic' }),
    )
    expect(result.current).toBeNull()
    expect(pending.size).toBe(0)
  })

  it('stops when the tab becomes hidden', () => {
    const { result } = renderHook(() => useFlowAnimation(base))
    expect(result.current).toBe(0)
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBeNull()
    expect(pending.size).toBe(0)
  })
})
