# React Flow + Zustand Quick Start Guide

**For**: Developers implementing the Konva → React Flow migration
**Time to Read**: 10 minutes
**Related Docs**: REACT_FLOW_DECISION.md, REACT_FLOW_RESEARCH.md

---

## TL;DR: Copy-Paste Architecture

### 1. Install React Flow

```bash
bun add reactflow
```

### 2. Create Zustand Store

```tsx
// src/lib/flow-store.ts
import { create } from 'zustand';
import type { Node, Edge } from 'reactflow';

interface FlowStore {
  nodes: Node[];
  edges: Edge[];
  isProcessingRemote: boolean;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  applyRemoteUpdate: (id: string, updates: Partial<Node>) => void;
  setProcessingRemote: (processing: boolean) => void;
}

export const useFlowStore = create<FlowStore>((set) => ({
  nodes: [],
  edges: [],
  isProcessingRemote: false,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  updateNodePosition: (id, position) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, position } : n
      ),
    })),

  applyRemoteUpdate: (id, updates) =>
    set((state) => ({
      isProcessingRemote: true,
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, ...updates } : n
      ),
    })),

  setProcessingRemote: (processing) => set({ isProcessingRemote: processing }),
}));
```

### 3. Create Collaboration Hook

```tsx
// src/hooks/use-flow-collaboration.ts
import { useEffect, useCallback } from 'react';
import { useFlowStore } from '@/lib/flow-store';
import { useCollaboration } from './use-collaboration';

export function useFlowCollaboration(whiteboardId: string, userId: string) {
  const { applyRemoteUpdate, setProcessingRemote } = useFlowStore();
  const { emit, on, off } = useCollaboration(whiteboardId, userId);

  // Listen for remote updates
  useEffect(() => {
    const handleRemoteMove = (data: any) => {
      if (data.userId === userId) return;
      setProcessingRemote(true);
      applyRemoteUpdate(data.nodeId, { position: data.position });
    };

    on('node:moved', handleRemoteMove);
    return () => off('node:moved', handleRemoteMove);
  }, [on, off, userId, applyRemoteUpdate, setProcessingRemote]);

  // Broadcast local changes
  const broadcastNodeMove = useCallback(
    (nodeId: string, position: any) => {
      emit('node:move', { nodeId, position, userId });
    },
    [emit, userId]
  );

  return { broadcastNodeMove };
}
```

### 4. Create React Flow Component

```tsx
// src/components/FlowEditor.tsx
import { useCallback } from 'react';
import ReactFlow, {
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useFlowStore } from '@/lib/flow-store';
import { useFlowCollaboration } from '@/hooks/use-flow-collaboration';

function FlowEditor({ whiteboardId }: { whiteboardId: string }) {
  const userId = 'temp-user-id'; // From auth context
  const { nodes, edges, isProcessingRemote, setProcessingRemote } = useFlowStore();
  const { broadcastNodeMove } = useFlowCollaboration(whiteboardId, userId);

  const handleNodesChange = useCallback(
    (changes: any[]) => {
      if (isProcessingRemote) {
        setProcessingRemote(false);
        return;
      }

      changes.forEach((change) => {
        if (change.type === 'position' && change.position) {
          broadcastNodeMove(change.id, change.position);
        }
      });
    },
    [isProcessingRemote, setProcessingRemote, broadcastNodeMove]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}

export default FlowEditor;
```

### 5. Update Socket.IO Handler

```tsx
// src/routes/api/collaboration.ts - Add this to setupCollaborationEventHandlers

socket.on('node:move', async (data: { nodeId: string; position: any; userId: string }) => {
  try {
    // Update position in database
    await updateDiagramTablePosition(data.nodeId, data.position.x, data.position.y);

    // Broadcast to other users
    socket.broadcast.emit('node:moved', {
      nodeId: data.nodeId,
      position: data.position,
      userId: data.userId,
      timestamp: Date.now(),
      version: 1,
    });

    // Update session activity
    await updateSessionActivity(socket.id);
  } catch (error) {
    console.error('Failed to move node:', error);
    socket.emit('error', {
      event: 'node:move',
      error: 'UPDATE_FAILED',
      message: 'Failed to update node position',
    });
  }
});
```

---

## Common Patterns

### Pattern 1: Throttle Position Updates

```tsx
// Throttle helper
function throttle(func: Function, delay: number) {
  let lastCall = 0;
  return (...args: any[]) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
}

// Use it
const broadcastThrottled = throttle((nodeId, position) => {
  emit('node:move', { nodeId, position });
}, 100); // Max once per 100ms

const handleNodesChange = useCallback((changes) => {
  changes.forEach(change => {
    if (change.type === 'position' && change.position) {
      broadcastThrottled(change.id, change.position);
    }
  });
}, []);
```

### Pattern 2: Selective Zustand Subscriptions

```tsx
// Only subscribe to nodes count to prevent re-renders on every position update
const nodes = useFlowStore(
  state => state.nodes,
  (a, b) => a.length === b.length // Only re-render if count changes
);

// Or use separate selectors
const selectNodes = (state: FlowStore) => state.nodes;
const nodes = useFlowStore(selectNodes);
```

### Pattern 3: Custom Node Component

```tsx
import React from 'react';
import { Handle, Position } from 'reactflow';

const CustomNode = React.memo(({ data, selected }: any) => {
  return (
    <div
      style={{
        padding: 10,
        border: selected ? '2px solid blue' : '1px solid gray',
        borderRadius: 5,
        backgroundColor: 'white',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div>{data.label}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

export default CustomNode;
```

### Pattern 4: Batch Updates

```tsx
// Apply multiple updates at once
const applyBatchUpdate = (updates: Array<{ nodeId: string; updates: any }>) => {
  set((state) => {
    let newNodes = state.nodes;
    updates.forEach(({ nodeId, updates: nodeUpdates }) => {
      newNodes = newNodes.map((n) =>
        n.id === nodeId ? { ...n, ...nodeUpdates } : n
      );
    });
    return { nodes: newNodes, isProcessingRemote: true };
  });
};

// Use it
socket.on('batch:update', (data) => {
  applyBatchUpdate(data.updates);
});
```

---

## Common Issues & Solutions

### Issue 1: "Position updates aren't syncing"

**Cause**: isProcessingRemote flag not being reset
**Solution**:
```tsx
const handleNodesChange = useCallback((changes) => {
  // IMPORTANT: Check this FIRST, before any other logic
  if (isProcessingRemote) {
    setProcessingRemote(false);
    return; // Exit early!
  }

  // Now handle user changes
  changes.forEach(change => {
    if (change.type === 'position') {
      emit('node:move', ...);
    }
  });
}, [isProcessingRemote, setProcessingRemote, emit]);
```

### Issue 2: "Dragging is laggy"

**Cause**: Not throttling high-frequency updates
**Solution**:
```tsx
// Throttle to 10Hz (100ms)
const broadcastThrottled = useCallback(
  throttle((nodeId, position) => {
    emit('node:move', { nodeId, position });
  }, 100),
  [emit]
);
```

### Issue 3: "Component re-renders too often"

**Cause**: Subscribing to entire nodes array
**Solution**:
```tsx
// ❌ Bad
const nodes = useFlowStore(state => state.nodes);

// ✅ Good - only re-render on count change
const nodes = useFlowStore(
  state => state.nodes,
  (a, b) => a.length === b.length
);
```

### Issue 4: "Remote updates get echoed back"

**Cause**: Broadcasting user's own changes
**Solution**:
```tsx
// Include userId with every update
const handleRemoteMove = (data) => {
  // Skip if it's from current user
  if (data.userId === userId) return;

  setProcessingRemote(true);
  applyRemoteUpdate(data.nodeId, { position: data.position });
};

// When emitting, include userId
emit('node:move', { nodeId, position, userId });
```

---

## Testing Checklist

### Local Development
- [ ] Can create/move nodes without WebSocket
- [ ] Throttling working (check Network tab, should see ~10 msgs/sec during drag)
- [ ] isProcessingRemote flag resets after remote update

### Collaboration (Two Browsers)
- [ ] User A moves node → User B sees it
- [ ] User B moves same node → User A sees it (no conflicts)
- [ ] Multiple nodes moved simultaneously → all sync correctly
- [ ] Network latency handled gracefully

### Performance
- [ ] 50 nodes on canvas, dragging at 60 FPS
- [ ] Opening DevTools Profiler shows minimal re-renders
- [ ] Custom nodes memoized properly

### Edge Cases
- [ ] User disconnects and reconnects → state sync request works
- [ ] Network packet loss (simulate with DevTools) → eventual consistency
- [ ] Rapid concurrent updates → last-write-wins resolved correctly

---

## Performance Checklist

Before deploying, verify:

- [ ] `useFlowStore` uses selective subscriptions
- [ ] All callbacks wrapped in `useCallback`
- [ ] Custom node components wrapped in `React.memo`
- [ ] Node/edge type objects defined outside component
- [ ] Position updates throttled to <100ms intervals
- [ ] No console warnings about missing memo/useCallback
- [ ] React DevTools Profiler shows <100ms render time
- [ ] Dragging 50 nodes maintains 55+ FPS

---

## File Structure After Implementation

```
src/
├── lib/
│   └── flow-store.ts              # NEW: Zustand store
├── hooks/
│   └── use-flow-collaboration.ts  # NEW: WebSocket sync
├── components/
│   └── FlowEditor.tsx             # NEW: React Flow wrapper
└── routes/
    └── api/
        └── collaboration.ts       # MODIFIED: Add node:move handler
```

---

## Next Steps

1. **Copy the code** from sections 1-5 above
2. **Update your component** to use FlowEditor
3. **Test locally** first (single user, no WebSocket)
4. **Test collaboration** with two browser windows
5. **Run performance tests** with 50+ nodes
6. **Deploy and monitor** for any issues

---

## Debugging Tips

### Enable logging
```tsx
// In store
updateNodePosition: (id, position) => {
  console.log(`[Store] Position update: ${id}`, position);
  set(state => ({
    nodes: state.nodes.map(n =>
      n.id === id ? { ...n, position } : n
    ),
  }));
}
```

### Watch network messages
```
Chrome DevTools → Network → Filter by "socket.io"
Look for:
- node:move (user dragging)
- node:moved (remote update)
```

### Profile with React DevTools
```
React DevTools → Profiler → Record
- Drag a node
- Check that only FlowEditor component re-renders
- Custom nodes should not re-render unless position changed
```

### Check Zustand state
```tsx
// In browser console
useFlowStore.subscribe(state => {
  console.log('Store updated:', state);
});
```

---

## References

- Full Research: `/REACT_FLOW_RESEARCH.md`
- Architecture Decision: `/REACT_FLOW_DECISION.md`
- React Flow Docs: https://reactflow.dev/
- Zustand Docs: https://github.com/pmndrs/zustand

---

## Questions?

Refer to:
1. **Architecture questions** → REACT_FLOW_DECISION.md
2. **Technical deep-dive** → REACT_FLOW_RESEARCH.md
3. **React Flow specifics** → https://reactflow.dev/learn

---

**Status**: Ready for implementation
**Last Updated**: 2025-11-15

