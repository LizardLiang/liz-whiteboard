// src/data/canvas-board-share-link.test.ts
// Integration tests for the canvas share-link data layer against a real
// in-memory SQLite database. Mirrors the whiteboard share-link tests' shape.
//
// The security-relevant properties are the ones worth naming: a raw token is
// never stored, the token hash is unique, an expired or revoked link is still
// RETURNED by the finder (so the handler can distinguish the reason), and
// deleting a board takes its links with it.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createCanvasBoardShareLink,
  findCanvasShareLinkById,
  findCanvasShareLinkByTokenHash,
  findCanvasShareLinksByBoardId,
  revokeCanvasBoardShareLinkById,
} from './canvas-board-share-link'
import { createCanvasBoard, deleteCanvasBoard } from './canvas-board'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

async function makeBoard(projectId: string): Promise<string> {
  const board = await createCanvasBoard({ name: 'Canvas', projectId })
  return board.id
}

beforeEach(() => resetDb())

describe('createCanvasBoardShareLink', () => {
  it('stores the hash and populates expiresAt from expiresInHours', async () => {
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const boardId = await makeBoard(project.id)

    const before = Date.now()
    const link = await createCanvasBoardShareLink({
      canvasBoardId: boardId,
      tokenHash: 'hash-1',
      createdByUserId: user.id,
      expiresInHours: 24,
    })

    expect(link.canvasBoardId).toBe(boardId)
    expect(link.tokenHash).toBe('hash-1')
    expect(link.revokedAt).toBeNull()
    expect(link.expiresAt).not.toBeNull()
    // 24h out, within a generous window so a slow machine cannot flake it.
    const delta = link.expiresAt!.getTime() - before
    expect(delta).toBeGreaterThan(23 * 3_600_000)
    expect(delta).toBeLessThan(25 * 3_600_000)
  })

  it('refuses a link on a board that does not exist', async () => {
    const user = makeUser()
    await expect(
      createCanvasBoardShareLink({
        canvasBoardId: '11111111-1111-4111-8111-111111111111',
        tokenHash: 'orphan',
        createdByUserId: user.id,
        expiresInHours: 1,
      }),
    ).rejects.toThrow()
  })

  it('rejects a duplicate token hash', async () => {
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const boardId = await makeBoard(project.id)
    const args = {
      canvasBoardId: boardId,
      tokenHash: 'same',
      createdByUserId: user.id,
      expiresInHours: 1,
    }
    await createCanvasBoardShareLink(args)
    // The unique index is what stops two boards ever sharing a token.
    await expect(createCanvasBoardShareLink(args)).rejects.toThrow()
  })

  it('allows several independently-revocable links on one board', async () => {
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const boardId = await makeBoard(project.id)

    const a = await createCanvasBoardShareLink({
      canvasBoardId: boardId,
      tokenHash: 'a',
      createdByUserId: user.id,
      expiresInHours: 1,
    })
    await createCanvasBoardShareLink({
      canvasBoardId: boardId,
      tokenHash: 'b',
      createdByUserId: user.id,
      expiresInHours: 1,
    })

    await revokeCanvasBoardShareLinkById(a.id)

    const links = await findCanvasShareLinksByBoardId(boardId)
    expect(links).toHaveLength(2)
    expect(links.find((l) => l.tokenHash === 'a')?.revokedAt).not.toBeNull()
    expect(links.find((l) => l.tokenHash === 'b')?.revokedAt).toBeNull()
  })

  it('sweeps other already-expired links but keeps the row just written', async () => {
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const boardId = await makeBoard(project.id)

    const stale = await createCanvasBoardShareLink({
      canvasBoardId: boardId,
      tokenHash: 'stale',
      createdByUserId: user.id,
      expiresInHours: 1,
    })
    db.prepare(
      'UPDATE "CanvasBoardShareLink" SET "expiresAt" = ? WHERE "id" = ?',
    ).run(Date.now() - 10_000, stale.id)

    const fresh = await createCanvasBoardShareLink({
      canvasBoardId: boardId,
      tokenHash: 'fresh',
      createdByUserId: user.id,
      expiresInHours: 1,
    })

    expect(await findCanvasShareLinkById(stale.id)).toBeNull()
    expect(await findCanvasShareLinkById(fresh.id)).not.toBeNull()
  })
})

describe('findCanvasShareLinkByTokenHash', () => {
  it('still returns an expired or revoked link, so the caller can say WHY', async () => {
    // Filtering here would collapse expired, revoked and never-existed into
    // one indistinguishable null and the public page could only ever say
    // "invalid".
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const boardId = await makeBoard(project.id)

    const link = await createCanvasBoardShareLink({
      canvasBoardId: boardId,
      tokenHash: 'expired',
      createdByUserId: user.id,
      expiresInHours: 1,
    })
    db.prepare(
      'UPDATE "CanvasBoardShareLink" SET "expiresAt" = ? WHERE "id" = ?',
    ).run(Date.now() - 1_000, link.id)

    const found = await findCanvasShareLinkByTokenHash('expired')
    expect(found).not.toBeNull()
    expect(found!.expiresAt!.getTime()).toBeLessThan(Date.now())
  })

  it('returns null for an unknown hash', async () => {
    expect(await findCanvasShareLinkByTokenHash('nope')).toBeNull()
  })
})

describe('findCanvasShareLinksByBoardId', () => {
  it('does not leak links between boards', async () => {
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const a = await makeBoard(project.id)
    const b = await makeBoard(project.id)

    await createCanvasBoardShareLink({
      canvasBoardId: a,
      tokenHash: 'only-a',
      createdByUserId: user.id,
      expiresInHours: 1,
    })

    expect(await findCanvasShareLinksByBoardId(a)).toHaveLength(1)
    expect(await findCanvasShareLinksByBoardId(b)).toHaveLength(0)
  })

  it('carries the board name for display', async () => {
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const board = await createCanvasBoard({
      name: 'Named Board',
      projectId: project.id,
    })
    await createCanvasBoardShareLink({
      canvasBoardId: board.id,
      tokenHash: 'named',
      createdByUserId: user.id,
      expiresInHours: 1,
    })

    const links = await findCanvasShareLinksByBoardId(board.id)
    expect(links[0].canvasBoardName).toBe('Named Board')
  })
})

describe('revokeCanvasBoardShareLinkById', () => {
  it('is idempotent and does not move revokedAt on a second call', async () => {
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const boardId = await makeBoard(project.id)
    const link = await createCanvasBoardShareLink({
      canvasBoardId: boardId,
      tokenHash: 'revoke-me',
      createdByUserId: user.id,
      expiresInHours: 1,
    })

    await revokeCanvasBoardShareLinkById(link.id)
    const first = (await findCanvasShareLinkById(link.id))!.revokedAt
    await revokeCanvasBoardShareLinkById(link.id)
    const second = (await findCanvasShareLinkById(link.id))!.revokedAt

    expect(first).not.toBeNull()
    expect(second!.getTime()).toBe(first!.getTime())
  })

  it('is a silent no-op for an id that matches nothing', async () => {
    await expect(
      revokeCanvasBoardShareLinkById('11111111-1111-4111-8111-111111111111'),
    ).resolves.toBeUndefined()
  })
})

describe('board deletion cascade', () => {
  it('takes the board’s share links with it', async () => {
    // Without the cascade a deleted board leaves live tokens pointing at
    // nothing — links that outlive the thing they grant access to.
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const boardId = await makeBoard(project.id)
    const link = await createCanvasBoardShareLink({
      canvasBoardId: boardId,
      tokenHash: 'cascade',
      createdByUserId: user.id,
      expiresInHours: 1,
    })

    await deleteCanvasBoard(boardId)

    expect(await findCanvasShareLinkById(link.id)).toBeNull()
  })
})
