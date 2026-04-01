# React Flow Migration - Quick Reference

## How to Use the New React Flow Components

### Basic Usage

```typescript
import { ReactFlowCanvas } from '@/components/whiteboard/ReactFlowCanvas';
import { convertToReactFlowNodes, convertToReactFlowEdges } from '@/lib/react-flow/converters';

function MyWhiteboard({ tables, relationships }) {
  const nodes = convertToReactFlowNodes(tables);
  const edges = convertToReactFlowEdges(relationships);

  return (
    <ReactFlowCanvas
      initialNodes={nodes}
      initialEdges={edges}
      nodesDraggable={true}
      showControls={true}
      showMinimap={false}
    />
  );
}
```

### With Drag Persistence

```typescript
const onNodesChange = useCallback((changes) => {
  changes.forEach(change => {
    if (change.type === 'position' && !change.dragging) {
      // Persist to database
      updateTablePosition({
        id: change.id,
        positionX: change.position.x,
        positionY: change.position.y,
      });
    }
  });
}, []);

<ReactFlowCanvas
  initialNodes={nodes}
  initialEdges={edges}
  onNodesChange={onNodesChange}
/>
```

### With Layout Algorithm

```typescript
import { applyLayoutToNodes } from '@/lib/react-flow/types'

const applyLayout = async () => {
  const layoutResult = await computeLayout(tables, relationships)
  const updatedNodes = applyLayoutToNodes(nodes, layoutResult)
  setNodes(updatedNodes)
}
```

## Component API Reference

### ReactFlowCanvas

```typescript
interface ReactFlowCanvasProps {
  initialNodes?: TableNode[]
  initialEdges?: RelationshipEdge[]
  onNodesChange?: (changes) => void
  onEdgesChange?: (changes) => void
  onConnect?: (connection) => void
  nodesDraggable?: boolean // default: true
  showMinimap?: boolean // default: false
  showControls?: boolean // default: true
  showBackground?: boolean // default: true
  fitViewOptions?: FitViewOptions
  className?: string
}
```

### TableNode

Automatically rendered by React Flow when node type is `'erTable'`.

```typescript
{
  id: string,
  type: 'erTable',
  position: { x: number, y: number },
  data: {
    table: DiagramTable,
    columns: Column[],
    onUpdate?: (tableId, updates) => void,
    onDelete?: (tableId) => void,
  }
}
```

### RelationshipEdge

Automatically rendered by React Flow when edge type is `'erRelationship'`.

```typescript
{
  id: string,
  type: 'erRelationship',
  source: string,              // tableId
  target: string,              // tableId
  sourceHandle: string,        // columnId-source
  targetHandle: string,        // columnId-target
  data: {
    relationship: Relationship,
    cardinality: CardinalityType,
    label?: string,
  }
}
```

## Converter Functions

### convertToReactFlowNodes

```typescript
const nodes = convertToReactFlowNodes(
  tables, // Array<DiagramTable & { columns: Column[] }>
)
```

### convertToReactFlowEdges

```typescript
const edges = convertToReactFlowEdges(
  relationships, // Array<Relationship>
)
```

### extractPositionUpdates

```typescript
const { positionX, positionY } = extractPositionUpdates(node)
```

## Handle Utilities

### generateHandleId

```typescript
const sourceHandle = generateHandleId(columnId, 'source')
// Returns: '{columnId}-source'

const targetHandle = generateHandleId(columnId, 'target')
// Returns: '{columnId}-target'
```

### parseHandleId

```typescript
const { columnId, type } = parseHandleId('col-123-source')
// Returns: { columnId: 'col-123', type: 'source' }
```

### calculateHandlePosition

```typescript
const yPosition = calculateHandlePosition(
  columnIndex, // 0-based index
  40, // header height (default)
  28, // row height (default)
)
```

## Viewport Utilities

### calculateFitViewport

```typescript
import { calculateFitViewport } from '@/lib/react-flow/viewport'

const viewport = calculateFitViewport(
  nodes,
  window.innerWidth,
  window.innerHeight,
  50, // padding
)
```

### clampZoom

```typescript
import { clampZoom } from '@/lib/react-flow/viewport'

const safeZoom = clampZoom(zoom) // Clamps to 0.1 - 5.0
```

## Theme Integration

Theme CSS variables in `src/styles/react-flow-theme.css`:

```css
:root {
  --rf-table-bg: #ffffff;
  --rf-table-border: #e5e7eb;
  --rf-table-header-bg: #f9fafb;
  --rf-table-text: #374151;
  --rf-edge-stroke: #6b7280;
  /* ... */
}

:root[class~='dark'] {
  --rf-table-bg: #1f2937;
  --rf-table-border: #374151;
  /* ... */
}
```

## Example: Complete Whiteboard Implementation

```typescript
import { useCallback, useMemo } from 'react';
import { ReactFlowCanvas } from '@/components/whiteboard/ReactFlowCanvas';
import { convertToReactFlowNodes, convertToReactFlowEdges } from '@/lib/react-flow/converters';
import type { OnNodesChange } from '@xyflow/react';

export function WhiteboardEditor({ whiteboard, relationships }) {
  // Convert data
  const nodes = useMemo(() =>
    convertToReactFlowNodes(whiteboard.tables),
    [whiteboard.tables]
  );

  const edges = useMemo(() =>
    convertToReactFlowEdges(relationships),
    [relationships]
  );

  // Handle node drag
  const onNodesChange: OnNodesChange = useCallback((changes) => {
    changes.forEach(change => {
      if (change.type === 'position' && change.dragging === false) {
        updateTablePositionMutation.mutate({
          id: change.id,
          positionX: change.position.x,
          positionY: change.position.y,
        });
      }
    });
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ReactFlowCanvas
        initialNodes={nodes}
        initialEdges={edges}
        onNodesChange={onNodesChange}
        nodesDraggable={true}
        showControls={true}
        showBackground={true}
      />
    </div>
  );
}
```

## Migration Checklist

- [ ] Install dependency: `bun add @xyflow/react`
- [ ] Import React Flow CSS in your styles
- [ ] Convert Prisma data to React Flow format
- [ ] Replace Canvas component with ReactFlowCanvas
- [ ] Handle onNodesChange for drag events
- [ ] Update layout algorithm to output React Flow positions
- [ ] Implement real-time sync for React Flow state
- [ ] Style nodes/edges with theme CSS variables
- [ ] Test with 50+ nodes for 60 FPS performance
- [ ] Remove Konva dependencies

## Common Issues

### Handles not connecting

Ensure handle IDs match on both nodes and edges:

```typescript
sourceHandle: `${columnId}-source`
targetHandle: `${columnId}-target`
```

### Nodes not dragging

Set `nodesDraggable={true}` on ReactFlowCanvas.

### Theme not applying

Check that dark mode class is on root element:

```html
<html class="dark"></html>
```

### Layout positions incorrect

Ensure d3-force outputs match React Flow's coordinate system (same x, y format).

## Performance Tips

1. Use `React.memo` for custom nodes (already done in TableNode.new.tsx)
2. Memoize node/edge arrays with `useMemo`
3. Throttle position updates to 100ms
4. Use `nodesConnectable={false}` if not creating connections
5. Enable `fitView` only on initial load

## Support

- See full task list: `specs/002-react-flow-migration/tasks.md`
- See research: `specs/002-react-flow-migration/research.md`
- See migration status: `MIGRATION_STATUS.md`
