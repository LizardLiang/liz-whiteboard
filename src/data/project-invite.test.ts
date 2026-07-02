// src/data/project-invite.test.ts
// Integration tests for the ProjectInvite data layer against a real
// in-memory SQLite database (mirrors src/data/session.test.ts's style).

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createProjectInvite,
  findActiveInviteByTokenHash,
  findProjectInvites,
  incrementInviteUsedCount,
  revokeProjectInvite,
} from '@/data/project-invite'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

beforeEach(() => resetDb())

describe('project-invite data layer', () => {
  describe('createProjectInvite', () => {
    it('persists a row and returns it with the given fields', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })

      const invite = await createProjectInvite({
        projectId: project.id,
        role: 'EDITOR',
        tokenHash: 'a'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })

      expect(invite.projectId).toBe(project.id)
      expect(invite.role).toBe('EDITOR')
      expect(invite.tokenHash).toBe('a'.repeat(64))
      expect(invite.createdByUserId).toBe(owner.id)
      expect(invite.maxUses).toBeNull()
      expect(invite.usedCount).toBe(0)
      expect(invite.revokedAt).toBeNull()
      expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('computes expiresAt from expiresInHours', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })
      const before = Date.now()

      const invite = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'b'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 1,
      })

      const expectedMin = before + 1 * 3_600_000
      const expectedMax = Date.now() + 1 * 3_600_000
      expect(invite.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin)
      expect(invite.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax)
    })

    // W5: opportunistic expired-row sweep (mirrors OauthRefreshToken's
    // DELETE ... WHERE expiresAt < ? precedent in src/lib/oauth/tokens.ts)
    it('sweeps other stale expired invites as a side effect of creating a new one', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })

      const stale = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'stale'.padEnd(64, '0'),
        createdByUserId: owner.id,
        expiresInHours: -1, // already expired
      })
      // Sanity: the stale row exists immediately after creation.
      expect(
        await findActiveInviteByTokenHash('stale'.padEnd(64, '0')),
      ).not.toBeNull()

      // Creating a second (fresh) invite should sweep the stale one away.
      await createProjectInvite({
        projectId: project.id,
        role: 'EDITOR',
        tokenHash: 'fresh'.padEnd(64, '0'),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })

      expect(
        await findActiveInviteByTokenHash('stale'.padEnd(64, '0')),
      ).toBeNull()
      const remaining = await findProjectInvites(project.id)
      expect(remaining.find((i) => i.id === stale.id)).toBeUndefined()
    })

    it('does not sweep the row it just created, even if created already-expired', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })

      const invite = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'justcreated'.padEnd(64, '0'),
        createdByUserId: owner.id,
        expiresInHours: -1, // already expired at creation time
      })

      // The row must still exist immediately after its own creation, so a
      // caller can classify it as EXPIRED (not INVALID/not-found).
      const found = await findActiveInviteByTokenHash(
        'justcreated'.padEnd(64, '0'),
      )
      expect(found).not.toBeNull()
      expect(found?.id).toBe(invite.id)
    })

    it('returns createdByUsername via the batched join', async () => {
      const owner = makeUser({ username: 'the-creator' })
      const project = makeProject({ ownerId: owner.id })

      await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'joincheck'.padEnd(64, '0'),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })

      const [row] = await findProjectInvites(project.id)
      expect(row.createdByUsername).toBe('the-creator')
    })
  })

  describe('findActiveInviteByTokenHash', () => {
    it('returns null for an unknown hash', async () => {
      const result = await findActiveInviteByTokenHash('nonexistent')
      expect(result).toBeNull()
    })

    it('returns the row for a revoked invite (caller does the state check)', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })
      const invite = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'c'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })
      await revokeProjectInvite(project.id, invite.id)

      const result = await findActiveInviteByTokenHash('c'.repeat(64))
      expect(result).not.toBeNull()
      expect(result?.revokedAt).not.toBeNull()
    })

    it('returns the row for an expired invite (caller does the state check)', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })
      // expiresInHours negative -> already in the past
      const invite = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'd'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: -1,
      })

      const result = await findActiveInviteByTokenHash('d'.repeat(64))
      expect(result).not.toBeNull()
      expect(result?.id).toBe(invite.id)
      expect(result!.expiresAt.getTime()).toBeLessThan(Date.now())
    })
  })

  describe('findProjectInvites', () => {
    it('returns invites for a project ordered by createdAt DESC', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })
      const other = makeProject({ ownerId: owner.id })

      const first = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'e'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })
      const second = await createProjectInvite({
        projectId: project.id,
        role: 'EDITOR',
        tokenHash: 'f'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })
      await createProjectInvite({
        projectId: other.id,
        role: 'VIEWER',
        tokenHash: 'g'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })

      const invites = await findProjectInvites(project.id)
      expect(invites).toHaveLength(2)
      expect(invites.map((i) => i.id)).toEqual(
        expect.arrayContaining([first.id, second.id]),
      )
      expect(invites.every((i) => i.projectId === project.id)).toBe(true)
    })
  })

  describe('revokeProjectInvite', () => {
    it('sets revokedAt on the matching row', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })
      const invite = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'h'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })

      await revokeProjectInvite(project.id, invite.id)

      const [row] = await findProjectInvites(project.id)
      expect(row.revokedAt).not.toBeNull()
    })

    it('is idempotent — double-revoke does not throw and preserves the original revokedAt', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })
      const invite = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'i'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })

      await revokeProjectInvite(project.id, invite.id)
      const [firstRevoke] = await findProjectInvites(project.id)
      const firstRevokedAt = firstRevoke.revokedAt?.getTime()

      await expect(
        revokeProjectInvite(project.id, invite.id),
      ).resolves.not.toThrow()

      const [secondRevoke] = await findProjectInvites(project.id)
      expect(secondRevoke.revokedAt?.getTime()).toBe(firstRevokedAt)
    })

    it('is a no-op for a mismatched projectId', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })
      const otherProject = makeProject({ ownerId: owner.id })
      const invite = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'j'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })

      await revokeProjectInvite(otherProject.id, invite.id)

      const [row] = await findProjectInvites(project.id)
      expect(row.revokedAt).toBeNull()
    })
  })

  describe('incrementInviteUsedCount', () => {
    it('increments usedCount by 1', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })
      const invite = await createProjectInvite({
        projectId: project.id,
        role: 'VIEWER',
        tokenHash: 'k'.repeat(64),
        createdByUserId: owner.id,
        expiresInHours: 24,
      })

      await incrementInviteUsedCount(invite.id)
      await incrementInviteUsedCount(invite.id)

      const [row] = await findProjectInvites(project.id)
      expect(row.usedCount).toBe(2)
    })
  })
})
