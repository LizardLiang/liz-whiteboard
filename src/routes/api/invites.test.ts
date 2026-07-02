// src/routes/api/invites.test.ts
// Server-function tests for invite-by-URL (create/list/revoke/redeem/
// preview). Unlike the older mirror-copy pattern (see git history / Hermes
// review W6), these tests import and call the REAL exported handler
// functions from src/lib/invite/handlers.ts directly, against the real
// (in-memory) test DB — including their ADMIN+ gating logic, which now runs
// through the real findEffectiveRole/hasMinimumRole resolution against
// actually-seeded ProjectMember rows rather than a mocked role resolver.
//
// The handlers live in src/lib/invite/handlers.ts, not src/routes/api/
// invites.ts itself — that split keeps invites.ts's client-imported
// createServerFn consts free of any data-layer import, which is required
// for `vite build` to succeed (see that file's module comment).

import { beforeEach, describe, expect, it } from 'vitest'

import type { AuthContext } from '@/lib/auth/middleware'
import { db } from '@/db'
import {
  createProjectInviteHandler,
  getInvitePreviewHandler,
  listProjectInvitesHandler,
  redeemInviteHandler,
  revokeInviteHandler,
} from '@/lib/invite/handlers'
import { generateInviteToken, hashInviteToken } from '@/lib/auth/invite-token'
import {
  createProjectInvite,
  findProjectInvites,
} from '@/data/project-invite'
import { upsertProjectMember } from '@/data/permission'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function ctxFor(userId: string): AuthContext {
  return {
    user: {
      id: userId,
      username: `user-${userId.slice(0, 6)}`,
      email: `${userId}@example.com`,
    },
    session: { id: 'test-session', expiresAt: new Date(Date.now() + 3_600_000) },
  }
}

async function memberRole(
  projectId: string,
  userId: string,
): Promise<string | undefined> {
  const row = db
    .prepare(
      'SELECT "role" FROM "ProjectMember" WHERE "projectId" = ? AND "userId" = ?',
    )
    .get(projectId, userId) as { role: string } | undefined
  return row?.role
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeded fixtures
// ─────────────────────────────────────────────────────────────────────────────

let OWNER_ID = ''
let ADMIN_ID = ''
let EDITOR_ID = ''
let VIEWER_ID = ''
let TARGET_ID = ''
let PROJECT_ID = ''

beforeEach(async () => {
  resetDb()
  OWNER_ID = makeUser({ username: 'owner', email: 'owner@example.com' }).id
  ADMIN_ID = makeUser({ username: 'admin', email: 'admin@example.com' }).id
  EDITOR_ID = makeUser({ username: 'editor', email: 'editor@example.com' }).id
  VIEWER_ID = makeUser({ username: 'viewer', email: 'viewer@example.com' }).id
  TARGET_ID = makeUser({ username: 'target', email: 'target@example.com' }).id
  PROJECT_ID = makeProject({ name: 'Test Project', ownerId: OWNER_ID }).id

  // Real ProjectMember rows (not a mocked role resolver) — findEffectiveRole
  // resolves these for real in every test below.
  await upsertProjectMember({ projectId: PROJECT_ID, userId: ADMIN_ID, role: 'ADMIN' })
  await upsertProjectMember({ projectId: PROJECT_ID, userId: EDITOR_ID, role: 'EDITOR' })
  await upsertProjectMember({ projectId: PROJECT_ID, userId: VIEWER_ID, role: 'VIEWER' })
})

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN+ gating (createProjectInvite / listProjectInvites / revokeInvite)
// ─────────────────────────────────────────────────────────────────────────────

describe('createProjectInviteHandler ADMIN+ gating', () => {
  it('ADMIN can create an invite link', async () => {
    const result = await createProjectInviteHandler(ctxFor(ADMIN_ID), {
      projectId: PROJECT_ID,
      role: 'EDITOR',
      expiresInHours: 24,
    })

    expect(result).toMatchObject({ success: true })
    expect((result as any).token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('OWNER can create an invite link', async () => {
    const result = await createProjectInviteHandler(ctxFor(OWNER_ID), {
      projectId: PROJECT_ID,
      role: 'ADMIN',
      expiresInHours: 24,
    })

    expect(result).toMatchObject({ success: true })
  })

  it('EDITOR is denied', async () => {
    const result = await createProjectInviteHandler(ctxFor(EDITOR_ID), {
      projectId: PROJECT_ID,
      role: 'VIEWER',
      expiresInHours: 24,
    })

    expect(result).toMatchObject({ error: 'FORBIDDEN', status: 403 })
  })

  it('VIEWER is denied', async () => {
    const result = await createProjectInviteHandler(ctxFor(VIEWER_ID), {
      projectId: PROJECT_ID,
      role: 'VIEWER',
      expiresInHours: 24,
    })

    expect(result).toMatchObject({ error: 'FORBIDDEN', status: 403 })
  })

  it('a user with no membership at all is denied', async () => {
    const result = await createProjectInviteHandler(ctxFor(TARGET_ID), {
      projectId: PROJECT_ID,
      role: 'VIEWER',
      expiresInHours: 24,
    })

    expect(result).toMatchObject({ error: 'FORBIDDEN', status: 403 })
  })
})

describe('listProjectInvitesHandler ADMIN+ gating', () => {
  it('ADMIN can list invites, including the batched creator username', async () => {
    await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: 'x'.repeat(64),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })

    const result = await listProjectInvitesHandler(
      ctxFor(ADMIN_ID),
      PROJECT_ID,
    )

    expect('invites' in result && result.invites).toHaveLength(1)
    expect((result as any).invites[0].createdByUsername).toBe('admin')
    expect((result as any).invites[0].tokenHash).toBeUndefined()
  })

  it('EDITOR and VIEWER are denied', async () => {
    expect(
      await listProjectInvitesHandler(ctxFor(EDITOR_ID), PROJECT_ID),
    ).toMatchObject({ error: 'FORBIDDEN', status: 403 })
    expect(
      await listProjectInvitesHandler(ctxFor(VIEWER_ID), PROJECT_ID),
    ).toMatchObject({ error: 'FORBIDDEN', status: 403 })
  })
})

describe('revokeInviteHandler ADMIN+ gating', () => {
  it('ADMIN can revoke an invite', async () => {
    const invite = await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: 'y'.repeat(64),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })

    const result = await revokeInviteHandler(ctxFor(ADMIN_ID), {
      projectId: PROJECT_ID,
      inviteId: invite.id,
    })

    expect(result).toMatchObject({ success: true })
    const [row] = await findProjectInvites(PROJECT_ID)
    expect(row.revokedAt).not.toBeNull()
  })

  it('EDITOR is denied and the invite remains un-revoked', async () => {
    const invite = await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: 'z'.repeat(64),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })

    const result = await revokeInviteHandler(ctxFor(EDITOR_ID), {
      projectId: PROJECT_ID,
      inviteId: invite.id,
    })

    expect(result).toMatchObject({ error: 'FORBIDDEN', status: 403 })
    const [row] = await findProjectInvites(PROJECT_ID)
    expect(row.revokedAt).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// redeemInviteHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('redeemInviteHandler', () => {
  it('INVALID: unknown token', async () => {
    const result = await redeemInviteHandler(ctxFor(TARGET_ID), {
      token: 'not-a-real-token',
    })
    expect(result).toEqual({
      success: false,
      error: 'INVALID',
      message: expect.any(String),
    })
  })

  it('REVOKED: revoked link', async () => {
    const rawToken = generateInviteToken()
    const invite = await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })
    await revokeInviteHandler(ctxFor(ADMIN_ID), {
      projectId: PROJECT_ID,
      inviteId: invite.id,
    })

    const result = await redeemInviteHandler(ctxFor(TARGET_ID), {
      token: rawToken,
    })

    expect(result).toMatchObject({ success: false, error: 'REVOKED' })
    expect(await memberRole(PROJECT_ID, TARGET_ID)).toBeUndefined()
  })

  it('EXPIRED: expired link', async () => {
    const rawToken = generateInviteToken()
    await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: -1,
    })

    const result = await redeemInviteHandler(ctxFor(TARGET_ID), {
      token: rawToken,
    })

    expect(result).toMatchObject({ success: false, error: 'EXPIRED' })
    expect(await memberRole(PROJECT_ID, TARGET_ID)).toBeUndefined()
  })

  it('EXHAUSTED: usedCount has reached maxUses', async () => {
    const rawToken = generateInviteToken()
    const invite = await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })
    db.prepare('UPDATE "ProjectInvite" SET "maxUses" = 1 WHERE "id" = ?').run(
      invite.id,
    )
    // Consume the single use directly (not via redemption, to isolate the
    // EXHAUSTED check from the write path).
    db.prepare(
      'UPDATE "ProjectInvite" SET "usedCount" = "usedCount" + 1 WHERE "id" = ?',
    ).run(invite.id)

    const result = await redeemInviteHandler(ctxFor(TARGET_ID), {
      token: rawToken,
    })

    expect(result).toMatchObject({ success: false, error: 'EXHAUSTED' })
    expect(await memberRole(PROJECT_ID, TARGET_ID)).toBeUndefined()
  })

  it('success: fresh user redemption creates a new ProjectMember', async () => {
    const rawToken = generateInviteToken()
    await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'EDITOR',
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })

    const result = await redeemInviteHandler(ctxFor(TARGET_ID), {
      token: rawToken,
    })

    expect(result).toEqual({
      success: true,
      projectId: PROJECT_ID,
      role: 'EDITOR',
    })
    expect(await memberRole(PROJECT_ID, TARGET_ID)).toBe('EDITOR')
    const [row] = await findProjectInvites(PROJECT_ID)
    expect(row.usedCount).toBe(1)
  })

  it('idempotent no-downgrade: existing EDITOR redeeming a VIEWER-role invite keeps EDITOR', async () => {
    const rawToken = generateInviteToken()
    await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })

    const result = await redeemInviteHandler(ctxFor(EDITOR_ID), {
      token: rawToken,
    })

    expect(result).toEqual({
      success: true,
      projectId: PROJECT_ID,
      role: 'EDITOR',
    })
    expect(await memberRole(PROJECT_ID, EDITOR_ID)).toBe('EDITOR')
    // Still consumes a "use" even though the write was skipped.
    const [row] = await findProjectInvites(PROJECT_ID)
    expect(row.usedCount).toBe(1)
  })

  it('upgrade: existing VIEWER redeeming an EDITOR-role invite is upgraded', async () => {
    const rawToken = generateInviteToken()
    await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'EDITOR',
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })

    const result = await redeemInviteHandler(ctxFor(VIEWER_ID), {
      token: rawToken,
    })

    expect(result).toEqual({
      success: true,
      projectId: PROJECT_ID,
      role: 'EDITOR',
    })
    expect(await memberRole(PROJECT_ID, VIEWER_ID)).toBe('EDITOR')
  })

  it('never downgrades the OWNER redeeming any role invite', async () => {
    const rawToken = generateInviteToken()
    await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })

    const result = await redeemInviteHandler(ctxFor(OWNER_ID), {
      token: rawToken,
    })

    expect(result).toEqual({
      success: true,
      projectId: PROJECT_ID,
      role: 'OWNER',
    })
    // Owner is never written as a ProjectMember row.
    expect(await memberRole(PROJECT_ID, OWNER_ID)).toBeUndefined()
  })

  // ───────────────────────────────────────────────────────────────────────
  // B1 regression (Hermes review, BLOCKER): transaction() only rolls back
  // on a SYNCHRONOUS throw from its callback. The pre-fix code called
  // `void upsertProjectMember(...)` / `void incrementInviteUsedCount(...)`
  // — both async functions — inside that synchronous callback. A throw
  // inside an async function becomes a REJECTED PROMISE, not a synchronous
  // throw; `void`-calling it (no await, no .catch) silently drops that
  // rejection, so COMMIT would still run and the handler would resolve
  // `{ success: true }` even though the membership write never actually
  // took effect (while an unrelated, independently-successful write — the
  // usedCount increment — WOULD have persisted, corrupting invite state:
  // "used" but nobody actually got access).
  // ───────────────────────────────────────────────────────────────────────

  describe('B1 regression: transaction atomicity on a failed write', () => {
    it('fails the whole redemption (no usedCount increment, no ProjectMember row) when the write violates a DB constraint', async () => {
      const rawToken = generateInviteToken()
      const invite = await createProjectInvite({
        projectId: PROJECT_ID,
        role: 'EDITOR',
        tokenHash: hashInviteToken(rawToken),
        createdByUserId: ADMIN_ID,
        expiresInHours: 24,
      })

      // Phantom user: a syntactically valid id that was never inserted into
      // "User". redeemInviteHandler is called directly (bypassing
      // requireAuth's real session-cookie validation, same as every other
      // test in this file), so nothing stops us from presenting a ctx for a
      // user id that doesn't exist — this simulates the DB-integrity
      // failure class B1 was about: the write itself fails mid-transaction
      // (here: the ProjectMember.userId foreign key), independent of
      // whether the caller was "authorized" to attempt it.
      const phantomUserId = '99999999-9999-9999-9999-999999999999'

      await expect(
        redeemInviteHandler(ctxFor(phantomUserId), { token: rawToken }),
      ).rejects.toThrow()

      // Rolled back atomically: neither write took effect. If this were
      // still the pre-fix void-async code, this handler would have
      // resolved `{ success: true }` (not thrown), usedCount would be 1,
      // and there would still be no ProjectMember row — a silently
      // corrupted invite.
      const [row] = await findProjectInvites(PROJECT_ID)
      expect(row.id).toBe(invite.id)
      expect(row.usedCount).toBe(0)
      expect(await memberRole(PROJECT_ID, phantomUserId)).toBeUndefined()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getInvitePreviewHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('getInvitePreviewHandler', () => {
  it('requires no auth and returns project name + role for a valid invite', async () => {
    const rawToken = generateInviteToken()
    await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'EDITOR',
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })

    const result = await getInvitePreviewHandler(rawToken)

    expect(result).toEqual({
      valid: true,
      projectName: 'Test Project',
      role: 'EDITOR',
    })
  })

  it('never returns projectId, createdByUserId, or tokenHash', async () => {
    const rawToken = generateInviteToken()
    await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'EDITOR',
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })

    const result = await getInvitePreviewHandler(rawToken)

    expect(result).not.toHaveProperty('projectId')
    expect(result).not.toHaveProperty('createdByUserId')
    expect(result).not.toHaveProperty('tokenHash')
  })

  it('returns valid:false with reason for INVALID/REVOKED/EXPIRED/EXHAUSTED', async () => {
    expect(await getInvitePreviewHandler('garbage-token')).toEqual({
      valid: false,
      reason: 'INVALID',
    })

    const revokedToken = generateInviteToken()
    const revokedInvite = await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: hashInviteToken(revokedToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })
    await revokeInviteHandler(ctxFor(ADMIN_ID), {
      projectId: PROJECT_ID,
      inviteId: revokedInvite.id,
    })
    expect(await getInvitePreviewHandler(revokedToken)).toEqual({
      valid: false,
      reason: 'REVOKED',
    })

    const expiredToken = generateInviteToken()
    await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: hashInviteToken(expiredToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: -1,
    })
    expect(await getInvitePreviewHandler(expiredToken)).toEqual({
      valid: false,
      reason: 'EXPIRED',
    })

    const exhaustedToken = generateInviteToken()
    const exhaustedInvite = await createProjectInvite({
      projectId: PROJECT_ID,
      role: 'VIEWER',
      tokenHash: hashInviteToken(exhaustedToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: 24,
    })
    db.prepare('UPDATE "ProjectInvite" SET "maxUses" = 1 WHERE "id" = ?').run(
      exhaustedInvite.id,
    )
    db.prepare(
      'UPDATE "ProjectInvite" SET "usedCount" = "usedCount" + 1 WHERE "id" = ?',
    ).run(exhaustedInvite.id)
    expect(await getInvitePreviewHandler(exhaustedToken)).toEqual({
      valid: false,
      reason: 'EXHAUSTED',
    })
  })
})
