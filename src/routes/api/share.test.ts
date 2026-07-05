// src/routes/api/share.test.ts
// Server-function tests for whiteboard read-only share links (GH #109):
// create/revoke/list (ADMIN+ gated) and the public unauthenticated diagram
// read. Mirrors src/routes/api/invites.test.ts's pattern — imports and
// calls the REAL exported handler functions from src/lib/share/handlers.ts
// directly, against the real (in-memory) test DB, including their ADMIN+
// gating logic running through the real findEffectiveRole/hasMinimumRole
// resolution against actually-seeded ProjectMember rows.
//
// v2 rework (A1/A2/A3): expiry is now REQUIRED (no never-expires branch),
// multiple links per whiteboard are allowed (no revoke-on-create), and
// listing/revocation are per-project/by-linkId rather than single-toggle.

import { beforeEach, describe, expect, it } from 'vitest'

import type { AuthContext } from '@/lib/auth/middleware'
import {
  createShareLinkHandler,
  getSharedWhiteboardHandler,
  listShareLinksHandler,
  revokeShareLinkHandler,
} from '@/lib/share/handlers'
import { generateInviteToken, hashInviteToken } from '@/lib/auth/invite-token'
import { createWhiteboardShareLink } from '@/data/whiteboard-share-link'
import { upsertProjectMember } from '@/data/permission'
import {
  makeProject,
  makeTable,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

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
    session: {
      id: 'test-session',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  }
}

const SEVEN_DAYS_HOURS = 24 * 7

// ─────────────────────────────────────────────────────────────────────────────
// Seeded fixtures
// ─────────────────────────────────────────────────────────────────────────────

let OWNER_ID = ''
let ADMIN_ID = ''
let EDITOR_ID = ''
let VIEWER_ID = ''
let PROJECT_ID = ''
let WHITEBOARD_ID = ''

beforeEach(async () => {
  resetDb()
  OWNER_ID = makeUser({ username: 'owner', email: 'owner@example.com' }).id
  ADMIN_ID = makeUser({ username: 'admin', email: 'admin@example.com' }).id
  EDITOR_ID = makeUser({ username: 'editor', email: 'editor@example.com' }).id
  VIEWER_ID = makeUser({ username: 'viewer', email: 'viewer@example.com' }).id
  PROJECT_ID = makeProject({ name: 'Test Project', ownerId: OWNER_ID }).id
  WHITEBOARD_ID = makeWhiteboard({
    projectId: PROJECT_ID,
    name: 'Test Whiteboard',
  }).id

  await upsertProjectMember({
    projectId: PROJECT_ID,
    userId: ADMIN_ID,
    role: 'ADMIN',
  })
  await upsertProjectMember({
    projectId: PROJECT_ID,
    userId: EDITOR_ID,
    role: 'EDITOR',
  })
  await upsertProjectMember({
    projectId: PROJECT_ID,
    userId: VIEWER_ID,
    role: 'VIEWER',
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN+ gating (create)
// ─────────────────────────────────────────────────────────────────────────────

describe('createShareLinkHandler ADMIN+ gating', () => {
  it('ADMIN can create a share link', async () => {
    const result = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    expect(result).toMatchObject({ success: true })
    expect((result as any).token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('OWNER can create a share link', async () => {
    const result = await createShareLinkHandler(ctxFor(OWNER_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    expect(result).toMatchObject({ success: true })
  })

  it('EDITOR is denied', async () => {
    const result = await createShareLinkHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    expect(result).toMatchObject({ error: 'FORBIDDEN', status: 403 })
  })

  it('VIEWER is denied', async () => {
    const result = await createShareLinkHandler(ctxFor(VIEWER_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    expect(result).toMatchObject({ error: 'FORBIDDEN', status: 403 })
  })

  it('a nonexistent whiteboard is denied (SEC-ERR-03 masking)', async () => {
    const result = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: '99999999-9999-9999-9999-999999999999',
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    expect(result).toMatchObject({ error: 'FORBIDDEN', status: 403 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A3: expiry is required
// ─────────────────────────────────────────────────────────────────────────────

describe('createShareLinkHandler A3: required expiry', () => {
  it('always populates expiresAt from the required expiresInHours', async () => {
    const before = Date.now()
    const result = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: 24,
    })

    expect(result).toMatchObject({ success: true })
    const expiresAt = (result as any).link.expiresAt as Date
    expect(expiresAt).toBeInstanceOf(Date)
    const expectedMin = before + 24 * 3_600_000
    const expectedMax = Date.now() + 24 * 3_600_000
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin)
    expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A2: per-project listing across multiple whiteboards
// ─────────────────────────────────────────────────────────────────────────────

describe('listShareLinksHandler ADMIN+ gating, per-project', () => {
  it('ADMIN sees links across every whiteboard in the project, most-recent first', async () => {
    const otherWhiteboardId = makeWhiteboard({
      projectId: PROJECT_ID,
      name: 'Second Whiteboard',
    }).id

    const first = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    const second = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: otherWhiteboardId,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    expect(first).toMatchObject({ success: true })
    expect(second).toMatchObject({ success: true })

    const result = await listShareLinksHandler(ctxFor(ADMIN_ID), PROJECT_ID)

    expect(result).toMatchObject({})
    const links = (result as any).links as Array<any>
    expect(links).toHaveLength(2)
    // Most-recent first.
    expect(links[0].whiteboardId).toBe(otherWhiteboardId)
    expect(links[0].whiteboardName).toBe('Second Whiteboard')
    expect(links[1].whiteboardId).toBe(WHITEBOARD_ID)
    expect(links[1].whiteboardName).toBe('Test Whiteboard')
  })

  it('multiple links on the same whiteboard are all listed (A2: no single-link replace)', async () => {
    await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    const result = await listShareLinksHandler(ctxFor(ADMIN_ID), PROJECT_ID)
    expect((result as any).links).toHaveLength(2)
  })

  it('never leaks the token or its hash', async () => {
    await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    const result = await listShareLinksHandler(ctxFor(ADMIN_ID), PROJECT_ID)
    const [link] = (result as any).links

    expect(link).not.toHaveProperty('token')
    expect(link).not.toHaveProperty('tokenHash')
  })

  it('EDITOR and VIEWER are denied', async () => {
    expect(
      await listShareLinksHandler(ctxFor(EDITOR_ID), PROJECT_ID),
    ).toMatchObject({ error: 'FORBIDDEN', status: 403 })
    expect(
      await listShareLinksHandler(ctxFor(VIEWER_ID), PROJECT_ID),
    ).toMatchObject({ error: 'FORBIDDEN', status: 403 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Revoke by linkId
// ─────────────────────────────────────────────────────────────────────────────

describe('revokeShareLinkHandler', () => {
  it('ADMIN can revoke a link by id', async () => {
    const created = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    const token = (created as any).token as string
    const linkId = (created as any).link.id as string

    const result = await revokeShareLinkHandler(ctxFor(ADMIN_ID), { linkId })

    expect(result).toMatchObject({ success: true })
    expect(await getSharedWhiteboardHandler(token)).toMatchObject({
      valid: false,
      reason: 'REVOKED',
    })
  })

  it('revoking one link does not affect a sibling link on the same whiteboard (A2)', async () => {
    const first = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    const second = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    const firstToken = (first as any).token as string
    const secondToken = (second as any).token as string
    const firstLinkId = (first as any).link.id as string

    await revokeShareLinkHandler(ctxFor(ADMIN_ID), { linkId: firstLinkId })

    expect(await getSharedWhiteboardHandler(firstToken)).toMatchObject({
      valid: false,
      reason: 'REVOKED',
    })
    expect(await getSharedWhiteboardHandler(secondToken)).toMatchObject({
      valid: true,
    })
  })

  it('is idempotent — revoking an unknown linkId is a no-op success', async () => {
    const result = await revokeShareLinkHandler(ctxFor(ADMIN_ID), {
      linkId: '99999999-9999-9999-9999-999999999999',
    })
    expect(result).toMatchObject({ success: true })
  })

  it('EDITOR is denied and the link remains active', async () => {
    const created = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    const token = (created as any).token as string
    const linkId = (created as any).link.id as string

    const result = await revokeShareLinkHandler(ctxFor(EDITOR_ID), { linkId })

    expect(result).toMatchObject({ error: 'FORBIDDEN', status: 403 })
    expect(await getSharedWhiteboardHandler(token)).toMatchObject({
      valid: true,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getSharedWhiteboardHandler (public, unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

describe('getSharedWhiteboardHandler', () => {
  it('requires no auth and returns the diagram for a valid token', async () => {
    makeTable({ whiteboardId: WHITEBOARD_ID, name: 'users' })
    const created = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    const token = (created as any).token as string

    const result = await getSharedWhiteboardHandler(token)

    expect(result).toMatchObject({
      valid: true,
      whiteboardId: WHITEBOARD_ID,
      whiteboardName: 'Test Whiteboard',
    })
    expect((result as any).tables).toHaveLength(1)
    expect((result as any).tables[0].name).toBe('users')
    expect((result as any).relationships).toEqual([])
  })

  it('never returns projectId, createdByUserId, or tokenHash', async () => {
    const created = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    const token = (created as any).token as string

    const result = await getSharedWhiteboardHandler(token)

    expect(result).not.toHaveProperty('projectId')
    expect(result).not.toHaveProperty('createdByUserId')
    expect(result).not.toHaveProperty('tokenHash')
  })

  it('INVALID: unknown token', async () => {
    expect(await getSharedWhiteboardHandler('not-a-real-token')).toEqual({
      valid: false,
      reason: 'INVALID',
    })
  })

  it('REVOKED: revoked link', async () => {
    const created = await createShareLinkHandler(ctxFor(ADMIN_ID), {
      whiteboardId: WHITEBOARD_ID,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    const token = (created as any).token as string
    const linkId = (created as any).link.id as string
    await revokeShareLinkHandler(ctxFor(ADMIN_ID), { linkId })

    expect(await getSharedWhiteboardHandler(token)).toEqual({
      valid: false,
      reason: 'REVOKED',
    })
  })

  it('EXPIRED: expired link', async () => {
    const rawToken = generateInviteToken()
    await createWhiteboardShareLink({
      whiteboardId: WHITEBOARD_ID,
      tokenHash: hashInviteToken(rawToken),
      createdByUserId: ADMIN_ID,
      expiresInHours: -1,
    })

    expect(await getSharedWhiteboardHandler(rawToken)).toEqual({
      valid: false,
      reason: 'EXPIRED',
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // R3 / IDOR guard
  // ───────────────────────────────────────────────────────────────────────

  describe('IDOR guard', () => {
    it('a token for whiteboard A never yields whiteboard B, and no sibling data leaks', async () => {
      const otherProjectId = makeProject({
        name: 'Other Project',
        ownerId: OWNER_ID,
      }).id
      const otherWhiteboardId = makeWhiteboard({
        projectId: otherProjectId,
        name: 'Other Whiteboard',
      }).id
      makeTable({ whiteboardId: WHITEBOARD_ID, name: 'whiteboard_a_table' })
      makeTable({
        whiteboardId: otherWhiteboardId,
        name: 'whiteboard_b_table',
      })

      const created = await createShareLinkHandler(ctxFor(ADMIN_ID), {
        whiteboardId: WHITEBOARD_ID,
        expiresInHours: SEVEN_DAYS_HOURS,
      })
      const token = (created as any).token as string

      const result = await getSharedWhiteboardHandler(token)

      expect(result).toMatchObject({
        valid: true,
        whiteboardId: WHITEBOARD_ID,
      })
      const tableNames = (result as any).tables.map((t: any) => t.name)
      expect(tableNames).toEqual(['whiteboard_a_table'])
      expect(tableNames).not.toContain('whiteboard_b_table')
    })
  })
})
