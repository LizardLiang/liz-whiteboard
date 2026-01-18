/**
 * Unit tests for Folder data access layer
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Folder } from '@prisma/client'
import * as folderModule from './folder'
import type { CreateFolder, UpdateFolder } from './schema'

// Mock the prisma import
vi.mock('@/db', () => ({
  prisma: {
    folder: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { prisma } from '@/db'

const mockFolder: Folder = {
  id: 'folder-1',
  projectId: 'proj-1',
  parentFolderId: null,
  name: 'Test Folder',
  description: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

describe('Folder Data Access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createFolder', () => {
    it('should create a folder with valid data', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000'
      const createData: CreateFolder = {
        projectId,
        name: 'New Folder',
      }

      vi.mocked(prisma.folder.create).mockResolvedValue(mockFolder)

      const result = await folderModule.createFolder(createData)

      expect(prisma.folder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId,
          name: 'New Folder',
        }),
      })
      expect(result).toEqual(mockFolder)
    })

    it('should create a nested folder', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000'
      const parentFolderId = '660e8400-e29b-41d4-a716-446655440000'
      const createData: CreateFolder = {
        projectId,
        parentFolderId,
        name: 'Nested Folder',
      }

      const nestedFolder = {
        ...mockFolder,
        parentFolderId,
        name: 'Nested Folder',
      }

      vi.mocked(prisma.folder.create).mockResolvedValue(nestedFolder)

      const result = await folderModule.createFolder(createData)

      expect(result.parentFolderId).toBe(parentFolderId)
    })

    it('should throw error on database failure', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000'
      const createData: CreateFolder = {
        projectId,
        name: 'New Folder',
      }

      vi.mocked(prisma.folder.create).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(folderModule.createFolder(createData)).rejects.toThrow(
        'Failed to create folder',
      )
    })

    it('should validate input with Zod schema', async () => {
      const invalidData = {
        projectId: '',
        name: '',
      } as CreateFolder

      await expect(folderModule.createFolder(invalidData)).rejects.toThrow()
    })
  })

  describe('findFoldersByProjectId', () => {
    it('should find all folders in a project', async () => {
      const folders = [mockFolder]
      vi.mocked(prisma.folder.findMany).mockResolvedValue(folders)

      const result = await folderModule.findFoldersByProjectId('proj-1')

      expect(prisma.folder.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1' },
        orderBy: { createdAt: 'asc' },
      })
      expect(result).toEqual(folders)
    })

    it('should return empty array if no folders found', async () => {
      vi.mocked(prisma.folder.findMany).mockResolvedValue([])

      const result = await folderModule.findFoldersByProjectId('proj-1')

      expect(result).toEqual([])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.folder.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        folderModule.findFoldersByProjectId('proj-1'),
      ).rejects.toThrow('Failed to fetch folders')
    })
  })

  describe('findChildFolders', () => {
    it('should find child folders of a parent folder', async () => {
      const childFolders = [
        { ...mockFolder, id: 'child-1', parentFolderId: 'parent-1' },
        { ...mockFolder, id: 'child-2', parentFolderId: 'parent-1' },
      ]

      vi.mocked(prisma.folder.findMany).mockResolvedValue(childFolders)

      const result = await folderModule.findChildFolders('parent-1')

      expect(prisma.folder.findMany).toHaveBeenCalledWith({
        where: { parentFolderId: 'parent-1' },
        orderBy: { name: 'asc' },
      })
      expect(result).toEqual(childFolders)
    })

    it('should return empty array if no child folders', async () => {
      vi.mocked(prisma.folder.findMany).mockResolvedValue([])

      const result = await folderModule.findChildFolders('parent-1')

      expect(result).toEqual([])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.folder.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(folderModule.findChildFolders('parent-1')).rejects.toThrow(
        'Failed to fetch child folders',
      )
    })
  })

  describe('findFolderByIdWithWhiteboards', () => {
    it('should find folder with its whiteboards', async () => {
      const folderWithWhiteboards = {
        ...mockFolder,
        whiteboards: [
          {
            id: 'wb-1',
            name: 'Whiteboard 1',
            updatedAt: new Date('2024-01-02'),
          },
          {
            id: 'wb-2',
            name: 'Whiteboard 2',
            updatedAt: new Date('2024-01-01'),
          },
        ],
      }

      vi.mocked(prisma.folder.findUnique).mockResolvedValue(
        folderWithWhiteboards as any,
      )

      const result = await folderModule.findFolderByIdWithWhiteboards('folder-1')

      expect(prisma.folder.findUnique).toHaveBeenCalledWith({
        where: { id: 'folder-1' },
        include: {
          whiteboards: {
            select: { id: true, name: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
          },
        },
      })
      expect(result).toEqual(folderWithWhiteboards)
    })

    it('should return null if folder not found', async () => {
      vi.mocked(prisma.folder.findUnique).mockResolvedValue(null)

      const result =
        await folderModule.findFolderByIdWithWhiteboards('nonexistent')

      expect(result).toBeNull()
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.folder.findUnique).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        folderModule.findFolderByIdWithWhiteboards('folder-1'),
      ).rejects.toThrow('Failed to fetch folder')
    })
  })

  describe('findFolderById', () => {
    it('should find folder by ID', async () => {
      vi.mocked(prisma.folder.findUnique).mockResolvedValue(mockFolder)

      const result = await folderModule.findFolderById('folder-1')

      expect(prisma.folder.findUnique).toHaveBeenCalledWith({
        where: { id: 'folder-1' },
      })
      expect(result).toEqual(mockFolder)
    })

    it('should return null if folder not found', async () => {
      vi.mocked(prisma.folder.findUnique).mockResolvedValue(null)

      const result = await folderModule.findFolderById('nonexistent')

      expect(result).toBeNull()
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.folder.findUnique).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(folderModule.findFolderById('folder-1')).rejects.toThrow(
        'Failed to fetch folder',
      )
    })
  })

  describe('updateFolder', () => {
    it('should update folder with valid data', async () => {
      const updateData: UpdateFolder = {
        name: 'Updated Folder Name',
      }

      const updatedFolder = {
        ...mockFolder,
        ...updateData,
      }

      vi.mocked(prisma.folder.update).mockResolvedValue(updatedFolder)

      const result = await folderModule.updateFolder('folder-1', updateData)

      expect(prisma.folder.update).toHaveBeenCalledWith({
        where: { id: 'folder-1' },
        data: expect.objectContaining({
          name: 'Updated Folder Name',
        }),
      })
      expect(result).toEqual(updatedFolder)
    })

    it('should update parent folder', async () => {
      const newParentId = '550e8400-e29b-41d4-a716-446655440000'
      const updateData: UpdateFolder = {
        parentFolderId: newParentId,
      }

      const updatedFolder = {
        ...mockFolder,
        parentFolderId: newParentId,
      }

      vi.mocked(prisma.folder.update).mockResolvedValue(updatedFolder)

      const result = await folderModule.updateFolder('folder-1', updateData)

      expect(result.parentFolderId).toBe(newParentId)
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.folder.update).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(
        folderModule.updateFolder('folder-1', { name: 'Test' }),
      ).rejects.toThrow('Failed to update folder')
    })
  })

  describe('deleteFolder', () => {
    it('should delete folder', async () => {
      vi.mocked(prisma.folder.delete).mockResolvedValue(mockFolder)

      const result = await folderModule.deleteFolder('folder-1')

      expect(prisma.folder.delete).toHaveBeenCalledWith({
        where: { id: 'folder-1' },
      })
      expect(result).toEqual(mockFolder)
    })

    it('should throw error if folder not found', async () => {
      vi.mocked(prisma.folder.delete).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(folderModule.deleteFolder('nonexistent')).rejects.toThrow(
        'Failed to delete folder',
      )
    })
  })
})
