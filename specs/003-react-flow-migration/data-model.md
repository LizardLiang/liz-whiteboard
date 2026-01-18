# Data Model: React Flow Whiteboard Migration

**Feature**: 003-react-flow-migration
**Date**: 2025-11-15

## Overview

This document defines the data structures and type definitions for integrating React Flow with the existing Prisma database schema. The migration maintains backward compatibility with the current data model while adding new React Flow-specific types.

## Database Schema (Unchanged)

The existing Prisma schema remains unchanged. For reference, the relevant models are:

### DiagramTable

```prisma
model DiagramTable {
  id           String   @id @default(uuid())
  whiteboardId String
  name         String   @db.VarChar(255)
  description  String?  @db.Text
  positionX    Float
  positionY    Float
  width        Float?
  height       Float?

  whiteboard            Whiteboard     @relation(fields: [whiteboardId], references: [id])
  columns               Column[]
  outgoingRelationships Relationship[] @relation("SourceTable")
  incomingRelationships Relationship[] @relation("TargetTable")
}
```

### Column

```prisma
model Column {
  id           String   @id @default(uuid())
  tableId      String
  name         String   @db.VarChar(255)
  dataType     String   @db.VarChar(50)
  isPrimaryKey Boolean  @default(false)
  isForeignKey Boolean  @default(false)
  isUnique     Boolean  @default(false)
  isNullable   Boolean  @default(true)
  order        Int      @default(0)

  table               DiagramTable   @relation(fields: [tableId], references: [id])
  sourceRelationships Relationship[] @relation("SourceColumn")
  targetRelationships Relationship[] @relation("TargetColumn")
}
```

### Relationship

```prisma
model Relationship {
  id             String      @id @default(uuid())
  whiteboardId   String
  sourceTableId  String
  targetTableId  String
  sourceColumnId String
  targetColumnId String
  cardinality    Cardinality  // ONE_TO_ONE | ONE_TO_MANY | MANY_TO_ONE | MANY_TO_MANY
  label          String?     @db.VarChar(255)
  routingPoints  Json?       // DEPRECATED: Not used with React Flow auto-routing

  whiteboard   Whiteboard   @relation(fields: [whiteboardId], references: [id])
  sourceTable  DiagramTable @relation("SourceTable", fields: [sourceTableId], references: [id])
  targetTable  DiagramTable @relation("TargetTable", fields: [targetTableId], references: [id])
  sourceColumn Column       @relation("SourceColumn", fields: [sourceColumnId], references: [id])
  targetColumn Column       @relation("TargetColumn", fields: [targetColumnId], references: [id])
}
```

## React Flow Types

### Core React Flow Imports

```typescript
import type { Node, Edge, NodeProps, EdgeProps } from '@xyflow/react'
import type {
  DiagramTable,
  Column,
  Relationship,
  Cardinality,
} from '@prisma/client'
```

### TableNode Data Structure

```typescript
/**
 * Display mode for table nodes
 */
export type ShowMode = 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS'

/**
 * Data structure for Table nodes in React Flow
 */
export interface TableNodeData {
  /** The table entity with its columns */
  table: DiagramTable & {
    columns: Column[]
  }

  /** Whether this table is actively selected (clicked) */
  isActiveHighlighted: boolean

  /** Whether this table is highlighted due to relationship with active table */
  isHighlighted: boolean

  /** Whether this table is currently hovered */
  isHovered: boolean

  /** Current display mode */
  showMode: ShowMode

  /** Map of column ID to cardinality for incoming relationships */
  targetColumnCardinalities?: Record<string, Cardinality>
}

/**
 * Complete Table node type for React Flow
 */
export type TableNodeType = Node<TableNodeData, 'table'>
```

### RelationshipEdge Data Structure

```typescript
/**
 * Data structure for Relationship edges in React Flow
 */
export interface RelationshipEdgeData {
  /** The relationship entity */
  relationship: Relationship & {
    sourceColumn: Column
    targetColumn: Column
  }

  /** Cardinality of the relationship */
  cardinality: Cardinality

  /** Whether this edge is highlighted */
  isHighlighted: boolean

  /** Optional label to display on the edge */
  label?: string
}

/**
 * Complete Relationship edge type for React Flow
 */
export type RelationshipEdgeType = Edge<RelationshipEdgeData, 'relationship'>
```

### Canvas State

```typescript
/**
 * Canvas viewport state (replaces Konva CanvasViewport)
 */
export interface ReactFlowViewport {
  /** Current zoom level (0.1 to 2.0) */
  zoom: number

  /** Viewport center X coordinate */
  x: number

  /** Viewport center Y coordinate */
  y: number
}

/**
 * Canvas interaction state
 */
export interface CanvasInteractionState {
  /** ID of actively selected table */
  activeTableId: string | null

  /** ID of currently hovered table */
  hoveredTableId: string | null

  /** Current display mode for all tables */
  showMode: ShowMode

  /** Set of table IDs that are currently hidden */
  hiddenTableIds: Set<string>
}
```

## Conversion Utilities

### Database → React Flow Conversion

```typescript
/**
 * Convert DiagramTable to React Flow Node
 */
export function convertTableToNode(
  table: DiagramTable & { columns: Column[] },
  interactionState?: Partial<TableNodeData>,
): TableNodeType {
  return {
    id: table.id,
    type: 'table',
    position: {
      x: table.positionX,
      y: table.positionY,
    },
    data: {
      table,
      isActiveHighlighted: false,
      isHighlighted: false,
      isHovered: false,
      showMode: 'ALL_FIELDS',
      ...interactionState,
    },
    // React Flow will measure actual dimensions
    // width and height are optional hints
    width: table.width ?? undefined,
    height: table.height ?? undefined,
  }
}

/**
 * Convert multiple DiagramTables to React Flow Nodes
 */
export function convertTablesToNodes(
  tables: (DiagramTable & { columns: Column[] })[],
): TableNodeType[] {
  return tables.map((table) => convertTableToNode(table))
}
```

```typescript
/**
 * Convert Relationship to React Flow Edge
 */
export function convertRelationshipToEdge(
  relationship: Relationship & {
    sourceColumn: Column
    targetColumn: Column
  },
): RelationshipEdgeType {
  return {
    id: relationship.id,
    type: 'relationship',
    source: relationship.sourceTableId,
    target: relationship.targetTableId,
    sourceHandle: createHandleId(
      relationship.sourceTableId,
      relationship.sourceColumnId,
    ),
    targetHandle: createHandleId(
      relationship.targetTableId,
      relationship.targetColumnId,
    ),
    data: {
      relationship,
      cardinality: relationship.cardinality,
      isHighlighted: false,
      label: relationship.label ?? undefined,
    },
    // SVG markers for cardinality indicators
    markerStart: getCardinalityMarkerStart(relationship.cardinality),
    markerEnd: getCardinalityMarkerEnd(relationship.cardinality),
  }
}

/**
 * Convert multiple Relationships to React Flow Edges
 */
export function convertRelationshipsToEdges(
  relationships: (Relationship & {
    sourceColumn: Column
    targetColumn: Column
  })[],
): RelationshipEdgeType[] {
  return relationships.map((rel) => convertRelationshipToEdge(rel))
}
```

### React Flow → Database Conversion

```typescript
/**
 * Extract position update from React Flow Node
 */
export function extractTablePosition(node: TableNodeType): {
  id: string
  positionX: number
  positionY: number
} {
  return {
    id: node.id,
    positionX: node.position.x,
    positionY: node.position.y,
  }
}

/**
 * Extract positions for all nodes (for batch update)
 */
export function extractAllTablePositions(
  nodes: TableNodeType[],
): Array<{ id: string; positionX: number; positionY: number }> {
  return nodes.map(extractTablePosition)
}
```

## Helper Utilities

### Handle ID Generation

```typescript
/**
 * Generate unique handle ID for column connection point
 * Format: `${tableId}__${columnId}`
 */
export function createHandleId(tableId: string, columnId: string): string {
  return `${tableId}__${columnId}`
}

/**
 * Parse handle ID back to table and column IDs
 */
export function parseHandleId(handleId: string): {
  tableId: string
  columnId: string
} {
  const [tableId, columnId] = handleId.split('__')
  return { tableId, columnId }
}
```

### Cardinality Markers

```typescript
/**
 * Get SVG marker ID for relationship source (based on cardinality)
 */
export function getCardinalityMarkerStart(cardinality: Cardinality): string {
  switch (cardinality) {
    case 'ONE_TO_ONE':
      return 'url(#zeroOrOneLeft)'
    case 'ONE_TO_MANY':
      return 'url(#zeroOrOneLeft)'
    case 'MANY_TO_ONE':
      return 'url(#zeroOrManyLeft)'
    case 'MANY_TO_MANY':
      return 'url(#zeroOrManyLeft)'
  }
}

/**
 * Get SVG marker ID for relationship target (based on cardinality)
 */
export function getCardinalityMarkerEnd(cardinality: Cardinality): string {
  switch (cardinality) {
    case 'ONE_TO_ONE':
      return 'url(#zeroOrOneRight)'
    case 'ONE_TO_MANY':
      return 'url(#zeroOrManyRight)'
    case 'MANY_TO_ONE':
      return 'url(#zeroOrOneRight)'
    case 'MANY_TO_MANY':
      return 'url(#zeroOrManyRight)'
  }
}
```

## ELK Layout Types

```typescript
/**
 * ELK graph structure (input to layout algorithm)
 */
export interface ELKGraph {
  id: string
  layoutOptions: Record<string, string>
  children: ELKNode[]
  edges: ELKEdge[]
}

/**
 * ELK node representation
 */
export interface ELKNode {
  id: string
  width: number
  height: number
  x?: number // Set by ELK after layout
  y?: number // Set by ELK after layout
}

/**
 * ELK edge representation
 */
export interface ELKEdge {
  id: string
  sources: string[]
  targets: string[]
}

/**
 * Convert React Flow nodes to ELK format
 */
export function convertNodesToELKGraph(
  nodes: TableNodeType[],
  edges: RelationshipEdgeType[],
): ELKGraph {
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.baseValue': '40',
      'elk.spacing.componentComponent': '80',
      'elk.layered.spacing.edgeNodeBetweenLayers': '120',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.width ?? 250,
      height: node.height ?? 150,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }
}

/**
 * Apply ELK layout results to React Flow nodes
 */
export function applyELKLayout(
  nodes: TableNodeType[],
  elkNodes: ELKNode[],
): TableNodeType[] {
  const layoutMap = new Map(elkNodes.map((n) => [n.id, { x: n.x!, y: n.y! }]))

  return nodes.map((node) => {
    const position = layoutMap.get(node.id)
    if (!position) return node

    return {
      ...node,
      position,
    }
  })
}
```

## Highlighting Logic Types

```typescript
/**
 * Result of highlighting calculation
 */
export interface HighlightResult {
  nodes: TableNodeType[]
  edges: RelationshipEdgeType[]
}

/**
 * Edge lookup map (for performance)
 */
export type EdgeMap = Map<string, RelationshipEdgeType[]>

/**
 * Build edge map for fast relationship lookups
 */
export function buildEdgeMap(edges: RelationshipEdgeType[]): EdgeMap {
  const map = new Map<string, RelationshipEdgeType[]>()

  edges.forEach((edge) => {
    // Add to source table's edges
    const sourceEdges = map.get(edge.source) ?? []
    sourceEdges.push(edge)
    map.set(edge.source, sourceEdges)

    // Add to target table's edges
    const targetEdges = map.get(edge.target) ?? []
    targetEdges.push(edge)
    map.set(edge.target, targetEdges)
  })

  return map
}

/**
 * Calculate highlighting state for nodes and edges
 */
export function calculateHighlighting(
  nodes: TableNodeType[],
  edges: RelationshipEdgeType[],
  activeTableId: string | null,
  hoveredTableId: string | null,
): HighlightResult {
  const edgeMap = buildEdgeMap(edges)
  const relatedTableIds = new Set<string>()

  // Add active table and its related tables
  if (activeTableId) {
    relatedTableIds.add(activeTableId)
    const connectedEdges = edgeMap.get(activeTableId) ?? []
    connectedEdges.forEach((edge) => {
      relatedTableIds.add(edge.source)
      relatedTableIds.add(edge.target)
    })
  }

  // Add hovered table and its related tables
  if (hoveredTableId) {
    relatedTableIds.add(hoveredTableId)
    const connectedEdges = edgeMap.get(hoveredTableId) ?? []
    connectedEdges.forEach((edge) => {
      relatedTableIds.add(edge.source)
      relatedTableIds.add(edge.target)
    })
  }

  // Update node highlighting
  const highlightedNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      isActiveHighlighted: node.id === activeTableId,
      isHighlighted: relatedTableIds.has(node.id) && node.id !== activeTableId,
      isHovered: node.id === hoveredTableId,
    },
    zIndex: relatedTableIds.has(node.id) ? 1000 : 1,
  }))

  // Update edge highlighting
  const highlightedEdges = edges.map((edge) => {
    const isConnectedToActive =
      edge.source === activeTableId || edge.target === activeTableId
    const isConnectedToHovered =
      edge.source === hoveredTableId || edge.target === hoveredTableId

    return {
      ...edge,
      data: {
        ...edge.data,
        isHighlighted: isConnectedToActive || isConnectedToHovered,
      },
      zIndex: isConnectedToActive || isConnectedToHovered ? 1000 : 1,
    }
  })

  return {
    nodes: highlightedNodes,
    edges: highlightedEdges,
  }
}
```

## Type Registry

```typescript
/**
 * React Flow node type registry
 */
export const nodeTypes = {
  table: TableNode,
} as const

/**
 * React Flow edge type registry
 */
export const edgeTypes = {
  relationship: RelationshipEdge,
} as const
```

## Summary

This data model provides:

1. **Backward Compatibility**: Maps existing Prisma schema to React Flow types without database changes
2. **Type Safety**: Full TypeScript definitions for all data structures
3. **Conversion Utilities**: Bidirectional conversion between database and React Flow formats
4. **Highlighting Logic**: Data-driven visual state management
5. **ELK Integration**: Types for auto-layout computation
6. **Handle Management**: Unique IDs for edge connection points

All types maintain compatibility with the existing WebSocket collaboration infrastructure and TanStack Query data fetching.
