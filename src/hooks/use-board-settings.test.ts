// src/hooks/use-board-settings.test.ts
// Settings write ack timeout: an unanswered write must roll back only its
// keys, toast, and stop masking collaborator broadcasts for those keys.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { useBoardSettings } from './use-board-settings'
import { ACK_TIMEOUT_MS } from './use-canvas-elements'
import type { CanvasBoardSettings } from '@/data/canvas-board-settings'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const BASE = { diagramStyle: 'card', flowDots: 'path' } as CanvasBoardSettings

function setup(connectionState: 'connected' | 'disconnected' = 'connected') {
  const handlers = new Map<string, (...a: Array<any>) => void>()
  const emit = vi.fn()
  const on = vi.fn((e: string, h: (...a: Array<any>) => void) => {
    handlers.set(e, h)
  })
  const off = vi.fn()
  const hook = renderHook(
    (props: { cs: 'connected' | 'disconnected' }) =>
      useBoardSettings({
        initialSettings: BASE,
        emit,
        on,
        off,
        connectionState: props.cs,
      }),
    { initialProps: { cs: connectionState } },
  )
  return { hook, emit, handlers }
}

describe('useBoardSettings ack timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(toast.error).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('rolls back and toasts when the ack never fires, then applies a later broadcast', () => {
    const { hook, handlers } = setup()
    act(() => hook.result.current.handleSettingsChange({ diagramStyle: 'classic' }))
    expect(hook.result.current.settings.diagramStyle).toBe('classic')

    // masked while pending
    act(() =>
      handlers.get('board:settings-updated')!({
        settings: { ...BASE, diagramStyle: 'card', flowDots: 'always' },
      }),
    )
    expect(hook.result.current.settings.diagramStyle).toBe('classic')
    expect(hook.result.current.settings.flowDots).toBe('always')

    act(() => {
      vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1)
    })
    expect(hook.result.current.settings.diagramStyle).toBe('card')
    expect(toast.error).toHaveBeenCalledTimes(1)

    act(() =>
      handlers.get('board:settings-updated')!({
        settings: { ...BASE, diagramStyle: 'classic' },
      }),
    )
    expect(hook.result.current.settings.diagramStyle).toBe('classic')
  })

  it('a late ack after the timeout is ignored', () => {
    const { hook, emit } = setup()
    act(() => hook.result.current.handleSettingsChange({ diagramStyle: 'classic' }))
    const ack = emit.mock.calls[0][2]
    act(() => {
      vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1)
    })
    act(() => ack({ ok: true }))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(hook.result.current.settings.diagramStyle).toBe('card')
  })

  it('clears pending counts on disconnect so broadcasts apply', () => {
    const { hook, handlers } = setup()
    act(() => hook.result.current.handleSettingsChange({ diagramStyle: 'classic' }))
    hook.rerender({ cs: 'disconnected' })
    act(() =>
      handlers.get('board:settings-updated')!({
        settings: { ...BASE, diagramStyle: 'card' },
      }),
    )
    expect(hook.result.current.settings.diagramStyle).toBe('card')
  })

  it('a successful ack keeps the optimistic value', () => {
    const { hook, emit } = setup()
    act(() => hook.result.current.handleSettingsChange({ diagramStyle: 'classic' }))
    act(() => emit.mock.calls[0][2]({ ok: true }))
    act(() => {
      vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1)
    })
    expect(hook.result.current.settings.diagramStyle).toBe('classic')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a timeout after a reconnect broadcast does not overwrite the newer value', () => {
    const { hook, handlers } = setup()
    act(() => hook.result.current.handleSettingsChange({ diagramStyle: 'classic' }))
    hook.rerender({ cs: 'disconnected' })
    hook.rerender({ cs: 'connected' })
    // Server had saved classic; a collaborator then switched the board to card
    // and back, landing on classic again via broadcast.
    act(() =>
      handlers.get('board:settings-updated')!({
        settings: { ...BASE, diagramStyle: 'classic' },
      }),
    )
    act(() => {
      vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1)
    })
    expect(hook.result.current.settings.diagramStyle).toBe('classic')
  })
})
