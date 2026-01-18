# Quick Start: React Flow Whiteboard Development

**Feature**: 003-react-flow-migration
**Date**: 2025-11-15

## Overview

This guide helps developers quickly understand and work with the React Flow-based whiteboard implementation. Read this first before diving into the codebase.

## Prerequisites

- Familiarity with React 19 and TypeScript
- Basic understanding of React Flow concepts (nodes, edges, handles)
- Understanding of the existing Prisma database schema
- Node.js 18+ and Bun installed

## Quick Reference

### Key Files

| File                                             | Purpose                                     |
| ------------------------------------------------ | ------------------------------------------- |
| `src/components/whiteboard/ReactFlowCanvas.tsx`  | Main canvas wrapper component               |
| `src/components/whiteboard/TableNode.tsx`        | Custom table node component                 |
| `src/components/whiteboard/RelationshipEdge.tsx` | Custom relationship edge component          |
| `src/lib/react-flow/convert-to-nodes.ts`         | Convert database tables to React Flow nodes |
| `src/lib/react-flow/convert-to-edges.ts`         | Convert relationships to React Flow edges   |
| `src/lib/react-flow/elk-layout.ts`               | ELK auto-layout integration                 |
| `src/lib/react-flow/highlighting.ts`             | Node/edge highlighting logic                |
| `src/hooks/use-whiteboard-collaboration.ts`      | WebSocket real-time collaboration           |

### Key Concepts

**Nodes**: Tables rendered as draggable React components
**Edges**: Relationships rendered as SVG paths with cardinality markers
**Handles**: Connection points on nodes (one per column)
**Highlighting**: Visual feedback when tables are selected/hovered
**Auto-layout**: ELK algorithm for automatic table positioning

## 5-Minute Setup

### 1. Install Dependencies

```bash
# Install ELK layout engine (React Flow already installed)
bun add elkjs@0.10.0
```

### 2. Run the Development Server

```bash
bun run dev
```

Open `http://localhost:3000` and navigate to a whiteboard.

### 3. View the React Flow Canvas

The main canvas is at `/whiteboard/$whiteboardId` route.

## Core Workflows

### Adding a New Table to the Canvas

```typescript
import { convertTableToNode } from '@/lib/react-flow/convert-to-nodes'

// Get table data from database
const newTable = await db.diagramTable.create({
  data: {
    name: 'users',
    whiteboardId: 'whiteboard-123',
    positionX: 100,
    positionY: 100,
  },
  include: { columns: true },
})

// Convert to React Flow node
const newNode = convertTableToNode(newTable)

// Add to canvas
setNodes((nodes) => [...nodes, newNode])
```

### Moving a Table

```typescript
import { extractTablePosition } from '@/lib/react-flow/convert-to-nodes'

// React Flow handles drag automatically, just save position on drag stop
const handleNodeDragStop = async (event: React.MouseEvent, node: Node) => {
  const { id, positionX, positionY } = extractTablePosition(node)

  // Save to database
  await db.diagramTable.update({
    where: { id },
    data: { positionX, positionY },
  })

  // Broadcast to other users via WebSocket
  socket.emit('table:position-update', { tableId: id, positionX, positionY })
}
```

### Highlighting Related Tables

```typescript
import { highlightNodesAndEdges } from '@/lib/react-flow/highlighting'

// When user clicks a table
const handleNodeClick = (event: React.MouseEvent, node: Node) => {
  setActiveTableId(node.id)
}

// Automatically apply highlighting when activeTableId changes
useEffect(() => {
  const { nodes: highlighted, edges: highlightedEdges } =
    highlightNodesAndEdges(nodes, edges, activeTableId, hoveredTableId)

  setNodes(highlighted)
  setEdges(highlightedEdges)
}, [activeTableId, hoveredTableId])
```

### Running Auto-Layout

```typescript
import { computeELKLayout } from '@/lib/react-flow/elk-layout'

const handleAutoLayout = async () => {
  // Compute layout in Web Worker (non-blocking)
  const layoutedNodes = await computeELKLayout(nodes, edges, {
    direction: 'RIGHT',
    spacing: 40,
  })

  // Apply new positions
  setNodes(layoutedNodes)

  // Fit view to show all tables
  setTimeout(() => fitView({ padding: 0.2 }), 100)

  // Save positions to database (batch update)
  const positions = layoutedNodes.map((node) => ({
    id: node.id,
    positionX: node.position.x,
    positionY: node.position.y,
  }))

  await db.diagramTable.updateMany(positions)
}
```

## Common Patterns

### Pattern 1: Fetching Whiteboard Data

```typescript
import { useQuery } from '@tanstack/react-query'
import {
  convertTablesToNodes,
  convertRelationshipsToEdges,
} from '@/lib/react-flow'

function useWhiteboardData(whiteboardId: string) {
  // Fetch tables
  const { data: tables } = useQuery({
    queryKey: ['tables', whiteboardId],
    queryFn: () =>
      db.diagramTable.findMany({
        where: { whiteboardId },
        include: { columns: true },
      }),
  })

  // Fetch relationships
  const { data: relationships } = useQuery({
    queryKey: ['relationships', whiteboardId],
    queryFn: () =>
      db.relationship.findMany({
        where: { whiteboardId },
        include: { sourceColumn: true, targetColumn: true },
      }),
  })

  // Convert to React Flow format
  const nodes = useMemo(
    () => (tables ? convertTablesToNodes(tables) : []),
    [tables],
  )

  const edges = useMemo(
    () => (relationships ? convertRelationshipsToEdges(relationships) : []),
    [relationships],
  )

  return { nodes, edges }
}
```

### Pattern 2: Custom Node with Handles

```typescript
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { TableNodeData } from '@/lib/react-flow/types'

export function TableNode({ data }: NodeProps<TableNodeData>) {
  const { table, isActiveHighlighted, showMode } = data

  return (
    <div className="table-node">
      {/* Table header */}
      <div className="table-header">{table.name}</div>

      {/* Columns */}
      {showMode !== 'TABLE_NAME' && (
        <div className="columns">
          {table.columns.map((column) => (
            <div key={column.id} className="column">
              {column.isPrimaryKey && <KeyIcon />}
              <span>{column.name}</span>

              {/* Connection handle for this column */}
              <Handle
                id={createHandleId(table.id, column.id)}
                type="source"
                position={Position.Right}
                className="handle"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

### Pattern 3: Real-time Collaboration

```typescript
import { useEffect } from 'react'
import { io } from 'socket.io-client'

function useCollaboration(whiteboardId: string, setNodes, setEdges) {
  useEffect(() => {
    const socket = io('/whiteboard', { query: { whiteboardId } })

    // Listen for position updates from other users
    socket.on('table:position-updated', ({ tableId, positionX, positionY }) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === tableId
            ? { ...node, position: { x: positionX, y: positionY } }
            : node,
        ),
      )
    })

    // Send position update when dragging
    const sendPositionUpdate = (tableId: string, x: number, y: number) => {
      socket.emit('table:position-update', {
        whiteboardId,
        tableId,
        positionX: x,
        positionY: y,
      })
    }

    return () => {
      socket.disconnect()
    }
  }, [whiteboardId])
}
```

### Pattern 4: Memoized Node/Edge Types

```typescript
import { useMemo } from 'react'
import { TableNode } from './TableNode'
import { RelationshipEdge } from './RelationshipEdge'

function ReactFlowCanvas() {
  // Memoize to prevent re-creating on every render
  const nodeTypes = useMemo(() => ({
    table: TableNode,
  }), [])

  const edgeTypes = useMemo(() => ({
    relationship: RelationshipEdge,
  }), [])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      // ...
    />
  )
}
```

## Debugging Tips

### 1. Inspect Node/Edge Data

```typescript
// In browser console
console.log('Nodes:', nodes)
console.log('Edges:', edges)

// Or use React DevTools to inspect component props
```

### 2. Visualize Handle IDs

```typescript
// Temporarily make handles visible
<Handle
  id={handleId}
  type="source"
  position={Position.Right}
  style={{ background: 'red', width: 8, height: 8 }} // Make visible
/>
```

### 3. Check Edge Connections

```typescript
// Verify source/target handles exist
edges.forEach((edge) => {
  const sourceNode = nodes.find((n) => n.id === edge.source)
  const targetNode = nodes.find((n) => n.id === edge.target)

  if (!sourceNode) console.error('Missing source node:', edge.source)
  if (!targetNode) console.error('Missing target node:', edge.target)
})
```

### 4. Debug Auto-Layout

```typescript
// Log layout computation time
const start = performance.now()
const layouted = await computeELKLayout(nodes, edges)
console.log('Layout took:', performance.now() - start, 'ms')
```

### 5. Monitor WebSocket Events

```typescript
socket.onAny((eventName, ...args) => {
  console.log('WebSocket event:', eventName, args)
})
```

## Performance Optimization Checklist

- [ ] Use `useMemo` for node/edge type registries
- [ ] Use `useMemo` for data conversion (tables → nodes, relationships → edges)
- [ ] Use `useCallback` for event handlers
- [ ] Enable React Flow virtualization (enabled by default)
- [ ] Run ELK layout in Web Worker (see `elk-layout.worker.ts`)
- [ ] Batch position updates (don't save on every drag, save on drag stop)
- [ ] Debounce WebSocket cursor updates (max 60 updates/second)

## Testing

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest'
import { convertTableToNode } from '@/lib/react-flow/convert-to-nodes'

describe('convertTableToNode', () => {
  it('should convert DiagramTable to React Flow Node', () => {
    const table = {
      id: 'table-123',
      name: 'users',
      positionX: 100,
      positionY: 200,
      columns: [
        { id: 'col-1', name: 'id', isPrimaryKey: true },
        { id: 'col-2', name: 'email', isPrimaryKey: false },
      ],
    }

    const node = convertTableToNode(table)

    expect(node.id).toBe('table-123')
    expect(node.type).toBe('table')
    expect(node.position).toEqual({ x: 100, y: 200 })
    expect(node.data.table).toEqual(table)
  })
})
```

### Integration Test Example

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowCanvas } from '@/components/whiteboard/ReactFlowCanvas'

describe('ReactFlowCanvas', () => {
  it('should render tables and allow dragging', async () => {
    const { container } = render(
      <ReactFlowCanvas whiteboardId="test-whiteboard" />
    )

    // Wait for tables to load
    await screen.findByText('users')

    // Find table node
    const tableNode = screen.getByText('users').closest('.react-flow__node')

    // Simulate drag
    fireEvent.mouseDown(tableNode)
    fireEvent.mouseMove(tableNode, { clientX: 150, clientY: 150 })
    fireEvent.mouseUp(tableNode)

    // Verify position updated
    expect(tableNode).toHaveStyle({ transform: 'translate(150px, 150px)' })
  })
})
```

## Troubleshooting

### Issue: Edges not rendering

**Solution**: Verify that `sourceHandle` and `targetHandle` IDs match Handle `id` props on nodes.

```typescript
// Edge
sourceHandle: createHandleId(sourceTableId, sourceColumnId)

// Node
<Handle id={createHandleId(tableId, columnId)} />
```

### Issue: Tables jump after auto-layout

**Solution**: Use `setTimeout` before calling `fitView()` to allow React Flow to measure new positions.

```typescript
setNodes(layoutedNodes)
setTimeout(() => fitView({ padding: 0.2 }), 100)
```

### Issue: Highlighting not working

**Solution**: Ensure highlighting logic runs in `useEffect` when selection state changes.

```typescript
useEffect(() => {
  const highlighted = highlightNodesAndEdges(nodes, edges, activeTableId, null)
  setNodes(highlighted.nodes)
  setEdges(highlighted.edges)
}, [activeTableId]) // Dependency: re-run when activeTableId changes
```

### Issue: WebSocket updates not reflecting

**Solution**: Check that `setNodes`/`setEdges` callbacks use functional updates.

```typescript
// ✅ Correct: Functional update
setNodes((nds) => nds.map((node) => ...))

// ❌ Wrong: Direct update (stale closure)
setNodes(nodes.map((node) => ...))
```

## Next Steps

1. **Read the Research**: See `research.md` for architectural decisions and alternatives considered
2. **Review Data Model**: See `data-model.md` for complete type definitions
3. **Study Contracts**: See `contracts/` for WebSocket events and type contracts
4. **Explore Liam ERD**: Reference implementation at `/home/shotup/programing/react/liam/`
5. **Run Tests**: `bun test` to verify your changes

## Helpful Resources

- **React Flow Docs**: https://reactflow.dev/
- **ELK Docs**: https://www.eclipse.org/elk/documentation.html
- **Liam ERD Guide**: `.claude/liam-whiteboard-implementation.md`
- **Original Spec**: `specs/001-collaborative-er-whiteboard/spec.md`

## Questions?

If you encounter issues not covered in this guide:

1. Check existing tests in `tests/unit/react-flow/`
2. Review Liam ERD implementation for similar patterns
3. Consult React Flow documentation
4. Ask in team chat with specific code examples

---

**Pro Tip**: Keep React DevTools and React Flow DevTools open while developing. They're invaluable for debugging node/edge state and interactions.
