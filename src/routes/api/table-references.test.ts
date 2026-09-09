// @vitest-environment node
// src/routes/api/table-references.test.ts
// Unit tests for /api/table-references: the JWT-authenticated server-to-server
// route the MCP server calls to create, re-target, delete and list cross-file
// table references (LizMeter #83).
//
// Strategy mirrors canvas-boards.test.ts: call the REAL exported handler
// against the real in-memory test DB, so the role gate runs through actual
// findEffectiveRole resolution against seeded ProjectMember rows, and tokens
// are verified by the same validateCollabToken the Socket.IO handshake uses.

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
  handleTableReferenceRequest,
} from './table-references'
import { _resetKeyPairForTests, getSigningKeyPair } from '@/lib/oauth/keys'
import { upsertProjectMember } from '@/data/permission'
import { listTableReferences } from '@/data/table-reference'
import {
  makeColumn,
  makeProject,
  makeTable,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

const TEST_COLLAB_URI = 'http://localhost:3010'
const TEST_ISSUER = 'http://localhost:3000'

vi.stubEnv('COLLAB_RESOURCE_URI', TEST_COLLAB_URI)
vi.stubEnv('OAUTH_ISSUER', TEST_ISSUER)

async function mintCollabToken(sub: string): Promise<string> {
  const { kid, privateKey } = await getSigningKeyPair()
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_COLLAB_URI)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 120)
    .sign(privateKey)
}

function post(body: unknown, token?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request('http://localhost:3000/api/table-references', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

/** One project, two boards, one source table with two columns. */
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
  const local = makeWhiteboard({ projectId: project.id, name: 'Local' })
  const source = makeWhiteboard({ projectId: project.id, name: 'Billing' })
  const sourceTable = makeTable({ whiteboardId: source.id, name: 'orders' })
  const idCol = makeColumn({
    tableId: sourceTable.id,
    name: 'id',
    isPrimaryKey: true,
  })
  return { owner, viewer, stranger, project, local, source, sourceTable, idCol }
}

beforeAll(() => {
  _resetKeyPairForTests()
})

beforeEach(() => {
  resetDb()
  _resetIpRateLimitForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/api/table-references authentication', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await handleTableReferenceRequest(
      post({ op: 'list', whiteboardId: crypto.randomUUID() }),
    )

    expect(res.status).toBe(401)
  })

  it('rejects a token that is not a valid collab token', async () => {
    const res = await handleTableReferenceRequest(
      post({ op: 'list', whiteboardId: crypto.randomUUID() }, 'not-a-jwt'),
    )

    expect(res.status).toBe(401)
  })
})

describe('/api/table-references authorization', () => {
  it('refuses a create from a VIEWER', async () => {
    const { viewer, local, source, sourceTable, idCol } = await setup()
    const token = await mintCollabToken(viewer.id)

    const res = await handleTableReferenceRequest(
      post(
        {
          op: 'create',
          whiteboardId: local.id,
          sourceWhiteboardId: source.id,
          sourceTableId: sourceTable.id,
          sourceColumnIds: [idCol.id],
        },
        token,
      ),
    )

    expect(res.status).toBe(403)
    expect(await listTableReferences(local.id)).toHaveLength(0)
  })

  it('lets a VIEWER list references', async () => {
    const { viewer, local } = await setup()
    const token = await mintCollabToken(viewer.id)

    const res = await handleTableReferenceRequest(
      post({ op: 'list', whiteboardId: local.id }, token),
    )

    expect(res.status).toBe(200)
  })

  it('refuses a stranger with no role on the project', async () => {
    const { stranger, local } = await setup()
    const token = await mintCollabToken(stranger.id)

    const res = await handleTableReferenceRequest(
      post({ op: 'list', whiteboardId: local.id }, token),
    )

    expect(res.status).toBe(403)
  })
})

describe('/api/table-references operations', () => {
  it('creates a reference and returns it', async () => {
    const { owner, local, source, sourceTable, idCol } = await setup()
    const token = await mintCollabToken(owner.id)

    const res = await handleTableReferenceRequest(
      post(
        {
          op: 'create',
          whiteboardId: local.id,
          sourceWhiteboardId: source.id,
          sourceTableId: sourceTable.id,
          sourceColumnIds: [idCol.id],
          positionX: 40,
          positionY: 60,
        },
        token,
      ),
    )

    expect(res.status).toBe(200)
    const payload = (await res.json()) as {
      reference: { table: { id: string; positionX: number } }
    }
    expect(payload.reference.table.positionX).toBe(40)
    expect(await listTableReferences(local.id)).toHaveLength(1)
  })

  it('lists a reference resolved against its source', async () => {
    const { owner, local, source, sourceTable, idCol } = await setup()
    const token = await mintCollabToken(owner.id)
    await handleTableReferenceRequest(
      post(
        {
          op: 'create',
          whiteboardId: local.id,
          sourceWhiteboardId: source.id,
          sourceTableId: sourceTable.id,
          sourceColumnIds: [idCol.id],
        },
        token,
      ),
    )

    const res = await handleTableReferenceRequest(
      post({ op: 'list', whiteboardId: local.id }, token),
    )

    const payload = (await res.json()) as {
      references: Array<{
        sourceTableName: string
        sourceWhiteboardName: string
        missing: boolean
      }>
    }
    expect(payload.references).toHaveLength(1)
    expect(payload.references[0].sourceTableName).toBe('orders')
    expect(payload.references[0].sourceWhiteboardName).toBe('Billing')
    expect(payload.references[0].missing).toBe(false)
  })

  it('reports how many relationships a re-target deleted', async () => {
    const { owner, local, source, sourceTable, idCol } = await setup()
    const token = await mintCollabToken(owner.id)
    const created = (await (
      await handleTableReferenceRequest(
        post(
          {
            op: 'create',
            whiteboardId: local.id,
            sourceWhiteboardId: source.id,
            sourceTableId: sourceTable.id,
            sourceColumnIds: [idCol.id],
          },
          token,
        ),
      )
    ).json()) as { reference: { table: { id: string } } }

    const nextTable = makeTable({ whiteboardId: source.id, name: 'payments' })
    const nextCol = makeColumn({ tableId: nextTable.id, name: 'id' })

    const res = await handleTableReferenceRequest(
      post(
        {
          op: 'update',
          tableId: created.reference.table.id,
          sourceTableId: nextTable.id,
          sourceColumnIds: [nextCol.id],
        },
        token,
      ),
    )

    expect(res.status).toBe(200)
    const payload = (await res.json()) as { deletedRelationships: number }
    // No lines were drawn, so nothing was destroyed — but the field is
    // reported either way, which is what the MCP tool relays.
    expect(payload.deletedRelationships).toBe(0)
  })

  it('deletes a reference', async () => {
    const { owner, local, source, sourceTable, idCol } = await setup()
    const token = await mintCollabToken(owner.id)
    const created = (await (
      await handleTableReferenceRequest(
        post(
          {
            op: 'create',
            whiteboardId: local.id,
            sourceWhiteboardId: source.id,
            sourceTableId: sourceTable.id,
            sourceColumnIds: [idCol.id],
          },
          token,
        ),
      )
    ).json()) as { reference: { table: { id: string } } }

    const res = await handleTableReferenceRequest(
      post({ op: 'delete', tableId: created.reference.table.id }, token),
    )

    expect(res.status).toBe(200)
    expect(await listTableReferences(local.id)).toHaveLength(0)
  })
})

describe('/api/table-references validation', () => {
  it('refuses a source board in another project, with a usable message', async () => {
    const { owner, local } = await setup()
    const otherProject = makeProject({ name: 'Other', ownerId: owner.id })
    const foreign = makeWhiteboard({ projectId: otherProject.id })
    const foreignTable = makeTable({ whiteboardId: foreign.id })
    const foreignCol = makeColumn({ tableId: foreignTable.id })
    const token = await mintCollabToken(owner.id)

    const res = await handleTableReferenceRequest(
      post(
        {
          op: 'create',
          whiteboardId: local.id,
          sourceWhiteboardId: foreign.id,
          sourceTableId: foreignTable.id,
          sourceColumnIds: [foreignCol.id],
        },
        token,
      ),
    )

    expect(res.status).toBe(400)
    const payload = (await res.json()) as { message: string }
    expect(payload.message).toMatch(/same project/i)
    expect(await listTableReferences(local.id)).toHaveLength(0)
  })

  it('404s an unknown whiteboard rather than leaking a role check', async () => {
    const { owner } = await setup()
    const token = await mintCollabToken(owner.id)

    const res = await handleTableReferenceRequest(
      post({ op: 'list', whiteboardId: crypto.randomUUID() }, token),
    )

    expect(res.status).toBe(404)
  })

  it('rejects a malformed body before touching the database', async () => {
    const { owner } = await setup()
    const token = await mintCollabToken(owner.id)

    const res = await handleTableReferenceRequest(
      post({ op: 'create', whiteboardId: 'not-a-uuid' }, token),
    )

    expect(res.status).toBe(400)
  })

  it('rejects an unknown op', async () => {
    const { owner } = await setup()
    const token = await mintCollabToken(owner.id)

    const res = await handleTableReferenceRequest(
      post({ op: 'destroy-everything' }, token),
    )

    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting. This route shipped with a single 15 / 60s per-IP bucket and no
// test at all. The bucket was wrong here: extractClientIp reads
// x-forwarded-for, the MCP server calls this route directly with no such
// header, so every request from it keyed on the literal string 'unknown' — 15
// writes a minute shared by every user of the MCP server. Reference work is
// bursty (list, create, relate, re-target), so it tripped in ordinary use; the
// e2e suite hit it as a flake before it was found.
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/table-references pre-auth per-IP flood guard', () => {
  it('allows the first 600 requests from one IP and blocks the 601st', () => {
    for (let i = 0; i < 600; i++) {
      expect(checkIpRateLimit('10.2.0.1')).toBe(true)
    }
    expect(checkIpRateLimit('10.2.0.1')).toBe(false)
  })

  it('does not block a different IP', () => {
    for (let i = 0; i < 601; i++) checkIpRateLimit('10.2.0.2')
    expect(checkIpRateLimit('10.2.0.3')).toBe(true)
  })

  it('returns 429 with Retry-After once the window is exhausted', async () => {
    const { owner, local, source, sourceTable, idCol } = await setup()
    const token = await mintCollabToken(owner.id)
    for (let i = 0; i < 601; i++) checkIpRateLimit('unknown')

    const resp = await handleTableReferenceRequest(
      post(
        {
          op: 'create',
          whiteboardId: local.id,
          sourceWhiteboardId: source.id,
          sourceTableId: sourceTable.id,
          sourceColumnIds: [idCol.id],
        },
        token,
      ),
    )

    expect(resp.status).toBe(429)
    expect(resp.headers.get('Retry-After')).toBe('60')
  })
})

describe('/api/table-references post-auth per-subject budget', () => {
  it('allows the first 120 requests from one subject and blocks the 121st', () => {
    for (let i = 0; i < 120; i++) {
      expect(checkUserRateLimit('user-a')).toBe(true)
    }
    expect(checkUserRateLimit('user-a')).toBe(false)
  })

  // Drives real requests through the real handler rather than poking the
  // limiter, because what matters is that the handler consults the right
  // bucket. `list` is used so the budget is spent without creating 120 rows.
  it(
    'blocks one user past the budget while still serving another on the same IP',
    { timeout: 30_000 },
    async () => {
      const { owner, viewer, local } = await setup()
      const heavyToken = await mintCollabToken(owner.id)
      const lightToken = await mintCollabToken(viewer.id)

      for (let i = 0; i < 120; i++) {
        const ok = await handleTableReferenceRequest(
          post({ op: 'list', whiteboardId: local.id }, heavyToken),
        )
        expect(ok.status).toBe(200)
      }
      const heavyLimited = await handleTableReferenceRequest(
        post({ op: 'list', whiteboardId: local.id }, heavyToken),
      )
      expect(heavyLimited.status).toBe(429)
      expect(heavyLimited.headers.get('Retry-After')).toBe('60')

      // Same IP, same 'unknown' key, different subject — must still be served.
      const other = await handleTableReferenceRequest(
        post({ op: 'list', whiteboardId: local.id }, lightToken),
      )
      expect(other.status).toBe(200)
    },
  )

  it('an unauthenticated request consumes no user budget', async () => {
    const { owner, local } = await setup()
    const token = await mintCollabToken(owner.id)

    for (let i = 0; i < 30; i++) {
      const rejected = await handleTableReferenceRequest(
        post({ op: 'list', whiteboardId: local.id }),
      )
      expect(rejected.status).toBe(401)
    }

    const ok = await handleTableReferenceRequest(
      post({ op: 'list', whiteboardId: local.id }, token),
    )
    expect(ok.status).toBe(200)
  })
})
