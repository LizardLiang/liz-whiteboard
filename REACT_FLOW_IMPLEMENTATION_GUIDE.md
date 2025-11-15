# React Flow Implementation Guide (If Migration Needed)

**Status**: Reference Document
**Purpose**: Quick implementation patterns if React Flow migration becomes necessary
**Last Updated**: 2025-11-15

---

## Table of Contents

1. [Setup & Installation](#setup--installation)
2. [Custom Database Table Node](#custom-database-table-node)
3. [Custom Cardinality Edge](#custom-cardinality-edge)
4. [Integration with d3-force Layout](#integration-with-d3-force-layout)
5. [Dark Mode Implementation](#dark-mode-implementation)
6. [Real-Time Collaboration Sync](#real-time-collaboration-sync)
7. [Performance Optimization](#performance-optimization-optimization)
8. [Common Pitfalls](#common-pitfalls)

---

## Setup & Installation

### Installation

```bash
bun add @xyflow/react@12.9.2
bun add -d @types/react-flow  # TypeScript types (built-in with @xyflow/react)
```

### Basic Component Structure

```typescript
import React, { useCallback } from 'react';
import ReactFlow, {
  Node, Edge,
  Controls, Background,
  useNodesState, useEdgesState,
  NodeTypes, EdgeTypes,
  Connection, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Import custom node/edge components
import TableNode from './TableNode';
import CardinalityEdge from './CardinalityEdge';

const nodeTypes: NodeTypes = {
  table: TableNode,
};

const edgeTypes: EdgeTypes = {
  cardinality: CardinalityEdge,
};

export default function WhiteboardCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onlyRenderVisibleElements={true}  // Optimization: only render visible nodes
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
```

---

## Custom Database Table Node

### Component Structure

```typescript
import React from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import './TableNode.css';

export interface Column {
  id: string;
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface TableNodeData {
  name: string;
  columns: Column[];
}

/**
 * Memoized table node component
 * - IMPORTANT: Must be memoized to prevent unnecessary re-renders
 * - Each column has unique handles for relationship connections
 */
const TableNode = React.memo(
  ({ data, selected, isConnecting }: NodeProps<TableNodeData>) => {
    return (
      <div
        className={`table-node ${selected ? 'selected' : ''} ${
          isConnecting ? 'connecting' : ''
        }`}
      >
        {/* Table Header with Name */}
        <div className="table-header">
          <span className="table-name">{data.name}</span>
        </div>

        {/* Column List */}
        <div className="table-columns">
          {data.columns.map((column) => (
            <div
              key={column.id}
              className={`column-row ${
                column.isPrimaryKey ? 'primary-key' : ''
              } ${column.isForeignKey ? 'foreign-key' : ''}`}
            >
              {/* Target Handle (for incoming relationships) */}
              <Handle
                type="target"
                position={Position.Left}
                id={`${data.name}_${column.id}_target`}
                isConnectable={true}
              />

              {/* Column Content */}
              <div className="column-content">
                {/* Key Indicator */}
                {column.isPrimaryKey && (
                  <span className="key-indicator" title="Primary Key">
                    🔑
                  </span>
                )}
                {column.isForeignKey && (
                  <span className="key-indicator" title="Foreign Key">
                    🔗
                  </span>
                )}

                {/* Column Name and Type */}
                <span className="column-name">{column.name}</span>
                <span className="column-type">{column.type}</span>
              </div>

              {/* Source Handle (for outgoing relationships) */}
              <Handle
                type="source"
                position={Position.Right}
                id={`${data.name}_${column.id}_source`}
                isConnectable={true}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }
);

TableNode.displayName = 'TableNode';

export default TableNode;
```

### Styling (TableNode.css)

```css
.table-node {
  border: 1.5px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  font-size: 12px;
  font-family: monospace;
  overflow: hidden;
  min-width: 180px;
  transition: all 0.2s ease;
}

.table-node.selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-light);
}

.table-node.connecting {
  opacity: 0.5;
}

.table-header {
  background: var(--color-primary);
  color: white;
  padding: 8px 12px;
  font-weight: bold;
  text-align: center;
  border-bottom: 1px solid var(--color-primary-dark);
}

.table-columns {
  max-height: 400px;
  overflow-y: auto;
}

.column-row {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  gap: 4px;
  position: relative;
  height: 32px;
}

.column-row:last-child {
  border-bottom: none;
}

.column-row.primary-key {
  background: var(--color-pk-bg);
}

.column-row.foreign-key {
  background: var(--color-fk-bg);
}

.column-row:hover {
  background: var(--color-hover);
}

.column-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.key-indicator {
  flex-shrink: 0;
  font-size: 14px;
  line-height: 1;
}

.column-name {
  font-weight: 500;
  flex-shrink: 0;
}

.column-type {
  color: var(--color-text-secondary);
  font-size: 11px;
  flex-shrink: 0;
}

/* Handle styling */
.react-flow__handle {
  width: 6px;
  height: 6px;
  border: 2px solid var(--color-bg);
  background: var(--color-primary);
  border-radius: 50%;
  cursor: crosshair;
}

.react-flow__handle.connectingNode {
  background: var(--color-success);
}

/* Dark mode */
.dark .table-node {
  border-color: var(--color-border-dark);
  background: var(--color-bg-dark);
}

.dark .table-header {
  background: var(--color-primary-dark);
}

.dark .react-flow__handle {
  border-color: var(--color-bg-dark);
}
```

### TypeScript Types

```typescript
export type TableNode = Node<TableNodeData, 'table'>;

export function createTableNode(
  id: string,
  name: string,
  columns: Column[],
  position: { x: number; y: number }
): TableNode {
  return {
    id,
    type: 'table',
    position,
    data: { name, columns },
  };
}
```

---

## Custom Cardinality Edge

### Component Structure

```typescript
import React, { CSSProperties } from 'react';
import {
  EdgeProps, BaseEdge, getStraightPath, useReactFlow,
} from '@xyflow/react';
import './CardinalityEdge.css';

export type Cardinality =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many';

export interface CardinalityEdgeData {
  label?: string;
  cardinality?: Cardinality;
}

/**
 * Memoized cardinality edge component
 * Renders crow's foot notation with optional label
 */
const CardinalityEdge = React.memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    data,
    selected,
  }: EdgeProps<CardinalityEdgeData>) => {
    const [edgePath, labelX, labelY] = getStraightPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
    });

    const markerId = `cardinality-${id}`;
    const markerEndId = `marker-${data?.cardinality || 'one-to-many'}-${id}`;

    return (
      <>
        {/* SVG Marker Definitions - Add to defs once per edge */}
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>
            {/* One-to-One marker (single line) */}
            <marker
              id={`marker-one-to-one-${id}`}
              markerWidth="20"
              markerHeight="20"
              viewBox="-10 -10 20 20"
              markerUnits="strokeWidth"
              orient="auto"
              refX="0"
              refY="0"
            >
              <line
                x1="-8"
                y1="0"
                x2="-2"
                y2="0"
                stroke="currentColor"
                strokeWidth="2"
              />
            </marker>

            {/* One-to-Many marker (crow's foot) */}
            <marker
              id={`marker-one-to-many-${id}`}
              markerWidth="20"
              markerHeight="20"
              viewBox="-10 -10 20 20"
              markerUnits="strokeWidth"
              orient="auto"
              refX="0"
              refY="0"
            >
              <polyline
                points="0,0 -5,-5 0,-3 5,-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>

            {/* Many-to-One marker (reverse crow's foot) */}
            <marker
              id={`marker-many-to-one-${id}`}
              markerWidth="20"
              markerHeight="20"
              viewBox="-10 -10 20 20"
              markerUnits="strokeWidth"
              orient="auto"
              refX="0"
              refY="0"
            >
              <polyline
                points="0,0 5,-5 0,-3 -5,-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>

            {/* Many-to-Many marker (both ends crow's foot) */}
            <marker
              id={`marker-many-to-many-${id}`}
              markerWidth="20"
              markerHeight="20"
              viewBox="-10 -10 20 20"
              markerUnits="strokeWidth"
              orient="auto"
              refX="0"
              refY="0"
            >
              <polyline
                points="0,0 -5,-5 0,-3 5,-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          </defs>
        </svg>

        {/* Edge Path */}
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={`url(#marker-${data?.cardinality || 'one-to-many'}-${id})`}
          className={`cardinality-edge ${selected ? 'selected' : ''}`}
          style={edgeStyle(selected)}
        />

        {/* Edge Label */}
        {data?.label && (
          <text
            x={labelX}
            y={labelY}
            className="edge-label"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {data.label}
          </text>
        )}
      </>
    );
  }
);

function edgeStyle(selected: boolean): CSSProperties {
  return {
    stroke: selected ? 'var(--color-primary)' : 'var(--color-text)',
    strokeWidth: selected ? 2.5 : 2,
    opacity: selected ? 1 : 0.6,
  };
}

CardinalityEdge.displayName = 'CardinalityEdge';

export default CardinalityEdge;
```

### Styling (CardinalityEdge.css)

```css
.cardinality-edge {
  stroke: var(--color-text);
  stroke-width: 2px;
  opacity: 0.6;
  transition: all 0.2s ease;
}

.cardinality-edge.selected {
  stroke: var(--color-primary);
  stroke-width: 2.5px;
  opacity: 1;
  filter: drop-shadow(0 0 4px var(--color-primary-light));
}

.edge-label {
  font-size: 12px;
  background: var(--color-bg);
  padding: 2px 6px;
  border-radius: 3px;
  pointer-events: none;
  font-weight: 500;
}

.dark .edge-label {
  background: var(--color-bg-dark);
}
```

### TypeScript Types

```typescript
export type CardinalityEdgeType = Edge<CardinalityEdgeData, 'cardinality'>;

export function createCardinalityEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
  cardinality: Cardinality = 'one-to-many',
  label?: string
): CardinalityEdgeType {
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: 'cardinality',
    data: { cardinality, label },
  };
}
```

---

## Integration with d3-force Layout

### Layout Service

```typescript
import { ForceLink, Simulation } from 'd3-force';
import { Node, Edge } from '@xyflow/react';
import { TableNodeData } from './TableNode';

export async function computeLayout(
  nodes: Node<TableNodeData>[],
  edges: Edge[],
  width: number = 1024,
  height: number = 768
): Promise<Array<{ id: string; x: number; y: number }>> {
  return new Promise((resolve) => {
    const simulation = new Simulation<Node<TableNodeData>>(nodes)
      .force('link', forceLink(edges).distance(150).strength(0.1))
      .force('charge', forceManyBody().strength(-500))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collision', forceCollide().radius(80));

    simulation.on('end', () => {
      resolve(
        nodes.map((node) => ({
          id: node.id,
          x: node.x ?? 0,
          y: node.y ?? 0,
        }))
      );
    });

    // Run simulation for fixed iterations
    simulation.tick(300);
  });
}

/**
 * Apply layout results to nodes
 * Called after force simulation completes
 */
export function applyLayout(
  nodes: Node<TableNodeData>[],
  layoutResults: Array<{ id: string; x: number; y: number }>
): Node<TableNodeData>[] {
  const layoutMap = new Map(layoutResults.map((r) => [r.id, r]));

  return nodes.map((node) => {
    const layout = layoutMap.get(node.id);
    return layout ? { ...node, position: { x: layout.x, y: layout.y } } : node;
  });
}
```

### Using Layout in Component

```typescript
const handleAutoLayout = useCallback(async () => {
  const layoutResults = await computeLayout(nodes, edges, canvasWidth, canvasHeight);
  const layoutedNodes = applyLayout(nodes, layoutResults);
  setNodes(layoutedNodes);
}, [nodes, edges, canvasWidth, canvasHeight, setNodes]);
```

---

## Dark Mode Implementation

### Theme Context Setup

```typescript
import { useTheme } from 'next-themes';
import { useEffect } from 'react';

export function useCanvasTheme() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const themeVars = {
    'color-primary': isDark ? '#3b82f6' : '#2563eb',
    'color-primary-dark': isDark ? '#1e40af' : '#1e3a8a',
    'color-primary-light': isDark ? '#93c5fd' : '#bfdbfe',
    'color-bg': isDark ? '#1f2937' : '#ffffff',
    'color-bg-dark': isDark ? '#111827' : '#f9fafb',
    'color-border': isDark ? '#374151' : '#e5e7eb',
    'color-border-dark': isDark ? '#1f2937' : '#d1d5db',
    'color-text': isDark ? '#f3f4f6' : '#111827',
    'color-text-secondary': isDark ? '#9ca3af' : '#6b7280',
    'color-success': isDark ? '#10b981' : '#059669',
    'color-pk-bg': isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(220, 252, 231, 0.5)',
    'color-fk-bg': isDark ? 'rgba(59, 130, 246, 0.1)' : 'rgba(219, 234, 254, 0.5)',
    'color-hover': isDark ? 'rgba(79, 70, 229, 0.1)' : 'rgba(238, 242, 255, 0.5)',
  };

  return { isDark, themeVars };
}
```

### CSS Variables Application

```typescript
export function WhiteboardCanvas() {
  const { themeVars } = useCanvasTheme();

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(themeVars).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, value);
    });
  }, [themeVars]);

  // ... rest of component
}
```

---

## Real-Time Collaboration Sync

### Sync Service

```typescript
import { Socket } from 'socket.io-client';
import { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';

export class WhiteboardSyncService {
  constructor(private socket: Socket, private whiteboardId: string) {}

  /**
   * Emit local node changes to other users
   */
  syncNodeChange(change: NodeChange) {
    this.socket.emit('node:change', {
      whiteboardId: this.whiteboardId,
      timestamp: Date.now(),
      change,
    });
  }

  /**
   * Emit local edge changes to other users
   */
  syncEdgeChange(change: EdgeChange) {
    this.socket.emit('edge:change', {
      whiteboardId: this.whiteboardId,
      timestamp: Date.now(),
      change,
    });
  }

  /**
   * Listen for remote changes
   */
  onNodeChange(callback: (change: NodeChange) => void) {
    this.socket.on('node:change', (data) => {
      // Verify timestamp ordering to avoid conflicts
      callback(data.change);
    });
  }

  onEdgeChange(callback: (change: EdgeChange) => void) {
    this.socket.on('edge:change', (data) => {
      callback(data.change);
    });
  }
}
```

### Integration in Component

```typescript
const handleNodesChange = useCallback(
  (changes: NodeChange[]) => {
    // Update local state
    onNodesChange(changes);

    // Sync with other users
    changes.forEach((change) => {
      syncService.syncNodeChange(change);
    });
  },
  [onNodesChange, syncService]
);
```

---

## Performance Optimization

### Essential Optimizations

```typescript
// 1. Memoize node and edge components
const TableNode = React.memo(TableNodeComponent);
const CardinalityEdge = React.memo(CardinalityEdgeComponent);

// 2. Separate selection state to avoid full re-renders
const selectedNodeIds = useStore(
  (state) => state.getNode(selectedNodeId)?.selected
);

// 3. Use useCallback for handlers
const handleNodesChange = useCallback((changes) => {
  onNodesChange(changes);
}, [onNodesChange]);

// 4. Enable viewport culling
<ReactFlow
  onlyRenderVisibleElements={true}
  // ... other props
/>

// 5. Throttle drag events
const throttledNodeChange = useMemo(
  () => throttle(handleNodesChange, 16), // ~60fps
  [handleNodesChange]
);
```

### Performance Monitoring

```typescript
export function PerformanceMonitor() {
  useEffect(() => {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 16) {
          console.warn(`Slow operation: ${entry.name} took ${entry.duration}ms`);
        }
      }
    });

    observer.observe({ entryTypes: ['measure'] });
    return () => observer.disconnect();
  }, []);

  return null;
}
```

---

## Common Pitfalls

### 1. Forgetting to Memoize Components
**Problem**: Every render creates new component references, causing all nodes to re-render.
**Solution**: Use `React.memo()` on TableNode and CardinalityEdge.

### 2. Handle ID Mismatches
**Problem**: Edge's `sourceHandle` doesn't match node's handle ID.
**Solution**: Use consistent naming: `${tableName}_${columnId}_source`.

### 3. Not Using useCallback for Handlers
**Problem**: Inline arrow functions cause infinite re-renders.
**Solution**: Wrap all handlers in `useCallback`.

### 4. Forgetting onlyRenderVisibleElements
**Problem**: All nodes render even when off-screen (performance issue with 500+ nodes).
**Solution**: Always set `onlyRenderVisibleElements={true}`.

### 5. Theme Variables Not Updating
**Problem**: Dark mode toggle doesn't update canvas colors.
**Solution**: Use CSS variables and update them in useEffect when theme changes.

### 6. SVG Markers in Wrong Scope
**Problem**: SVG marker definitions inside component cause duplicates.
**Solution**: Define markers once per edge using unique IDs with edge ID.

### 7. Not Handling Network Delays
**Problem**: Rapid changes cause conflict with remote updates.
**Solution**: Include timestamps and implement last-write-wins conflict resolution.

### 8. Layout Algorithm Blocking UI
**Problem**: D3-force computation freezes the main thread.
**Solution**: Run simulation in Web Worker (see layout-worker.ts in project).

---

## Useful Commands

```bash
# Install with TypeScript
bun add @xyflow/react@12.9.2

# Install optional layout libraries
bun add d3-force
bun add -d @types/d3-force

# Type checking
bun run check

# Build
bun run build

# Test
bun run test
```

---

## Additional Resources

- **React Flow Documentation**: https://reactflow.dev
- **API Reference**: https://reactflow.dev/api-reference
- **Examples**: https://reactflow.dev/examples
- **Performance Guide**: https://reactflow.dev/learn/advanced-use/performance
- **TypeScript Guide**: https://reactflow.dev/learn/advanced-use/typescript

---

**Note**: This guide is for reference only. Current recommendation is to continue with Konva implementation. Use this if migration becomes necessary in the future.
