// @vitest-environment node
// src/routes/api/canvas-boards.test.ts
// Unit tests for the /api/canvas-boards endpoint: the JWT-authenticated
// server-to-server route the MCP server calls to create, rename, and delete
// canvas boards. TC-CBD-01 through TC-CBD-14.
//
// Strategy: call the REAL exported handler (handleCanvasBoardRequest) against
// the real in-memory test DB, so the EDITOR+ gate runs through actual
// findEffectiveRole / hasMinimumRole resolution against actually-seeded
// ProjectMember rows rather than a mock. This differs from collab-token.test.ts,
// which re-implements its handler inline; that duplication is what let the route
// and its test drift, and the route module already exports test helpers
// (checkIpRateLimit), so exporting the handler needs no new convention.
//
// Tokens are minted with the same signing key and the same claims
// /api/collab-token issues, then verified by the same validateCollabToken the
// Socket.IO handshake uses. A test that hand-rolled its own verification would
// not prove the two paths agree.

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { SignJWT } from 'jose'
import {
  _resetIpRateLimitForTests,
  checkIpRateLimit,
  checkUserRateLimit,
  handleCanvasBoardRequest,
} from './canvas-boards'
import { _resetKeyPairForTests, getSigningKeyPair } from '@/lib/oauth/keys'
import { createCanvasBoard } from '@/data/canvas-board'
import { createCanvasElement } from '@/data/canvas-element'
import { upsertProjectMember } from '@/data/permission'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

const TEST_COLLAB_URI = 'http://localhost:3010'
const TEST_ISSUER = 'http://localhost:3000'
const MCP_RESOURCE_URI = 'http://localhost:3011/mcp'

vi.stubEnv('COLLAB_RESOURCE_URI', TEST_COLLAB_URI)
vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Mint a collab-audience JWT exactly as /api/collab-token does. */
async function mintCollabToken(
  sub: string,
  opts: { audience?: string; issuer?: string; ttlSeconds?: number } = {},
): Promise<string> {
  const { kid, privateKey } = await getSigningKeyPair()
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(opts.issuer ?? TEST_ISSUER)
    .setAudience(opts.audience ?? TEST_COLLAB_URI)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + (opts.ttlSeconds ?? 120))
    .sign(privateKey)
}

function post(body: unknown, token?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request('http://localhost:3000/api/canvas-boards', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function setup() {
  const owner = makeUser()
  const editor = makeUser()
  const viewer = makeUser()
  const stranger = makeUser()
  const project = makeProject({ ownerId: owner.id })
  await upsertProjectMember({
    projectId: project.id,
    userId: editor.id,
    role: 'EDITOR',
  })
  await upsertProjectMember({
    projectId: project.id,
    userId: viewer.id,
    role: 'VIEWER',
  })
  return { owner, editor, viewer, stranger, project }
}

function boardRow(id: string) {
  return db.prepare('SELECT * FROM "CanvasBoard" WHERE "id" = ?').get(id) as
    | { id: string; name: string; folderId: string | null }
    | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  _resetKeyPairForTests()
})

beforeEach(() => {
  resetDb()
  _resetIpRateLimitForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('COLLAB_RESOURCE_URI', TEST_COLLAB_URI)
  vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)
})

// ─────────────────────────────────────────────────────────────────────────────
// Authentication (401)
// ─────────────────────────────────────────────────────────────────────────────

// TC-CBD-01: a request with no Authorization header is rejected before any
// database read.
describe('TC-CBD-01: missing Authorization header', () => {
  it('returns 401', async () => {
    const { project } = await setup()
    const resp = await handleCanvasBoardRequest(
      post({ op: 'create', name: 'Board', projectId: project.id }),
    )
    expect(resp.status).toBe(401)
    expect((await resp.json()).error).toBe('invalid_token')
  })

  it('returns 401 for a non-Bearer Authorization scheme', async () => {
    const { project } = await setup()
    const req = new Request('http://localhost:3000/api/canvas-boards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic abc',
      },
      body: JSON.stringify({
        op: 'create',
        name: 'Board',
        projectId: project.id,
      }),
    })
    const resp = await handleCanvasBoardRequest(req)
    expect(resp.status).toBe(401)
  })
})

// TC-CBD-02: the MCP server's own access token (aud = the MCP resource) must
// NOT open this route. Accepting it would re-open the confused-deputy hole
// /api/collab-token was built to close.
describe('TC-CBD-02: wrong audience rejected', () => {
  it('returns 401 for a JWT minted for the MCP resource', async () => {
    const { owner, project } = await setup()
    const token = await mintCollabToken(owner.id, {
      audience: MCP_RESOURCE_URI,
    })
    const resp = await handleCanvasBoardRequest(
      post({ op: 'create', name: 'Board', projectId: project.id }, token),
    )
    expect(resp.status).toBe(401)
  })

  it('returns 401 for a JWT from a different issuer', async () => {
    const { owner, project } = await setup()
    const token = await mintCollabToken(owner.id, {
      issuer: 'https://evil.example',
    })
    const resp = await handleCanvasBoardRequest(
      post({ op: 'create', name: 'Board', projectId: project.id }, token),
    )
    expect(resp.status).toBe(401)
  })
})

// TC-CBD-03: an expired collab JWT is rejected. The MCP caches these for
// (exp - 30s); a clock skew or a stalled process must not get a free pass.
describe('TC-CBD-03: expired token rejected', () => {
  it('returns 401', async () => {
    const { owner, project } = await setup()
    const token = await mintCollabToken(owner.id, { ttlSeconds: -60 })
    const resp = await handleCanvasBoardRequest(
      post({ op: 'create', name: 'Board', projectId: project.id }, token),
    )
    expect(resp.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Body validation (400)
// ─────────────────────────────────────────────────────────────────────────────

// TC-CBD-04: the body is a discriminated union on `op`; anything else is a 400
// naming the problem, never a 500.
describe('TC-CBD-04: body validation', () => {
  it('returns 400 for an unknown op', async () => {
    const { owner } = await setup()
    const token = await mintCollabToken(owner.id)
    const resp = await handleCanvasBoardRequest(
      post({ op: 'drop-table' }, token),
    )
    expect(resp.status).toBe(400)
    expect((await resp.json()).error).toBe('invalid_request')
  })

  it('returns 400 for a create with no name', async () => {
    const { owner, project } = await setup()
    const token = await mintCollabToken(owner.id)
    const resp = await handleCanvasBoardRequest(
      post({ op: 'create', projectId: project.id }, token),
    )
    expect(resp.status).toBe(400)
  })

  it('returns 400 for a non-JSON content type', async () => {
    const { owner } = await setup()
    const token = await mintCollabToken(owner.id)
    const req = new Request('http://localhost:3000/api/canvas-boards', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: `Bearer ${token}`,
      },
      body: 'op=create',
    })
    const resp = await handleCanvasBoardRequest(req)
    expect(resp.status).toBe(400)
  })

  it('returns 400 for an unparseable body', async () => {
    const { owner } = await setup()
    const token = await mintCollabToken(owner.id)
    const req = new Request('http://localhost:3000/api/canvas-boards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: '{ not json',
    })
    const resp = await handleCanvasBoardRequest(req)
    expect(resp.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────────────────

// TC-CBD-05: the happy path an agent actually needs — an EDITOR creates a board
// and gets back a row it can immediately address with the element tools.
describe('TC-CBD-05: create', () => {
  it('lets an OWNER create a board and returns it with no-store', async () => {
    const { owner, project } = await setup()
    const token = await mintCollabToken(owner.id)

    const resp = await handleCanvasBoardRequest(
      post(
        { op: 'create', name: 'Sprint board', projectId: project.id },
        token,
      ),
    )

    expect(resp.status).toBe(200)
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
    const { board } = await resp.json()
    expect(board.name).toBe('Sprint board')
    expect(board.projectId).toBe(project.id)
    expect(boardRow(board.id)).toBeDefined()
  })

  it('lets an EDITOR member create a board', async () => {
    const { editor, project } = await setup()
    const token = await mintCollabToken(editor.id)
    const resp = await handleCanvasBoardRequest(
      post(
        { op: 'create', name: 'Editor board', projectId: project.id },
        token,
      ),
    )
    expect(resp.status).toBe(200)
  })
})

// TC-CBD-06: a VIEWER cannot create. The MCP checks this too, but the route is
// the check that actually protects the data — a caller can reach it directly.
describe('TC-CBD-06: create is EDITOR-gated', () => {
  it('returns 403 for a VIEWER member', async () => {
    const { viewer, project } = await setup()
    const token = await mintCollabToken(viewer.id)
    const resp = await handleCanvasBoardRequest(
      post({ op: 'create', name: 'Nope', projectId: project.id }, token),
    )
    expect(resp.status).toBe(403)
    expect((await resp.json()).error).toBe('FORBIDDEN')
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM "CanvasBoard"').get() as {
        n: number
      },
    ).toEqual({ n: 0 })
  })

  it('returns 403 for a non-member', async () => {
    const { stranger, project } = await setup()
    const token = await mintCollabToken(stranger.id)
    const resp = await handleCanvasBoardRequest(
      post({ op: 'create', name: 'Nope', projectId: project.id }, token),
    )
    expect(resp.status).toBe(403)
  })

  it('returns 403 for an unknown project', async () => {
    const { owner } = await setup()
    const token = await mintCollabToken(owner.id)
    const resp = await handleCanvasBoardRequest(
      post(
        {
          op: 'create',
          name: 'Nope',
          projectId: '00000000-0000-4000-8000-000000000000',
        },
        token,
      ),
    )
    expect(resp.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// update
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-CBD-07: update renames a board', () => {
  it('returns 200 and the renamed board', async () => {
    const { owner, project } = await setup()
    const board = await createCanvasBoard({
      name: 'Old',
      projectId: project.id,
    })
    const token = await mintCollabToken(owner.id)

    const resp = await handleCanvasBoardRequest(
      post({ op: 'update', canvasBoardId: board.id, name: 'New' }, token),
    )

    expect(resp.status).toBe(200)
    expect((await resp.json()).board.name).toBe('New')
    expect(boardRow(board.id)?.name).toBe('New')
  })
})

// TC-CBD-08: an unknown board id is 404, distinct from 403. The MCP maps this
// straight to its NOT_FOUND code, so an agent can tell a typo from a
// permission problem.
describe('TC-CBD-08: update of an unknown board', () => {
  it('returns 404', async () => {
    const { owner } = await setup()
    const token = await mintCollabToken(owner.id)
    const resp = await handleCanvasBoardRequest(
      post(
        {
          op: 'update',
          canvasBoardId: '00000000-0000-4000-8000-000000000000',
          name: 'New',
        },
        token,
      ),
    )
    expect(resp.status).toBe(404)
    expect((await resp.json()).error).toBe('NOT_FOUND')
  })
})

describe('TC-CBD-09: update is EDITOR-gated', () => {
  it('returns 403 for a VIEWER and leaves the name unchanged', async () => {
    const { viewer, project } = await setup()
    const board = await createCanvasBoard({
      name: 'Old',
      projectId: project.id,
    })
    const token = await mintCollabToken(viewer.id)

    const resp = await handleCanvasBoardRequest(
      post({ op: 'update', canvasBoardId: board.id, name: 'New' }, token),
    )

    expect(resp.status).toBe(403)
    expect(boardRow(board.id)?.name).toBe('Old')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// delete
// ─────────────────────────────────────────────────────────────────────────────

// TC-CBD-10: the cascade is the whole reason delete_canvas_board carries a
// confirmName guard on the MCP side. This test pins that the cascade is real,
// so the guard is not protecting against an imaginary risk.
describe('TC-CBD-10: delete cascades to elements', () => {
  it('removes the board and every element on it', async () => {
    const { owner, project } = await setup()
    const board = await createCanvasBoard({
      name: 'Doomed',
      projectId: project.id,
    })
    await createCanvasElement({
      boardId: board.id,
      kind: 'rectangle',
      positionX: 10,
      positionY: 20,
      width: 100,
      height: 50,
      props: { kind: 'rectangle' },
    })
    const token = await mintCollabToken(owner.id)

    const resp = await handleCanvasBoardRequest(
      post({ op: 'delete', canvasBoardId: board.id }, token),
    )

    expect(resp.status).toBe(200)
    expect((await resp.json()).board.id).toBe(board.id)
    expect(boardRow(board.id)).toBeUndefined()
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM "CanvasElement" WHERE "boardId" = ?',
        )
        .get(board.id) as { n: number },
    ).toEqual({ n: 0 })
  })
})

describe('TC-CBD-11: delete of an unknown board', () => {
  it('returns 404', async () => {
    const { owner } = await setup()
    const token = await mintCollabToken(owner.id)
    const resp = await handleCanvasBoardRequest(
      post(
        { op: 'delete', canvasBoardId: '00000000-0000-4000-8000-000000000000' },
        token,
      ),
    )
    expect(resp.status).toBe(404)
  })
})

describe('TC-CBD-12: delete is EDITOR-gated', () => {
  it('returns 403 for a VIEWER and leaves the board intact', async () => {
    const { viewer, project } = await setup()
    const board = await createCanvasBoard({
      name: 'Safe',
      projectId: project.id,
    })
    const token = await mintCollabToken(viewer.id)

    const resp = await handleCanvasBoardRequest(
      post({ op: 'delete', canvasBoardId: board.id }, token),
    )

    expect(resp.status).toBe(403)
    expect(boardRow(board.id)).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────────────────────────────

// TC-CBD-13: the pre-auth per-IP bucket. 600/60s, applied before the body is
// parsed so an unauthenticated flood cannot exhaust the JSON decode path. It is
// a flood guard, not the business limit — TC-CBD-15 covers that.
describe('TC-CBD-13: pre-auth per-IP flood guard', () => {
  it('allows the first 600 requests from one IP and blocks the 601st', () => {
    for (let i = 0; i < 600; i++) {
      expect(checkIpRateLimit('10.1.0.1')).toBe(true)
    }
    expect(checkIpRateLimit('10.1.0.1')).toBe(false)
  })

  it('does not block a different IP', () => {
    for (let i = 0; i < 601; i++) checkIpRateLimit('10.1.0.2')
    expect(checkIpRateLimit('10.1.0.3')).toBe(true)
  })

  it('returns 429 with Retry-After once the window is exhausted', async () => {
    const { owner, project } = await setup()
    const token = await mintCollabToken(owner.id)
    for (let i = 0; i < 601; i++) checkIpRateLimit('unknown')

    const resp = await handleCanvasBoardRequest(
      post({ op: 'create', name: 'Board', projectId: project.id }, token),
    )

    expect(resp.status).toBe(429)
    expect(resp.headers.get('Retry-After')).toBe('60')
  })
})

// TC-CBD-15: the post-auth per-subject budget — the real limit, and the fix for
// the bug this route shipped with. The MCP server calls this endpoint directly,
// with no x-forwarded-for, so every request from it keyed on the same 'unknown'
// IP: a per-IP budget of 15 starved every user of the MCP server at once. The
// budget must follow the JWT subject instead. Same model as /api/mcp-lifecycle.
describe('TC-CBD-15: post-auth per-subject budget', () => {
  it('allows the first 120 requests from one subject and blocks the 121st', () => {
    for (let i = 0; i < 120; i++) {
      expect(checkUserRateLimit('user-a')).toBe(true)
    }
    expect(checkUserRateLimit('user-a')).toBe(false)
  })

  // Drives real writes through the real handler rather than poking the limiter,
  // because the thing worth pinning is that the handler consults the right
  // bucket. That costs real time under full-suite parallelism, hence the
  // explicit timeout.
  it(
    'blocks one user past the budget while still serving another on the same IP',
    { timeout: 30_000 },
    async () => {
      const { owner, editor, project } = await setup()
      const heavyToken = await mintCollabToken(owner.id)
      const lightToken = await mintCollabToken(editor.id)

      for (let i = 0; i < 120; i++) {
        const ok = await handleCanvasBoardRequest(
          post({ op: 'create', name: `H${i}`, projectId: project.id }, heavyToken),
        )
        expect(ok.status).toBe(200)
      }
      const heavyLimited = await handleCanvasBoardRequest(
        post({ op: 'create', name: 'H121', projectId: project.id }, heavyToken),
      )
      expect(heavyLimited.status).toBe(429)
      expect(heavyLimited.headers.get('Retry-After')).toBe('60')

      // Same IP, same 'unknown' key, different subject — must still be served.
      const other = await handleCanvasBoardRequest(
        post({ op: 'create', name: 'L1', projectId: project.id }, lightToken),
      )
      expect(other.status).toBe(200)
    },
  )

  it('an unauthenticated request consumes no user budget', async () => {
    const { owner, project } = await setup()
    const token = await mintCollabToken(owner.id)

    for (let i = 0; i < 30; i++) {
      const rejected = await handleCanvasBoardRequest(
        post({ op: 'create', name: 'X', projectId: project.id }),
      )
      expect(rejected.status).toBe(401)
    }

    const ok = await handleCanvasBoardRequest(
      post({ op: 'create', name: 'Still fine', projectId: project.id }, token),
    )
    expect(ok.status).toBe(200)
  })
})

// TC-CBD-14: the acting user is the JWT's sub, never a body field. A body that
// names another user must not change who the role check runs against.
describe('TC-CBD-14: identity comes from the token, not the body', () => {
  it('ignores a user_id in the body', async () => {
    const { owner, viewer, project } = await setup()
    const token = await mintCollabToken(viewer.id)

    const resp = await handleCanvasBoardRequest(
      post(
        {
          op: 'create',
          name: 'Escalation',
          projectId: project.id,
          userId: owner.id,
          sub: owner.id,
        },
        token,
      ),
    )

    expect(resp.status).toBe(403)
  })
})
