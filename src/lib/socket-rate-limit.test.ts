// src/lib/socket-rate-limit.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SOCKETS_PER_USER,
  _resetUserConnectionsForTests,
  admitUserConnection,
  createSocketEventLimiter,
} from './socket-rate-limit'
import { guardSocketHandlers } from './socket-safe'

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

describe('createSocketEventLimiter', () => {
  it('lets a full 500-event MCP position batch through, twice in a row', () => {
    let t = 0
    const allow = createSocketEventLimiter(() => t)
    for (let batch = 0; batch < 2; batch++) {
      for (let i = 0; i < 500; i++) {
        t += 4 // 250 events/s, faster than a measured MCP round trip
        expect(allow('table:move').ok).toBe(true)
      }
    }
  })

  it('refuses a mutation flood and recovers after the bucket refills', () => {
    let t = 0
    const allow = createSocketEventLimiter(() => t)
    let refused = 0
    for (let i = 0; i < 5000; i++) if (!allow('column:create').ok) refused += 1
    expect(refused).toBeGreaterThan(3000)
    t += 10_000
    expect(allow('column:create').ok).toBe(true)
  })

  it('limits comment, sync:request and heartbeat events tightly', () => {
    const allow = createSocketEventLimiter(() => 0)
    const run = (event: string, n: number) =>
      Array.from({ length: n }, () => allow(event).ok).filter(Boolean).length
    expect(run('comment:create', 100)).toBe(20)
    expect(run('sync:request', 100)).toBe(10)
    expect(run('activity:heartbeat', 100)).toBe(5)
  })

  it('does not share buckets across classes or limit cursor:update', () => {
    const allow = createSocketEventLimiter(() => 0)
    for (let i = 0; i < 50; i++) allow('comment:create')
    expect(allow('table:move').ok).toBe(true)
    for (let i = 0; i < 5000; i++) expect(allow('cursor:update').ok).toBe(true)
  })

  it('samples refusals: the 1st and every 100th', () => {
    const allow = createSocketEventLimiter(() => 0)
    for (let i = 0; i < 5; i++) allow('activity:heartbeat')
    const samples = Array.from({ length: 201 }, () => allow('activity:heartbeat'))
      .map((r) => !r.ok && r.sample)
      .filter(Boolean).length
    expect(samples).toBe(3)
  })
})

describe('guardSocketHandlers rate limiting', () => {
  it('acks RATE_LIMITED, skips the listener, and keeps the socket open', async () => {
    const { socket, handlers } = buildSocket()
    socket.disconnect = vi.fn()
    const listener = vi.fn()
    socket.on('comment:create', listener)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ack = vi.fn()
    for (let i = 0; i < 20; i++) await handlers['comment:create']({}, ack)
    expect(listener).toHaveBeenCalledTimes(20)
    await handlers['comment:create']({}, ack)
    expect(listener).toHaveBeenCalledTimes(20)
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'RATE_LIMITED' }),
    )
    expect(socket.disconnect).not.toHaveBeenCalled()
  })

  it('drops an ack-less refused event without throwing', async () => {
    const { socket, handlers } = buildSocket()
    socket.on('sync:request', vi.fn())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 10; i++) await handlers['sync:request']()
    await expect(handlers['sync:request']()).resolves.toBeUndefined()
  })
})

describe('admitUserConnection', () => {
  beforeEach(() => _resetUserConnectionsForTests())

  it('refuses the socket past the cap and frees a slot on disconnect', () => {
    const disconnectors: Array<() => void> = []
    const mk = () => ({
      on: (_e: string, l: () => void) => {
        disconnectors.push(l)
      },
    })
    for (let i = 0; i < MAX_SOCKETS_PER_USER; i++) {
      expect(admitUserConnection(mk(), 'u1')).toBe(true)
    }
    expect(admitUserConnection(mk(), 'u1')).toBe(false)
    expect(admitUserConnection(mk(), 'u2')).toBe(true)
    disconnectors[0]()
    expect(admitUserConnection(mk(), 'u1')).toBe(true)
  })
})
