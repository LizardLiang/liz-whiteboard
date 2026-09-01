// src/routes/api/canvas-share.test.ts
// Server-function tests for canvas-board read-only share links: create,
// revoke and list (all ADMIN+ gated) plus the public unauthenticated board
// read. Mirrors src/routes/api/share.test.ts — calls the REAL exported
// handlers directly against the real in-memory test DB, so the ADMIN+ gating
// runs through actual findEffectiveRole/hasMinimumRole resolution against
// actually-seeded ProjectMember rows rather than a mock.

import { beforeEach, describe, expect, it } from 'vitest'

import type { AuthContext } from '@/lib/auth/middleware'
import {
  createCanvasShareLinkHandler,
  getSharedCanvasBoardHandler,
  listCanvasShareLinksHandler,
  revokeCanvasShareLinkHandler,
} from '@/lib/share/canvas-handlers'
import { hashInviteToken } from '@/lib/auth/invite-token'
import { createCanvasBoardShareLink } from '@/data/canvas-board-share-link'
import { createCanvasBoard } from '@/data/canvas-board'
import { createCanvasElement } from '@/data/canvas-element'
import { upsertProjectMember } from '@/data/permission'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

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

async function setup() {
  const owner = makeUser()
  const project = makeProject({ ownerId: owner.id })
  const board = await createCanvasBoard({
    name: 'Shared Canvas',
    projectId: project.id,
  })
  return { owner, project, board }
}

beforeEach(() => resetDb())

describe('createCanvasShareLinkHandler', () => {
  it('lets an OWNER create a link and returns the raw token exactly once', async () => {
    const { owner, board } = await setup()

    const result = await createCanvasShareLinkHandler(ctxFor(owner.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    expect(result.success).toBe(true)
    if (result.success !== true) throw new Error('expected success')
    expect(result.token).toBeTruthy()
    expect(result.link.canvasBoardId).toBe(board.id)

    // The RAW token is never persisted — only its hash. This is the property
    // that makes a leaked database row useless as a share link.
    const rows = db
      .prepare('SELECT "tokenHash" FROM "CanvasBoardShareLink"')
      .all() as Array<{ tokenHash: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toBe(result.token)
    expect(rows[0].tokenHash).toBe(hashInviteToken(result.token))
  })

  it('refuses an EDITOR', async () => {
    const { project, board } = await setup()
    const editor = makeUser()
    await upsertProjectMember({
      projectId: project.id,
      userId: editor.id,
      role: 'EDITOR',
    })

    const result = await createCanvasShareLinkHandler(ctxFor(editor.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    expect('error' in result && result.error).toBe('FORBIDDEN')
  })

  it('refuses a non-member', async () => {
    const { board } = await setup()
    const stranger = makeUser()

    const result = await createCanvasShareLinkHandler(ctxFor(stranger.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    expect('error' in result && result.error).toBe('FORBIDDEN')
  })

  it('answers a nonexistent board identically to an unauthorised one', async () => {
    // SEC-ERR-03: a distinguishable "no such board" would turn this endpoint
    // into an existence oracle for board ids.
    const { owner } = await setup()
    const result = await createCanvasShareLinkHandler(ctxFor(owner.id), {
      canvasBoardId: '11111111-1111-4111-8111-111111111111',
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    expect('error' in result && result.error).toBe('FORBIDDEN')
  })
})

describe('revokeCanvasShareLinkHandler', () => {
  it('lets an ADMIN revoke, after which the public read fails as REVOKED', async () => {
    const { owner, project, board } = await setup()
    const admin = makeUser()
    await upsertProjectMember({
      projectId: project.id,
      userId: admin.id,
      role: 'ADMIN',
    })

    const created = await createCanvasShareLinkHandler(ctxFor(owner.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    if (created.success !== true) throw new Error('expected success')

    await revokeCanvasShareLinkHandler(ctxFor(admin.id), {
      linkId: created.link.id,
    })

    const read = await getSharedCanvasBoardHandler(created.token)
    expect(read.valid).toBe(false)
    expect(!read.valid && read.reason).toBe('REVOKED')
  })

  it('refuses a VIEWER', async () => {
    const { owner, project, board } = await setup()
    const viewer = makeUser()
    await upsertProjectMember({
      projectId: project.id,
      userId: viewer.id,
      role: 'VIEWER',
    })

    const created = await createCanvasShareLinkHandler(ctxFor(owner.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    if (created.success !== true) throw new Error('expected success')

    const result = await revokeCanvasShareLinkHandler(ctxFor(viewer.id), {
      linkId: created.link.id,
    })
    expect('error' in result && result.error).toBe('FORBIDDEN')

    // And the link still works — a refused revoke must not half-apply.
    const read = await getSharedCanvasBoardHandler(created.token)
    expect(read.valid).toBe(true)
  })

  it('is a no-op success for an unknown link id', async () => {
    const { owner } = await setup()
    const result = await revokeCanvasShareLinkHandler(ctxFor(owner.id), {
      linkId: '11111111-1111-4111-8111-111111111111',
    })
    expect(result.success).toBe(true)
  })
})

describe('listCanvasShareLinksHandler', () => {
  it('lists a board’s links without ever exposing the token hash', async () => {
    const { owner, board } = await setup()
    await createCanvasShareLinkHandler(ctxFor(owner.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })

    const result = await listCanvasShareLinksHandler(ctxFor(owner.id), board.id)
    if ('error' in result) throw new Error('expected links')

    expect(result.links).toHaveLength(1)
    expect(result.links[0]).not.toHaveProperty('tokenHash')
    expect(result.links[0]).not.toHaveProperty('createdByUserId')
    expect(result.links[0].canvasBoardName).toBe('Shared Canvas')
  })

  it('refuses an EDITOR', async () => {
    const { project, board } = await setup()
    const editor = makeUser()
    await upsertProjectMember({
      projectId: project.id,
      userId: editor.id,
      role: 'EDITOR',
    })

    const result = await listCanvasShareLinksHandler(
      ctxFor(editor.id),
      board.id,
    )
    expect('error' in result && result.error).toBe('FORBIDDEN')
  })
})

describe('getSharedCanvasBoardHandler', () => {
  it('returns the board and its elements with no account at all', async () => {
    const { owner, board } = await setup()
    await createCanvasElement({
      boardId: board.id,
      kind: 'rectangle',
      positionX: 10,
      positionY: 20,
      width: 100,
      height: 50,
      props: { kind: 'rectangle' },
    })
    const created = await createCanvasShareLinkHandler(ctxFor(owner.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    if (created.success !== true) throw new Error('expected success')

    const read = await getSharedCanvasBoardHandler(created.token)
    expect(read.valid).toBe(true)
    if (!read.valid) throw new Error('expected valid')
    expect(read.canvasBoardName).toBe('Shared Canvas')
    expect(read.elements).toHaveLength(1)
    expect(read.elements[0].positionX).toBe(10)
  })

  it('never leaks the project, folder or creator', async () => {
    const { owner, board } = await setup()
    const created = await createCanvasShareLinkHandler(ctxFor(owner.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    if (created.success !== true) throw new Error('expected success')

    const read = await getSharedCanvasBoardHandler(created.token)
    expect(read).not.toHaveProperty('projectId')
    expect(read).not.toHaveProperty('folderId')
    expect(read).not.toHaveProperty('createdByUserId')
    expect(read).not.toHaveProperty('tokenHash')
  })

  it('cannot be used to read a DIFFERENT board (IDOR)', async () => {
    // The board id comes from the token row exclusively; there is no
    // client-supplied id for a caller to substitute. This test pins that the
    // signature offers no such parameter and the answer follows the token.
    const { owner, project, board } = await setup()
    const other = await createCanvasBoard({
      name: 'Someone Else',
      projectId: project.id,
    })
    await createCanvasElement({
      boardId: other.id,
      kind: 'rectangle',
      positionX: 999,
      positionY: 999,
      width: 10,
      height: 10,
      props: { kind: 'rectangle' },
    })

    const created = await createCanvasShareLinkHandler(ctxFor(owner.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    if (created.success !== true) throw new Error('expected success')

    const read = await getSharedCanvasBoardHandler(created.token)
    if (!read.valid) throw new Error('expected valid')
    expect(read.canvasBoardId).toBe(board.id)
    expect(read.canvasBoardName).toBe('Shared Canvas')
    expect(read.elements).toHaveLength(0)
  })

  it('reports INVALID for an unknown token', async () => {
    const read = await getSharedCanvasBoardHandler('not-a-real-token')
    expect(read.valid).toBe(false)
    expect(!read.valid && read.reason).toBe('INVALID')
  })

  it('reports EXPIRED rather than INVALID for a lapsed link', async () => {
    const { owner, board } = await setup()
    const token = 'expired-token-value'
    await createCanvasBoardShareLink({
      canvasBoardId: board.id,
      tokenHash: hashInviteToken(token),
      createdByUserId: owner.id,
      expiresInHours: 1,
    })
    db.prepare(
      'UPDATE "CanvasBoardShareLink" SET "expiresAt" = ? WHERE "tokenHash" = ?',
    ).run(Date.now() - 1_000, hashInviteToken(token))

    const read = await getSharedCanvasBoardHandler(token)
    expect(read.valid).toBe(false)
    expect(!read.valid && read.reason).toBe('EXPIRED')
  })

  it('reports INVALID once the board itself is gone', async () => {
    const { owner, board } = await setup()
    const created = await createCanvasShareLinkHandler(ctxFor(owner.id), {
      canvasBoardId: board.id,
      expiresInHours: SEVEN_DAYS_HOURS,
    })
    if (created.success !== true) throw new Error('expected success')

    db.prepare('DELETE FROM "CanvasBoard" WHERE "id" = ?').run(board.id)

    const read = await getSharedCanvasBoardHandler(created.token)
    expect(read.valid).toBe(false)
  })
})
