/**
 * Unit tests for Column data access layer
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Column } from '@prisma/client'
import * as columnModule from './column'
import type { CreateColumn, UpdateColumn } from './schema'

// Mock the prisma import
vi.mock('@/db', () => ({
  prisma: {
    column: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/db'

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
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

describe('Column Data Access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createColumn', () => {
    it('should create a column with valid data', async () => {
      const createData: CreateColumn = {
        tableId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'email',
        dataType: 'string',
        order: 1,
      }

      vi.mocked(prisma.column.create).mockResolvedValue(mockColumn)

      const result = await columnModule.createColumn(createData)

      expect(prisma.column.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tableId: '550e8400-e29b-41d4-a716-446655440000',
          name: 'email',
          dataType: 'string',
        }),
      })
      expect(result).toEqual(mockColumn)
    })

    it('should throw error on database failure', async () => {
      const createData: CreateColumn = {
        tableId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'email',
        dataType: 'string',
        order: 1,
      }

      vi.mocked(prisma.column.create).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(columnModule.createColumn(createData)).rejects.toThrow(
        'Failed to create column',
      )
    })

    it('should validate input with Zod schema', async () => {
      const invalidData = {
        tableId: '',
        name: '',
        dataType: 'invalid-type',
      } as CreateColumn

      await expect(columnModule.createColumn(invalidData)).rejects.toThrow()
    })
  })

  describe('createColumns', () => {
    it('should create multiple columns in a transaction', async () => {
      const tableId = '550e8400-e29b-41d4-a716-446655440000'
      const columns: CreateColumn[] = [
        { tableId, name: 'id', dataType: 'uuid', order: 0 },
        { tableId, name: 'email', dataType: 'string', order: 1 },
      ]

      const createdColumns = [
        { ...mockColumn, id: 'col-1', name: 'id' },
        { ...mockColumn, id: 'col-2', name: 'email' },
      ]

      vi.mocked(prisma.$transaction).mockResolvedValue(createdColumns as any)

      const result = await columnModule.createColumns(columns)

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(Promise),
        ]),
      )
      expect(result).toEqual(createdColumns)
    })

    it('should throw error if transaction fails', async () => {
      const tableId = '550e8400-e29b-41d4-a716-446655440000'
      const columns: CreateColumn[] = [
        { tableId, name: 'id', dataType: 'uuid', order: 0 },
      ]

      vi.mocked(prisma.$transaction).mockRejectedValue(
        new Error('Transaction failed'),
      )

      await expect(columnModule.createColumns(columns)).rejects.toThrow(
        'Failed to create columns',
      )
    })

    it('should validate all inputs', async () => {
      const columns = [
        { tableId: '', name: '', dataType: 'invalid' },
      ] as CreateColumn[]

      await expect(columnModule.createColumns(columns)).rejects.toThrow()
    })
  })

  describe('findColumnsByTableId', () => {
    it('should find all columns in a table ordered by order field', async () => {
      const columns = [
        { ...mockColumn, id: 'col-1', order: 0 },
        { ...mockColumn, id: 'col-2', order: 1 },
      ]

      vi.mocked(prisma.column.findMany).mockResolvedValue(columns)

      const result = await columnModule.findColumnsByTableId('table-1')

      expect(prisma.column.findMany).toHaveBeenCalledWith({
        where: { tableId: 'table-1' },
        orderBy: { order: 'asc' },
      })
      expect(result).toEqual(columns)
    })

    it('should return empty array if no columns found', async () => {
      vi.mocked(prisma.column.findMany).mockResolvedValue([])

      const result = await columnModule.findColumnsByTableId('table-1')

      expect(result).toEqual([])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.column.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        columnModule.findColumnsByTableId('table-1'),
      ).rejects.toThrow('Failed to fetch columns')
    })
  })

  describe('findColumnById', () => {
    it('should find column by ID', async () => {
      vi.mocked(prisma.column.findUnique).mockResolvedValue(mockColumn)

      const result = await columnModule.findColumnById('col-1')

      expect(prisma.column.findUnique).toHaveBeenCalledWith({
        where: { id: 'col-1' },
      })
      expect(result).toEqual(mockColumn)
    })

    it('should return null if column not found', async () => {
      vi.mocked(prisma.column.findUnique).mockResolvedValue(null)

      const result = await columnModule.findColumnById('nonexistent')

      expect(result).toBeNull()
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.column.findUnique).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(columnModule.findColumnById('col-1')).rejects.toThrow(
        'Failed to fetch column',
      )
    })
  })

  describe('updateColumn', () => {
    it('should update column with valid data', async () => {
      const updateData: UpdateColumn = {
        name: 'user_email',
      }

      const updatedColumn = {
        ...mockColumn,
        ...updateData,
      }

      vi.mocked(prisma.column.update).mockResolvedValue(updatedColumn)

      const result = await columnModule.updateColumn('col-1', updateData)

      expect(prisma.column.update).toHaveBeenCalledWith({
        where: { id: 'col-1' },
        data: expect.objectContaining({
          name: 'user_email',
        }),
      })
      expect(result).toEqual(updatedColumn)
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.column.update).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(
        columnModule.updateColumn('col-1', { name: 'new_name' }),
      ).rejects.toThrow('Failed to update column')
    })
  })

  describe('updateColumnOrder', () => {
    it('should update column order', async () => {
      const updatedColumn = {
        ...mockColumn,
        order: 5,
      }

      vi.mocked(prisma.column.update).mockResolvedValue(updatedColumn)

      const result = await columnModule.updateColumnOrder('col-1', 5)

      expect(prisma.column.update).toHaveBeenCalledWith({
        where: { id: 'col-1' },
        data: { order: 5 },
      })
      expect(result.order).toBe(5)
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.column.update).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(columnModule.updateColumnOrder('col-1', 5)).rejects.toThrow(
        'Failed to update column order',
      )
    })
  })

  describe('deleteColumn', () => {
    it('should delete column', async () => {
      vi.mocked(prisma.column.delete).mockResolvedValue(mockColumn)

      const result = await columnModule.deleteColumn('col-1')

      expect(prisma.column.delete).toHaveBeenCalledWith({
        where: { id: 'col-1' },
      })
      expect(result).toEqual(mockColumn)
    })

    it('should throw error if column not found', async () => {
      vi.mocked(prisma.column.delete).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(columnModule.deleteColumn('nonexistent')).rejects.toThrow(
        'Failed to delete column',
      )
    })
  })

  describe('findPrimaryKeyColumnsByTableId', () => {
    it('should find only primary key columns', async () => {
      const pkColumns = [
        { ...mockColumn, id: 'col-1', isPrimaryKey: true },
      ]

      vi.mocked(prisma.column.findMany).mockResolvedValue(pkColumns)

      const result =
        await columnModule.findPrimaryKeyColumnsByTableId('table-1')

      expect(prisma.column.findMany).toHaveBeenCalledWith({
        where: {
          tableId: 'table-1',
          isPrimaryKey: true,
        },
        orderBy: { order: 'asc' },
      })
      expect(result).toEqual(pkColumns)
    })

    it('should return empty array if no primary keys found', async () => {
      vi.mocked(prisma.column.findMany).mockResolvedValue([])

      const result =
        await columnModule.findPrimaryKeyColumnsByTableId('table-1')

      expect(result).toEqual([])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.column.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        columnModule.findPrimaryKeyColumnsByTableId('table-1'),
      ).rejects.toThrow('Failed to fetch primary key columns')
    })
  })

  describe('findForeignKeyColumnsByTableId', () => {
    it('should find only foreign key columns', async () => {
      const fkColumns = [
        { ...mockColumn, id: 'col-1', isForeignKey: true, isPrimaryKey: false },
      ]

      vi.mocked(prisma.column.findMany).mockResolvedValue(fkColumns)

      const result =
        await columnModule.findForeignKeyColumnsByTableId('table-1')

      expect(prisma.column.findMany).toHaveBeenCalledWith({
        where: {
          tableId: 'table-1',
          isForeignKey: true,
        },
        orderBy: { order: 'asc' },
      })
      expect(result).toEqual(fkColumns)
    })

    it('should return empty array if no foreign keys found', async () => {
      vi.mocked(prisma.column.findMany).mockResolvedValue([])

      const result =
        await columnModule.findForeignKeyColumnsByTableId('table-1')

      expect(result).toEqual([])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.column.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(
        columnModule.findForeignKeyColumnsByTableId('table-1'),
      ).rejects.toThrow('Failed to fetch foreign key columns')
    })
  })
})
