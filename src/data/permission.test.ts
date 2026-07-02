// src/data/permission.test.ts
// Integration tests for permission (ProjectMember) data-access functions.
// Runs against an in-memory SQLite DB (vitest.config sets DATABASE_URL=:memory:).

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createProjectMember,
  deleteProjectMember,
  findEffectiveRole,
  findProjectMembers,
  findProjectMembersByUser,
  upsertProjectMember,
} from './permission'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

beforeEach(() => resetDb())

describe('permission data-access', () => {
  describe('createProjectMember', () => {
    it('inserts a membership and returns the mapped row', async () => {
      const owner = makeUser()
      const member = makeUser()
      const project = makeProject({ ownerId: owner.id })

      const created = await createProjectMember({
        projectId: project.id,
        userId: member.id,
        role: 'EDITOR',
      })

      expect(created.projectId).toBe(project.id)
      expect(created.userId).toBe(member.id)
      expect(created.role).toBe('EDITOR')
      expect(created.createdAt).toBeInstanceOf(Date)

      // Read-back via raw db
      const row = db
        .prepare('SELECT * FROM "ProjectMember" WHERE "id" = ?')
        .get(created.id) as { role: string } | undefined
      expect(row?.role).toBe('EDITOR')
    })
  })

  describe('findProjectMembers', () => {
    it('returns members each with a nested user selection', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })
      const alice = makeUser({ username: 'alice', email: 'alice@example.com' })
      const bob = makeUser({ username: 'bob', email: 'bob@example.com' })

      await createProjectMember({
        projectId: project.id,
        userId: alice.id,
        role: 'EDITOR',
      })
      await createProjectMember({
        projectId: project.id,
        userId: bob.id,
        role: 'VIEWER',
      })

      const members = await findProjectMembers(project.id)

      expect(members).toHaveLength(2)
      const byUser = new Map(members.map((m) => [m.userId, m]))

      const aliceMember = byUser.get(alice.id)!
      expect(aliceMember.role).toBe('EDITOR')
      expect(aliceMember.user).toEqual({
        id: alice.id,
        username: 'alice',
        email: 'alice@example.com',
      })

      const bobMember = byUser.get(bob.id)!
      expect(bobMember.role).toBe('VIEWER')
      expect(bobMember.user.username).toBe('bob')
    })

    it('returns an empty array when project has no members', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })

      const members = await findProjectMembers(project.id)
      expect(members).toEqual([])
    })
  })

  describe('findProjectMembersByUser', () => {
    it('returns all memberships for a user across projects', async () => {
      const user = makeUser()
      const owner = makeUser()
      const projectA = makeProject({ name: 'A', ownerId: owner.id })
      const projectB = makeProject({ name: 'B', ownerId: owner.id })

      await createProjectMember({
        projectId: projectA.id,
        userId: user.id,
        role: 'EDITOR',
      })
      await createProjectMember({
        projectId: projectB.id,
        userId: user.id,
        role: 'VIEWER',
      })

      const memberships = await findProjectMembersByUser(user.id)
      expect(memberships).toHaveLength(2)
      expect(memberships.map((m) => m.projectId).sort()).toEqual(
        [projectA.id, projectB.id].sort(),
      )
    })
  })

  describe('upsertProjectMember', () => {
    it('inserts when no membership exists', async () => {
      const owner = makeUser()
      const member = makeUser()
      const project = makeProject({ ownerId: owner.id })

      const result = await upsertProjectMember({
        projectId: project.id,
        userId: member.id,
        role: 'VIEWER',
      })

      expect(result.role).toBe('VIEWER')
      const count = db
        .prepare(
          'SELECT COUNT(*) AS c FROM "ProjectMember" WHERE "projectId" = ? AND "userId" = ?',
        )
        .get(project.id, member.id) as { c: number }
      expect(count.c).toBe(1)
    })

    it('updates the role on conflict instead of inserting a duplicate', async () => {
      const owner = makeUser()
      const member = makeUser()
      const project = makeProject({ ownerId: owner.id })

      await upsertProjectMember({
        projectId: project.id,
        userId: member.id,
        role: 'VIEWER',
      })
      const updated = await upsertProjectMember({
        projectId: project.id,
        userId: member.id,
        role: 'EDITOR',
      })

      expect(updated.role).toBe('EDITOR')
      const count = db
        .prepare(
          'SELECT COUNT(*) AS c FROM "ProjectMember" WHERE "projectId" = ? AND "userId" = ?',
        )
        .get(project.id, member.id) as { c: number }
      expect(count.c).toBe(1)
    })
  })

  describe('deleteProjectMember', () => {
    it('removes an existing membership', async () => {
      const owner = makeUser()
      const member = makeUser()
      const project = makeProject({ ownerId: owner.id })

      await createProjectMember({
        projectId: project.id,
        userId: member.id,
        role: 'EDITOR',
      })

      await deleteProjectMember(project.id, member.id)

      const row = db
        .prepare(
          'SELECT * FROM "ProjectMember" WHERE "projectId" = ? AND "userId" = ?',
        )
        .get(project.id, member.id)
      expect(row).toBeUndefined()
    })

    it('does not throw when membership does not exist', async () => {
      await expect(
        deleteProjectMember('no-project', 'no-user'),
      ).resolves.toBeUndefined()
    })
  })

  describe('findEffectiveRole', () => {
    it('returns OWNER for the project owner', async () => {
      const owner = makeUser()
      const project = makeProject({ ownerId: owner.id })

      const role = await findEffectiveRole(owner.id, project.id)
      expect(role).toBe('OWNER')
    })

    it('returns the member role (EDITOR) when a ProjectMember row exists', async () => {
      const owner = makeUser()
      const member = makeUser()
      const project = makeProject({ ownerId: owner.id })
      await createProjectMember({
        projectId: project.id,
        userId: member.id,
        role: 'EDITOR',
      })

      const role = await findEffectiveRole(member.id, project.id)
      expect(role).toBe('EDITOR')
    })

    it('returns the member role (VIEWER) when a ProjectMember row exists', async () => {
      const owner = makeUser()
      const member = makeUser()
      const project = makeProject({ ownerId: owner.id })
      await createProjectMember({
        projectId: project.id,
        userId: member.id,
        role: 'VIEWER',
      })

      const role = await findEffectiveRole(member.id, project.id)
      expect(role).toBe('VIEWER')
    })

    it('returns the member role (ADMIN) when a ProjectMember row exists', async () => {
      const owner = makeUser()
      const member = makeUser()
      const project = makeProject({ ownerId: owner.id })
      await createProjectMember({
        projectId: project.id,
        userId: member.id,
        role: 'ADMIN',
      })

      const role = await findEffectiveRole(member.id, project.id)
      expect(role).toBe('ADMIN')
    })

    it('returns null when there is no owner match and no membership row', async () => {
      const owner = makeUser()
      const stranger = makeUser()
      const project = makeProject({ ownerId: owner.id })

      const role = await findEffectiveRole(stranger.id, project.id)
      expect(role).toBeNull()
    })

    it('returns null when the project does not exist', async () => {
      const stranger = makeUser()
      const role = await findEffectiveRole(stranger.id, 'no-such-project')
      expect(role).toBeNull()
    })
  })
})
