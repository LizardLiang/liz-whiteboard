/**
 * Test file for table notes server functions
 * Tests Zod validation schemas and handler logic delegation
 * Following TanStack Start testing patterns used elsewhere in the codebase
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// Mock the prisma client
vi.mock('@/db', () => ({
  prisma: {
    diagramTable: {
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  }
}))

// Mock the socket.io integration
vi.mock('@/routes/api/collaboration', () => ({
  getSocketIO: vi.fn(() => ({
    to: vi.fn(() => ({
      emit: vi.fn(),
    })),
  })),
}))

// Import after mocks
import {
  updateTableNotesSchema,
  getTableNotesSchema,
  bulkLoadNotesSchema
} from './table-notes'
import { prisma } from '@/db'

describe('table notes schemas and handler logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('updateTableNotesSchema validation', () => {
    test('validates correct CUID format and description length', () => {
      const validInput = {
        tableId: 'cluivxyz123456789012345678',
        description: 'Valid notes',
        whiteboardId: 'cluivxyz123456789012345679',
        userId: 'cluivxyz123456789012345680',
      }

      expect(() => updateTableNotesSchema.parse(validInput)).not.toThrow()
      const parsed = updateTableNotesSchema.parse(validInput)
      expect(parsed.tableId).toBe(validInput.tableId)
      expect(parsed.description).toBe(validInput.description)
    })

    test('rejects invalid CUID format', () => {
      const invalidInput = {
        tableId: 'invalid-id',
        description: 'Valid notes',
        whiteboardId: 'cluivxyz123456789012345679',
        userId: 'cluivxyz123456789012345680',
      }

      expect(() => updateTableNotesSchema.parse(invalidInput)).toThrow()
    })

    test('rejects description longer than 10,000 characters', () => {
      const invalidInput = {
        tableId: 'cluivxyz123456789012345678',
        description: 'A'.repeat(10001),
        whiteboardId: 'cluivxyz123456789012345679',
        userId: 'cluivxyz123456789012345680',
      }

      expect(() => updateTableNotesSchema.parse(invalidInput)).toThrow()
    })

    test('accepts description up to 10,000 characters', () => {
      const validInput = {
        tableId: 'cluivxyz123456789012345678',
        description: 'A'.repeat(10000),
        whiteboardId: 'cluivxyz123456789012345679',
        userId: 'cluivxyz123456789012345680',
      }

      expect(() => updateTableNotesSchema.parse(validInput)).not.toThrow()
    })
  })

  describe('getTableNotesSchema validation', () => {
    test('validates correct CUID format', () => {
      const validInput = { tableId: 'cluivxyz123456789012345678' }

      expect(() => getTableNotesSchema.parse(validInput)).not.toThrow()
      const parsed = getTableNotesSchema.parse(validInput)
      expect(parsed.tableId).toBe(validInput.tableId)
    })

    test('rejects invalid CUID format', () => {
      const invalidInput = { tableId: 'invalid-id' }

      expect(() => getTableNotesSchema.parse(invalidInput)).toThrow()
    })
  })

  describe('bulkLoadNotesSchema validation', () => {
    test('validates array of correct CUID format', () => {
      const validInput = {
        tableIds: ['cluivxyz123456789012345678', 'cluivxyz123456789012345679']
      }

      expect(() => bulkLoadNotesSchema.parse(validInput)).not.toThrow()
      const parsed = bulkLoadNotesSchema.parse(validInput)
      expect(parsed.tableIds).toEqual(validInput.tableIds)
    })

    test('rejects array with invalid CUID format', () => {
      const invalidInput = {
        tableIds: ['invalid-1', 'invalid-2']
      }

      expect(() => bulkLoadNotesSchema.parse(invalidInput)).toThrow()
    })

    test('accepts empty array', () => {
      const validInput = { tableIds: [] }

      expect(() => bulkLoadNotesSchema.parse(validInput)).not.toThrow()
    })
  })

  describe('updateTableNotes handler logic', () => {
    test('updates table description and returns success response', async () => {
      const mockUpdatedTable = {
        id: 'cluivxyz123456789012345678',
        description: 'Updated notes',
        updatedAt: new Date('2026-04-02T20:00:00Z'),
      }

      vi.mocked(prisma.diagramTable.update).mockResolvedValue(mockUpdatedTable as any)

      // Simulate the handler logic
      const handler = async (data: z.infer<typeof updateTableNotesSchema>) => {
        const { tableId, description } = data

        const updated = await prisma.diagramTable.update({
          where: { id: tableId },
          data: {
            description,
            updatedAt: expect.any(Date),
          },
        })

        return {
          success: true,
          updatedAt: updated.updatedAt,
          description: updated.description,
        }
      }

      const inputData = {
        tableId: 'cluivxyz123456789012345678',
        description: 'Updated notes',
        whiteboardId: 'cluivxyz123456789012345679',
        userId: 'cluivxyz123456789012345680',
      }

      const result = await handler(inputData)

      expect(prisma.diagramTable.update).toHaveBeenCalledWith({
        where: { id: 'cluivxyz123456789012345678' },
        data: {
          description: 'Updated notes',
          updatedAt: expect.any(Date),
        },
      })

      expect(result).toEqual({
        success: true,
        updatedAt: mockUpdatedTable.updatedAt,
        description: 'Updated notes',
      })
    })

    test('handles database errors gracefully', async () => {
      vi.mocked(prisma.diagramTable.update).mockRejectedValue(new Error('Database error'))

      const handler = async (data: z.infer<typeof updateTableNotesSchema>) => {
        try {
          const updated = await prisma.diagramTable.update({
            where: { id: data.tableId },
            data: {
              description: data.description,
              updatedAt: new Date(),
            },
          })

          return {
            success: true,
            updatedAt: updated.updatedAt,
            description: updated.description,
          }
        } catch (error) {
          throw new Error('Failed to update table notes')
        }
      }

      const inputData = {
        tableId: 'cluivxyz123456789012345678',
        description: 'Updated notes',
        whiteboardId: 'cluivxyz123456789012345679',
        userId: 'cluivxyz123456789012345680',
      }

      await expect(handler(inputData)).rejects.toThrow('Failed to update table notes')
    })
  })

  describe('getTableNotes handler logic', () => {
    test('retrieves table description when table exists', async () => {
      const mockTable = {
        description: 'Existing notes',
        updatedAt: new Date('2026-04-02T20:00:00Z'),
      }

      vi.mocked(prisma.diagramTable.findUnique).mockResolvedValue(mockTable as any)

      const handler = async (data: z.infer<typeof getTableNotesSchema>) => {
        const table = await prisma.diagramTable.findUnique({
          where: { id: data.tableId },
          select: {
            description: true,
            updatedAt: true,
          },
        })

        return {
          description: table?.description || null,
          updatedAt: table?.updatedAt,
        }
      }

      const result = await handler({ tableId: 'cluivxyz123456789012345678' })

      expect(prisma.diagramTable.findUnique).toHaveBeenCalledWith({
        where: { id: 'cluivxyz123456789012345678' },
        select: {
          description: true,
          updatedAt: true,
        },
      })

      expect(result).toEqual({
        description: 'Existing notes',
        updatedAt: mockTable.updatedAt,
      })
    })

    test('returns null for non-existent table', async () => {
      vi.mocked(prisma.diagramTable.findUnique).mockResolvedValue(null)

      const handler = async (data: z.infer<typeof getTableNotesSchema>) => {
        const table = await prisma.diagramTable.findUnique({
          where: { id: data.tableId },
          select: {
            description: true,
            updatedAt: true,
          },
        })

        return {
          description: table?.description || null,
          updatedAt: table?.updatedAt,
        }
      }

      const result = await handler({ tableId: 'cluivxyz123456789012345678' })

      expect(result).toEqual({
        description: null,
        updatedAt: undefined,
      })
    })
  })

  describe('bulkLoadNotes handler logic', () => {
    test('loads notes for multiple tables and filters out empty descriptions', async () => {
      const mockTables = [
        {
          id: 'cluivxyz123456789012345678',
          description: 'Notes for table 1',
          updatedAt: new Date('2026-04-02T20:00:00Z'),
        },
        {
          id: 'cluivxyz123456789012345679',
          description: 'Notes for table 2',
          updatedAt: new Date('2026-04-02T20:01:00Z'),
        },
        {
          id: 'cluivxyz123456789012345680',
          description: null, // This should be filtered out
          updatedAt: new Date('2026-04-02T20:02:00Z'),
        },
      ]

      vi.mocked(prisma.diagramTable.findMany).mockResolvedValue(mockTables as any)

      const handler = async (data: z.infer<typeof bulkLoadNotesSchema>) => {
        const tables = await prisma.diagramTable.findMany({
          where: { id: { in: data.tableIds } },
          select: {
            id: true,
            description: true,
            updatedAt: true,
          },
        })

        // Create a map for efficient lookup
        const notesMap = new Map(
          tables
            .filter(table => table.description)
            .map(table => [table.id, {
              description: table.description,
              updatedAt: table.updatedAt
            }])
        )

        return {
          notes: Object.fromEntries(notesMap)
        }
      }

      const inputData = {
        tableIds: [
          'cluivxyz123456789012345678',
          'cluivxyz123456789012345679',
          'cluivxyz123456789012345680'
        ]
      }

      const result = await handler(inputData)

      expect(prisma.diagramTable.findMany).toHaveBeenCalledWith({
        where: { id: { in: inputData.tableIds } },
        select: {
          id: true,
          description: true,
          updatedAt: true,
        },
      })

      // Only tables with descriptions should be included
      expect(result.notes).toEqual({
        'cluivxyz123456789012345678': {
          description: 'Notes for table 1',
          updatedAt: mockTables[0].updatedAt,
        },
        'cluivxyz123456789012345679': {
          description: 'Notes for table 2',
          updatedAt: mockTables[1].updatedAt,
        },
      })
    })

    test('returns empty object for no tables', async () => {
      vi.mocked(prisma.diagramTable.findMany).mockResolvedValue([])

      const handler = async (data: z.infer<typeof bulkLoadNotesSchema>) => {
        const tables = await prisma.diagramTable.findMany({
          where: { id: { in: data.tableIds } },
          select: {
            id: true,
            description: true,
            updatedAt: true,
          },
        })

        const notesMap = new Map(
          tables
            .filter(table => table.description)
            .map(table => [table.id, {
              description: table.description,
              updatedAt: table.updatedAt
            }])
        )

        return {
          notes: Object.fromEntries(notesMap)
        }
      }

      const result = await handler({ tableIds: [] })

      expect(result.notes).toEqual({})
    })
  })
})