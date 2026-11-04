// M7: registry disconnects + periodic recheck, with fake sockets.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RECHECK_INTERVAL_MS,
  _resetSocketRegistryForTests,
  disconnectSessionSockets,
  disconnectUserSockets,
  trackSocket,
  trackedSocketCount,
} from './socket-registry'
import { completePasswordReset } from '@/data/password-reset'
import { removeProjectMember, setProjectMemberRole } from '@/data/permission'
import { deleteAuthSession } from '@/data/session'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

function fakeSocket(data: Record<string, unknown>) {
  const handlers: Record<string, () => void> = { disconnect: () => {} }
  return {
    data,
    emit: vi.fn(),
    disconnect: vi.fn(() => handlers.disconnect()),
    on: (e: string, cb: () => void) => {
      handlers[e] = cb
    },
  }
}

function insertSession(id: string, userId: string, expiresAt = Date.now() + 3_600_000) {
  db.prepare(
    'INSERT INTO "Session" ("id","tokenHash","userId","expiresAt","createdAt") VALUES (?,?,?,?,?)',
  ).run(id, `hash-${id}`, userId, expiresAt, Date.now())
}

beforeEach(() => {
  resetDb()
  _resetSocketRegistryForTests()
})
afterEach(() => {
  _resetSocketRegistryForTests()
  vi.useRealTimers()
})

describe('registry disconnects', () => {
  it('disconnectUserSockets cuts every socket of that user only', () => {
    const a1 = fakeSocket({ userId: 'a', sessionId: 's1', sessionExpiresAt: Date.now() + 1e6 })
    const a2 = fakeSocket({ userId: 'a', sessionId: '', sessionExpiresAt: Date.now() + 1e6 })
    const b = fakeSocket({ userId: 'b', sessionId: 's2', sessionExpiresAt: Date.now() + 1e6 })
    ;[a1, a2, b].forEach((s) => trackSocket(s))
    expect(disconnectUserSockets('a')).toBe(2)
    expect(a1.disconnect).toHaveBeenCalledWith(true)
    expect(a2.disconnect).toHaveBeenCalled()
    expect(b.disconnect).not.toHaveBeenCalled()
    expect(trackedSocketCount()).toBe(1)
  })

  it('disconnectSessionSockets cuts only the logged-out session', () => {
    const s1 = fakeSocket({ userId: 'a', sessionId: 's1', sessionExpiresAt: Date.now() + 1e6 })
    const s2 = fakeSocket({ userId: 'a', sessionId: 's2', sessionExpiresAt: Date.now() + 1e6 })
    trackSocket(s1)
    trackSocket(s2)
    disconnectSessionSockets('s1')
    expect(s1.disconnect).toHaveBeenCalled()
    expect(s2.disconnect).not.toHaveBeenCalled()
  })

  it('logout (deleteAuthSession) disconnects that session\'s sockets', async () => {
    const u = makeUser()
    insertSession('sess-1', u.id)
    const s = fakeSocket({ userId: u.id, sessionId: 'sess-1', sessionExpiresAt: Date.now() + 1e6 })
    trackSocket(s)
    await deleteAuthSession('sess-1')
    expect(s.disconnect).toHaveBeenCalled()
  })

  it('completePasswordReset disconnects the user\'s sockets', () => {
    const u = makeUser()
    const s = fakeSocket({ userId: u.id, sessionId: '', sessionExpiresAt: Date.now() + 1e6 })
    trackSocket(s)
    completePasswordReset(u.id, 'newhash')
    expect(s.disconnect).toHaveBeenCalled()
  })

  it('member removal and role change disconnect the member\'s sockets', async () => {
    const owner = makeUser()
    const member = makeUser()
    const project = makeProject({ ownerId: owner.id })
    const s1 = fakeSocket({ userId: member.id, sessionId: '', sessionExpiresAt: Date.now() + 1e6 })
    trackSocket(s1)
    await setProjectMemberRole({ projectId: project.id, userId: member.id, role: 'VIEWER' })
    expect(s1.disconnect).toHaveBeenCalled()

    const s2 = fakeSocket({ userId: member.id, sessionId: '', sessionExpiresAt: Date.now() + 1e6 })
    trackSocket(s2)
    await removeProjectMember(project.id, member.id)
    expect(s2.disconnect).toHaveBeenCalled()
  })
})

describe('periodic recheck', () => {
  it('disconnects a socket whose Session row was deleted', async () => {
    vi.useFakeTimers()
    const u = makeUser()
    insertSession('sess-x', u.id)
    const s = fakeSocket({ userId: u.id, sessionId: 'sess-x', sessionExpiresAt: Date.now() + 3_600_000 })
    trackSocket(s)

    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS)
    expect(s.disconnect).not.toHaveBeenCalled()

    db.prepare('DELETE FROM "Session" WHERE "id" = ?').run('sess-x')
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS)
    expect(s.disconnect).toHaveBeenCalledWith(true)
  })

  it('disconnects when role access is lost', async () => {
    vi.useFakeTimers()
    let access = true
    const s = fakeSocket({ userId: 'u', sessionId: '', sessionExpiresAt: Date.now() + 3_600_000 })
    trackSocket(s, () => access)
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS)
    expect(s.disconnect).not.toHaveBeenCalled()
    access = false
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS)
    expect(s.disconnect).toHaveBeenCalled()
  })

  it('disconnects a JWT socket past its expiry and fails closed on a recheck error', async () => {
    vi.useFakeTimers()
    const exp = fakeSocket({ userId: 'u', sessionId: '', sessionExpiresAt: Date.now() + 1000 })
    trackSocket(exp)
    const boom = fakeSocket({ userId: 'v', sessionId: '', sessionExpiresAt: Date.now() + 1e9 })
    trackSocket(boom, () => {
      throw new Error('db down')
    })
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS)
    expect(exp.disconnect).toHaveBeenCalled()
    expect(boom.disconnect).toHaveBeenCalled()
  })
})
