// src/test/fixtures.ts
// Shared test fixtures for dynamic-field-management tests

import type { Column } from '@prisma/client'

export const mockColumn: Column = {
  id: 'col-001',
  tableId: 'tbl-001',
  name: 'email',
  dataType: 'string',
  isPrimaryKey: false,
  isForeignKey: false,
  isNullable: true,
  isUnique: false,
  description: null,
  order: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

export const mockPKColumn: Column = {
  ...mockColumn,
  id: 'col-pk',
  name: 'id',
  dataType: 'uuid',
  isPrimaryKey: true,
  isNullable: false,
  isUnique: true,
  order: 0,
}

export const mockFKColumn: Column = {
  ...mockColumn,
  id: 'col-fk',
  name: 'user_id',
  dataType: 'uuid',
  isForeignKey: true,
  order: 2,
}

export const mockRelationship = {
  id: 'rel-001',
  sourceColumnId: 'col-fk',
  targetColumnId: 'col-pk',
  sourceTableId: 'tbl-001',
  targetTableId: 'tbl-002',
  sourceTableName: 'orders',
  sourceColumnName: 'user_id',
  targetTableName: 'users',
  targetColumnName: 'id',
  cardinality: 'MANY_TO_ONE' as const,
}
