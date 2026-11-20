// src/lib/auth/session-sweep.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _stopSessionSweepForTests, startSessionSweep } from './session-sweep'
import { db } from '@/db'
import { makeUser, resetDb } from '@/test/db-helpers'

function insertSession(userId: string, expiresAt: number): string {
  const id = crypto.randomUUID()
  const ts = Date.now()
  db.prepare(
    'INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt") VALUES (?,?,?,?,?)',
  ).run(id, userId, `hash-${id}`, expiresAt, ts)
  return id
}
const exists = (id: string) =>
  db.prepare('SELECT 1 AS x FROM "Session" WHERE "id" = ?').get(id) !== undefined

beforeEach(() => {
  resetDb()
  vi.useFakeTimers()
})
afterEach(() => {
  _stopSessionSweepForTests()
  vi.useRealTimers()
})

describe('startSessionSweep', () => {
  it('deletes expired sessions at boot and on the hourly sweep, keeps live ones', async () => {
    const user = makeUser()
    const expired = insertSession(user.id, Date.now() - 1000)
    const live = insertSession(user.id, Date.now() + 3 * 3_600_000)

    startSessionSweep()
    await vi.advanceTimersByTimeAsync(0)
    expect(exists(expired)).toBe(false)
    expect(exists(live)).toBe(true)

    const expiredLater = insertSession(user.id, Date.now() - 1000)
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(exists(expiredLater)).toBe(false)
    expect(exists(live)).toBe(true)
  })
})
