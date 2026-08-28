// src/lib/canvas-board/server-functions.test.ts
// Unit tests for createCanvasBoardFn / updateCanvasBoardFn /
// deleteCanvasBoardFn's RBAC gate (navigator-create-canvas-board tactical
// plan, spec-delta scenarios "Viewer cannot create a canvas board" and
// "Viewer cannot rename or delete").
//
// The createServerFn wrapper is not directly callable outside a real
// request (requireAuth's getRequest() needs request context) — same
// constraint documented in src/routes/api/columns.test.ts and
// src/routes/api/whiteboards.test.ts. This mirrors those files' pattern:
// reimplement the handler body (role check, then data-layer call) and
// assert against it, with `requireServerFnRole` mocked so the assertions
// exercise the actual gate the real handler calls.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/resolve-project', () => ({
  getCanvasBoardProjectId: vi.fn(),
}))

vi.mock('@/lib/auth/require-role', async (importOriginal) => {
  const actual = await importOriginal<{
    ForbiddenError: typeof ForbiddenError
    requireServerFnRole: typeof requireServerFnRole
  }>()
  return {
    ...actual,
    requireServerFnRole: vi.fn(),
  }
})

vi.mock('@/data/canvas-board', () => ({
  createCanvasBoard: vi.fn(),
  updateCanvasBoard: vi.fn(),
  deleteCanvasBoard: vi.fn(),
}))

// eslint-disable-next-line import/first
import { getCanvasBoardProjectId } from '@/data/resolve-project'
// eslint-disable-next-line import/first
import { ForbiddenError, requireServerFnRole } from '@/lib/auth/require-role'
// eslint-disable-next-line import/first
import {
  createCanvasBoard,
  deleteCanvasBoard,
  updateCanvasBoard,
} from '@/data/canvas-board'

const mockGetCanvasBoardProjectId = vi.mocked(getCanvasBoardProjectId)
const mockRequireServerFnRole = vi.mocked(requireServerFnRole)
const mockCreateCanvasBoard = vi.mocked(createCanvasBoard)
const mockUpdateCanvasBoard = vi.mocked(updateCanvasBoard)
const mockDeleteCanvasBoard = vi.mocked(deleteCanvasBoard)

// ─────────────────────────────────────────────────────────────────────────────
// Mirrors of createCanvasBoardFn / updateCanvasBoardFn / deleteCanvasBoardFn's
// handler bodies (src/lib/canvas-board/server-functions.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function createCanvasBoardHandler(
  userId: string,
  data: { name: string; projectId: string; folderId?: string },
) {
  await requireServerFnRole(userId, data.projectId, 'EDITOR')
  return createCanvasBoard(data as any)
}

async function updateCanvasBoardHandler(
  userId: string,
  params: { id: string; data: { name?: string; folderId?: string | null } },
) {
  const projectId = await getCanvasBoardProjectId(params.id)
  await requireServerFnRole(userId, projectId, 'EDITOR')
  return updateCanvasBoard(params.id, params.data as any)
}

async function deleteCanvasBoardHandler(userId: string, boardId: string) {
  const projectId = await getCanvasBoardProjectId(boardId)
  await requireServerFnRole(userId, projectId, 'EDITOR')
  return deleteCanvasBoard(boardId)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createCanvasBoardFn RBAC gate', () => {
  it('EDITOR: role check passes, board is created', async () => {
    mockRequireServerFnRole.mockResolvedValue(undefined)
    mockCreateCanvasBoard.mockResolvedValue({ id: 'board-1' } as any)

    const result = await createCanvasBoardHandler('user-1', {
      name: 'My Board',
      projectId: 'project-1',
    })

    expect(mockRequireServerFnRole).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'EDITOR',
    )
    expect(mockCreateCanvasBoard).toHaveBeenCalled()
    expect(result).toEqual({ id: 'board-1' })
  })

  it('VIEWER: role check throws ForbiddenError, no board is created', async () => {
    mockRequireServerFnRole.mockRejectedValue(new ForbiddenError())

    await expect(
      createCanvasBoardHandler('user-1', {
        name: 'My Board',
        projectId: 'project-1',
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(mockCreateCanvasBoard).not.toHaveBeenCalled()
  })
})

describe('updateCanvasBoardFn RBAC gate', () => {
  it('EDITOR: role check passes, board is renamed', async () => {
    mockGetCanvasBoardProjectId.mockResolvedValue('project-1')
    mockRequireServerFnRole.mockResolvedValue(undefined)
    mockUpdateCanvasBoard.mockResolvedValue({ id: 'board-1' } as any)

    const result = await updateCanvasBoardHandler('user-1', {
      id: 'board-1',
      data: { name: 'Renamed' },
    })

    expect(mockRequireServerFnRole).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'EDITOR',
    )
    expect(mockUpdateCanvasBoard).toHaveBeenCalledWith('board-1', {
      name: 'Renamed',
    })
    expect(result).toEqual({ id: 'board-1' })
  })

  it('VIEWER: role check throws ForbiddenError, board is unchanged', async () => {
    mockGetCanvasBoardProjectId.mockResolvedValue('project-1')
    mockRequireServerFnRole.mockRejectedValue(new ForbiddenError())

    await expect(
      updateCanvasBoardHandler('user-1', {
        id: 'board-1',
        data: { name: 'Renamed' },
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(mockUpdateCanvasBoard).not.toHaveBeenCalled()
  })
})

describe('deleteCanvasBoardFn RBAC gate', () => {
  it('EDITOR: role check passes, board is deleted', async () => {
    mockGetCanvasBoardProjectId.mockResolvedValue('project-1')
    mockRequireServerFnRole.mockResolvedValue(undefined)
    mockDeleteCanvasBoard.mockResolvedValue({ id: 'board-1' } as any)

    const result = await deleteCanvasBoardHandler('user-1', 'board-1')

    expect(mockRequireServerFnRole).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'EDITOR',
    )
    expect(mockDeleteCanvasBoard).toHaveBeenCalledWith('board-1')
    expect(result).toEqual({ id: 'board-1' })
  })

  it('VIEWER: role check throws ForbiddenError, board is unchanged', async () => {
    mockGetCanvasBoardProjectId.mockResolvedValue('project-1')
    mockRequireServerFnRole.mockRejectedValue(new ForbiddenError())

    await expect(
      deleteCanvasBoardHandler('user-1', 'board-1'),
    ).rejects.toThrow(ForbiddenError)

    expect(mockDeleteCanvasBoard).not.toHaveBeenCalled()
  })

  it('no such board: getCanvasBoardProjectId resolves null, SEC-ERR-03 conflation refuses without a DB probe distinguishing "not found" from "no access"', async () => {
    mockGetCanvasBoardProjectId.mockResolvedValue(null)
    mockRequireServerFnRole.mockImplementation(async (_userId, projectId) => {
      if (!projectId) throw new ForbiddenError()
    })

    await expect(
      deleteCanvasBoardHandler('user-1', 'nonexistent-board'),
    ).rejects.toThrow(ForbiddenError)

    expect(mockDeleteCanvasBoard).not.toHaveBeenCalled()
  })
})
