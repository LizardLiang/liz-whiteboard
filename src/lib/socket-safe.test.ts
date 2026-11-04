// H2 + M9 (security batch 1): malformed socket payloads must not crash the
// process, and dynamic namespaces only accept UUID ids.
import { describe, expect, it, vi } from 'vitest'
import {
  safeConnectionHandler,
  CANVAS_NAMESPACE_RE,
  WHITEBOARD_NAMESPACE_RE,
  guardSocketHandlers,
} from './socket-safe'

function buildSocket() {
  const handlers: Record<string, (...a: Array<any>) => any> = {}
  const socket: any = {
    on: vi.fn((e: string, h: (...a: Array<any>) => any) => {
      handlers[e] = h
    }),
  }
  guardSocketHandlers(socket)
  return { socket, handlers }
}

describe('guardSocketHandlers', () => {
  it('acks an error instead of throwing when a handler throws on null data', async () => {
    const { socket, handlers } = buildSocket()
    // Mirrors comment:delete: catch block read data.commentId.
    socket.on('comment:delete', (data: any) => {
      throw new Error(`boom ${data.commentId}`)
    })
    const ack = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(handlers['comment:delete'](null, ack)).resolves.toBeUndefined()
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'INTERNAL_ERROR' }),
    )
  })

  it('replaces a non-function ack with undefined', async () => {
    const { socket, handlers } = buildSocket()
    let seen: unknown = 'unset'
    socket.on('table:create', async (_d: unknown, cb?: unknown) => {
      seen = cb
      ;(cb as any)?.({ ok: true }) // would be `1(...)` without the guard
    })
    await expect(handlers['table:create']({}, 1)).resolves.toBeUndefined()
    expect(seen).toBeUndefined()
  })

  it('does not throw when the handler fails and the ack is not a function', async () => {
    const { socket, handlers } = buildSocket()
    socket.on('x', async () => {
      throw new Error('nope')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(handlers['x'](null, 'str')).resolves.toBeUndefined()
  })

  it('passes arguments through untouched on the happy path', async () => {
    const { socket, handlers } = buildSocket()
    const listener = vi.fn()
    socket.on('ok', listener)
    const ack = vi.fn()
    await handlers['ok']({ a: 1 }, ack)
    expect(listener).toHaveBeenCalledWith({ a: 1 }, ack)
  })

  it('leaves disconnect listeners unwrapped (their arg is a reason string)', () => {
    const { socket, handlers } = buildSocket()
    const listener = vi.fn()
    socket.on('disconnect', listener)
    expect(handlers['disconnect']).toBe(listener)
  })

  it('is idempotent', () => {
    const { socket } = buildSocket()
    const wrapped = socket.on
    guardSocketHandlers(socket)
    expect(socket.on).toBe(wrapped)
  })
})

describe('namespace patterns', () => {
  const uuid = '20000000-0000-4000-8000-000000000001'
  it('accepts UUID ids', () => {
    expect(WHITEBOARD_NAMESPACE_RE.test(`/whiteboard/${uuid}`)).toBe(true)
    expect(CANVAS_NAMESPACE_RE.test(`/canvas/${uuid}`)).toBe(true)
  })
  it('rejects non-UUID ids', () => {
    for (const id of [
      'abc',
      'x'.repeat(500),
      `${uuid}-extra`,
      `${uuid}/x`,
      '',
    ]) {
      expect(WHITEBOARD_NAMESPACE_RE.test(`/whiteboard/${id}`)).toBe(false)
      expect(CANVAS_NAMESPACE_RE.test(`/canvas/${id}`)).toBe(false)
    }
  })
})

describe('safeConnectionHandler', () => {
  it('disconnects the socket and does not reject when the handler throws', async () => {
    const disconnect = vi.fn()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapped = safeConnectionHandler(async () => {
      throw new Error('db down')
    })
    await expect(wrapped({ disconnect })).resolves.toBeUndefined()
    expect(disconnect).toHaveBeenCalledWith(true)
    spy.mockRestore()
  })

  it('leaves the socket alone when the handler succeeds', async () => {
    const disconnect = vi.fn()
    await safeConnectionHandler(async () => {})({ disconnect })
    expect(disconnect).not.toHaveBeenCalled()
  })
})
