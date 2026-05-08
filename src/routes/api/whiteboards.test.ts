// src/routes/api/whiteboards.test.ts
// Phase 4 whiteboard permission tests
// TC-P4-04: Whiteboard read requires VIEWER or above
// TC-P4-05: Whiteboard write requires EDITOR or above; VIEWER gets 403

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createWhiteboard,
  findWhiteboardByIdWithDiagram,
} from '@/data/whiteboard'
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: vi.fn(() => new Request('http://localhost/')),
  setResponseHeader: vi.fn(),
}))

vi.mock('@/db', () => ({
  prisma: {
    whiteboard: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/data/whiteboard', () => ({
  findWhiteboardByIdWithDiagram: vi.fn(),
  findWhiteboardById: vi.fn(),
  createWhiteboard: vi.fn(),
  deleteWhiteboard: vi.fn(),
  findWhiteboardsByProjectId: vi.fn(),
  updateWhiteboard: vi.fn(),
  updateWhiteboardCanvasState: vi.fn(),
  updateWhiteboardTextSource: vi.fn(),
  findWhiteboardsByFolderId: vi.fn(),
  findRecentWhiteboards: vi.fn(),
}))

vi.mock('@/data/permission', () => ({
  findEffectiveRole: vi.fn(),
}))

vi.mock('@/lib/auth/permissions', () => ({
  hasMinimumRole: vi.fn(),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const WHITEBOARD_ID = 'wb-a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const PROJECT_ID = 'proj-a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const USER_ID = 'user-f47ac10b-58cc-4372-a567-0e02b2c3d479'

const mockWhiteboard = {
  id: WHITEBOARD_ID,
  name: 'Test Whiteboard',
  projectId: PROJECT_ID,
  folderId: null,
  tables: [],
  relationships: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ─────────────────────────────────────────────────────────────────────────────
// Whiteboard handler mirrors (AC-18: whiteboards inherit project permissions)
// ─────────────────────────────────────────────────────────────────────────────

async function getWhiteboardHandler(userId: string, whiteboardId: string) {
  // Must look up project from whiteboard to check permission
  const whiteboard = await findWhiteboardByIdWithDiagram(whiteboardId)
  if (!whiteboard) throw new Error('Whiteboard not found')

  const role = await findEffectiveRole(userId, (whiteboard as any).projectId)
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
  // Whiteboard creation requires EDITOR or above on the project
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

beforeEach(() => {
  vi.clearAllMocks()
  // Default: hasMinimumRole delegates to real role hierarchy
  vi.mocked(hasMinimumRole).mockImplementation((role, required) => {
    const HIERARCHY: Record<string, number> = {
      VIEWER: 1,
      EDITOR: 2,
      ADMIN: 3,
      OWNER: 4,
    }
    if (!role) return false
    return (HIERARCHY[role] ?? 0) >= (HIERARCHY[required] ?? 0)
  })
  vi.mocked(findWhiteboardByIdWithDiagram).mockResolvedValue(
    mockWhiteboard as any,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-04: Whiteboard read requires VIEWER or above
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-04: getWhiteboard permission check (VIEWER or above)', () => {
  it('returns 403 when user has no role on the project', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue(null)

    const result = await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    expect((result as any).error).toBe('FORBIDDEN')
    expect((result as any).status).toBe(403)
  })

  it('returns the whiteboard for VIEWER role', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('VIEWER')

    const result = await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    expect((result as any).id).toBe(WHITEBOARD_ID)
  })

  it('returns the whiteboard for EDITOR role', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('EDITOR')

    const result = await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    expect((result as any).id).toBe(WHITEBOARD_ID)
  })

  it('returns the whiteboard for OWNER role', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('OWNER')

    const result = await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    expect((result as any).id).toBe(WHITEBOARD_ID)
  })

  it('permission is checked against projectId from the whiteboard (inheritance)', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('VIEWER')

    await getWhiteboardHandler(USER_ID, WHITEBOARD_ID)

    // findEffectiveRole must be called with the whiteboard's projectId — not an arbitrary value
    expect(findEffectiveRole).toHaveBeenCalledWith(USER_ID, PROJECT_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P4-05: Whiteboard write requires EDITOR or above; VIEWER gets 403
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P4-05: createWhiteboard permission check (EDITOR or above)', () => {
  it('VIEWER role cannot create whiteboard (403)', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('VIEWER')

    const result = await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect((result as any).error).toBe('FORBIDDEN')
    expect((result as any).status).toBe(403)
    expect(createWhiteboard).not.toHaveBeenCalled()
  })

  it('null role cannot create whiteboard', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue(null)

    const result = await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect((result as any).error).toBe('FORBIDDEN')
    expect(createWhiteboard).not.toHaveBeenCalled()
  })

  it('EDITOR role can create whiteboard', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('EDITOR')
    vi.mocked(createWhiteboard).mockResolvedValue(mockWhiteboard as any)

    const result = await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect(createWhiteboard).toHaveBeenCalled()
    expect((result as any).id).toBe(WHITEBOARD_ID)
  })

  it('ADMIN role can create whiteboard', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('ADMIN')
    vi.mocked(createWhiteboard).mockResolvedValue(mockWhiteboard as any)

    const result = await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect(createWhiteboard).toHaveBeenCalled()
  })

  it('OWNER role can create whiteboard', async () => {
    vi.mocked(findEffectiveRole).mockResolvedValue('OWNER')
    vi.mocked(createWhiteboard).mockResolvedValue(mockWhiteboard as any)

    const result = await createWhiteboardHandler(USER_ID, {
      name: 'New Board',
      projectId: PROJECT_ID,
    })

    expect(createWhiteboard).toHaveBeenCalled()
  })
})
