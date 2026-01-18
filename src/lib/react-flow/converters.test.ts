/**
 * Unit tests for React Flow Conversion Utilities
 */

import { describe, expect, it } from 'vitest'
import type { Cardinality, Column, DiagramTable, Relationship } from '@prisma/client'
import {
  extractTablePosition,
  convertTableToNode,
  convertTablesToNodes,
  convertToReactFlowNodes,
  extractPositionUpdates,
  createHandleId,
  parseHandleId,
  getCardinalityMarkerStart,
  getCardinalityMarkerEnd,
  convertRelationshipToEdge,
  convertRelationshipsToEdges,
  convertToReactFlowEdges,
  convertToReactFlowViewport,
  convertToCanvasViewport,
} from './converters'
import type { TableNode, CanvasViewport, ReactFlowViewport } from './types'

// Mock data helpers
const createMockTable = (overrides?: Partial<DiagramTable>): DiagramTable => ({
  id: 'table-1',
  whiteboardId: 'wb-1',
  name: 'Users',
  description: null,
  positionX: 100,
  positionY: 200,
  width: null,
  height: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const createMockColumn = (overrides?: Partial<Column>): Column => ({
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
  ...overrides,
})

const createMockRelationship = (
  overrides?: Partial<Relationship>,
): Relationship => ({
  id: 'rel-1',
  whiteboardId: 'wb-1',
  sourceTableId: 'table-1',
  targetTableId: 'table-2',
  sourceColumnId: 'col-1',
  targetColumnId: 'col-2',
  cardinality: 'ONE_TO_MANY',
  label: null,
  relationshipType: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

describe('Node Conversion', () => {
  describe('extractTablePosition', () => {
    it('should extract x and y coordinates from table', () => {
      const table = createMockTable({ positionX: 150, positionY: 250 })
      const position = extractTablePosition(table)

      expect(position).toEqual({ x: 150, y: 250 })
    })

    it('should handle zero coordinates', () => {
      const table = createMockTable({ positionX: 0, positionY: 0 })
      const position = extractTablePosition(table)

      expect(position).toEqual({ x: 0, y: 0 })
    })

    it('should handle negative coordinates', () => {
      const table = createMockTable({ positionX: -100, positionY: -200 })
      const position = extractTablePosition(table)

      expect(position).toEqual({ x: -100, y: -200 })
    })
  })

  describe('convertTableToNode', () => {
    it('should convert table with columns to React Flow node', () => {
      const columns = [
        createMockColumn({ id: 'col-1', name: 'id', isPrimaryKey: true }),
        createMockColumn({ id: 'col-2', name: 'email', isPrimaryKey: false }),
      ]
      const table = { ...createMockTable(), columns }

      const node = convertTableToNode(table)

      expect(node.id).toBe('table-1')
      expect(node.type).toBe('table')
      expect(node.position).toEqual({ x: 100, y: 200 })
      expect(node.data.table).toEqual(table)
      expect(node.data.isActiveHighlighted).toBe(false)
      expect(node.data.isHighlighted).toBe(false)
      expect(node.data.isHovered).toBe(false)
      expect(node.data.showMode).toBe('ALL_FIELDS')
    })

    it('should apply optional data overrides', () => {
      const table = { ...createMockTable(), columns: [] }
      const node = convertTableToNode(table, { showMode: 'KEY_ONLY', isHighlighted: true })

      expect(node.data.showMode).toBe('KEY_ONLY')
      expect(node.data.isHighlighted).toBe(true)
    })

    it('should include width and height if available', () => {
      const table = { ...createMockTable({ width: 300, height: 400 }), columns: [] }
      const node = convertTableToNode(table)

      expect(node.width).toBe(300)
      expect(node.height).toBe(400)
    })

    it('should set undefined for null width/height', () => {
      const table = { ...createMockTable({ width: null, height: null }), columns: [] }
      const node = convertTableToNode(table)

      expect(node.width).toBeUndefined()
      expect(node.height).toBeUndefined()
    })
  })

  describe('convertTablesToNodes', () => {
    it('should convert multiple tables to nodes', () => {
      const tables = [
        { ...createMockTable({ id: 'table-1', name: 'Users' }), columns: [] },
        { ...createMockTable({ id: 'table-2', name: 'Orders' }), columns: [] },
      ]

      const nodes = convertTablesToNodes(tables)

      expect(nodes).toHaveLength(2)
      expect(nodes[0].id).toBe('table-1')
      expect(nodes[1].id).toBe('table-2')
    })

    it('should apply showMode to all nodes', () => {
      const tables = [
        { ...createMockTable({ id: 'table-1' }), columns: [] },
        { ...createMockTable({ id: 'table-2' }), columns: [] },
      ]

      const nodes = convertTablesToNodes(tables, 'TABLE_NAME')

      expect(nodes[0].data.showMode).toBe('TABLE_NAME')
      expect(nodes[1].data.showMode).toBe('TABLE_NAME')
    })

    it('should handle empty array', () => {
      const nodes = convertTablesToNodes([])
      expect(nodes).toEqual([])
    })
  })

  describe('convertToReactFlowNodes (legacy)', () => {
    it('should convert to legacy format', () => {
      const columns = [
        createMockColumn({ id: 'col-1', name: 'col1', order: 0 }),
        createMockColumn({ id: 'col-2', name: 'col2', order: 1 }),
      ]
      const tables = [{ ...createMockTable(), columns }]

      const nodes = convertToReactFlowNodes(tables)

      expect(nodes).toHaveLength(1)
      expect(nodes[0].type).toBe('erTable')
      expect(nodes[0].data.table).toBeDefined()
      expect(nodes[0].data.columns).toHaveLength(2)
      // Columns should be sorted by order field (ascending)
      expect(nodes[0].data.columns[0].order).toBe(0)
      expect(nodes[0].data.columns[1].order).toBe(1)
      expect(nodes[0].data.columns[0].name).toBe('col1')
      expect(nodes[0].data.columns[1].name).toBe('col2')
    })
  })

  describe('extractPositionUpdates', () => {
    it('should extract position from node for database persistence', () => {
      const node: TableNode = {
        id: 'table-1',
        type: 'erTable',
        position: { x: 300, y: 400 },
        data: {
          table: createMockTable(),
          columns: [],
        },
      }

      const updates = extractPositionUpdates(node)

      expect(updates).toEqual({
        positionX: 300,
        positionY: 400,
      })
    })
  })
})

describe('Edge Conversion', () => {
  describe('createHandleId', () => {
    it('should create handle ID from table and column IDs', () => {
      const handleId = createHandleId('table-1', 'col-1')
      expect(handleId).toBe('table-1__col-1')
    })

    it('should handle UUID-like IDs', () => {
      const handleId = createHandleId(
        '550e8400-e29b-41d4-a716-446655440000',
        '660e8400-e29b-41d4-a716-446655440000',
      )
      expect(handleId).toBe(
        '550e8400-e29b-41d4-a716-446655440000__660e8400-e29b-41d4-a716-446655440000',
      )
    })
  })

  describe('parseHandleId', () => {
    it('should parse handle ID back to table and column IDs', () => {
      const parsed = parseHandleId('table-1__col-1')
      expect(parsed).toEqual({
        tableId: 'table-1',
        columnId: 'col-1',
      })
    })

    it('should handle UUID-like IDs', () => {
      const parsed = parseHandleId(
        '550e8400-e29b-41d4-a716-446655440000__660e8400-e29b-41d4-a716-446655440000',
      )
      expect(parsed).toEqual({
        tableId: '550e8400-e29b-41d4-a716-446655440000',
        columnId: '660e8400-e29b-41d4-a716-446655440000',
      })
    })
  })

  describe('getCardinalityMarkerStart', () => {
    it('should return correct marker for ONE_TO_ONE', () => {
      expect(getCardinalityMarkerStart('ONE_TO_ONE')).toBe('url(#zeroOrOneLeft)')
    })

    it('should return correct marker for ONE_TO_MANY', () => {
      expect(getCardinalityMarkerStart('ONE_TO_MANY')).toBe('url(#zeroOrOneLeft)')
    })

    it('should return correct marker for MANY_TO_ONE', () => {
      expect(getCardinalityMarkerStart('MANY_TO_ONE')).toBe('url(#zeroOrManyLeft)')
    })

    it('should return correct marker for MANY_TO_MANY', () => {
      expect(getCardinalityMarkerStart('MANY_TO_MANY')).toBe('url(#zeroOrManyLeft)')
    })
  })

  describe('getCardinalityMarkerEnd', () => {
    it('should return correct marker for ONE_TO_ONE', () => {
      expect(getCardinalityMarkerEnd('ONE_TO_ONE')).toBe('url(#zeroOrOneRight)')
    })

    it('should return correct marker for ONE_TO_MANY', () => {
      expect(getCardinalityMarkerEnd('ONE_TO_MANY')).toBe('url(#zeroOrManyRight)')
    })

    it('should return correct marker for MANY_TO_ONE', () => {
      expect(getCardinalityMarkerEnd('MANY_TO_ONE')).toBe('url(#zeroOrOneRight)')
    })

    it('should return correct marker for MANY_TO_MANY', () => {
      expect(getCardinalityMarkerEnd('MANY_TO_MANY')).toBe('url(#zeroOrManyRight)')
    })
  })

  describe('convertRelationshipToEdge', () => {
    it('should convert relationship to React Flow edge', () => {
      const relationship = {
        ...createMockRelationship({
          sourceTableId: 'table-1',
          targetTableId: 'table-2',
          sourceColumnId: 'col-1',
          targetColumnId: 'col-2',
          cardinality: 'ONE_TO_MANY',
          label: 'has many',
        }),
        sourceColumn: createMockColumn({ id: 'col-1' }),
        targetColumn: createMockColumn({ id: 'col-2' }),
      }

      const edge = convertRelationshipToEdge(relationship)

      expect(edge.id).toBe('rel-1')
      expect(edge.type).toBe('relationship')
      expect(edge.source).toBe('table-1')
      expect(edge.target).toBe('table-2')
      expect(edge.sourceHandle).toBe('table-1__col-1')
      expect(edge.targetHandle).toBe('table-2__col-2')
      expect(edge.data.cardinality).toBe('ONE_TO_MANY')
      expect(edge.data.label).toBe('has many')
      expect(edge.data.isHighlighted).toBe(false)
      expect(edge.markerStart).toBe('url(#zeroOrOneLeft)')
      expect(edge.markerEnd).toBe('url(#zeroOrManyRight)')
    })

    it('should handle null label', () => {
      const relationship = {
        ...createMockRelationship({ label: null }),
        sourceColumn: createMockColumn(),
        targetColumn: createMockColumn(),
      }

      const edge = convertRelationshipToEdge(relationship)
      expect(edge.data.label).toBeUndefined()
    })

    it('should handle all cardinality types', () => {
      const cardinalities: Cardinality[] = [
        'ONE_TO_ONE',
        'ONE_TO_MANY',
        'MANY_TO_ONE',
        'MANY_TO_MANY',
      ]

      cardinalities.forEach((cardinality) => {
        const relationship = {
          ...createMockRelationship({ cardinality }),
          sourceColumn: createMockColumn(),
          targetColumn: createMockColumn(),
        }

        const edge = convertRelationshipToEdge(relationship)
        expect(edge.data.cardinality).toBe(cardinality)
        expect(edge.markerStart).toContain('url(#')
        expect(edge.markerEnd).toContain('url(#')
      })
    })
  })

  describe('convertRelationshipsToEdges', () => {
    it('should convert multiple relationships to edges', () => {
      const relationships = [
        {
          ...createMockRelationship({ id: 'rel-1' }),
          sourceColumn: createMockColumn(),
          targetColumn: createMockColumn(),
        },
        {
          ...createMockRelationship({ id: 'rel-2' }),
          sourceColumn: createMockColumn(),
          targetColumn: createMockColumn(),
        },
      ]

      const edges = convertRelationshipsToEdges(relationships)

      expect(edges).toHaveLength(2)
      expect(edges[0].id).toBe('rel-1')
      expect(edges[1].id).toBe('rel-2')
    })

    it('should handle empty array', () => {
      const edges = convertRelationshipsToEdges([])
      expect(edges).toEqual([])
    })
  })

  describe('convertToReactFlowEdges (legacy)', () => {
    it('should convert to legacy format', () => {
      const relationships = [
        createMockRelationship({
          sourceColumnId: 'col-1',
          targetColumnId: 'col-2',
          label: 'test relationship',
        }),
      ]

      const edges = convertToReactFlowEdges(relationships)

      expect(edges).toHaveLength(1)
      expect(edges[0].type).toBe('erRelationship')
      expect(edges[0].sourceHandle).toBe('col-1-source')
      expect(edges[0].targetHandle).toBe('col-2-target')
      expect(edges[0].data.label).toBe('test relationship')
    })

    it('should handle null column IDs', () => {
      const relationships = [
        createMockRelationship({
          sourceColumnId: null as any,
          targetColumnId: null as any,
        }),
      ]

      const edges = convertToReactFlowEdges(relationships)

      expect(edges[0].sourceHandle).toBeUndefined()
      expect(edges[0].targetHandle).toBeUndefined()
    })

    it('should handle empty label', () => {
      const relationships = [createMockRelationship({ label: null })]

      const edges = convertToReactFlowEdges(relationships)
      expect(edges[0].data.label).toBeUndefined()
    })
  })
})

describe('Viewport Conversion', () => {
  describe('convertToReactFlowViewport', () => {
    it('should convert CanvasViewport to ReactFlowViewport', () => {
      const canvasViewport: CanvasViewport = {
        zoom: 1.5,
        offsetX: 100,
        offsetY: 200,
      }

      const reactFlowViewport = convertToReactFlowViewport(canvasViewport)

      expect(reactFlowViewport).toEqual({
        zoom: 1.5,
        x: 100,
        y: 200,
      })
    })

    it('should handle zoom at minimum value', () => {
      const canvasViewport: CanvasViewport = {
        zoom: 0.1,
        offsetX: 0,
        offsetY: 0,
      }

      const reactFlowViewport = convertToReactFlowViewport(canvasViewport)
      expect(reactFlowViewport.zoom).toBe(0.1)
    })

    it('should handle zoom at maximum value', () => {
      const canvasViewport: CanvasViewport = {
        zoom: 2,
        offsetX: 0,
        offsetY: 0,
      }

      const reactFlowViewport = convertToReactFlowViewport(canvasViewport)
      expect(reactFlowViewport.zoom).toBe(2)
    })
  })

  describe('convertToCanvasViewport', () => {
    it('should convert ReactFlowViewport to CanvasViewport', () => {
      const reactFlowViewport: ReactFlowViewport = {
        zoom: 1.5,
        x: 100,
        y: 200,
      }

      const canvasViewport = convertToCanvasViewport(reactFlowViewport)

      expect(canvasViewport).toEqual({
        zoom: 1.5,
        offsetX: 100,
        offsetY: 200,
      })
    })

    it('should handle negative offsets', () => {
      const reactFlowViewport: ReactFlowViewport = {
        zoom: 1,
        x: -100,
        y: -200,
      }

      const canvasViewport = convertToCanvasViewport(reactFlowViewport)
      expect(canvasViewport.offsetX).toBe(-100)
      expect(canvasViewport.offsetY).toBe(-200)
    })
  })

  describe('round-trip viewport conversion', () => {
    it('should preserve data through round-trip conversion', () => {
      const original: CanvasViewport = {
        zoom: 1.25,
        offsetX: 150,
        offsetY: 250,
      }

      const reactFlowViewport = convertToReactFlowViewport(original)
      const backToCanvas = convertToCanvasViewport(reactFlowViewport)

      expect(backToCanvas).toEqual(original)
    })
  })
})
