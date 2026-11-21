// src/data/project-email-invite.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  EMAIL_INVITE_TTL_MS,
  claimEmailInvite,
  classifyEmailInvite,
  createEmailInvite,
  deleteEmailInvitesExpiredBefore,
  findEmailInviteByTokenHash,
  findPendingEmailInvites,
  releaseEmailInvite,
  revokeEmailInvite,
} from './project-email-invite'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

let projectId: string
let adminId: string

beforeEach(() => {
  resetDb()
  adminId = makeUser().id
  projectId = makeProject({ ownerId: adminId }).id
})

const create = (tokenHash: string, email = 'a@example.com') =>
  createEmailInvite({
    projectId,
    email,
    role: 'EDITOR',
    tokenHash,
    invitedByUserId: adminId,
  })

describe('createEmailInvite', () => {
  it('stores a hashed, 7 day, pending row', () => {
    const row = create('h1')
    expect(row.tokenHash).toBe('h1')
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(
      EMAIL_INVITE_TTL_MS,
    )
    expect(classifyEmailInvite(row)).toBe('valid')
  })

  it('a re-invite of the same (project, email) voids the older pending row', () => {
    create('old')
    create('new')
    expect(classifyEmailInvite(findEmailInviteByTokenHash('old')!)).toBe(
      'revoked',
    )
    expect(classifyEmailInvite(findEmailInviteByTokenHash('new')!)).toBe(
      'valid',
    )
  })

  it('leaves invites of other emails alone', () => {
    create('a')
    create('b', 'b@example.com')
    expect(findPendingEmailInvites(projectId)).toHaveLength(2)
  })
})

describe('claim, revoke and expiry', () => {
  it('claim succeeds once', () => {
    const row = create('c')
    expect(claimEmailInvite(row.id)).toBe(true)
    expect(claimEmailInvite(row.id)).toBe(false)
    expect(classifyEmailInvite(findEmailInviteByTokenHash('c')!)).toBe('used')
  })

  it('release makes a claimed row claimable again', () => {
    const row = create('r')
    claimEmailInvite(row.id)
    releaseEmailInvite(row.id)
    expect(claimEmailInvite(row.id)).toBe(true)
  })

  it('claim refuses a revoked or expired row', () => {
    const a = create('rev')
    expect(revokeEmailInvite(projectId, a.id)).toBe(true)
    expect(revokeEmailInvite(projectId, a.id)).toBe(false)
    expect(claimEmailInvite(a.id)).toBe(false)
    const b = create('exp', 'b@example.com')
    db.prepare(
      'UPDATE "ProjectEmailInvite" SET "expiresAt" = 1 WHERE "id" = ?',
    ).run(b.id)
    expect(claimEmailInvite(b.id)).toBe(false)
    expect(classifyEmailInvite(findEmailInviteByTokenHash('exp')!)).toBe(
      'expired',
    )
  })

  it('revoke is scoped to the project', () => {
    const row = create('s')
    const other = makeProject({ ownerId: adminId }).id
    expect(revokeEmailInvite(other, row.id)).toBe(false)
  })

  it('pending list hides accepted, revoked and expired rows', () => {
    const a = create('p1', 'a@example.com')
    const b = create('p2', 'b@example.com')
    create('p3', 'c@example.com')
    claimEmailInvite(a.id)
    revokeEmailInvite(projectId, b.id)
    expect(findPendingEmailInvites(projectId).map((r) => r.email)).toEqual([
      'c@example.com',
    ])
  })

  it('the sweep deletes rows expired longer than the age', () => {
    const row = create('old')
    db.prepare(
      'UPDATE "ProjectEmailInvite" SET "expiresAt" = 1 WHERE "id" = ?',
    ).run(row.id)
    expect(deleteEmailInvitesExpiredBefore(1000)).toBe(1)
    expect(findEmailInviteByTokenHash('old')).toBeNull()
  })

  it('deleting the project cascades', () => {
    create('z')
    db.exec('PRAGMA foreign_keys = ON;')
    db.prepare('DELETE FROM "Project" WHERE "id" = ?').run(projectId)
    expect(findEmailInviteByTokenHash('z')).toBeNull()
  })
})
