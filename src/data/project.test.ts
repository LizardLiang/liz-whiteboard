// src/data/project.test.ts
// TS-09: Data layer unit tests for findProjectPageContent
// Tests query filtering logic with mocked Prisma client

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the db module before importing project functions
vi.mock('@/db', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    folder: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    whiteboard: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/db'
import { findProjectPageContent } from './project'

const mockProject = { id: 'proj-001', name: 'Test Project' }
const mockFolders = [
  { id: 'folder-001', name: 'Alpha Folder', createdAt: new Date('2026-01-01') },
  { id: 'folder-002', name: 'Beta Folder', createdAt: new Date('2026-01-02') },
]
const mockWhiteboards = [
  {
    id: 'wb-001',
    name: 'Schema Design',
    updatedAt: new Date('2026-03-30'),
    _count: { tables: 3 },
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findProjectPageContent', () => {
  describe('TC-09-07: returns null when projectId does not exist', () => {
    it('returns null for non-existent project', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(null)

      const result = await findProjectPageContent('non-existent-uuid')
      expect(result).toBeNull()
    })
  })

  describe('root view (no folderId)', () => {
    beforeEach(() => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(mockProject as any)
      vi.mocked(prisma.folder.findMany).mockResolvedValue(mockFolders as any)
      vi.mocked(prisma.whiteboard.findMany).mockResolvedValue(mockWhiteboards as any)
    })

    it('TC-09-01: queries folders with parentFolderId = null', async () => {
      await findProjectPageContent('proj-001')

      expect(prisma.folder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parentFolderId: null,
          }),
        }),
      )
    })

    it('TC-09-02: queries whiteboards with folderId = null', async () => {
      await findProjectPageContent('proj-001')

      expect(prisma.whiteboard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            folderId: null,
          }),
        }),
      )
    })

    it('TC-09-03: returns whiteboards with _count.tables', async () => {
      const whiteboardWithTables = [
        {
          id: 'wb-001',
          name: 'Schema Design',
          updatedAt: new Date('2026-03-30'),
          _count: { tables: 3 },
        },
      ]
      vi.mocked(prisma.whiteboard.findMany).mockResolvedValue(whiteboardWithTables as any)

      const result = await findProjectPageContent('proj-001')

      expect(result).not.toBeNull()
      expect(result!.whiteboards[0]._count.tables).toBe(3)
    })

    it('TC-09-04: breadcrumb is empty for root view', async () => {
      const result = await findProjectPageContent('proj-001')

      expect(result).not.toBeNull()
      expect(result!.breadcrumb).toEqual([])
    })

    it('returns project, folders and whiteboards', async () => {
      const result = await findProjectPageContent('proj-001')

      expect(result).not.toBeNull()
      expect(result!.project).toEqual(mockProject)
      expect(result!.folders).toEqual(mockFolders)
      expect(result!.whiteboards).toEqual(mockWhiteboards)
    })
  })

  describe('folder view (with folderId)', () => {
    const mockTargetFolder = {
      id: 'folder-001',
      name: 'Alpha Folder',
      projectId: 'proj-001',
      parentFolderId: null,
    }

    beforeEach(() => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(mockProject as any)
      vi.mocked(prisma.folder.findUnique).mockResolvedValue(mockTargetFolder as any)
      vi.mocked(prisma.folder.findMany).mockResolvedValue([] as any)
      vi.mocked(prisma.whiteboard.findMany).mockResolvedValue(mockWhiteboards as any)
    })

    it('TC-09-05: returns child folders and whiteboards for the folder', async () => {
      const childFolders = [
        { id: 'folder-child-001', name: 'Child Folder', createdAt: new Date() },
      ]
      vi.mocked(prisma.folder.findMany).mockResolvedValue(childFolders as any)

      const result = await findProjectPageContent('proj-001', 'folder-001')

      expect(result).not.toBeNull()
      expect(result!.folders).toEqual(childFolders)
      expect(result!.whiteboards).toEqual(mockWhiteboards)
      // Should query child folders by parentFolderId AND projectId (defense-in-depth)
      expect(prisma.folder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'proj-001',
            parentFolderId: 'folder-001',
          }),
        }),
      )
      // Should query whiteboards by folderId AND projectId (defense-in-depth)
      expect(prisma.whiteboard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'proj-001',
            folderId: 'folder-001',
          }),
        }),
      )
    })

    it('TC-09-06: breadcrumb includes project root at minimum when folder has no parent', async () => {
      const result = await findProjectPageContent('proj-001', 'folder-001')

      expect(result).not.toBeNull()
      // breadcrumb should have project entry prepended
      expect(result!.breadcrumb).toEqual([
        { id: 'proj-001', name: 'Test Project', type: 'project' },
      ])
    })

    it('TC-09-06: breadcrumb includes ancestor folders in chain', async () => {
      const childFolder = {
        id: 'folder-child',
        name: 'Child Folder',
        projectId: 'proj-001',
        parentFolderId: 'folder-parent',
      }
      // Recursive CTE returns rows in leaf→root order; implementation reverses them
      const ancestorRows = [
        { id: 'folder-parent', name: 'Parent Folder', parentFolderId: null },
      ]

      vi.mocked(prisma.folder.findUnique).mockResolvedValueOnce(childFolder as any)
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(ancestorRows as any)

      const result = await findProjectPageContent('proj-001', 'folder-child')

      expect(result).not.toBeNull()
      const breadcrumb = result!.breadcrumb
      // Project root first
      expect(breadcrumb[0]).toEqual({ id: 'proj-001', name: 'Test Project', type: 'project' })
      // Parent folder second
      expect(breadcrumb[1]).toEqual(
        expect.objectContaining({ id: 'folder-parent', name: 'Parent Folder', type: 'folder' }),
      )
    })

    it('TC-09-08: throws "Folder not found" for cross-project folder access', async () => {
      const crossProjectFolder = {
        id: 'folder-other',
        name: 'Other Project Folder',
        projectId: 'proj-other', // different project
        parentFolderId: null,
      }
      vi.mocked(prisma.folder.findUnique).mockResolvedValue(crossProjectFolder as any)

      await expect(
        findProjectPageContent('proj-001', 'folder-other'),
      ).rejects.toThrow('Folder not found')
    })

    it('TC-09-08: throws "Folder not found" when folderId does not exist', async () => {
      vi.mocked(prisma.folder.findUnique).mockResolvedValue(null)

      await expect(
        findProjectPageContent('proj-001', 'non-existent-folder'),
      ).rejects.toThrow('Folder not found')
    })
  })
})
