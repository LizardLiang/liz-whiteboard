# React Flow Component Contracts

**Date**: 2025-11-15
**Branch**: `002-react-flow-migration`

## Overview

This document specifies the component interfaces, props, and behaviors for React Flow-based ER diagram components.

**Note**: Migration to React Flow is not recommended based on research. This serves as reference if proceeding.

## Core Components

### ReactFlowCanvas

Main wrapper component that replaces Konva's Canvas component.

#### Props

```typescript
export interface ReactFlowCanvasProps {
  /** Whiteboard ID for data loading */
  whiteboardId: string

  /** Canvas dimensions */
  width: number
  height: number

  /** Initial viewport state */
  initialViewport?: ReactFlowViewport

  /** Callback when viewport changes (zoom/pan) */
  onViewportChange?: (viewport: ReactFlowViewport) => void

  /** Enable/disable node dragging */
  nodesDraggable?: boolean

  /** Enable/disable edge interaction */
  edgesUpdatable?: boolean

  /** Theme: 'light' or 'dark' */
  theme?: 'light' | 'dark'

  /** Optional CSS class */
  className?: string

  /** Optional ref for programmatic control */
  reactFlowRef?: React.RefObject<ReactFlowInstance>
}
```

#### Behavior

```typescript
/**
 * ReactFlowCanvas component
 *
 * Responsibilities:
 * - Load tables and relationships from database
 * - Convert Prisma entities to React Flow nodes/edges
 * - Manage viewport state (zoom, pan)
 * - Handle user interactions (drag, select)
 * - Broadcast changes via WebSocket
 * - Apply remote updates from WebSocket
 *
 * Features:
 * - Built-in zoom controls
 * - Pan by dragging canvas
 * - Fit to screen button
 * - Minimap (optional)
 * - Background grid (optional)
 */
export function ReactFlowCanvas({
  whiteboardId,
  width,
  height,
  initialViewport,
  onViewportChange,
  nodesDraggable = true,
  edgesUpdatable = false,
  theme = 'light',
  className = '',
  reactFlowRef,
}: ReactFlowCanvasProps): JSX.Element
```

#### Usage Example

```typescript
import { ReactFlowCanvas } from '@/components/whiteboard/ReactFlowCanvas';

function WhiteboardRoute() {
  const { whiteboardId } = useParams();
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  return (
    <ReactFlowCanvas
      whiteboardId={whiteboardId}
      width={window.innerWidth}
      height={window.innerHeight}
      initialViewport={viewport}
      onViewportChange={setViewport}
      theme="dark"
    />
  );
}
```

---

### TableNode

Custom React Flow node component for rendering database tables.

#### Props

```typescript
export interface TableNodeProps extends NodeProps<TableNodeData> {
  // NodeProps from React Flow includes:
  // - id: string
  // - data: TableNodeData
  // - selected: boolean
  // - dragging: boolean
  // - xPos, yPos: number
}
```

#### Component Structure

```typescript
/**
 * TableNode component
 *
 * Renders a database table with:
 * - Header (table name)
 * - Column list (name, type, constraints)
 * - Handles for each column (left=target, right=source)
 * - Visual indicators (PK, FK, unique, nullable)
 * - Hover/select states
 *
 * Layout:
 * ┌─────────────────────────┐
 * │ Table Name              │ ← Header
 * ├─────────────────────────┤
 * │ ○ id: INTEGER [PK] ○    │ ← Column row with handles
 * │ ○ email: VARCHAR(255) ○ │
 * │ ○ created_at: TIMESTAMP │
 * └─────────────────────────┘
 *   ↑                     ↑
 *   Left handle          Right handle
 *   (target)             (source)
 */
export function TableNode({
  id,
  data,
  selected,
  dragging,
}: TableNodeProps): JSX.Element
```

#### Handle Configuration

```typescript
// Each column has two handles
const generateHandles = (columns: Column[]) => {
  return columns.flatMap((col, index) => {
    const yOffset = calculateHandlePosition(index);

    return [
      // Target handle (left side)
      <Handle
        key={`${col.id}-target`}
        type="target"
        position={Position.Left}
        id={`${col.id}-target`}
        style={{ top: `${yOffset}px` }}
      />,
      // Source handle (right side)
      <Handle
        key={`${col.id}-source`}
        type="source"
        position={Position.Right}
        id={`${col.id}-source`}
        style={{ top: `${yOffset}px` }}
      />
    ];
  });
};
```

#### Styling

```css
.table-node {
  min-width: 200px;
  background: var(--table-bg);
  border: 2px solid var(--table-border);
  border-radius: 8px;
  font-family: 'Monaco', monospace;
}

.table-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-alpha);
}

.table-header {
  padding: 12px;
  background: var(--table-header-bg);
  font-weight: 600;
  border-bottom: 1px solid var(--table-border);
}

.column-row {
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.column-row:hover {
  background: var(--table-row-hover);
}

.pk-indicator {
  color: var(--pk-color);
  font-weight: 600;
}

.fk-indicator {
  color: var(--fk-color);
}
```

---

### RelationshipEdge

Custom React Flow edge component for rendering relationships.

#### Props

```typescript
export interface RelationshipEdgeProps extends EdgeProps<RelationshipEdgeData> {
  // EdgeProps from React Flow includes:
  // - id: string
  // - source, target: string (node IDs)
  // - sourceX, sourceY, targetX, targetY: number
  // - sourcePosition, targetPosition: Position
  // - data: RelationshipEdgeData
  // - selected: boolean
}
```

#### Component Structure

```typescript
/**
 * RelationshipEdge component
 *
 * Renders a relationship arrow with:
 * - Path connecting source to target handles
 * - Cardinality markers (crow's foot, etc.)
 * - Optional label
 * - Hover/select states
 *
 * Cardinality Notation:
 * - ONE_TO_ONE: Line with single dash on both ends
 * - ONE_TO_MANY: Line with crow's foot on "many" side
 * - MANY_TO_ONE: Line with crow's foot on "many" side
 * - MANY_TO_MANY: Line with crow's foot on both ends
 */
export function RelationshipEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: RelationshipEdgeProps): JSX.Element
```

#### Cardinality Markers

```typescript
// SVG marker definitions
const cardinalityMarkers = {
  ONE: (
    <g>
      <line x1="-10" y1="0" x2="0" y2="0" stroke="currentColor" strokeWidth="2" />
    </g>
  ),
  MANY: (
    <g>
      {/* Crow's foot */}
      <path
        d="M -10,-5 L 0,0 L -10,5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </g>
  )
};

// Apply markers based on cardinality type
const getMarkers = (cardinality: CardinalityType) => {
  switch (cardinality) {
    case 'ONE_TO_ONE':
      return { start: 'ONE', end: 'ONE' };
    case 'ONE_TO_MANY':
      return { start: 'ONE', end: 'MANY' };
    case 'MANY_TO_ONE':
      return { start: 'MANY', end: 'ONE' };
    case 'MANY_TO_MANY':
      return { start: 'MANY', end: 'MANY' };
  }
};
```

#### Edge Path Calculation

```typescript
import { getSmoothStepPath } from '@xyflow/react'

// Calculate edge path with smooth corners
const [edgePath, labelX, labelY] = getSmoothStepPath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  borderRadius: 8,
})
```

---

## Utility Components

### LayoutControls

Control panel for triggering automatic layout.

```typescript
export interface LayoutControlsProps {
  onTriggerLayout: () => void;
  isLayouting: boolean;
  onFitView: () => void;
}

export function LayoutControls({
  onTriggerLayout,
  isLayouting,
  onFitView
}: LayoutControlsProps): JSX.Element {
  return (
    <div className="layout-controls">
      <button
        onClick={onTriggerLayout}
        disabled={isLayouting}
        aria-label="Auto-arrange tables"
      >
        {isLayouting ? 'Arranging...' : 'Auto Layout'}
      </button>
      <button onClick={onFitView} aria-label="Fit diagram to screen">
        Fit to Screen
      </button>
    </div>
  );
}
```

### ZoomIndicator

Display current zoom level.

```typescript
export interface ZoomIndicatorProps {
  zoom: number;
}

export function ZoomIndicator({ zoom }: ZoomIndicatorProps): JSX.Element {
  return (
    <div className="zoom-indicator">
      {Math.round(zoom * 100)}%
    </div>
  );
}
```

---

## Custom Hooks

### useReactFlowSync

Hook for syncing React Flow state with WebSocket.

```typescript
export interface UseReactFlowSyncOptions {
  whiteboardId: string
  socket: Socket
  onRemoteUpdate?: (event: NodeUpdateBroadcast | EdgeUpdateBroadcast) => void
}

export interface UseReactFlowSyncReturn {
  nodes: TableNode[]
  edges: RelationshipEdge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  applyRemoteNodeUpdate: (event: NodeUpdateBroadcast) => void
  applyRemoteEdgeUpdate: (event: EdgeUpdateBroadcast) => void
}

/**
 * Sync React Flow state with WebSocket for real-time collaboration
 *
 * Usage:
 * const { nodes, edges, onNodesChange, onEdgesChange } = useReactFlowSync({
 *   whiteboardId,
 *   socket
 * });
 */
export function useReactFlowSync({
  whiteboardId,
  socket,
  onRemoteUpdate,
}: UseReactFlowSyncOptions): UseReactFlowSyncReturn
```

### useLayoutTrigger

Hook for triggering automatic layout.

```typescript
export interface UseLayoutTriggerOptions {
  nodes: TableNode[]
  edges: RelationshipEdge[]
  canvasWidth: number
  canvasHeight: number
  onLayoutComplete?: (
    positions: Record<string, { x: number; y: number }>,
  ) => void
}

export interface UseLayoutTriggerReturn {
  triggerLayout: () => Promise<void>
  isLayouting: boolean
  layoutMetadata: LayoutOutput['metadata'] | null
}

/**
 * Trigger automatic layout computation
 *
 * Usage:
 * const { triggerLayout, isLayouting } = useLayoutTrigger({
 *   nodes, edges, canvasWidth, canvasHeight
 * });
 */
export function useLayoutTrigger({
  nodes,
  edges,
  canvasWidth,
  canvasHeight,
  onLayoutComplete,
}: UseLayoutTriggerOptions): UseLayoutTriggerReturn
```

---

## Event Handlers

### Node Event Handlers

```typescript
// Node drag end - persist position to database
const onNodeDragStop: NodeDragHandler = (event, node) => {
  const updates = extractPositionUpdates(node as TableNode)
  await updateTablePosition(node.id, updates)

  // Broadcast via WebSocket (if not remote update)
  if (!isProcessingRemote) {
    socket.emit('node:update', {
      type: 'node:update',
      whiteboardId,
      nodeId: node.id,
      updates: { position: node.position },
      userId: currentUser.id,
      timestamp: Date.now(),
    })
  }
}

// Node selection
const onNodeClick: NodeMouseHandler = (event, node) => {
  setSelectedNodeIds([node.id])
}

// Node double-click - edit table
const onNodeDoubleClick: NodeMouseHandler = (event, node) => {
  openTableEditor(node.id)
}
```

### Edge Event Handlers

```typescript
// Edge selection
const onEdgeClick: EdgeMouseHandler = (event, edge) => {
  setSelectedEdgeIds([edge.id])
}

// Edge delete (if edgesUpdatable enabled)
const onEdgesDelete: OnEdgesDelete = (edges) => {
  edges.forEach(async (edge) => {
    await deleteRelationship(edge.id)

    // Broadcast via WebSocket
    socket.emit('edge:delete', {
      type: 'edge:delete',
      whiteboardId,
      edgeId: edge.id,
      userId: currentUser.id,
      timestamp: Date.now(),
    })
  })
}
```

---

## Theme Integration

### CSS Variables

```css
/* Light mode */
:root {
  --table-bg: #ffffff;
  --table-border: #e5e7eb;
  --table-header-bg: #f9fafb;
  --table-row-hover: #f3f4f6;
  --pk-color: #f59e0b;
  --fk-color: #3b82f6;
  --accent: #6366f1;
  --accent-alpha: rgba(99, 102, 241, 0.2);

  --edge-color: #9ca3af;
  --edge-selected: #6366f1;
  --edge-label-bg: #ffffff;
}

/* Dark mode */
[data-theme='dark'] {
  --table-bg: #1f2937;
  --table-border: #374151;
  --table-header-bg: #111827;
  --table-row-hover: #374151;
  --pk-color: #fbbf24;
  --fk-color: #60a5fa;
  --accent: #818cf8;
  --accent-alpha: rgba(129, 140, 248, 0.2);

  --edge-color: #6b7280;
  --edge-selected: #818cf8;
  --edge-label-bg: #1f2937;
}
```

### React Flow Theme Props

```typescript
// Apply theme to React Flow
<ReactFlow
  // ...other props
  style={{
    background: 'var(--canvas-bg)',
  }}
  // Default edge style
  defaultEdgeOptions={{
    style: { stroke: 'var(--edge-color)' },
  }}
/>
```

---

## Component Registration

### Node Types

```typescript
import { TableNode } from './TableNode';

export const nodeTypes = {
  erTable: TableNode,
};

// Usage
<ReactFlow nodeTypes={nodeTypes} ... />
```

### Edge Types

```typescript
import { RelationshipEdge } from './RelationshipEdge';

export const edgeTypes = {
  erRelationship: RelationshipEdge,
};

// Usage
<ReactFlow edgeTypes={edgeTypes} ... />
```

---

## Summary

This contract specification defines:

1. **ReactFlowCanvas**: Main wrapper component
2. **TableNode**: Custom node for database tables with column handles
3. **RelationshipEdge**: Custom edge with cardinality notation
4. **Utility Components**: Layout controls, zoom indicator
5. **Custom Hooks**: WebSocket sync, layout trigger
6. **Event Handlers**: Node/edge interaction patterns
7. **Theme Integration**: CSS variables for light/dark modes
8. **Component Registration**: Node and edge type configuration

All components follow React Flow conventions while implementing ER diagram-specific features.

**Note**: Based on research, migrating to React Flow is not recommended. See [research.md](../research.md) for details.
