// src/lib/auth/first-user-migration.test.ts
// Integration tests for first-user data migration (TC-P2-09 through TC-P2-10).
// Runs against an in-memory SQLite DB.

import { beforeEach, describe, expect, it } from 'vitest'

import { migrateDataToFirstUser } from './first-user-migration'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

beforeEach(() => resetDb())

function ownerOf(projectId: string): string | null {
  const row = db
    .prepare('SELECT "ownerId" FROM "Project" WHERE "id" = ?')
    .get(projectId) as { ownerId: string | null } | undefined
  return row?.ownerId ?? null
}

describe('migrateDataToFirstUser', () => {
  // TC-P2-09: assigns all ownerless projects
  it('TC-P2-09: assigns all ownerless projects to the first user', async () => {
    const user = makeUser()
    const p1 = makeProject({ name: 'orphan-1' }) // ownerId null
    const p2 = makeProject({ name: 'orphan-2' }) // ownerId null
    const p3 = makeProject({ name: 'orphan-3' }) // ownerId null

    await migrateDataToFirstUser(user.id)

    expect(ownerOf(p1.id)).toBe(user.id)
    expect(ownerOf(p2.id)).toBe(user.id)
    expect(ownerOf(p3.id)).toBe(user.id)
  })

  // TC-P2-10: idempotent — already-owned projects untouched
  it('TC-P2-10: leaves already-owned projects untouched', async () => {
    const existingOwner = makeUser()
    const newUser = makeUser()
    const owned = makeProject({ name: 'owned', ownerId: existingOwner.id })
    const orphan = makeProject({ name: 'orphan' })

    await migrateDataToFirstUser(newUser.id)

    // Owned project keeps its original owner; orphan gets the new user.
    expect(ownerOf(owned.id)).toBe(existingOwner.id)
    expect(ownerOf(orphan.id)).toBe(newUser.id)
  })

  it('TC-P2-10: is idempotent — second invocation is a no-op', async () => {
    const firstUser = makeUser()
    const secondUser = makeUser()
    const orphan = makeProject({ name: 'orphan' })

    await migrateDataToFirstUser(firstUser.id)
    expect(ownerOf(orphan.id)).toBe(firstUser.id)

    // No ownerless projects remain, so a second run changes nothing.
    await expect(migrateDataToFirstUser(secondUser.id)).resolves.not.toThrow()
    expect(ownerOf(orphan.id)).toBe(firstUser.id)
  })

  it('does not throw when there are no projects at all', async () => {
    const user = makeUser()
    await expect(migrateDataToFirstUser(user.id)).resolves.not.toThrow()
  })
})
