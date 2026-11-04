// @vitest-environment node
// src/routes/api/admin-role-policy.test.ts
// M5: granting/inviting ADMIN and changing/removing an ADMIN needs OWNER, and
// a creator who is removed or demoted below ADMIN loses their outstanding
// share links and invites. Everything here is the REAL code against the test
// DB (the policy helper, the data-layer role writers, and the invite handler).

import { beforeEach, describe, expect, it } from 'vitest'

import type { AuthContext } from '@/lib/auth/middleware'
import { checkAdminRoleChange } from '@/lib/auth/admin-role-guard'
import {
  findEffectiveRole,
  removeProjectMember,
  setProjectMemberRole,
  upsertProjectMember,
} from '@/data/permission'
import { createProjectInvite } from '@/data/project-invite'
import { createWhiteboardShareLink } from '@/data/whiteboard-share-link'
import { createCanvasBoardShareLink } from '@/data/canvas-board-share-link'
import { createProjectInviteHandler } from '@/lib/invite/handlers'
import { db } from '@/db'
import {
  makeCanvasBoard,
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

function ctxFor(userId: string): AuthContext {
  return {
    user: { id: userId, username: 'u', email: `${userId}@example.com` },
    session: { id: 's', expiresAt: new Date(Date.now() + 3_600_000) },
  }
}

describe('checkAdminRoleChange', () => {
  it('lets OWNER do anything', () => {
    expect(
      checkAdminRoleChange('OWNER', { newRole: 'ADMIN', targetRole: 'ADMIN' }),
    ).toBeNull()
    expect(
      checkAdminRoleChange('OWNER', { newRole: null, targetRole: 'ADMIN' }),
    ).toBeNull()
  })

  it('denies ADMIN granting ADMIN', () => {
    expect(
      checkAdminRoleChange('ADMIN', { newRole: 'ADMIN', targetRole: null }),
    ).toMatchObject({ error: 'FORBIDDEN', status: 403 })
    expect(
      checkAdminRoleChange('ADMIN', { newRole: 'ADMIN', targetRole: 'EDITOR' }),
    ).not.toBeNull()
  })

  it('denies ADMIN demoting or removing another ADMIN', () => {
    expect(
      checkAdminRoleChange('ADMIN', { newRole: 'VIEWER', targetRole: 'ADMIN' }),
    ).not.toBeNull()
    expect(
      checkAdminRoleChange('ADMIN', { newRole: null, targetRole: 'ADMIN' }),
    ).not.toBeNull()
  })

  it('lets ADMIN manage EDITOR and VIEWER members', () => {
    expect(
      checkAdminRoleChange('ADMIN', {
        newRole: 'EDITOR',
        targetRole: 'VIEWER',
      }),
    ).toBeNull()
    expect(
      checkAdminRoleChange('ADMIN', { newRole: null, targetRole: 'EDITOR' }),
    ).toBeNull()
  })
})

describe('createProjectInviteHandler ADMIN policy', () => {
  let ownerId = ''
  let adminId = ''
  let projectId = ''

  beforeEach(async () => {
    resetDb()
    ownerId = makeUser().id
    adminId = makeUser().id
    projectId = makeProject({ ownerId }).id
    await upsertProjectMember({ projectId, userId: adminId, role: 'ADMIN' })
  })

  it('ADMIN cannot create an ADMIN invite', async () => {
    const res = await createProjectInviteHandler(ctxFor(adminId), {
      projectId,
      role: 'ADMIN',
      expiresInHours: 24,
    })
    expect(res).toMatchObject({ error: 'FORBIDDEN', status: 403 })
    expect(
      (
        db.prepare('SELECT COUNT(*) AS n FROM "ProjectInvite"').get() as {
          n: number
        }
      ).n,
    ).toBe(0)
  })

  it('ADMIN can still create an EDITOR invite', async () => {
    const res = await createProjectInviteHandler(ctxFor(adminId), {
      projectId,
      role: 'EDITOR',
      expiresInHours: 24,
    })
    expect(res).toMatchObject({ success: true })
  })

  it('OWNER can create an ADMIN invite', async () => {
    const res = await createProjectInviteHandler(ctxFor(ownerId), {
      projectId,
      role: 'ADMIN',
      expiresInHours: 24,
    })
    expect(res).toMatchObject({ success: true })
  })
})

describe('creator links are revoked when the creator loses ADMIN', () => {
  let ownerId = ''
  let creatorId = ''
  let otherAdminId = ''
  let projectId = ''
  let whiteboardId = ''
  let boardId = ''

  async function seedLinks(userId: string) {
    await createWhiteboardShareLink({
      whiteboardId,
      tokenHash: `wb-${userId}`,
      createdByUserId: userId,
      expiresInHours: 24,
    })
    await createCanvasBoardShareLink({
      canvasBoardId: boardId,
      tokenHash: `cb-${userId}`,
      createdByUserId: userId,
      expiresInHours: 24,
    })
    await createProjectInvite({
      projectId,
      role: 'EDITOR',
      tokenHash: `inv-${userId}`,
      createdByUserId: userId,
      expiresInHours: 24,
    })
  }

  function activeLinkCount(userId: string): number {
    const n = (sql: string) => (db.prepare(sql).get(userId) as { n: number }).n
    return (
      n(
        'SELECT COUNT(*) AS n FROM "WhiteboardShareLink" WHERE "createdByUserId" = ? AND "revokedAt" IS NULL',
      ) +
      n(
        'SELECT COUNT(*) AS n FROM "CanvasBoardShareLink" WHERE "createdByUserId" = ? AND "revokedAt" IS NULL',
      ) +
      n(
        'SELECT COUNT(*) AS n FROM "ProjectInvite" WHERE "createdByUserId" = ? AND "revokedAt" IS NULL',
      )
    )
  }

  beforeEach(async () => {
    resetDb()
    ownerId = makeUser().id
    creatorId = makeUser().id
    otherAdminId = makeUser().id
    projectId = makeProject({ ownerId }).id
    whiteboardId = makeWhiteboard({ projectId }).id
    boardId = makeCanvasBoard({ projectId }).id
    await upsertProjectMember({ projectId, userId: creatorId, role: 'ADMIN' })
    await upsertProjectMember({
      projectId,
      userId: otherAdminId,
      role: 'ADMIN',
    })
    await seedLinks(creatorId)
    await seedLinks(otherAdminId)
  })

  it('removing the creator revokes only their links', async () => {
    expect(activeLinkCount(creatorId)).toBe(3)
    await removeProjectMember(projectId, creatorId)
    expect(activeLinkCount(creatorId)).toBe(0)
    expect(activeLinkCount(otherAdminId)).toBe(3)
    expect(await findEffectiveRole(creatorId, projectId)).toBeNull()
  })

  it('demoting the creator below ADMIN revokes their links', async () => {
    await setProjectMemberRole({ projectId, userId: creatorId, role: 'EDITOR' })
    expect(activeLinkCount(creatorId)).toBe(0)
    expect(activeLinkCount(otherAdminId)).toBe(3)
  })

  it('keeping the creator at ADMIN leaves their links alone', async () => {
    await setProjectMemberRole({ projectId, userId: creatorId, role: 'ADMIN' })
    expect(activeLinkCount(creatorId)).toBe(3)
  })

  it('does not touch links the user created in another project', async () => {
    const otherProject = makeProject({ ownerId }).id
    await upsertProjectMember({
      projectId: otherProject,
      userId: creatorId,
      role: 'ADMIN',
    })
    await createProjectInvite({
      projectId: otherProject,
      role: 'VIEWER',
      tokenHash: 'inv-elsewhere',
      createdByUserId: creatorId,
      expiresInHours: 24,
    })
    await removeProjectMember(projectId, creatorId)
    const row = db
      .prepare('SELECT "revokedAt" FROM "ProjectInvite" WHERE "tokenHash" = ?')
      .get('inv-elsewhere') as { revokedAt: number | null }
    expect(row.revokedAt).toBeNull()
  })
})
