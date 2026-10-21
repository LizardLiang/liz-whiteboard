// @vitest-environment node
// src/routes/api/render-token.test.ts
// Unit tests for POST /api/render-token and the render-board server fn
// handler it feeds. The REAL handlers run against the real test DB, so the
// VIEWER gate resolves through actual ProjectMember rows.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import {
  _resetRateLimitsForTests,
  checkIpRateLimit,
  checkUserRateLimit,
  handleRenderTokenRequest,
} from './render-token'
import { getRenderBoardHandler } from '@/lib/render/handlers'
import { signRenderToken } from '@/lib/render/render-token'
import { _resetKeyPairForTests, getSigningKeyPair } from '@/lib/oauth/keys'
import { upsertProjectMember } from '@/data/permission'
import { db } from '@/db'
import {
  makeCanvasBoard,
  makeProject,
  makeTable,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

const COLLAB_URI = 'http://localhost:3010'
const ISSUER = 'http://localhost:3000'

vi.stubEnv('COLLAB_RESOURCE_URI', COLLAB_URI)
vi.stubEnv('OAUTH_ISSUER', ISSUER)

async function mintCollabToken(sub: string, audience = COLLAB_URI) {
  const { kid, privateKey } = await getSigningKeyPair()
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(privateKey)
}

function post(body: unknown, token?: string, ip?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (ip) headers['x-forwarded-for'] = ip
  return new Request('http://localhost:3000/api/render-token', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function setup() {
  const owner = makeUser()
  const viewer = makeUser()
  const stranger = makeUser()
  const project = makeProject({ ownerId: owner.id })
  await upsertProjectMember({
    projectId: project.id,
    userId: viewer.id,
    role: 'VIEWER',
  })
  const whiteboard = makeWhiteboard({ projectId: project.id, name: 'ER' })
  makeTable({ whiteboardId: whiteboard.id, name: '用户表' })
  const canvas = makeCanvasBoard({ projectId: project.id, name: 'Canvas' })
  return { owner, viewer, stranger, project, whiteboard, canvas }
}

beforeAll(() => {
  _resetKeyPairForTests()
})

beforeEach(() => {
  resetDb()
  _resetRateLimitsForTests()
})

describe('POST /api/render-token', () => {
  it('mints a token for a VIEWER on a whiteboard', async () => {
    const { viewer, whiteboard } = await setup()
    const collab = await mintCollabToken(viewer.id)
    const resp = await handleRenderTokenRequest(
      post({ kind: 'whiteboard', boardId: whiteboard.id }, collab),
    )
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(typeof body.token).toBe('string')
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('mints a token for a VIEWER on a canvas board', async () => {
    const { viewer, canvas } = await setup()
    const collab = await mintCollabToken(viewer.id)
    const resp = await handleRenderTokenRequest(
      post({ kind: 'canvas', boardId: canvas.id }, collab),
    )
    expect(resp.status).toBe(200)
  })

  it('returns 404 for a user with no role on the project', async () => {
    const { stranger, whiteboard } = await setup()
    const collab = await mintCollabToken(stranger.id)
    const resp = await handleRenderTokenRequest(
      post({ kind: 'whiteboard', boardId: whiteboard.id }, collab),
    )
    expect(resp.status).toBe(404)
  })

  it('returns 404 for an unknown board', async () => {
    const { viewer } = await setup()
    const collab = await mintCollabToken(viewer.id)
    const resp = await handleRenderTokenRequest(
      post(
        { kind: 'canvas', boardId: '99999999-9999-4999-8999-999999999999' },
        collab,
      ),
    )
    expect(resp.status).toBe(404)
  })

  it('returns 404 when a whiteboard id is sent as a canvas board', async () => {
    const { viewer, whiteboard } = await setup()
    const collab = await mintCollabToken(viewer.id)
    const resp = await handleRenderTokenRequest(
      post({ kind: 'canvas', boardId: whiteboard.id }, collab),
    )
    expect(resp.status).toBe(404)
  })

  it('returns 401 without a bearer token', async () => {
    const { whiteboard } = await setup()
    const resp = await handleRenderTokenRequest(
      post({ kind: 'whiteboard', boardId: whiteboard.id }),
    )
    expect(resp.status).toBe(401)
  })

  it('returns 401 for a JWT with the wrong audience', async () => {
    const { viewer, whiteboard } = await setup()
    const token = await mintCollabToken(viewer.id, 'http://localhost:3011/mcp')
    const resp = await handleRenderTokenRequest(
      post({ kind: 'whiteboard', boardId: whiteboard.id }, token),
    )
    expect(resp.status).toBe(401)
  })

  it('returns 401 for a render token presented as the bearer', async () => {
    const { viewer, whiteboard } = await setup()
    const { token } = await signRenderToken({
      sub: viewer.id,
      kind: 'whiteboard',
      boardId: whiteboard.id,
    })
    const resp = await handleRenderTokenRequest(
      post({ kind: 'whiteboard', boardId: whiteboard.id }, token),
    )
    expect(resp.status).toBe(401)
  })

  it('returns 400 for a malformed body', async () => {
    const { viewer } = await setup()
    const collab = await mintCollabToken(viewer.id)
    const resp = await handleRenderTokenRequest(
      post({ kind: 'folder', boardId: 'nope' }, collab),
    )
    expect(resp.status).toBe(400)
  })

  it('returns 429 once the per-IP pre-auth bucket is spent', async () => {
    for (let i = 0; i < 600; i++) checkIpRateLimit('9.9.9.9')
    const resp = await handleRenderTokenRequest(
      post({ kind: 'whiteboard', boardId: 'x' }, undefined, '9.9.9.9'),
    )
    expect(resp.status).toBe(429)
    expect(resp.headers.get('Retry-After')).toBe('60')
  })

  it('returns 429 once the per-subject bucket is spent', async () => {
    const { viewer, whiteboard } = await setup()
    for (let i = 0; i < 120; i++) checkUserRateLimit(viewer.id)
    const collab = await mintCollabToken(viewer.id)
    const resp = await handleRenderTokenRequest(
      post({ kind: 'whiteboard', boardId: whiteboard.id }, collab),
    )
    expect(resp.status).toBe(429)
  })
})

describe('getRenderBoardHandler', () => {
  it('returns the whiteboard for a valid token', async () => {
    const { viewer, whiteboard } = await setup()
    const { token } = await signRenderToken({
      sub: viewer.id,
      kind: 'whiteboard',
      boardId: whiteboard.id,
    })
    const result = await getRenderBoardHandler(token)
    expect(result.valid).toBe(true)
    if (!result.valid || result.kind !== 'whiteboard') throw new Error('kind')
    expect(result.tables.map((t) => t.name)).toEqual(['用户表'])
  })

  it('returns the canvas board for a valid canvas token', async () => {
    const { viewer, canvas } = await setup()
    const { token } = await signRenderToken({
      sub: viewer.id,
      kind: 'canvas',
      boardId: canvas.id,
    })
    const result = await getRenderBoardHandler(token)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('invalid')
    expect(result.kind).toBe('canvas')
  })

  it('resolves garbage to INVALID without throwing', async () => {
    expect(await getRenderBoardHandler('junk')).toEqual({
      valid: false,
      reason: 'INVALID',
    })
  })

  it('resolves an expired token to EXPIRED', async () => {
    const { viewer, whiteboard } = await setup()
    const { kid, privateKey } = await getSigningKeyPair()
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({
      kind: 'whiteboard',
      boardId: whiteboard.id,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setSubject(viewer.id)
      .setIssuer(ISSUER)
      .setAudience('render')
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(privateKey)
    expect(await getRenderBoardHandler(token)).toEqual({
      valid: false,
      reason: 'EXPIRED',
    })
  })

  it('re-checks the role: a removed member is refused inside the token life', async () => {
    const { viewer, project, whiteboard } = await setup()
    const { token } = await signRenderToken({
      sub: viewer.id,
      kind: 'whiteboard',
      boardId: whiteboard.id,
    })
    db.prepare(
      'DELETE FROM "ProjectMember" WHERE "projectId" = ? AND "userId" = ?',
    ).run(project.id, viewer.id)
    expect(await getRenderBoardHandler(token)).toEqual({
      valid: false,
      reason: 'INVALID',
    })
  })

  it('refuses a token for a board that was deleted after minting', async () => {
    const { viewer, whiteboard } = await setup()
    const { token } = await signRenderToken({
      sub: viewer.id,
      kind: 'whiteboard',
      boardId: whiteboard.id,
    })
    db.prepare('DELETE FROM "Whiteboard" WHERE "id" = ?').run(whiteboard.id)
    expect((await getRenderBoardHandler(token)).valid).toBe(false)
  })
})
