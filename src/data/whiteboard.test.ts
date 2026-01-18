/**
 * Unit tests for Whiteboard data access layer
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Whiteboard } from '@prisma/client'
import * as whiteboardModule from './whiteboard'
import type { CreateWhiteboard, UpdateWhiteboard } from './schema'

// Mock the prisma import
vi.mock('@/db', () => ({
  prisma: {
    whiteboard: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

// Get the mocked prisma
import { prisma } from '@/db'

const mockWhiteboard: Whiteboard = {
  id: 'wb-1',
  projectId: 'proj-1',
  folderId: null,
  name: 'Test Whiteboard',
  description: null,
  textSource: '',
  canvasState: { zoom: 1, offsetX: 0, offsetY: 0 },
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

describe('Whiteboard Data Access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createWhiteboard', () => {
    it('should create a whiteboard with valid data', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000'
      const createData: CreateWhiteboard = {
        projectId,
        name: 'New Whiteboard',
      }

      vi.mocked(prisma.whiteboard.create).mockResolvedValue(mockWhiteboard)

      const result = await whiteboardModule.createWhiteboard(createData)

      expect(prisma.whiteboard.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId,
          name: 'New Whiteboard',
        }),
      })
      expect(result).toEqual(mockWhiteboard)
    })

    it('should throw error on database failure', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000'
      const createData: CreateWhiteboard = {
        projectId,
        name: 'New Whiteboard',
      }

      vi.mocked(prisma.whiteboard.create).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(whiteboardModule.createWhiteboard(createData)).rejects.toThrow(
        'Failed to create whiteboard',
      )
    })

    it('should validate input with Zod schema', async () => {
      const invalidData = {
        projectId: '', // Empty projectId should fail validation
        name: 'Test',
      } as CreateWhiteboard

      await expect(
        whiteboardModule.createWhiteboard(invalidData),
      ).rejects.toThrow()
    })
  })

  describe('findWhiteboardsByProjectId', () => {
    it('should find all whiteboards in a project', async () => {
      const whiteboards = [mockWhiteboard]
      vi.mocked(prisma.whiteboard.findMany).mockResolvedValue(whiteboards)

      const result =
        await whiteboardModule.findWhiteboardsByProjectId('proj-1')

      expect(prisma.whiteboard.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1' },
        orderBy: { updatedAt: 'desc' },
      })
      expect(result).toEqual(whiteboards)
    })

    it('should return empty array if no whiteboards found', async () => {
      vi.mocked(prisma.whiteboard.findMany).mockResolvedValue([])

      const result =
        await whiteboardModule.findWhiteboardsByProjectId('proj-1')

      expect(result).toEqual([])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.whiteboard.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        whiteboardModule.findWhiteboardsByProjectId('proj-1'),
      ).rejects.toThrow('Failed to fetch whiteboards')
    })
  })

  describe('findWhiteboardsByFolderId', () => {
    it('should find all whiteboards in a folder', async () => {
      const whiteboards = [mockWhiteboard]
      vi.mocked(prisma.whiteboard.findMany).mockResolvedValue(whiteboards)

      const result =
        await whiteboardModule.findWhiteboardsByFolderId('folder-1')

      expect(prisma.whiteboard.findMany).toHaveBeenCalledWith({
        where: { folderId: 'folder-1' },
        orderBy: { updatedAt: 'desc' },
      })
      expect(result).toEqual(whiteboards)
    })
  })

  describe('findWhiteboardById', () => {
    it('should find whiteboard by ID', async () => {
      vi.mocked(prisma.whiteboard.findUnique).mockResolvedValue(mockWhiteboard)

      const result = await whiteboardModule.findWhiteboardById('wb-1')

      expect(prisma.whiteboard.findUnique).toHaveBeenCalledWith({
        where: { id: 'wb-1' },
      })
      expect(result).toEqual(mockWhiteboard)
    })

    it('should return null if whiteboard not found', async () => {
      vi.mocked(prisma.whiteboard.findUnique).mockResolvedValue(null)

      const result = await whiteboardModule.findWhiteboardById('nonexistent')

      expect(result).toBeNull()
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.whiteboard.findUnique).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        whiteboardModule.findWhiteboardById('wb-1'),
      ).rejects.toThrow('Failed to fetch whiteboard')
    })
  })

  describe('findWhiteboardByIdWithDiagram', () => {
    it('should find whiteboard with full diagram data', async () => {
      const mockWithDiagram = {
        ...mockWhiteboard,
        tables: [
          {
            id: 'table-1',
            name: 'Users',
            columns: [],
            outgoingRelationships: [],
            incomingRelationships: [],
          },
        ],
      }

      vi.mocked(prisma.whiteboard.findUnique).mockResolvedValue(
        mockWithDiagram as any,
      )

      const result =
        await whiteboardModule.findWhiteboardByIdWithDiagram('wb-1')

      expect(prisma.whiteboard.findUnique).toHaveBeenCalledWith({
        where: { id: 'wb-1' },
        include: {
          tables: {
            include: {
              columns: { orderBy: { order: 'asc' } },
              outgoingRelationships: true,
              incomingRelationships: true,
            },
          },
        },
      })
      expect(result).toEqual(mockWithDiagram)
    })

    it('should return null if not found', async () => {
      vi.mocked(prisma.whiteboard.findUnique).mockResolvedValue(null)

      const result =
        await whiteboardModule.findWhiteboardByIdWithDiagram('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('updateWhiteboard', () => {
    it('should update whiteboard with valid data', async () => {
      const updateData: UpdateWhiteboard = {
        name: 'Updated Name',
      }

      const updatedWhiteboard = {
        ...mockWhiteboard,
        ...updateData,
      }

      vi.mocked(prisma.whiteboard.update).mockResolvedValue(updatedWhiteboard)

      const result = await whiteboardModule.updateWhiteboard('wb-1', updateData)

      expect(prisma.whiteboard.update).toHaveBeenCalledWith({
        where: { id: 'wb-1' },
        data: expect.objectContaining({
          name: 'Updated Name',
        }),
      })
      expect(result).toEqual(updatedWhiteboard)
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.whiteboard.update).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(
        whiteboardModule.updateWhiteboard('wb-1', { name: 'Test' }),
      ).rejects.toThrow('Failed to update whiteboard')
    })
  })

  describe('updateWhiteboardCanvasState', () => {
    it('should update canvas state', async () => {
      const canvasState = { zoom: 1.5, offsetX: 100, offsetY: 200 }
      const updatedWhiteboard = {
        ...mockWhiteboard,
        canvasState,
      }

      vi.mocked(prisma.whiteboard.update).mockResolvedValue(updatedWhiteboard)

      const result = await whiteboardModule.updateWhiteboardCanvasState(
        'wb-1',
        canvasState,
      )

      expect(prisma.whiteboard.update).toHaveBeenCalledWith({
        where: { id: 'wb-1' },
        data: { canvasState },
      })
      expect(result.canvasState).toEqual(canvasState)
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.whiteboard.update).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        whiteboardModule.updateWhiteboardCanvasState('wb-1', {
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
        }),
      ).rejects.toThrow('Failed to update canvas state')
    })
  })

  describe('updateWhiteboardTextSource', () => {
    it('should update text source', async () => {
      const textSource = 'table Users { id uuid pk }'
      const updatedWhiteboard = {
        ...mockWhiteboard,
        textSource,
      }

      vi.mocked(prisma.whiteboard.update).mockResolvedValue(updatedWhiteboard)

      const result = await whiteboardModule.updateWhiteboardTextSource(
        'wb-1',
        textSource,
      )

      expect(prisma.whiteboard.update).toHaveBeenCalledWith({
        where: { id: 'wb-1' },
        data: { textSource },
      })
      expect(result.textSource).toEqual(textSource)
    })
  })

  describe('deleteWhiteboard', () => {
    it('should delete whiteboard', async () => {
      vi.mocked(prisma.whiteboard.delete).mockResolvedValue(mockWhiteboard)

      const result = await whiteboardModule.deleteWhiteboard('wb-1')

      expect(prisma.whiteboard.delete).toHaveBeenCalledWith({
        where: { id: 'wb-1' },
      })
      expect(result).toEqual(mockWhiteboard)
    })

    it('should throw error if whiteboard not found', async () => {
      vi.mocked(prisma.whiteboard.delete).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(whiteboardModule.deleteWhiteboard('nonexistent')).rejects.toThrow(
        'Failed to delete whiteboard',
      )
    })
  })

  describe('findRecentWhiteboards', () => {
    it('should find recent whiteboards with default limit', async () => {
      const whiteboards = [mockWhiteboard]
      vi.mocked(prisma.whiteboard.findMany).mockResolvedValue(whiteboards)

      const result = await whiteboardModule.findRecentWhiteboards()

      expect(prisma.whiteboard.findMany).toHaveBeenCalledWith({
        orderBy: { updatedAt: 'desc' },
        take: 10,
      })
      expect(result).toEqual(whiteboards)
    })

    it('should find recent whiteboards with custom limit', async () => {
      const whiteboards = [mockWhiteboard]
      vi.mocked(prisma.whiteboard.findMany).mockResolvedValue(whiteboards)

      await whiteboardModule.findRecentWhiteboards(5)

      expect(prisma.whiteboard.findMany).toHaveBeenCalledWith({
        orderBy: { updatedAt: 'desc' },
        take: 5,
      })
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.whiteboard.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(whiteboardModule.findRecentWhiteboards()).rejects.toThrow(
        'Failed to fetch recent whiteboards',
      )
    })
  })
})
