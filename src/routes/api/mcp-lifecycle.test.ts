// @vitest-environment node
// src/routes/api/mcp-lifecycle.test.ts
// Unit tests for /api/mcp-lifecycle: the JWT-authenticated server-to-server
// route the MCP server calls to create, rename and delete projects, folders and
// ER whiteboards. TC-MCPL-01 through TC-MCPL-26.
//
// Strategy is copied deliberately from canvas-boards.test.ts: call the REAL
// exported handler against the real in-memory test DB, so every role gate runs
// through actual findEffectiveRole / hasMinimumRole resolution against actually
// seeded ownerId and ProjectMember rows. Mocking the gate would prove only that
// a mock was called.
//
// Tokens are minted with the same signing key and the same claims
// /api/collab-token issues, then verified by the same validateCollabToken the
// Socket.IO handshake uses, so the two paths cannot silently drift.
//
// The gate table this file pins (mirroring the session-cookie server functions
// in projects.ts, folders.ts and whiteboards.ts):
//
//   entity      create           update    delete
//   project     authenticated    ADMIN+    OWNER only
//   folder      EDITOR+          EDITOR+   EDITOR+
//   whiteboard  EDITOR+          EDITOR+   EDITOR+

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
  handleMcpLifecycleRequest,
} from './mcp-lifecycle'
import { _resetKeyPairForTests, getSigningKeyPair } from '@/lib/oauth/keys'
import { createFolder } from '@/data/folder'
import { upsertProjectMember } from '@/data/permission'
import { db } from '@/db'
import {
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

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
  return new Request('http://localhost:3000/api/mcp-lifecycle', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

interface Actors {
  owner: { id: string }
  admin: { id: string }
  editor: { id: string }
  viewer: { id: string }
  stranger: { id: string }
  project: { id: string }
}

async function setup(): Promise<Actors> {
  const owner = makeUser()
  const admin = makeUser()
  const editor = makeUser()
  const viewer = makeUser()
  const stranger = makeUser()
  const project = makeProject({ ownerId: owner.id })
  await upsertProjectMember({
    projectId: project.id,
    userId: admin.id,
    role: 'ADMIN',
  })
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
  return { owner, admin, editor, viewer, stranger, project }
}

function countRows(table: string, column: string, value: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" = ?`)
    .get(value) as { n: number }
  return row.n
}

beforeAll(async () => {
  _resetKeyPairForTests()
  await getSigningKeyPair()
})

beforeEach(() => {
  resetDb()
  _resetIpRateLimitForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Authentication (TC-MCPL-01 .. 04)
// ─────────────────────────────────────────────────────────────────────────────

describe('authentication', () => {
  it('TC-MCPL-01 rejects a request with no Authorization header', async () => {
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'create', name: 'X' }),
    )
    expect(res.status).toBe(401)
  })

  it('TC-MCPL-02 rejects a token whose audience is the MCP resource URI', async () => {
    const user = makeUser()
    const token = await mintCollabToken(user.id, {
      audience: MCP_RESOURCE_URI,
    })
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'create', name: 'X' }, token),
    )
    expect(res.status).toBe(401)
    expect(countRows('Project', 'ownerId', user.id)).toBe(0)
  })

  it('TC-MCPL-03 rejects an expired token', async () => {
    const user = makeUser()
    const token = await mintCollabToken(user.id, { ttlSeconds: -10 })
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'create', name: 'X' }, token),
    )
    expect(res.status).toBe(401)
  })

  it('TC-MCPL-04 never echoes the bearer token in an error body', async () => {
    const user = makeUser()
    const token = await mintCollabToken(user.id, {
      audience: MCP_RESOURCE_URI,
    })
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'create', name: 'X' }, token),
    )
    const text = await res.text()
    expect(text).not.toContain(token)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Project (TC-MCPL-05 .. 12)
// ─────────────────────────────────────────────────────────────────────────────

describe('project', () => {
  it('TC-MCPL-05 creates a project owned by the token subject', async () => {
    const user = makeUser()
    const token = await mintCollabToken(user.id)
    const res = await handleMcpLifecycleRequest(
      post(
        {
          entity: 'project',
          op: 'create',
          name: 'Cold start',
          description: 'd',
        },
        token,
      ),
    )
    expect(res.status).toBe(200)
    const { project } = (await res.json()) as {
      project: { id: string; name: string; ownerId: string | null }
    }
    expect(project.name).toBe('Cold start')
    expect(project.ownerId).toBe(user.id)
  })

  it('TC-MCPL-06 writes no ProjectMember row on create', async () => {
    const user = makeUser()
    const token = await mintCollabToken(user.id)
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'create', name: 'Cold start' }, token),
    )
    const { project } = (await res.json()) as { project: { id: string } }
    expect(countRows('ProjectMember', 'projectId', project.id)).toBe(0)
  })

  it('TC-MCPL-07 ignores an ownerId supplied in the body', async () => {
    const user = makeUser()
    const victim = makeUser()
    const token = await mintCollabToken(user.id)
    const res = await handleMcpLifecycleRequest(
      post(
        { entity: 'project', op: 'create', name: 'X', ownerId: victim.id },
        token,
      ),
    )
    expect(res.status).toBe(200)
    const { project } = (await res.json()) as {
      project: { ownerId: string | null }
    }
    expect(project.ownerId).toBe(user.id)
  })

  it('TC-MCPL-08 refuses an empty project name', async () => {
    const user = makeUser()
    const token = await mintCollabToken(user.id)
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'create', name: '' }, token),
    )
    expect(res.status).toBe(400)
  })

  it('TC-MCPL-09 lets an ADMIN rename a project', async () => {
    const { admin, project } = await setup()
    const token = await mintCollabToken(admin.id)
    const res = await handleMcpLifecycleRequest(
      post(
        { entity: 'project', op: 'update', projectId: project.id, name: 'New' },
        token,
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { project: { name: string } }
    expect(body.project.name).toBe('New')
  })

  it('TC-MCPL-10 refuses a project rename by an EDITOR', async () => {
    const { editor, project } = await setup()
    const token = await mintCollabToken(editor.id)
    const res = await handleMcpLifecycleRequest(
      post(
        { entity: 'project', op: 'update', projectId: project.id, name: 'New' },
        token,
      ),
    )
    expect(res.status).toBe(403)
  })

  it('TC-MCPL-11 lets the OWNER delete a project', async () => {
    const { owner, project } = await setup()
    const token = await mintCollabToken(owner.id)
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'delete', projectId: project.id }, token),
    )
    expect(res.status).toBe(200)
    expect(countRows('Project', 'id', project.id)).toBe(0)
  })

  it('TC-MCPL-12 refuses a project delete by an ADMIN', async () => {
    const { admin, project } = await setup()
    const token = await mintCollabToken(admin.id)
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'delete', projectId: project.id }, token),
    )
    expect(res.status).toBe(403)
    expect(countRows('Project', 'id', project.id)).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Folder (TC-MCPL-13 .. 17)
// ─────────────────────────────────────────────────────────────────────────────

describe('folder', () => {
  it('TC-MCPL-13 lets an EDITOR create a folder', async () => {
    const { editor, project } = await setup()
    const token = await mintCollabToken(editor.id)
    const res = await handleMcpLifecycleRequest(
      post(
        { entity: 'folder', op: 'create', projectId: project.id, name: 'Docs' },
        token,
      ),
    )
    expect(res.status).toBe(200)
    const { folder } = (await res.json()) as {
      folder: { id: string; name: string; projectId: string }
    }
    expect(folder.name).toBe('Docs')
    expect(folder.projectId).toBe(project.id)
  })

  it('TC-MCPL-14 refuses a folder create by a VIEWER', async () => {
    const { viewer, project } = await setup()
    const token = await mintCollabToken(viewer.id)
    const res = await handleMcpLifecycleRequest(
      post(
        { entity: 'folder', op: 'create', projectId: project.id, name: 'Docs' },
        token,
      ),
    )
    expect(res.status).toBe(403)
    expect(countRows('Folder', 'projectId', project.id)).toBe(0)
  })

  it('TC-MCPL-15 lets an EDITOR rename a folder', async () => {
    const { editor, project } = await setup()
    const folder = await createFolder({ projectId: project.id, name: 'Old' })
    const token = await mintCollabToken(editor.id)
    const res = await handleMcpLifecycleRequest(
      post(
        { entity: 'folder', op: 'update', folderId: folder.id, name: 'New' },
        token,
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { folder: { name: string } }
    expect(body.folder.name).toBe('New')
  })

  it('TC-MCPL-16 deletes a folder and cascades its whiteboards', async () => {
    const { editor, project } = await setup()
    const folder = await createFolder({ projectId: project.id, name: 'Docs' })
    db.prepare('UPDATE "Whiteboard" SET "folderId" = ? WHERE "id" = ?').run(
      folder.id,
      makeWhiteboard({ projectId: project.id }).id,
    )
    expect(countRows('Whiteboard', 'folderId', folder.id)).toBe(1)

    const token = await mintCollabToken(editor.id)
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'folder', op: 'delete', folderId: folder.id }, token),
    )
    expect(res.status).toBe(200)
    expect(countRows('Folder', 'id', folder.id)).toBe(0)
    expect(countRows('Whiteboard', 'folderId', folder.id)).toBe(0)
  })

  it('TC-MCPL-17 refuses a folder delete by a VIEWER', async () => {
    const { viewer, project } = await setup()
    const folder = await createFolder({ projectId: project.id, name: 'Docs' })
    const token = await mintCollabToken(viewer.id)
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'folder', op: 'delete', folderId: folder.id }, token),
    )
    expect(res.status).toBe(403)
    expect(countRows('Folder', 'id', folder.id)).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Whiteboard (TC-MCPL-18 .. 21)
// ─────────────────────────────────────────────────────────────────────────────

describe('whiteboard', () => {
  it('TC-MCPL-18 lets an EDITOR create an ER whiteboard', async () => {
    const { editor, project } = await setup()
    const token = await mintCollabToken(editor.id)
    const res = await handleMcpLifecycleRequest(
      post(
        {
          entity: 'whiteboard',
          op: 'create',
          projectId: project.id,
          name: 'Schema',
        },
        token,
      ),
    )
    expect(res.status).toBe(200)
    const { whiteboard } = (await res.json()) as {
      whiteboard: { id: string; name: string; projectId: string }
    }
    expect(whiteboard.name).toBe('Schema')
    expect(whiteboard.projectId).toBe(project.id)
  })

  it('TC-MCPL-19 refuses a whiteboard create by a VIEWER', async () => {
    const { viewer, project } = await setup()
    const token = await mintCollabToken(viewer.id)
    const res = await handleMcpLifecycleRequest(
      post(
        {
          entity: 'whiteboard',
          op: 'create',
          projectId: project.id,
          name: 'Schema',
        },
        token,
      ),
    )
    expect(res.status).toBe(403)
  })

  it('TC-MCPL-20 lets an EDITOR rename a whiteboard', async () => {
    const { editor, project } = await setup()
    const wb = makeWhiteboard({ projectId: project.id, name: 'Old' })
    const token = await mintCollabToken(editor.id)
    const res = await handleMcpLifecycleRequest(
      post(
        {
          entity: 'whiteboard',
          op: 'update',
          whiteboardId: wb.id,
          name: 'New',
        },
        token,
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { whiteboard: { name: string } }
    expect(body.whiteboard.name).toBe('New')
  })

  it('TC-MCPL-21 refuses a whiteboard delete by a VIEWER', async () => {
    const { viewer, project } = await setup()
    const wb = makeWhiteboard({ projectId: project.id })
    const token = await mintCollabToken(viewer.id)
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'whiteboard', op: 'delete', whiteboardId: wb.id }, token),
    )
    expect(res.status).toBe(403)
    expect(countRows('Whiteboard', 'id', wb.id)).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Not found, validation, rate limit (TC-MCPL-22 .. 24)
// ─────────────────────────────────────────────────────────────────────────────

describe('not found, validation and rate limiting', () => {
  it('TC-MCPL-22 returns 404 for an unknown id before the role check', async () => {
    const user = makeUser()
    const token = await mintCollabToken(user.id)
    const res = await handleMcpLifecycleRequest(
      post(
        {
          entity: 'whiteboard',
          op: 'delete',
          whiteboardId: '11111111-2222-4333-8444-555555555555',
        },
        token,
      ),
    )
    expect(res.status).toBe(404)
  })

  it('TC-MCPL-23 refuses an update that names no field', async () => {
    const { admin, project } = await setup()
    const token = await mintCollabToken(admin.id)
    const res = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'update', projectId: project.id }, token),
    )
    expect(res.status).toBe(400)
  })

  // The two budget tests below drive 120+ real writes through the real handler
  // rather than poking the limiter directly, because the thing worth pinning is
  // that the handler consults the right bucket. That costs real time: ~400ms
  // alone, but enough under full-suite parallelism to blow the 5s default. The
  // explicit timeout is that cost acknowledged, not a hung test tolerated.
  it(
    'TC-MCPL-24 rate limits one user after 120 requests in the window',
    { timeout: 30_000 },
    async () => {
      const user = makeUser()
      const token = await mintCollabToken(user.id)
      for (let i = 0; i < 120; i++) {
        const ok = await handleMcpLifecycleRequest(
          post({ entity: 'project', op: 'create', name: `P${i}` }, token),
        )
        expect(ok.status).toBe(200)
      }
      const limited = await handleMcpLifecycleRequest(
        post({ entity: 'project', op: 'create', name: 'P121' }, token),
      )
      expect(limited.status).toBe(429)
      expect(limited.headers.get('Retry-After')).toBe('60')
    },
  )

  // The bug this route was written with and then fixed: the MCP server calls
  // this endpoint directly, with no x-forwarded-for, so every request from it
  // keys on the same 'unknown' IP. A per-IP budget therefore starves every
  // user at once. The budget must follow the JWT subject instead.
  it(
    'TC-MCPL-25 one user exhausting the budget does not block another',
    { timeout: 30_000 },
    async () => {
      const heavy = makeUser()
      const light = makeUser()
      const heavyToken = await mintCollabToken(heavy.id)
      const lightToken = await mintCollabToken(light.id)

      for (let i = 0; i < 120; i++) {
        await handleMcpLifecycleRequest(
          post({ entity: 'project', op: 'create', name: `H${i}` }, heavyToken),
        )
      }
      const heavyLimited = await handleMcpLifecycleRequest(
        post({ entity: 'project', op: 'create', name: 'H121' }, heavyToken),
      )
      expect(heavyLimited.status).toBe(429)

      // Same IP, same 'unknown' key, different subject — must still be served.
      const other = await handleMcpLifecycleRequest(
        post({ entity: 'project', op: 'create', name: 'L1' }, lightToken),
      )
      expect(other.status).toBe(200)
    },
  )

  // A request with no valid credential must be refused before it can consume
  // any user's budget.
  it('TC-MCPL-26 an unauthenticated request consumes no user budget', async () => {
    const user = makeUser()
    const token = await mintCollabToken(user.id)

    for (let i = 0; i < 30; i++) {
      const rejected = await handleMcpLifecycleRequest(
        post({ entity: 'project', op: 'create', name: 'X' }),
      )
      expect(rejected.status).toBe(401)
    }

    const ok = await handleMcpLifecycleRequest(
      post({ entity: 'project', op: 'create', name: 'Still fine' }, token),
    )
    expect(ok.status).toBe(200)
  })
})
