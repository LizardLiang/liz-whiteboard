// src/lib/auth/owner-email-backfill.test.ts
// Integration tests for the email-targeted ownerless-project backfill.
// Mirrors src/lib/auth/first-user-migration.test.ts's style: runs against
// an in-memory SQLite DB.

import { beforeEach, describe, expect, it } from 'vitest'

import { backfillOwnerlessProjectsByEmail } from './owner-email-backfill'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

beforeEach(() => resetDb())

function ownerOf(projectId: string): string | null {
  const row = db
    .prepare('SELECT "ownerId" FROM "Project" WHERE "id" = ?')
    .get(projectId) as { ownerId: string | null } | undefined
  return row?.ownerId ?? null
}

describe('backfillOwnerlessProjectsByEmail', () => {
  it('backfills NULL-owner projects to the user with the given email', async () => {
    const target = makeUser({ email: 'shotup0101@gmail.com' })
    const p1 = makeProject({ name: 'orphan-1' }) // ownerId null
    const p2 = makeProject({ name: 'orphan-2' }) // ownerId null

    await backfillOwnerlessProjectsByEmail('shotup0101@gmail.com')

    expect(ownerOf(p1.id)).toBe(target.id)
    expect(ownerOf(p2.id)).toBe(target.id)
  })

  it('backfills empty-string-owner projects too', async () => {
    const target = makeUser({ email: 'shotup0101@gmail.com' })
    const p1 = makeProject({ name: 'empty-owner' })
    // Simulate a legacy empty-string ownerId (not just NULL). The live
    // schema's ownerId FK (ON DELETE SET NULL) means '' can never actually
    // be written while foreign_keys=ON — temporarily disable it, matching
    // src/test/db-helpers.ts's resetDb() precedent, purely to construct
    // this edge-case row for the test.
    db.exec('PRAGMA foreign_keys = OFF;')
    db.prepare('UPDATE "Project" SET "ownerId" = ? WHERE "id" = ?').run(
      '',
      p1.id,
    )
    db.exec('PRAGMA foreign_keys = ON;')
    expect(ownerOf(p1.id)).toBe('')

    await backfillOwnerlessProjectsByEmail('shotup0101@gmail.com')

    expect(ownerOf(p1.id)).toBe(target.id)
  })

  it('does not touch already-owned projects', async () => {
    const target = makeUser({ email: 'shotup0101@gmail.com' })
    const existingOwner = makeUser({ email: 'someone-else@example.com' })
    const owned = makeProject({ name: 'owned', ownerId: existingOwner.id })
    const orphan = makeProject({ name: 'orphan' })

    await backfillOwnerlessProjectsByEmail('shotup0101@gmail.com')

    expect(ownerOf(owned.id)).toBe(existingOwner.id)
    expect(ownerOf(orphan.id)).toBe(target.id)
  })

  it('no-ops (does not create a user, does not throw) when no user with that email exists', async () => {
    const orphan = makeProject({ name: 'orphan' })

    await expect(
      backfillOwnerlessProjectsByEmail('nobody@example.com'),
    ).resolves.not.toThrow()

    expect(ownerOf(orphan.id)).toBeNull()
    const userCount = (
      db.prepare('SELECT count(*) AS c FROM "User"').get() as { c: number }
    ).c
    expect(userCount).toBe(0)
  })

  it('is idempotent — a second run is a no-op once every project has an owner', async () => {
    const target = makeUser({ email: 'shotup0101@gmail.com' })
    const orphan = makeProject({ name: 'orphan' })

    await backfillOwnerlessProjectsByEmail('shotup0101@gmail.com')
    expect(ownerOf(orphan.id)).toBe(target.id)

    // A newly-created orphan after the first run should NOT be touched by
    // re-running (only projects that were ownerless at call time are
    // affected — this just re-confirms the first run's result is stable).
    await expect(
      backfillOwnerlessProjectsByEmail('shotup0101@gmail.com'),
    ).resolves.not.toThrow()
    expect(ownerOf(orphan.id)).toBe(target.id)
  })

  it('defaults to OWNER_BACKFILL_EMAIL when called with no argument', async () => {
    const target = makeUser({ email: 'shotup0101@gmail.com' })
    const orphan = makeProject({ name: 'orphan' })

    await backfillOwnerlessProjectsByEmail()

    expect(ownerOf(orphan.id)).toBe(target.id)
  })
})
