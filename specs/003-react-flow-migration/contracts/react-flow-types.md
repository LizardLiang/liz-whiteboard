# React Flow Type Contracts

**Feature**: 003-react-flow-migration
**Date**: 2025-11-15

## Overview

This document defines the TypeScript type contracts for React Flow components, props, and utilities used in the whiteboard migration. These types ensure type safety across the codebase and serve as the public API contract.

## Component Prop Contracts

### ReactFlowCanvas Component

Main wrapper component for the React Flow canvas.

```typescript
import type { ProOptions } from '@xyflow/react'
import type { TableNodeType, RelationshipEdgeType } from '../data-model'

export interface ReactFlowCanvasProps {
  /** Whiteboard ID for data fetching */
  whiteboardId: string

  /** Initial viewport state (zoom, position) */
  initialViewport?: {
    zoom: number
    x: number
    y: number
  }

  /** Callback when user drags a table to new position */
  onTablePositionChange?: (tableId: string, x: number, y: number) => void

  /** Callback when user clicks on a table */
  onTableClick?: (tableId: string) => void

  /** Callback when user clicks on canvas background (deselect) */
  onCanvasClick?: () => void

  /** Current display mode for all tables */
  showMode?: 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS'

  /** Callback when display mode changes */
  onShowModeChange?: (mode: 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS') => void

  /** Optional React Flow Pro license key */
  proOptions?: ProOptions

  /** Whether to show the minimap */
  showMinimap?: boolean

  /** Whether to show the controls panel */
  showControls?: boolean

  /** Whether to enable auto-layout on initial load */
  enableAutoLayoutOnLoad?: boolean
}
```

**Usage Example**:

```typescript
<ReactFlowCanvas
  whiteboardId="whiteboard-123"
  initialViewport={{ zoom: 1, x: 0, y: 0 }}
  onTablePositionChange={(id, x, y) => savePosition(id, x, y)}
  onTableClick={(id) => setActiveTable(id)}
  showMode="ALL_FIELDS"
  showMinimap={true}
  showControls={true}
/>
```

---

### TableNode Component

Custom node component for rendering database tables.

```typescript
import type { NodeProps } from '@xyflow/react'
import type { TableNodeData } from '../data-model'

export type TableNodeProps = NodeProps<TableNodeData>

// Component signature
export const TableNode: React.FC<TableNodeProps>
```

**Props Provided by React Flow**:

- `id`: string - Node ID (table ID)
- `data`: TableNodeData - Custom data (table entity, highlighting state, etc.)
- `selected`: boolean - Whether node is selected
- `type`: 'table' - Node type
- `xPos`: number - Current X position
- `yPos`: number - Current Y position
- `dragging`: boolean - Whether node is being dragged
- `isConnectable`: boolean - Whether edges can connect to this node
- `sourcePosition`: Position - Default source handle position
- `targetPosition`: Position - Default target handle position

**Data Structure** (from `data-model.md`):

```typescript
interface TableNodeData {
  table: DiagramTable & { columns: Column[] }
  isActiveHighlighted: boolean
  isHighlighted: boolean
  isHovered: boolean
  showMode: 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS'
  targetColumnCardinalities?: Record<string, Cardinality>
}
```

---

### RelationshipEdge Component

Custom edge component for rendering relationships between tables.

```typescript
import type { EdgeProps } from '@xyflow/react'
import type { RelationshipEdgeData } from '../data-model'

export type RelationshipEdgeProps = EdgeProps<RelationshipEdgeData>

// Component signature
export const RelationshipEdge: React.FC<RelationshipEdgeProps>
```

**Props Provided by React Flow**:

- `id`: string - Edge ID (relationship ID)
- `data`: RelationshipEdgeData - Custom data (relationship entity, cardinality, etc.)
- `source`: string - Source node ID (source table ID)
- `target`: string - Target node ID (target table ID)
- `sourceX`: number - Source handle X coordinate
- `sourceY`: number - Source handle Y coordinate
- `targetX`: number - Target handle X coordinate
- `targetY`: number - Target handle Y coordinate
- `sourcePosition`: Position - Source handle position ('left' | 'right' | 'top' | 'bottom')
- `targetPosition`: Position - Target handle position
- `markerStart`: string - SVG marker ID for source end
- `markerEnd`: string - SVG marker ID for target end
- `selected`: boolean - Whether edge is selected

**Data Structure** (from `data-model.md`):

```typescript
interface RelationshipEdgeData {
  relationship: Relationship & {
    sourceColumn: Column
    targetColumn: Column
  }
  cardinality: Cardinality
  isHighlighted: boolean
  label?: string
}
```

---

## Hook Contracts

### useReactFlowCanvas

Main hook for managing React Flow state and interactions.

```typescript
export interface UseReactFlowCanvasOptions {
  whiteboardId: string
  initialViewport?: { zoom: number; x: number; y: number }
  onTablePositionChange?: (tableId: string, x: number, y: number) => void
  showMode?: 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS'
}

export interface UseReactFlowCanvasReturn {
  // React Flow state
  nodes: TableNodeType[]
  edges: RelationshipEdgeType[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange

  // Interaction handlers
  onNodeClick: (event: React.MouseEvent, node: Node) => void
  onPaneClick: (event: React.MouseEvent) => void
  onNodeMouseEnter: (event: React.MouseEvent, node: Node) => void
  onNodeMouseLeave: (event: React.MouseEvent, node: Node) => void
  onNodeDragStop: (event: React.MouseEvent, node: Node) => void

  // Selection state
  activeTableId: string | null
  setActiveTableId: (id: string | null) => void

  // Viewport controls
  fitView: () => void
  zoomIn: () => void
  zoomOut: () => void

  // Loading state
  isLoading: boolean
  error: Error | null
}

export function useReactFlowCanvas(
  options: UseReactFlowCanvasOptions,
): UseReactFlowCanvasReturn
```

**Usage Example**:

```typescript
const {
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onPaneClick,
  activeTableId,
  fitView,
} = useReactFlowCanvas({
  whiteboardId: 'whiteboard-123',
  showMode: 'ALL_FIELDS',
  onTablePositionChange: savePosition,
})
```

---

### useHighlighting

Hook for managing node/edge highlighting based on selection.

```typescript
export interface UseHighlightingOptions {
  nodes: TableNodeType[]
  edges: RelationshipEdgeType[]
  activeTableId: string | null
  hoveredTableId: string | null
}

export interface UseHighlightingReturn {
  highlightedNodes: TableNodeType[]
  highlightedEdges: RelationshipEdgeType[]
}

export function useHighlighting(
  options: UseHighlightingOptions,
): UseHighlightingReturn
```

**Usage Example**:

```typescript
const { highlightedNodes, highlightedEdges } = useHighlighting({
  nodes,
  edges,
  activeTableId,
  hoveredTableId,
})
```

---

### useAutoLayout

Hook for computing and applying ELK auto-layout.

```typescript
export interface UseAutoLayoutOptions {
  nodes: TableNodeType[]
  edges: RelationshipEdgeType[]
  onLayoutComplete?: (nodes: TableNodeType[]) => void
}

export interface UseAutoLayoutReturn {
  computeLayout: () => Promise<void>
  isComputing: boolean
  error: Error | null
}

export function useAutoLayout(
  options: UseAutoLayoutOptions,
): UseAutoLayoutReturn
```

**Usage Example**:

```typescript
const { computeLayout, isComputing } = useAutoLayout({
  nodes,
  edges,
  onLayoutComplete: (layoutedNodes) => {
    setNodes(layoutedNodes)
    fitView()
  },
})

// Trigger auto-layout on button click
<button onClick={computeLayout} disabled={isComputing}>
  Auto Layout
</button>
```

---

### useWhiteboardCollaboration

Hook for WebSocket real-time collaboration.

```typescript
export interface UseWhiteboardCollaborationOptions {
  whiteboardId: string
  userId: string
  userName?: string
  onTablePositionUpdate?: (tableId: string, x: number, y: number) => void
  onTableCreated?: (table: DiagramTable & { columns: Column[] }) => void
  onTableDeleted?: (tableId: string) => void
  onRelationshipCreated?: (relationship: Relationship) => void
  onRelationshipDeleted?: (relationshipId: string) => void
}

export interface UseWhiteboardCollaborationReturn {
  // Send events
  updateTablePosition: (tableId: string, x: number, y: number) => void
  moveCursor: (x: number, y: number) => void

  // Connection state
  isConnected: boolean
  connectionError: Error | null

  // Other users' cursors
  otherCursors: Array<{
    userId: string
    userName?: string
    x: number
    y: number
  }>
}

export function useWhiteboardCollaboration(
  options: UseWhiteboardCollaborationOptions,
): UseWhiteboardCollaborationReturn
```

**Usage Example**:

```typescript
const { updateTablePosition, isConnected, otherCursors } =
  useWhiteboardCollaboration({
    whiteboardId: 'whiteboard-123',
    userId: 'user-xyz',
    userName: 'Alice',
    onTablePositionUpdate: (id, x, y) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id ? { ...node, position: { x, y } } : node,
        ),
      )
    },
  })
```

---

## Utility Function Contracts

### convertTablesToNodes

```typescript
/**
 * Convert database tables to React Flow nodes
 */
export function convertTablesToNodes(
  tables: Array<DiagramTable & { columns: Column[] }>,
  options?: {
    showMode?: 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS'
    activeTableId?: string | null
    hoveredTableId?: string | null
  },
): TableNodeType[]
```

---

### convertRelationshipsToEdges

```typescript
/**
 * Convert database relationships to React Flow edges
 */
export function convertRelationshipsToEdges(
  relationships: Array<
    Relationship & {
      sourceColumn: Column
      targetColumn: Column
    }
  >,
  options?: {
    activeTableId?: string | null
  },
): RelationshipEdgeType[]
```

---

### computeELKLayout

```typescript
/**
 * Compute auto-layout using ELK algorithm
 */
export function computeELKLayout(
  nodes: TableNodeType[],
  edges: RelationshipEdgeType[],
  options?: {
    direction?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
    spacing?: number
  },
): Promise<TableNodeType[]>
```

---

### highlightNodesAndEdges

```typescript
/**
 * Calculate highlighting state for nodes and edges
 */
export function highlightNodesAndEdges(
  nodes: TableNodeType[],
  edges: RelationshipEdgeType[],
  activeTableId: string | null,
  hoveredTableId: string | null,
): {
  nodes: TableNodeType[]
  edges: RelationshipEdgeType[]
}
```

---

### createHandleId

```typescript
/**
 * Generate unique handle ID for column connection point
 */
export function createHandleId(tableId: string, columnId: string): string
```

---

### parseHandleId

```typescript
/**
 * Parse handle ID back to table and column IDs
 */
export function parseHandleId(handleId: string): {
  tableId: string
  columnId: string
}
```

---

## React Flow Configuration Contracts

### nodeTypes Registry

```typescript
import { TableNode } from './components/whiteboard/TableNode'

export const nodeTypes = {
  table: TableNode,
} as const

export type NodeType = keyof typeof nodeTypes
```

---

### edgeTypes Registry

```typescript
import { RelationshipEdge } from './components/whiteboard/RelationshipEdge'

export const edgeTypes = {
  relationship: RelationshipEdge,
} as const

export type EdgeType = keyof typeof edgeTypes
```

---

### Default React Flow Props

```typescript
export const defaultReactFlowProps = {
  minZoom: 0.1,
  maxZoom: 2,
  defaultViewport: { x: 0, y: 0, zoom: 1 },
  snapToGrid: false,
  snapGrid: [15, 15] as [number, number],
  nodesDraggable: true,
  nodesConnectable: false, // Read-only connections
  elementsSelectable: true,
  selectNodesOnDrag: false,
  panOnDrag: [1, 2] as number[], // Middle and right mouse button
  deleteKeyCode: null, // Disable deletion via keyboard
  multiSelectionKeyCode: 'Control',
} as const
```

---

## Constants

### Zoom Constraints

```typescript
export const ZOOM_CONSTRAINTS = {
  MIN: 0.1,
  MAX: 2,
  DEFAULT: 1,
  STEP: 0.1,
} as const
```

### Layout Constraints

```typescript
export const LAYOUT_CONSTRAINTS = {
  NODE_SPACING: 40,
  LAYER_SPACING: 120,
  COMPONENT_SPACING: 80,
  DEFAULT_NODE_WIDTH: 250,
  DEFAULT_NODE_HEIGHT: 150,
} as const
```

### Z-Index Layers

```typescript
export const Z_INDEX = {
  NODE_DEFAULT: 1,
  NODE_HIGHLIGHTED: 1000,
  EDGE_DEFAULT: 1,
  EDGE_HIGHLIGHTED: 1000,
} as const
```

---

## Type Exports

All types are exported from a central module for consistency:

```typescript
// src/lib/react-flow/types.ts
export type {
  // Component props
  ReactFlowCanvasProps,
  TableNodeProps,
  RelationshipEdgeProps,

  // Hook returns
  UseReactFlowCanvasOptions,
  UseReactFlowCanvasReturn,
  UseHighlightingOptions,
  UseHighlightingReturn,
  UseAutoLayoutOptions,
  UseAutoLayoutReturn,
  UseWhiteboardCollaborationOptions,
  UseWhiteboardCollaborationReturn,

  // Data models (re-exported from data-model.md)
  ShowMode,
  TableNodeData,
  TableNodeType,
  RelationshipEdgeData,
  RelationshipEdgeType,
  ReactFlowViewport,
  CanvasInteractionState,
  ELKGraph,
  ELKNode,
  ELKEdge,
  HighlightResult,
  EdgeMap,
}

export {
  // Constants
  ZOOM_CONSTRAINTS,
  LAYOUT_CONSTRAINTS,
  Z_INDEX,

  // Registries
  nodeTypes,
  edgeTypes,

  // Default props
  defaultReactFlowProps,
}
```

---

## Compatibility Notes

### React Flow Version

This contract is designed for **@xyflow/react v12.9.2**. Breaking changes in future React Flow versions may require contract updates.

### Backward Compatibility

All type contracts maintain backward compatibility with:

- Existing Prisma database schema (DiagramTable, Column, Relationship)
- Existing TanStack Query data fetching patterns
- Existing WebSocket event payloads
- Existing position coordinate system (x, y in pixels)

### Migration Path

When migrating from Konva to React Flow:

1. Konva `CanvasViewport` → React Flow `ReactFlowViewport`
2. Konva `TableShape` → React Flow `TableNodeType`
3. Konva `RelationshipLine` → React Flow `RelationshipEdgeType`
4. Konva `Stage.position()` → React Flow `setViewport()`
5. Konva `Layer.batchDraw()` → React Flow automatic re-render

---

## Summary

These type contracts provide:

- **Type Safety**: Full TypeScript coverage for all React Flow integration
- **API Stability**: Clear public API for components, hooks, and utilities
- **Documentation**: Self-documenting code via TypeScript types
- **Backward Compatibility**: Seamless migration from Konva without data changes
- **Future-Proofing**: Versioned contracts that can evolve with React Flow updates

All contracts are enforced at compile-time via TypeScript and at runtime via Zod schemas (where applicable).
