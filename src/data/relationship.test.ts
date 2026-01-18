/**
 * Unit tests for Relationship data access layer
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Relationship, Column } from '@prisma/client'
import * as relationshipModule from './relationship'
import type { CreateRelationship, UpdateRelationship } from './schema'

// Mock the prisma import
vi.mock('@/db', () => ({
  prisma: {
    relationship: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    column: {
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '@/db'

const mockRelationship: Relationship = {
  id: 'rel-1',
  whiteboardId: 'wb-1',
  sourceTableId: 'table-1',
  targetTableId: 'table-2',
  sourceColumnId: 'col-1',
  targetColumnId: 'col-2',
  cardinality: 'ONE_TO_MANY',
  label: null,
  relationshipType: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const mockColumn: Column = {
  id: 'col-1',
  tableId: 'table-1',
  name: 'id',
  dataType: 'uuid',
  isPrimaryKey: true,
  isForeignKey: false,
  isUnique: false,
  isNullable: false,
  description: null,
  order: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('Relationship Data Access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createRelationship', () => {
    it('should create a relationship with valid data', async () => {
      const whiteboardId = '550e8400-e29b-41d4-a716-446655440000'
      const sourceTableId = '660e8400-e29b-41d4-a716-446655440000'
      const targetTableId = '770e8400-e29b-41d4-a716-446655440000'
      const sourceColumnId = '880e8400-e29b-41d4-a716-446655440000'
      const targetColumnId = '990e8400-e29b-41d4-a716-446655440000'

      const createData: CreateRelationship = {
        whiteboardId,
        sourceTableId,
        targetTableId,
        sourceColumnId,
        targetColumnId,
        cardinality: 'ONE_TO_MANY',
      }

      // Mock column validation
      vi.mocked(prisma.column.findUnique)
        .mockResolvedValueOnce({ ...mockColumn, id: sourceColumnId, tableId: sourceTableId })
        .mockResolvedValueOnce({ ...mockColumn, id: targetColumnId, tableId: targetTableId })

      vi.mocked(prisma.relationship.create).mockResolvedValue(mockRelationship)

      const result = await relationshipModule.createRelationship(createData)

      expect(prisma.column.findUnique).toHaveBeenCalledTimes(2)
      expect(prisma.relationship.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          whiteboardId,
          sourceTableId,
          targetTableId,
        }),
      })
      expect(result).toEqual(mockRelationship)
    })

    it('should throw error if source column does not belong to source table', async () => {
      const whiteboardId = '550e8400-e29b-41d4-a716-446655440000'
      const sourceTableId = '660e8400-e29b-41d4-a716-446655440000'
      const targetTableId = '770e8400-e29b-41d4-a716-446655440000'
      const sourceColumnId = '880e8400-e29b-41d4-a716-446655440000'
      const targetColumnId = '990e8400-e29b-41d4-a716-446655440000'

      const createData: CreateRelationship = {
        whiteboardId,
        sourceTableId,
        targetTableId,
        sourceColumnId,
        targetColumnId,
        cardinality: 'ONE_TO_MANY',
      }

      // Mock source column belonging to wrong table
      vi.mocked(prisma.column.findUnique).mockResolvedValueOnce({
        ...mockColumn,
        id: sourceColumnId,
        tableId: '111e8400-e29b-41d4-a716-446655440000', // wrong table
      })

      await expect(
        relationshipModule.createRelationship(createData),
      ).rejects.toThrow('Source column does not belong to source table')
    })

    it('should throw error if target column does not belong to target table', async () => {
      const whiteboardId = '550e8400-e29b-41d4-a716-446655440000'
      const sourceTableId = '660e8400-e29b-41d4-a716-446655440000'
      const targetTableId = '770e8400-e29b-41d4-a716-446655440000'
      const sourceColumnId = '880e8400-e29b-41d4-a716-446655440000'
      const targetColumnId = '990e8400-e29b-41d4-a716-446655440000'

      const createData: CreateRelationship = {
        whiteboardId,
        sourceTableId,
        targetTableId,
        sourceColumnId,
        targetColumnId,
        cardinality: 'ONE_TO_MANY',
      }

      // Mock columns
      vi.mocked(prisma.column.findUnique)
        .mockResolvedValueOnce({ ...mockColumn, id: sourceColumnId, tableId: sourceTableId })
        .mockResolvedValueOnce({
          ...mockColumn,
          id: targetColumnId,
          tableId: '222e8400-e29b-41d4-a716-446655440000', // wrong table
        })

      await expect(
        relationshipModule.createRelationship(createData),
      ).rejects.toThrow('Target column does not belong to target table')
    })

    it('should throw error if source column not found', async () => {
      const createData: CreateRelationship = {
        whiteboardId: 'wb-1',
        sourceTableId: 'table-1',
        targetTableId: 'table-2',
        sourceColumnId: 'col-1',
        targetColumnId: 'col-2',
        cardinality: 'ONE_TO_MANY',
      }

      vi.mocked(prisma.column.findUnique).mockResolvedValueOnce(null)

      await expect(
        relationshipModule.createRelationship(createData),
      ).rejects.toThrow()
    })

    it('should throw error on database failure', async () => {
      const whiteboardId = '550e8400-e29b-41d4-a716-446655440000'
      const sourceTableId = '660e8400-e29b-41d4-a716-446655440000'
      const targetTableId = '770e8400-e29b-41d4-a716-446655440000'
      const sourceColumnId = '880e8400-e29b-41d4-a716-446655440000'
      const targetColumnId = '990e8400-e29b-41d4-a716-446655440000'

      const createData: CreateRelationship = {
        whiteboardId,
        sourceTableId,
        targetTableId,
        sourceColumnId,
        targetColumnId,
        cardinality: 'ONE_TO_MANY',
      }

      vi.mocked(prisma.column.findUnique)
        .mockResolvedValueOnce({ ...mockColumn, tableId: sourceTableId })
        .mockResolvedValueOnce({ ...mockColumn, tableId: targetTableId })

      vi.mocked(prisma.relationship.create).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        relationshipModule.createRelationship(createData),
      ).rejects.toThrow('Failed to create relationship')
    })
  })

  describe('findRelationshipsByWhiteboardId', () => {
    it('should find all relationships in a whiteboard', async () => {
      const relationships = [mockRelationship]
      vi.mocked(prisma.relationship.findMany).mockResolvedValue(relationships)

      const result =
        await relationshipModule.findRelationshipsByWhiteboardId('wb-1')

      expect(prisma.relationship.findMany).toHaveBeenCalledWith({
        where: { whiteboardId: 'wb-1' },
        orderBy: { createdAt: 'asc' },
      })
      expect(result).toEqual(relationships)
    })

    it('should return empty array if no relationships found', async () => {
      vi.mocked(prisma.relationship.findMany).mockResolvedValue([])

      const result =
        await relationshipModule.findRelationshipsByWhiteboardId('wb-1')

      expect(result).toEqual([])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.relationship.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        relationshipModule.findRelationshipsByWhiteboardId('wb-1'),
      ).rejects.toThrow('Failed to fetch relationships')
    })
  })

  describe('findRelationshipsByWhiteboardIdWithDetails', () => {
    it('should find relationships with table and column details', async () => {
      const relationshipWithDetails = {
        ...mockRelationship,
        sourceTable: { id: 'table-1', name: 'Users' },
        targetTable: { id: 'table-2', name: 'Orders' },
        sourceColumn: mockColumn,
        targetColumn: mockColumn,
      }

      vi.mocked(prisma.relationship.findMany).mockResolvedValue([
        relationshipWithDetails as any,
      ])

      const result =
        await relationshipModule.findRelationshipsByWhiteboardIdWithDetails(
          'wb-1',
        )

      expect(prisma.relationship.findMany).toHaveBeenCalledWith({
        where: { whiteboardId: 'wb-1' },
        include: {
          sourceTable: true,
          targetTable: true,
          sourceColumn: true,
          targetColumn: true,
        },
        orderBy: { createdAt: 'asc' },
      })
      expect(result).toEqual([relationshipWithDetails])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.relationship.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        relationshipModule.findRelationshipsByWhiteboardIdWithDetails('wb-1'),
      ).rejects.toThrow('Failed to fetch relationships with details')
    })
  })

  describe('findRelationshipById', () => {
    it('should find relationship by ID', async () => {
      vi.mocked(prisma.relationship.findUnique).mockResolvedValue(
        mockRelationship,
      )

      const result = await relationshipModule.findRelationshipById('rel-1')

      expect(prisma.relationship.findUnique).toHaveBeenCalledWith({
        where: { id: 'rel-1' },
      })
      expect(result).toEqual(mockRelationship)
    })

    it('should return null if relationship not found', async () => {
      vi.mocked(prisma.relationship.findUnique).mockResolvedValue(null)

      const result =
        await relationshipModule.findRelationshipById('nonexistent')

      expect(result).toBeNull()
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.relationship.findUnique).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        relationshipModule.findRelationshipById('rel-1'),
      ).rejects.toThrow('Failed to fetch relationship')
    })
  })

  describe('findRelationshipByIdWithDetails', () => {
    it('should find relationship by ID with details', async () => {
      const relationshipWithDetails = {
        ...mockRelationship,
        sourceTable: { id: 'table-1', name: 'Users' },
        targetTable: { id: 'table-2', name: 'Orders' },
        sourceColumn: mockColumn,
        targetColumn: mockColumn,
      }

      vi.mocked(prisma.relationship.findUnique).mockResolvedValue(
        relationshipWithDetails as any,
      )

      const result =
        await relationshipModule.findRelationshipByIdWithDetails('rel-1')

      expect(prisma.relationship.findUnique).toHaveBeenCalledWith({
        where: { id: 'rel-1' },
        include: {
          sourceTable: true,
          targetTable: true,
          sourceColumn: true,
          targetColumn: true,
        },
      })
      expect(result).toEqual(relationshipWithDetails)
    })

    it('should return null if not found', async () => {
      vi.mocked(prisma.relationship.findUnique).mockResolvedValue(null)

      const result =
        await relationshipModule.findRelationshipByIdWithDetails('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('findRelationshipsByTableId', () => {
    it('should find all relationships connected to a table', async () => {
      const relationships = [mockRelationship]
      vi.mocked(prisma.relationship.findMany).mockResolvedValue(relationships)

      const result =
        await relationshipModule.findRelationshipsByTableId('table-1')

      expect(prisma.relationship.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ sourceTableId: 'table-1' }, { targetTableId: 'table-1' }],
        },
        orderBy: { createdAt: 'asc' },
      })
      expect(result).toEqual(relationships)
    })

    it('should return empty array if no relationships found', async () => {
      vi.mocked(prisma.relationship.findMany).mockResolvedValue([])

      const result =
        await relationshipModule.findRelationshipsByTableId('table-1')

      expect(result).toEqual([])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.relationship.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        relationshipModule.findRelationshipsByTableId('table-1'),
      ).rejects.toThrow('Failed to fetch table relationships')
    })
  })

  describe('updateRelationship', () => {
    it('should update relationship with valid data', async () => {
      const updateData: UpdateRelationship = {
        cardinality: 'MANY_TO_MANY',
        label: 'updated label',
      }

      const updatedRelationship = {
        ...mockRelationship,
        ...updateData,
      }

      vi.mocked(prisma.relationship.update).mockResolvedValue(
        updatedRelationship,
      )

      const result = await relationshipModule.updateRelationship(
        'rel-1',
        updateData,
      )

      expect(prisma.relationship.update).toHaveBeenCalledWith({
        where: { id: 'rel-1' },
        data: updateData,
      })
      expect(result).toEqual(updatedRelationship)
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.relationship.update).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(
        relationshipModule.updateRelationship('rel-1', { label: 'test' }),
      ).rejects.toThrow('Failed to update relationship')
    })
  })

  describe('deleteRelationship', () => {
    it('should delete relationship', async () => {
      vi.mocked(prisma.relationship.delete).mockResolvedValue(mockRelationship)

      const result = await relationshipModule.deleteRelationship('rel-1')

      expect(prisma.relationship.delete).toHaveBeenCalledWith({
        where: { id: 'rel-1' },
      })
      expect(result).toEqual(mockRelationship)
    })

    it('should throw error if relationship not found', async () => {
      vi.mocked(prisma.relationship.delete).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(
        relationshipModule.deleteRelationship('nonexistent'),
      ).rejects.toThrow('Failed to delete relationship')
    })
  })
})
