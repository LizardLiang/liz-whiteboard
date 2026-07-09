// src/routes/api/whiteboards.test.ts
// Phase 4 whiteboard permission integration tests (real in-memory SQLite DB).
//
// TC-P4-04: Whiteboard read requires VIEWER or above
// TC-P4-05: Whiteboard write requires EDITOR or above; VIEWER gets 403
//
// All DB-backed calls are REAL (createWhiteboard / findWhiteboardByIdWithDiagram
// against the in-memory DB). The ONLY mock is `findEffectiveRole`, which is
// currently a non-DB-backed stub (always returns 'OWNER'), so it is mocked to
// drive the role-based branches. `hasMinimumRole` is the real pure helper.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PermissionModule from '@/data/permission'
import {
  createWhiteboard,
  findWhiteboardByIdWithDiagram,
} from '@/data/whiteboard'
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { db } from '@/db'
import {
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

// Keep the real data layer; mock only the (stubbed) role resolver.
vi.mock('@/data/permission', async (importOriginal) => {
  const actual = await importOriginal<typeof PermissionModule>()
  return {
    ...actual,
    findEffectiveRole: vi.fn(),
  }
})

const mockedFindEffectiveRole = vi.mocked(findEffectiveRole)

// ─────────────────────────────────────────────────────────────────────────────
// Whiteboard handler mirrors (AC-18: whiteboards inherit project permissions)
// ─────────────────────────────────────────────────────────────────────────────

async function getWhiteboardHandler(userId: string, whiteboardId: string) {
  // Must look up project from whiteboard to check permission.
  const whiteboard = await findWhiteboardByIdWithDiagram(whiteboardId)
  if (!whiteboard) throw new Error('Whiteboard not found')

  const role = await findEffectiveRole(userId, whiteboard.projectId)
  const permitted = hasMinimumRole(role, 'VIEWER')
  if (!permitted) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'You do not have access to this whiteboard.',
    }
  }

  return whiteboard
}

async function createWhiteboardHandler(
  userId: string,
  data: { name: string; projectId: string; folderId?: string },
) {
  // Whiteboard creation requires EDITOR or above on the project.
  const role = await findEffectiveRole(userId, data.projectId)
  const permitted = hasMinimumRole(role, 'EDITOR')
  if (!permitted) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Only EDITOR or above can create whiteboards.',
    }
  }

  const whiteboard = await createWhiteboard(data)
  return whiteboard
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeded fixtures (real rows)
// ─────────────────────────────────────────────────────────────────────────────

let USER_ID = ''
let PROJECT_ID = ''
let WHITEBOARD_ID = ''

/** Count whiteboard rows in a project (read-back assertion helper). */
function whiteboardCount(projectId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM "Whiteboard" WHERE "projectId" = ?')
    .get(projectId)
  return Number(row?.c ?? 0)
}

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
  USER_ID = makeUser({ username: 'owner', email: 'owner@example.com' }).id
  PROJECT_ID = makeProject({ name: 'Test Project', ownerId: USER_ID }).id
  WHITEBOARD_ID = makeWhiteboard({
    projectId: PROJECT_ID,
    name: 'Test Whiteboard',
  }).id
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-04: Whiteboard read requires VIEWER or above
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-04: getWhiteboard permission check (VIEWER or above)', () => {
  it('returns 403 when user has no role on the project', async () => {
    mockedFindEffectiveRole.mockResolvedValue(null)

    const result = await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    expect((result as any).error).toBe('FORBIDDEN')
    expect((result as any).status).toBe(403)
  })

  it('returns the real whiteboard for VIEWER role', async () => {
    mockedFindEffectiveRole.mockResolvedValue('VIEWER')

    const result = await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    expect((result as any).id).toBe(WHITEBOARD_ID)
    expect((result as any).projectId).toBe(PROJECT_ID)
  })

  it('returns the whiteboard for EDITOR role', async () => {
    mockedFindEffectiveRole.mockResolvedValue('EDITOR')

    const result = await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    expect((result as any).id).toBe(WHITEBOARD_ID)
  })

  it('returns the whiteboard for OWNER role', async () => {
    mockedFindEffectiveRole.mockResolvedValue('OWNER')

    const result = await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    expect((result as any).id).toBe(WHITEBOARD_ID)
  })

  it('permission is checked against the projectId from the whiteboard (inheritance)', async () => {
    mockedFindEffectiveRole.mockResolvedValue('VIEWER')

    await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    // findEffectiveRole must be called with the whiteboard's real projectId.
    expect(mockedFindEffectiveRole).toHaveBeenCalledWith(USER_ID, PROJECT_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-05: Whiteboard write requires EDITOR or above; VIEWER gets 403
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-05: createWhiteboard permission check (EDITOR or above)', () => {
  it('VIEWER role cannot create whiteboard (403); none created', async () => {
    mockedFindEffectiveRole.mockResolvedValue('VIEWER')
    const before = whiteboardCount(PROJECT_ID)

    const result = await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect((result as any).error).toBe('FORBIDDEN')
    expect((result as any).status).toBe(403)
    expect(whiteboardCount(PROJECT_ID)).toBe(before)
  })

  it('null role cannot create whiteboard; none created', async () => {
    mockedFindEffectiveRole.mockResolvedValue(null)
    const before = whiteboardCount(PROJECT_ID)

    const result = await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect((result as any).error).toBe('FORBIDDEN')
    expect(whiteboardCount(PROJECT_ID)).toBe(before)
  })

  it('EDITOR role can create whiteboard; row persisted', async () => {
    mockedFindEffectiveRole.mockResolvedValue('EDITOR')
    const before = whiteboardCount(PROJECT_ID)

    const result = await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect((result as any).name).toBe('New Board')
    expect((result as any).projectId).toBe(PROJECT_ID)
    expect(whiteboardCount(PROJECT_ID)).toBe(before + 1)
    // Read it back from the DB.
    const persisted = await findWhiteboardByIdWithDiagram((result as any).id)
    expect(persisted?.name).toBe('New Board')
  })

  it('ADMIN role can create whiteboard', async () => {
    mockedFindEffectiveRole.mockResolvedValue('ADMIN')
    const before = whiteboardCount(PROJECT_ID)

    await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect(whiteboardCount(PROJECT_ID)).toBe(before + 1)
  })

  it('OWNER role can create whiteboard', async () => {
    mockedFindEffectiveRole.mockResolvedValue('OWNER')
    const before = whiteboardCount(PROJECT_ID)

    await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect(whiteboardCount(PROJECT_ID)).toBe(before + 1)
  })
})
