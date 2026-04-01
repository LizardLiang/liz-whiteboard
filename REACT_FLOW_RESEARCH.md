# React Flow State Management & Real-Time Collaboration Research

**Date**: 2025-11-15
**Context**: Migrating from Konva to React Flow for collaborative ER diagram whiteboard
**Scope**: State management patterns, real-time collaboration, performance optimization, event handling

---

## Table of Contents

1. [State Management Patterns](#state-management-patterns)
2. [Real-Time Collaboration Architecture](#real-time-collaboration-architecture)
3. [Performance Optimization](#performance-optimization)
4. [Event Handling & Change Detection](#event-handling--change-detection)
5. [Recommended Implementation](#recommended-implementation)
6. [Migration Strategy from Konva](#migration-strategy-from-konva)

---

## State Management Patterns

### Overview

React Flow provides three approaches to state management:

1. **Uncontrolled** - React Flow manages internal state (default)
2. **Controlled with Hooks** - Use `useNodesState`/`useEdgesState` (prototyping)
3. **Controlled with External Store** - Zustand/Redux (production recommended)

### Controlled vs Uncontrolled Components

#### Uncontrolled (Default)

```tsx
<ReactFlow nodes={nodes} edges={edges} />
```

- React Flow manages state internally
- Simple but limited for external sync
- Limited real-time collaboration support
- **Not suitable for WebSocket sync**

#### Controlled with Hooks (Prototyping)

```tsx
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

;<ReactFlow
  nodes={nodes}
  edges={edges}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
/>
```

- You manage nodes/edges state
- Simple API with built-in change handling
- Acceptable for prototyping and small apps
- **Can work with WebSocket but requires careful sync**

#### Controlled with External Store (Production)

```tsx
// Zustand store
const useFlowStore = create((set) => ({
  nodes: [],
  edges: [],
  updateNodes: (nodes) => set({ nodes }),
  updateEdges: (edges) => set({ edges }),
  updateNodeData: (nodeId, data) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    })),
}))

// Usage
const nodes = useFlowStore((state) => state.nodes)
const updateNodes = useFlowStore((state) => state.updateNodes)
```

- **Recommended for production + real-time collaboration**
- Separation of concerns
- Easy to intercept mutations for WebSocket broadcast
- Enables complex sync logic
- Better performance (prevents unnecessary re-renders)

### Key Principle: Immutability

React Flow requires immutable updates:

```tsx
// ✅ Correct
setNodes((nodes) =>
  nodes.map((n) =>
    n.id === 'node-1' ? { ...n, position: { x: 100, y: 100 } } : n,
  ),
)

// ❌ Wrong - mutates object directly
const node = nodes[0]
node.position = { x: 100, y: 100 }
setNodes(nodes)
```

---

## Real-Time Collaboration Architecture

### Current Implementation (Konva + Socket.IO)

Your application currently uses:

- **WebSocket**: Socket.IO with room-based broadcasting
- **Event-Based Sync**: Granular events (`table:create`, `table:move`, etc.)
- **Conflict Resolution**: Last-Write-Wins (LWW)
- **Architecture**: TanStack Query for data fetching, Socket.IO for real-time updates

### Syncing React Flow with WebSocket

#### Pattern 1: External Store + Event Listeners

```tsx
// Zustand store with mutation actions
const useFlowStore = create((set) => ({
  nodes: [],
  edges: [],

  // Local mutations
  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),

  updateNodePosition: (nodeId, position) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
    })),

  // Apply remote changes
  applyRemoteUpdate: (nodeId, updates) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, ...updates } : n,
      ),
    })),
}))

// Component
function WhiteboardEditor() {
  const { nodes, edges, addNode, updateNodePosition, applyRemoteUpdate } =
    useFlowStore()
  const { emit, on, off } = useCollaboration(whiteboardId, userId)

  // Handle local changes
  const handleNodesChange = useCallback(
    (changes) => {
      changes.forEach((change) => {
        if (change.type === 'position' && change.position) {
          updateNodePosition(change.id, change.position)
          // Broadcast to other users
          emit('node:move', { nodeId: change.id, position: change.position })
        }
      })
    },
    [updateNodePosition, emit],
  )

  // Listen for remote changes
  useEffect(() => {
    const handleRemoteNodeMove = (data) => {
      applyRemoteUpdate(data.nodeId, { position: data.position })
    }

    on('node:moved', handleRemoteNodeMove)
    return () => off('node:moved', handleRemoteNodeMove)
  }, [on, off, applyRemoteUpdate])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
    />
  )
}
```

#### Pattern 2: Distinguish User vs Remote Actions

```tsx
// Add a flag to track change origin
const useFlowStore = create((set) => ({
  isProcessingRemoteUpdate: false,

  setProcessingRemote: (processing) =>
    set({ isProcessingRemoteUpdate: processing }),

  applyRemoteUpdate: (nodeId, updates) =>
    set((state) => ({
      isProcessingRemoteUpdate: true,
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, ...updates } : n,
      ),
    })),
}))

function WhiteboardEditor() {
  const { nodes, isProcessingRemoteUpdate, setProcessingRemote } =
    useFlowStore()

  const handleNodesChange = useCallback(
    (changes) => {
      // Don't broadcast if this is a remote update
      if (isProcessingRemoteUpdate) {
        setProcessingRemote(false)
        return
      }

      // Broadcast local changes
      changes.forEach((change) => {
        if (change.type === 'position') {
          emit('node:move', { nodeId: change.id, position: change.position })
        }
      })
    },
    [isProcessingRemoteUpdate, setProcessingRemote, emit],
  )

  useEffect(() => {
    const handleRemoteUpdate = (data) => {
      setProcessingRemote(true)
      applyRemoteUpdate(data.nodeId, { position: data.position })
    }
    on('node:moved', handleRemoteUpdate)
    return () => off('node:moved', handleRemoteUpdate)
  }, [on, off])

  return <ReactFlow nodes={nodes} onNodesChange={handleNodesChange} />
}
```

### Handling Concurrent Updates

#### Scenario: Two users drag the same node simultaneously

**Problem**:

- User A drags node to position (100, 100), broadcasts
- User B drags same node to position (200, 200), broadcasts
- Last write wins, but animation becomes jerky

**Solution 1: Timestamp-Based Version Control**

```tsx
// Track version metadata
type VersionedNode = Node & {
  version: number
  lastUpdatedBy: string
  lastUpdatedAt: number
}

const applyRemoteUpdate = (nodeId, updates, metadata) =>
  set((state) => ({
    nodes: state.nodes.map((n) => {
      if (n.id !== nodeId) return n

      // Only apply if remote is newer
      if (metadata.version > (n.version || 0)) {
        return {
          ...n,
          ...updates,
          version: metadata.version,
          lastUpdatedBy: metadata.userId,
          lastUpdatedAt: metadata.timestamp,
        }
      }
      return n
    }),
  }))
```

#### Solution 2: Conflict-Free Replicated Data Types (CRDT)

For advanced scenarios, consider **Yjs**:

```tsx
// Initialize Yjs
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const ydoc = new Y.Doc()
const ymap = ydoc.getMap('nodes')
const yarray = ydoc.getArray('edges')

const provider = new WebsocketProvider(
  'ws://localhost:1234',
  'whiteboard-room',
  ydoc,
)

// Yjs automatically handles conflicts!
ymap.set('node-1', {
  id: 'node-1',
  position: { x: 100, y: 100 },
})
```

**When to use Yjs**:

- Complex documents with many concurrent edits
- Need offline-first support
- Want automatic conflict resolution
- Don't want to implement custom versioning

**Trade-offs**:

- Larger bundle size (~50KB gzipped)
- Learning curve
- Overkill for simple position/property updates

---

## Performance Optimization

### 1. Prevent Unnecessary Re-renders

#### Problem: Nodes Array Changes Frequently During Dragging

```tsx
// ❌ Bad - component re-renders on every position update
function Diagram() {
  const nodes = useFlowStore((state) => state.nodes) // Subscribes to entire state
  const edges = useFlowStore((state) => state.edges)

  return <ReactFlow nodes={nodes} edges={edges} />
}
```

#### Solution: Selective State Subscription

```tsx
// ✅ Good - subscribe only to needed state
function Diagram() {
  const nodes = useFlowStore(
    (state) => state.nodes,
    (a, b) => {
      // Only re-render if node count changes, not on every position update
      return a.length === b.length
    },
  )
  const edges = useFlowStore(
    (state) => state.edges,
    (a, b) => a.length === b.length,
  )

  return <ReactFlow nodes={nodes} edges={edges} />
}

// Or separate selectors
const selectNodes = (state) => state.nodes
const selectEdges = (state) => state.edges
const selectSelectedNodeId = (state) => state.selectedNodeId

function Diagram() {
  const nodes = useFlowStore(selectNodes)
  const edges = useFlowStore(selectEdges)

  return <ReactFlow nodes={nodes} edges={edges} />
}
```

### 2. Memoize Callback Functions

```tsx
// ❌ Bad - creates new function on every render
function Diagram() {
  const handleNodesChange = (changes) => {
    // ... update logic
  }

  return <ReactFlow onNodesChange={handleNodesChange} />
}

// ✅ Good - memoized callback
function Diagram() {
  const handleNodesChange = useCallback(
    (changes) => {
      // ... update logic
    },
    [dependencies],
  )

  return <ReactFlow onNodesChange={handleNodesChange} />
}
```

### 3. Define Node/Edge Types Outside Component

```tsx
// ❌ Bad - creates new object reference on every render
function Diagram() {
  const nodeTypes = { custom: CustomNode }
  const edgeTypes = { custom: CustomEdge }

  return <ReactFlow nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
}

// ✅ Good - stable reference
const nodeTypes = { custom: CustomNode }
const edgeTypes = { custom: CustomEdge }

function Diagram() {
  return <ReactFlow nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
}
```

### 4. Use React.memo for Custom Nodes/Edges

```tsx
// Define node types outside to prevent re-creation
const CustomNode = React.memo(({ data, selected }) => {
  return (
    <div
      style={{
        padding: 10,
        border: selected ? '2px solid blue' : '1px solid gray',
      }}
    >
      {data.label}
    </div>
  )
})

const CustomEdge = React.memo(({ id, sourceX, sourceY, targetX, targetY }) => {
  return (
    <g>
      <path d={`M${sourceX},${sourceY}L${targetX},${targetY}`} stroke="black" />
    </g>
  )
})
```

### 5. Batch Updates for Multiple Changes

```tsx
// ❌ Bad - triggers multiple re-renders
socket.on('node:moved', (data) => {
  updateNode(data.nodeId, { position: data.position })
  updateNode(data.nodeId, { selected: true }) // Another re-render
})

// ✅ Good - batch updates
socket.on('node:moved', (data) => {
  applyBatchUpdate([
    { nodeId: data.nodeId, position: data.position },
    { nodeId: data.nodeId, selected: true },
  ])
})

// In store
const applyBatchUpdate = (updates) =>
  set((state) => {
    let newNodes = state.nodes
    updates.forEach(({ nodeId, ...props }) => {
      newNodes = newNodes.map((n) => (n.id === nodeId ? { ...n, ...props } : n))
    })
    return { nodes: newNodes }
  })
```

### 6. Use React Flow's Built-in Optimizations

React Flow provides:

- **Auto-panning** when dragging near edges
- **Lazy node rendering** with `hidden` property
- **Connection line rendering** (lightweight SVG)
- **Viewport management** to avoid rendering off-screen nodes

```tsx
// Use hidden property to optimize large graphs
const hiddenNodes = nodes.map((n) => ({
  ...n,
  hidden: isOutsideViewport(n.position, viewport),
}))
```

---

## Event Handling & Change Detection

### React Flow's onChange Callbacks

#### `onNodesChange`

```tsx
const handleNodesChange = useCallback((changes: NodeChange[]) => {
  changes.forEach((change) => {
    switch (change.type) {
      case 'position':
        // Fired during dragging
        console.log(`Node ${change.id} moved to`, change.position)
        // Emit at end of drag, not on every frame
        break

      case 'select':
        console.log(`Node ${change.id} selected`)
        break

      case 'replace':
        console.log(`Node ${change.id} replaced`)
        break

      case 'add':
        console.log(`Node ${change.id} added`)
        break

      case 'remove':
        console.log(`Node ${change.id} removed`)
        break

      case 'dimensions':
        console.log(`Node ${change.id} dimensions changed`)
        break
    }
  })
}, [])
```

### Distinguishing User vs Programmatic Changes

```tsx
// Solution: Use a ref flag
const isApplyingRemoteUpdate = useRef(false)

const applyRemoteChanges = useCallback((nodes) => {
  isApplyingRemoteUpdate.current = true
  setNodes(nodes)
  // React Flow will call onNodesChange, but we can ignore it
}, [])

const handleNodesChange = useCallback(
  (changes) => {
    if (isApplyingRemoteUpdate.current) {
      isApplyingRemoteUpdate.current = false
      return
    }

    // This is a user-initiated change, broadcast it
    changes.forEach((change) => {
      if (change.type === 'position' && change.position) {
        emit('node:move', { nodeId: change.id, position: change.position })
      }
    })
  },
  [emit],
)
```

### Throttling Position Updates

```tsx
import { useCallback } from 'react'

// Throttle helper
const throttle = (func, delay) => {
  let lastCall = 0
  return (...args) => {
    const now = Date.now()
    if (now - lastCall >= delay) {
      lastCall = now
      func(...args)
    }
  }
}

function Diagram() {
  const emitThrottled = useCallback(
    throttle((nodeId, position) => {
      emit('node:move', { nodeId, position })
    }, 100), // Emit max once per 100ms
    [emit],
  )

  const handleNodesChange = useCallback(
    (changes) => {
      changes.forEach((change) => {
        if (change.type === 'position' && change.position) {
          emitThrottled(change.id, change.position)
        }
      })
    },
    [emitThrottled],
  )

  return <ReactFlow onNodesChange={handleNodesChange} />
}
```

---

## Recommended Implementation

### Architecture: Zustand + Socket.IO + React Flow

```
┌─────────────────────────────────────────────┐
│              React Flow Component            │
│  - Renders nodes/edges from Zustand store  │
│  - Calls onNodesChange/onEdgesChange       │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│          Zustand State Store                 │
│  - nodes[], edges[] (source of truth)       │
│  - updateNode(), applyRemoteUpdate()        │
│  - isProcessingRemote flag                  │
└──────────────┬──────────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
  Local Changes   Remote Changes
  (User Action)   (WebSocket)
       │               │
       ├─ Broadcast ───┤
       │               │
       └───────┬───────┘
               ▼
        ┌──────────────┐
        │  Socket.IO   │
        │  WebSocket   │
        └──────────────┘
```

### Implementation Steps

#### Step 1: Create Zustand Store

```tsx
// src/lib/flow-store.ts
import { create } from 'zustand'

interface FlowState {
  nodes: Node[]
  edges: Edge[]
  isProcessingRemote: boolean

  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void

  updateNodePosition: (nodeId: string, position: XYPosition) => void
  updateNodeData: (nodeId: string, data: any) => void

  applyRemoteUpdate: (nodeId: string, updates: Partial<Node>) => void
  setProcessingRemote: (processing: boolean) => void
}

export const useFlowStore = create<FlowState>((set) => ({
  nodes: [],
  edges: [],
  isProcessingRemote: false,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  updateNodePosition: (nodeId, position) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
    })),

  updateNodeData: (nodeId, data) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    })),

  applyRemoteUpdate: (nodeId, updates) =>
    set((state) => ({
      isProcessingRemote: true,
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, ...updates } : n,
      ),
    })),

  setProcessingRemote: (processing) => set({ isProcessingRemote: processing }),
}))
```

#### Step 2: Create WebSocket Sync Hook

```tsx
// src/hooks/use-flow-collaboration.ts
import { useEffect, useCallback } from 'react'
import { useFlowStore } from '@/lib/flow-store'
import { useCollaboration } from './use-collaboration'

export function useFlowCollaboration(whiteboardId: string, userId: string) {
  const {
    nodes,
    updateNodePosition,
    applyRemoteUpdate,
    setProcessingRemote,
    isProcessingRemote,
  } = useFlowStore()

  const { emit, on, off } = useCollaboration(whiteboardId, userId)

  // Broadcast local node position changes
  const broadcastNodeMove = useCallback(
    (nodeId: string, position: any) => {
      emit('node:move', { nodeId, position, userId })
    },
    [emit],
  )

  // Listen for remote node position changes
  useEffect(() => {
    const handleRemoteNodeMove = (data: any) => {
      if (data.userId === userId) return // Ignore own changes

      setProcessingRemote(true)
      applyRemoteUpdate(data.nodeId, { position: data.position })
    }

    on('node:moved', handleRemoteNodeMove)
    return () => off('node:moved', handleRemoteNodeMove)
  }, [on, off, userId, setProcessingRemote, applyRemoteUpdate])

  return { broadcastNodeMove }
}
```

#### Step 3: Integrate with React Flow Component

```tsx
// src/components/whiteboard/FlowEditor.tsx
import { useCallback } from 'react'
import ReactFlow, { Controls, Background } from 'reactflow'
import { useFlowStore } from '@/lib/flow-store'
import { useFlowCollaboration } from '@/hooks/use-flow-collaboration'

function FlowEditor({ whiteboardId }: { whiteboardId: string }) {
  const userId = 'current-user-id' // From auth context
  const { nodes, edges, isProcessingRemote, setProcessingRemote } =
    useFlowStore()
  const { broadcastNodeMove } = useFlowCollaboration(whiteboardId, userId)

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Skip if this is a remote update
      if (isProcessingRemote) {
        setProcessingRemote(false)
        return
      }

      // Process user changes
      changes.forEach((change) => {
        if (change.type === 'position' && change.position) {
          broadcastNodeMove(change.id, change.position)
        }
      })
    },
    [isProcessingRemote, setProcessingRemote, broadcastNodeMove],
  )

  return (
    <ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodesChange}>
      <Background />
      <Controls />
    </ReactFlow>
  )
}
```

---

## Migration Strategy from Konva

### Phase 1: Parallel Implementation

- Keep Konva running alongside React Flow
- Implement React Flow with same data model (tables, relationships)
- Test both rendering paths with same data

### Phase 2: State Synchronization

- Refactor state management to shared Zustand store
- Both Konva and React Flow read from same store
- Update handlers write to shared store

### Phase 3: Event Routing

- Migrate Socket.IO events to use Zustand actions
- Update handlers dispatch store mutations
- Both renderers respond to same state changes

### Phase 4: Cutover

- Toggle between renderers with feature flag
- Validate React Flow render quality
- Remove Konva code

### Code Example: Parallel State

```tsx
// src/lib/diagram-store.ts - Shared for both Konva and React Flow
import { create } from 'zustand'

interface Table {
  id: string
  name: string
  positionX: number
  positionY: number
  columns: Column[]
}

interface DiagramStore {
  tables: Table[]
  relationships: Relationship[]

  addTable: (table: Table) => void
  updateTablePosition: (id: string, x: number, y: number) => void
  updateTableName: (id: string, name: string) => void
}

export const useDiagramStore = create<DiagramStore>((set) => ({
  tables: [],
  relationships: [],

  addTable: (table) =>
    set((state) => ({
      tables: [...state.tables, table],
    })),

  updateTablePosition: (id, x, y) =>
    set((state) => ({
      tables: state.tables.map((t) =>
        t.id === id ? { ...t, positionX: x, positionY: y } : t,
      ),
    })),

  updateTableName: (id, name) =>
    set((state) => ({
      tables: state.tables.map((t) => (t.id === id ? { ...t, name } : t)),
    })),
}))

// Konva component
function KonvaRenderer() {
  const { tables } = useDiagramStore()
  return (
    <>
      {tables.map((table) => (
        <KonvaTableNode key={table.id} table={table} />
      ))}
    </>
  )
}

// React Flow component
function ReactFlowRenderer() {
  const { tables } = useDiagramStore()
  const nodes = tables.map((table) => ({
    id: table.id,
    data: { label: table.name, table },
    position: { x: table.positionX, y: table.positionY },
  }))

  return <ReactFlow nodes={nodes} />
}
```

---

## Summary & Decision Matrix

| Aspect                  | Decision                              | Rationale                                                              |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| **State Management**    | Zustand external store                | Best for production, easy WebSocket sync, clear separation of concerns |
| **State Type**          | Controlled with external store        | Full control over state mutations, necessary for complex collaboration |
| **Conflict Resolution** | Last-Write-Wins with timestamps       | Spec requirement, simple implementation, acceptable for LWW updates    |
| **Sync Pattern**        | Event-based (Socket.IO)               | Granular updates, matches current architecture, easy to throttle       |
| **Performance**         | Selective subscriptions + memoization | Prevents unnecessary re-renders during intense dragging                |
| **Real-Time Pattern**   | Zustand → WebSocket → Zustand         | Bidirectional sync, clear change origin detection                      |
| **Custom Nodes**        | Define outside component + React.memo | Prevents recreation, improves performance                              |
| **Batch Updates**       | Supported in store                    | Needed for multi-change operations                                     |

---

## Key Takeaways

1. **Use Zustand for production** - React Flow with Zustand is the industry standard for collaborative editing
2. **Distinguish local vs remote** - Use flags or refs to prevent echoing local changes
3. **Throttle high-frequency updates** - Position changes during dragging need throttling
4. **Memoize everything** - Custom nodes, callbacks, and store selectors must be memoized
5. **Batch updates** - Multiple changes should be applied together
6. **Consider Yjs for advanced collaboration** - If LWW proves insufficient, Yjs provides automatic conflict resolution
7. **Test concurrent editing** - Implement tests simulating multiple users editing simultaneously
8. **Monitor performance** - Use React DevTools Profiler to identify re-render bottlenecks

---

## References & Resources

- **React Flow Docs**: https://reactflow.dev/learn
- **React Flow Performance**: https://reactflow.dev/learn/advanced-use/performance
- **Zustand**: https://github.com/pmndrs/zustand
- **Socket.IO**: https://socket.io/docs/v4/
- **Yjs (for advanced CRDTs)**: https://docs.yjs.dev/
- **Your Current Implementation**: Socket.IO patterns in `src/routes/api/collaboration.ts`
- **Your Current Hooks**: WebSocket hook in `src/hooks/use-collaboration.ts`
