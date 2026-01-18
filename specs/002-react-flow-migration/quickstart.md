# Quick Start: React Flow Migration

**Date**: 2025-11-15
**Branch**: `002-react-flow-migration`

## ⚠️ Important Notice

**Based on comprehensive research, migrating to React Flow is NOT RECOMMENDED.**

See [research.md](./research.md) for detailed findings. Key reasons:

- Konva performs better for ER diagrams (50+ FPS vs 35-40 FPS)
- Migration cost: 5-8 weeks with no significant feature gains
- Bundle size savings negligible (~48 KB, 5% of total)
- Konva's API better suited for ER diagram features

**Alternative recommendation**: Invest 4-6 hours optimizing the current Konva + d3-force implementation for same or better results.

---

This document provides quick-start instructions **if stakeholders decide to proceed** with React Flow migration despite research recommendations.

## Prerequisites

- Node.js 20+ and Bun installed
- Project cloned and dependencies installed
- PostgreSQL database running
- Existing Konva-based implementation functional

## Installation

### 1. Install React Flow

```bash
# Add React Flow (use @xyflow/react, not deprecated reactflow package)
bun add @xyflow/react@^12.9.2

# Add layout libraries (optional, if not using existing d3-force)
bun add dagre @types/dagre  # OR
bun add elkjs
```

### 2. Remove Konva (After Migration Complete)

```bash
# DO NOT run this until React Flow implementation is complete and tested
bun remove konva react-konva

# Optionally remove d3-force if replacing with different layout algorithm
# bun remove d3-force @types/d3-force
```

## Project Structure

Create the following files in your project:

```bash
# Core components
src/components/whiteboard/
├── ReactFlowCanvas.tsx       # Main wrapper component
├── TableNode.tsx             # Custom node for tables
├── RelationshipEdge.tsx      # Custom edge for relationships
├── LayoutControls.tsx        # Auto-layout controls
└── ZoomIndicator.tsx         # Zoom level display

# Utilities
src/lib/react-flow/
├── types.ts                  # TypeScript types
├── converters.ts             # Prisma ↔ React Flow converters
├── layout-adapter.ts         # Layout algorithm integration
└── theme.ts                  # Theme utilities

# Hooks
src/hooks/
├── use-react-flow-sync.ts    # WebSocket sync hook
└── use-layout-trigger.ts     # Layout trigger hook

# Stores (if using Zustand)
src/stores/
└── whiteboard.ts             # Whiteboard state management

# Styles
src/styles/
└── react-flow-theme.css      # React Flow custom styles
```

## Quick Implementation Guide

### Step 1: Create Type Definitions

```typescript
// src/lib/react-flow/types.ts
import { Node, Edge } from '@xyflow/react'
import { DiagramTable, Column, Relationship } from '@prisma/client'

export type TableNodeData = {
  table: DiagramTable
  columns: Column[]
}

export type TableNode = Node<TableNodeData, 'erTable'>

export type RelationshipEdgeData = {
  relationship: Relationship
  cardinality: string
  label?: string
}

export type RelationshipEdge = Edge<RelationshipEdgeData, 'erRelationship'>
```

See [data-model.md](./data-model.md) for complete type definitions.

### Step 2: Create Converter Functions

```typescript
// src/lib/react-flow/converters.ts
import { TableNode, RelationshipEdge } from './types'

export function convertToReactFlowNodes(
  tables: (DiagramTable & { columns: Column[] })[],
): TableNode[] {
  return tables.map((table) => ({
    id: table.id,
    type: 'erTable',
    position: { x: table.positionX, y: table.positionY },
    data: { table, columns: table.columns },
  }))
}

export function convertToReactFlowEdges(
  relationships: Relationship[],
): RelationshipEdge[] {
  return relationships.map((rel) => ({
    id: rel.id,
    type: 'erRelationship',
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
      cardinality: rel.relationshipType,
      label: rel.label || undefined,
    },
  }))
}
```

### Step 3: Create TableNode Component

```typescript
// src/components/whiteboard/TableNode.tsx
import { NodeProps, Handle, Position } from '@xyflow/react';
import { TableNodeData } from '@/lib/react-flow/types';

export function TableNode({ data, selected }: NodeProps<TableNodeData>) {
  const { table, columns } = data;

  return (
    <div className={`table-node ${selected ? 'selected' : ''}`}>
      <div className="table-header">{table.name}</div>
      <div className="table-columns">
        {columns.map((col, index) => (
          <div key={col.id} className="column-row">
            <Handle
              type="target"
              position={Position.Left}
              id={`${col.id}-target`}
              style={{ top: `${40 + index * 28 + 14}px` }}
            />
            <span className={col.isPrimaryKey ? 'pk' : ''}>
              {col.name}: {col.dataType}
              {col.isPrimaryKey && ' [PK]'}
              {col.isForeignKey && ' [FK]'}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={`${col.id}-source`}
              style={{ top: `${40 + index * 28 + 14}px` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

See [contracts/react-flow-types.md](./contracts/react-flow-types.md) for complete component specifications.

### Step 4: Create RelationshipEdge Component

```typescript
// src/components/whiteboard/RelationshipEdge.tsx
import { EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { RelationshipEdgeData } from '@/lib/react-flow/types';

export function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data
}: EdgeProps<RelationshipEdgeData>) {
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition
  });

  return (
    <>
      <path
        id={id}
        className="edge-path"
        d={edgePath}
        strokeWidth={2}
        stroke="var(--edge-color)"
      />
      {data?.label && (
        <text>
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
            {data.label}
          </textPath>
        </text>
      )}
    </>
  );
}
```

### Step 5: Create Main ReactFlowCanvas Component

```typescript
// src/components/whiteboard/ReactFlowCanvas.tsx
import { useCallback, useState } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TableNode } from './TableNode';
import { RelationshipEdge } from './RelationshipEdge';
import { convertToReactFlowNodes, convertToReactFlowEdges } from '@/lib/react-flow/converters';

const nodeTypes = { erTable: TableNode };
const edgeTypes = { erRelationship: RelationshipEdge };

export function ReactFlowCanvas({ whiteboardId }) {
  const { data: whiteboard } = useQuery({
    queryKey: ['whiteboard', whiteboardId],
    queryFn: () => fetchWhiteboard(whiteboardId)
  });

  const nodes = convertToReactFlowNodes(whiteboard?.tables || []);
  const edges = convertToReactFlowEdges(whiteboard?.relationships || []);

  const onNodeDragStop = useCallback((event, node) => {
    // Persist position to database
    updateTablePosition(node.id, node.position);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeDragStop={onNodeDragStop}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

### Step 6: Add Styles

```css
/* src/styles/react-flow-theme.css */
.table-node {
  min-width: 200px;
  background: var(--table-bg);
  border: 2px solid var(--table-border);
  border-radius: 8px;
  font-family: 'Monaco', monospace;
  font-size: 13px;
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
  position: relative;
}

.column-row:hover {
  background: var(--table-row-hover);
}

.pk {
  color: var(--pk-color);
  font-weight: 600;
}

.edge-path {
  stroke: var(--edge-color);
  fill: none;
}
```

### Step 7: Update Whiteboard Route

```typescript
// src/routes/whiteboard/$whiteboardId.tsx
import { ReactFlowCanvas } from '@/components/whiteboard/ReactFlowCanvas';

export function WhiteboardRoute() {
  const { whiteboardId } = useParams();

  return (
    <div className="whiteboard-container">
      <ReactFlowCanvas whiteboardId={whiteboardId} />
    </div>
  );
}
```

## Testing

### Unit Tests

```typescript
// src/components/whiteboard/TableNode.test.tsx
import { render } from '@testing-library/react';
import { TableNode } from './TableNode';

describe('TableNode', () => {
  it('renders table name', () => {
    const { getByText } = render(
      <TableNode
        id="test"
        data={{
          table: { name: 'users' },
          columns: []
        }}
        selected={false}
      />
    );
    expect(getByText('users')).toBeInTheDocument();
  });
});
```

### Visual Regression Testing

```bash
# Install visual regression testing tool
bun add -d @storybook/test-runner playwright

# Run visual regression tests
bun run test:visual
```

## Performance Benchmarking

```typescript
// src/lib/react-flow/benchmark.ts
export async function benchmarkRenderPerformance() {
  const startTime = performance.now();

  // Render 50 nodes
  const nodes = generateTestNodes(50);
  const edges = generateTestEdges(30);

  render(<ReactFlow nodes={nodes} edges={edges} />);

  const renderTime = performance.now() - startTime;
  console.log(`Render time: ${renderTime}ms`);

  // Target: <100ms for 50 nodes
  expect(renderTime).toBeLessThan(100);
}
```

## Migration Checklist

- [ ] Install @xyflow/react package
- [ ] Create type definitions (types.ts)
- [ ] Create converter functions (converters.ts)
- [ ] Implement TableNode component
- [ ] Implement RelationshipEdge component
- [ ] Create ReactFlowCanvas wrapper
- [ ] Add custom styles (react-flow-theme.css)
- [ ] Update whiteboard route
- [ ] Integrate WebSocket collaboration (see [contracts/websocket-updates.md](./contracts/websocket-updates.md))
- [ ] Implement automatic layout (see [data-model.md](./data-model.md))
- [ ] Add dark mode support
- [ ] Write unit tests
- [ ] Run visual regression tests
- [ ] Benchmark performance (target: 60 FPS with 50 nodes)
- [ ] Test with 50+ tables
- [ ] Test real-time collaboration with multiple users
- [ ] Verify all user stories from spec.md pass
- [ ] Remove Konva dependencies
- [ ] Update documentation

## Common Issues & Solutions

### Issue: Handles not connecting

**Solution**: Ensure handle IDs match between source and target:

```typescript
sourceHandle: `${sourceColumnId}-source`
targetHandle: `${targetColumnId}-target`
```

### Issue: Poor performance with many nodes

**Solution**: Enable React.memo for custom components:

```typescript
export const TableNode = React.memo(
  ({ data, selected }: NodeProps<TableNodeData>) => {
    // ...
  },
)
```

### Issue: WebSocket echo-back loop

**Solution**: Use `isProcessingRemote` flag:

```typescript
if (!isProcessingRemote.current) {
  socket.emit('node:update', ...);
}
```

### Issue: Dark mode not working

**Solution**: Ensure CSS variables are defined in both light/dark themes:

```css
[data-theme='dark'] {
  --table-bg: #1f2937;
  --table-border: #374151;
  /* ... */
}
```

## Next Steps

1. **Review research findings** in [research.md](./research.md) - reconsider migration
2. **If proceeding**: Follow implementation checklist above
3. **Integrate layout algorithm** from [data-model.md](./data-model.md)
4. **Add WebSocket sync** from [contracts/websocket-updates.md](./contracts/websocket-updates.md)
5. **Run tasks** generated by `/speckit.tasks` command

## Resources

- [React Flow Documentation](https://reactflow.dev)
- [React Flow Examples](https://reactflow.dev/examples)
- [@xyflow/react API Reference](https://reactflow.dev/api-reference)
- [Custom Nodes Guide](https://reactflow.dev/learn/customization/custom-nodes)
- [Custom Edges Guide](https://reactflow.dev/learn/customization/custom-edges)

## Support

For questions or issues during migration:

1. Review [research.md](./research.md) for architecture decisions
2. Check [contracts/](./contracts/) for interface specifications
3. Refer to React Flow official documentation
4. Open issue in project repository with `react-flow-migration` label

---

**Remember**: Based on comprehensive research, **keeping Konva + optimizing is recommended** over this migration. See [research.md](./research.md) for details.
