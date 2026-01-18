# Data Model: React Flow Migration

**Date**: 2025-11-15
**Branch**: `002-react-flow-migration`

## Overview

This document defines the data structures for React Flow-based ER diagram rendering. It maps existing Prisma entities to React Flow's node/edge format.

**Note**: Based on research findings, migration to React Flow is **not recommended**. This document serves as reference if stakeholders decide to proceed despite research recommendations.

## React Flow Core Types

### Node Structure

React Flow nodes represent database tables in the ER diagram.

```typescript
import { Node } from '@xyflow/react'
import { DiagramTable, Column } from '@prisma/client'

export type TableNodeData = {
  // Original database entities
  table: DiagramTable
  columns: Column[]

  // UI callbacks
  onUpdate?: (tableId: string, updates: Partial<DiagramTable>) => void
  onColumnUpdate?: (columnId: string, updates: Partial<Column>) => void
  onDelete?: (tableId: string) => void

  // Visual state
  isSelected?: boolean
  isHovered?: boolean

  // Collaboration state
  editingUser?: string | null // Username of user currently editing this table
}

export type TableNode = Node<TableNodeData, 'erTable'>

// Example instance
const exampleTableNode: TableNode = {
  id: 'table-uuid-123',
  type: 'erTable',
  position: { x: 100, y: 200 },
  data: {
    table: {
      id: 'table-uuid-123',
      name: 'users',
      whiteboardId: 'whiteboard-uuid-456',
      positionX: 100,
      positionY: 200,
      width: 250,
      height: 150,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    columns: [
      {
        id: 'col-uuid-1',
        tableId: 'table-uuid-123',
        name: 'id',
        dataType: 'INTEGER',
        isPrimaryKey: true,
        isForeignKey: false,
        isNullable: false,
        isUnique: true,
        orderIndex: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'col-uuid-2',
        tableId: 'table-uuid-123',
        name: 'email',
        dataType: 'VARCHAR(255)',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: false,
        isUnique: true,
        orderIndex: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    onUpdate: (tableId, updates) => {
      // Update table in database via API
    },
  },
}
```

### Edge Structure

React Flow edges represent relationships between tables.

```typescript
import { Edge } from '@xyflow/react'
import { Relationship } from '@prisma/client'

export type CardinalityType =
  | 'ONE_TO_ONE'
  | 'ONE_TO_MANY'
  | 'MANY_TO_ONE'
  | 'MANY_TO_MANY'

export type RelationshipEdgeData = {
  // Original database entity
  relationship: Relationship

  // Relationship metadata
  cardinality: CardinalityType
  label?: string
  strength?: number // For layout algorithm (0-1)

  // UI callbacks
  onUpdate?: (relationshipId: string, updates: Partial<Relationship>) => void
  onDelete?: (relationshipId: string) => void

  // Visual state
  isSelected?: boolean
  isHovered?: boolean
}

export type RelationshipEdge = Edge<RelationshipEdgeData, 'erRelationship'>

// Example instance
const exampleRelationshipEdge: RelationshipEdge = {
  id: 'rel-uuid-789',
  type: 'erRelationship',
  source: 'table-uuid-123', // users table
  target: 'table-uuid-456', // orders table
  sourceHandle: 'col-uuid-1-source', // users.id (right handle)
  targetHandle: 'col-uuid-7-target', // orders.user_id (left handle)
  data: {
    relationship: {
      id: 'rel-uuid-789',
      whiteboardId: 'whiteboard-uuid-456',
      sourceTableId: 'table-uuid-123',
      targetTableId: 'table-uuid-456',
      sourceColumnId: 'col-uuid-1',
      targetColumnId: 'col-uuid-7',
      relationshipType: 'ONE_TO_MANY',
      label: 'owns',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    cardinality: 'ONE_TO_MANY',
    label: 'owns',
    strength: 0.8,
  },
}
```

## Prisma Entity Mapping

### Existing Prisma Schema (Unchanged)

```prisma
model DiagramTable {
  id           String   @id @default(uuid())
  whiteboardId String
  name         String
  positionX    Float    @default(0)
  positionY    Float    @default(0)
  width        Float?
  height       Float?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  whiteboard    Whiteboard     @relation(fields: [whiteboardId], references: [id], onDelete: Cascade)
  columns       Column[]
  sourceRels    Relationship[] @relation("SourceTable")
  targetRels    Relationship[] @relation("TargetTable")
}

model Column {
  id            String   @id @default(uuid())
  tableId       String
  name          String
  dataType      String
  isPrimaryKey  Boolean  @default(false)
  isForeignKey  Boolean  @default(false)
  isNullable    Boolean  @default(true)
  isUnique      Boolean  @default(false)
  orderIndex    Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  table         DiagramTable   @relation(fields: [tableId], references: [id], onDelete: Cascade)
  sourceRels    Relationship[] @relation("SourceColumn")
  targetRels    Relationship[] @relation("TargetColumn")
}

model Relationship {
  id               String   @id @default(uuid())
  whiteboardId     String
  sourceTableId    String
  targetTableId    String
  sourceColumnId   String?
  targetColumnId   String?
  relationshipType String   @default("ONE_TO_MANY")
  label            String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  whiteboard    Whiteboard   @relation(fields: [whiteboardId], references: [id], onDelete: Cascade)
  sourceTable   DiagramTable @relation("SourceTable", fields: [sourceTableId], references: [id], onDelete: Cascade)
  targetTable   DiagramTable @relation("TargetTable", fields: [targetTableId], references: [id], onDelete: Cascade)
  sourceColumn  Column?      @relation("SourceColumn", fields: [sourceColumnId], references: [id])
  targetColumn  Column?      @relation("TargetColumn", fields: [targetColumnId], references: [id])
}
```

### Conversion Functions

```typescript
// Convert Prisma entities to React Flow format
export function convertToReactFlowNodes(
  tables: (DiagramTable & { columns: Column[] })[],
): TableNode[] {
  return tables.map((table) => ({
    id: table.id,
    type: 'erTable' as const,
    position: {
      x: table.positionX,
      y: table.positionY,
    },
    data: {
      table,
      columns: table.columns.sort((a, b) => a.orderIndex - b.orderIndex),
    },
  }))
}

export function convertToReactFlowEdges(
  relationships: Relationship[],
): RelationshipEdge[] {
  return relationships.map((rel) => ({
    id: rel.id,
    type: 'erRelationship' as const,
    source: rel.sourceTableId,
    target: rel.targetTableId,
    sourceHandle: rel.sourceColumnId
      ? `${rel.sourceColumnId}-source`
      : undefined,
    targetHandle: rel.targetColumnId
      ? `${rel.targetColumnId}-target`
      : undefined,
    data: {
      relationship: rel,
      cardinality: rel.relationshipType as CardinalityType,
      label: rel.label || undefined,
    },
  }))
}

// Convert React Flow node position back to Prisma format
export function extractPositionUpdates(
  node: TableNode,
): Pick<DiagramTable, 'positionX' | 'positionY'> {
  return {
    positionX: node.position.x,
    positionY: node.position.y,
  }
}
```

## Handle Positioning

### Handle ID Convention

Each column in a table node has two handles:

- **Source handle** (right side): `{columnId}-source`
- **Target handle** (left side): `{columnId}-target`

```typescript
export function generateHandleId(
  columnId: string,
  type: 'source' | 'target',
): string {
  return `${columnId}-${type}`
}

export function parseHandleId(handleId: string): {
  columnId: string
  type: 'source' | 'target'
} {
  const [columnId, type] = handleId.split('-')
  return { columnId, type: type as 'source' | 'target' }
}
```

### Handle Position Calculation

```typescript
export function calculateHandlePosition(
  columnIndex: number,
  headerHeight: number = 40,
  rowHeight: number = 28,
): number {
  // Position handle at vertical center of column row
  return headerHeight + columnIndex * rowHeight + rowHeight / 2
}
```

## Layout Data Structures

### Layout Algorithm Input/Output

```typescript
export interface LayoutInput {
  tables: (DiagramTable & { columns: Column[] })[]
  relationships: Relationship[]
  canvasWidth: number
  canvasHeight: number
  options?: {
    linkDistance?: number
    chargeStrength?: number
    iterations?: number
  }
}

export interface LayoutOutput {
  positions: Record<string, { x: number; y: number }>
  metadata: {
    computeTime: number
    iterations: number
    clusterCount: number
  }
}

// Apply layout results to React Flow nodes
export function applyLayoutToNodes(
  nodes: TableNode[],
  layoutOutput: LayoutOutput,
): TableNode[] {
  return nodes.map((node) => ({
    ...node,
    position: layoutOutput.positions[node.id] || node.position,
  }))
}
```

## Viewport State

### React Flow Viewport

```typescript
import { Viewport } from '@xyflow/react'

export interface ReactFlowViewport extends Viewport {
  x: number // Pan offset X
  y: number // Pan offset Y
  zoom: number // Zoom level (0.1 to 5)
}

// Convert to/from existing CanvasViewport
export interface CanvasViewport {
  zoom: number
  offsetX: number
  offsetY: number
}

export function convertToReactFlowViewport(
  cv: CanvasViewport,
): ReactFlowViewport {
  return {
    x: cv.offsetX,
    y: cv.offsetY,
    zoom: cv.zoom,
  }
}

export function convertToCanvasViewport(
  rfv: ReactFlowViewport,
): CanvasViewport {
  return {
    zoom: rfv.zoom,
    offsetX: rfv.x,
    offsetY: rfv.y,
  }
}
```

## State Management Types

### Zustand Store Schema

```typescript
import { create } from 'zustand'

export interface WhiteboardState {
  // Core data
  nodes: TableNode[]
  edges: RelationshipEdge[]
  viewport: ReactFlowViewport

  // UI state
  selectedNodeIds: string[]
  selectedEdgeIds: string[]

  // Collaboration state
  isProcessingRemote: boolean
  activeUsers: Array<{
    userId: string
    username: string
    cursor?: { x: number; y: number }
  }>

  // Actions
  setNodes: (nodes: TableNode[] | ((prev: TableNode[]) => TableNode[])) => void
  setEdges: (
    edges:
      | RelationshipEdge[]
      | ((prev: RelationshipEdge[]) => RelationshipEdge[]),
  ) => void
  updateNodePosition: (
    nodeId: string,
    position: { x: number; y: number },
  ) => void
  addNode: (node: TableNode) => void
  removeNode: (nodeId: string) => void
  addEdge: (edge: RelationshipEdge) => void
  removeEdge: (edgeId: string) => void
  setViewport: (viewport: ReactFlowViewport) => void
}
```

## WebSocket Event Payloads

### Node Update Events

```typescript
// Client → Server
export interface NodeUpdateEvent {
  type: 'node:update'
  whiteboardId: string
  nodeId: string
  updates: Partial<TableNode>
  userId: string
  timestamp: number
}

// Server → Clients
export interface NodeUpdateBroadcast {
  type: 'node:updated'
  whiteboardId: string
  nodeId: string
  updates: Partial<TableNode>
  userId: string
  timestamp: number
}
```

### Edge Update Events

```typescript
// Client → Server
export interface EdgeUpdateEvent {
  type: 'edge:update'
  whiteboardId: string
  edgeId: string
  updates: Partial<RelationshipEdge>
  userId: string
  timestamp: number
}

// Server → Clients
export interface EdgeUpdateBroadcast {
  type: 'edge:updated'
  whiteboardId: string
  edgeId: string
  updates: Partial<RelationshipEdge>
  userId: string
  timestamp: number
}
```

See [contracts/websocket-updates.md](./contracts/websocket-updates.md) for full event specifications.

## Type Exports

All types should be exported from a central types file:

```typescript
// src/lib/react-flow/types.ts
export type {
  TableNodeData,
  TableNode,
  RelationshipEdgeData,
  RelationshipEdge,
  CardinalityType,
  LayoutInput,
  LayoutOutput,
  ReactFlowViewport,
  WhiteboardState,
}

export {
  convertToReactFlowNodes,
  convertToReactFlowEdges,
  extractPositionUpdates,
  generateHandleId,
  parseHandleId,
  calculateHandlePosition,
  applyLayoutToNodes,
  convertToReactFlowViewport,
  convertToCanvasViewport,
}
```

## Summary

This data model preserves the existing Prisma schema while providing React Flow-compatible data structures. Key design principles:

1. **No database changes**: All existing Prisma models unchanged
2. **Bidirectional conversion**: Easy conversion between Prisma and React Flow formats
3. **Type safety**: Full TypeScript coverage for all data structures
4. **Handle convention**: Consistent column-based handle IDs
5. **State management**: Clear separation between data and UI state
6. **Collaboration**: WebSocket event payloads for real-time sync

**Note**: Based on research findings (see research.md), keeping Konva is recommended over this migration.
