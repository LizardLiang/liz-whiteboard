# WebSocket Collaboration Protocol

**Date**: 2025-11-15
**Branch**: `002-react-flow-migration`

## Overview

This document specifies the WebSocket event protocol for real-time collaboration in React Flow-based ER diagrams. It extends the existing Socket.IO collaboration implementation to support React Flow state synchronization.

**Note**: Migration to React Flow is not recommended based on research. This serves as reference if proceeding.

## Connection & Room Management

### Join Whiteboard

**Client → Server**

```typescript
socket.emit('whiteboard:join', {
  whiteboardId: string;
  userId: string;
  username: string;
});
```

**Server → Client (Acknowledgment)**

```typescript
socket.emit('whiteboard:joined', {
  whiteboardId: string;
  users: Array<{
    userId: string;
    username: string;
    joinedAt: number;
  }>;
  currentState: {
    nodes: TableNode[];
    edges: RelationshipEdge[];
    viewport: ReactFlowViewport;
  };
});
```

### Leave Whiteboard

**Client → Server**

```typescript
socket.emit('whiteboard:leave', {
  whiteboardId: string;
  userId: string;
});
```

**Server → All Clients in Room**

```typescript
socket.emit('user:left', {
  whiteboardId: string;
  userId: string;
  username: string;
  leftAt: number;
});
```

---

## Node Events

### Node Position Update (Drag)

**Client → Server**

```typescript
// Emitted when user finishes dragging a node
socket.emit('node:position', {
  whiteboardId: string;
  nodeId: string;
  position: {
    x: number;
    y: number;
  };
  userId: string;
  timestamp: number;
  version?: number;  // Optional for conflict resolution
});
```

**Server → Other Clients**

```typescript
// Broadcasted to all clients except sender
socket.emit('node:position:update', {
  whiteboardId: string;
  nodeId: string;
  position: {
    x: number;
    y: number;
  };
  userId: string;
  username: string;
  timestamp: number;
  version?: number;
});
```

**Client Handler**

```typescript
socket.on('node:position:update', (event) => {
  // Set flag to prevent echo-back
  isProcessingRemote = true

  // Update node position in store
  updateNodePosition(event.nodeId, event.position)

  // Reset flag after render
  requestAnimationFrame(() => {
    isProcessingRemote = false
  })
})
```

### Node Added

**Client → Server**

```typescript
socket.emit('node:add', {
  whiteboardId: string;
  node: {
    id: string;
    type: 'erTable';
    position: { x: number; y: number };
    data: {
      table: DiagramTable;
      columns: Column[];
    };
  };
  userId: string;
  timestamp: number;
});
```

**Server → Other Clients**

```typescript
socket.emit('node:added', {
  whiteboardId: string;
  node: TableNode;
  userId: string;
  username: string;
  timestamp: number;
});
```

### Node Deleted

**Client → Server**

```typescript
socket.emit('node:delete', {
  whiteboardId: string;
  nodeId: string;
  userId: string;
  timestamp: number;
});
```

**Server → Other Clients**

```typescript
socket.emit('node:deleted', {
  whiteboardId: string;
  nodeId: string;
  userId: string;
  username: string;
  timestamp: number;
  // Also delete connected edges automatically
  deletedEdgeIds: string[];
});
```

### Node Updated (Table Properties)

**Client → Server**

```typescript
socket.emit('node:update', {
  whiteboardId: string;
  nodeId: string;
  updates: {
    data?: {
      table?: Partial<DiagramTable>;
      columns?: Column[];
    };
  };
  userId: string;
  timestamp: number;
});
```

**Server → Other Clients**

```typescript
socket.emit('node:updated', {
  whiteboardId: string;
  nodeId: string;
  updates: Partial<TableNode>;
  userId: string;
  username: string;
  timestamp: number;
});
```

---

## Edge Events

### Edge Added (Relationship Created)

**Client → Server**

```typescript
socket.emit('edge:add', {
  whiteboardId: string;
  edge: {
    id: string;
    type: 'erRelationship';
    source: string;  // sourceTableId
    target: string;  // targetTableId
    sourceHandle: string;  // columnId-source
    targetHandle: string;  // columnId-target
    data: {
      relationship: Relationship;
      cardinality: CardinalityType;
      label?: string;
    };
  };
  userId: string;
  timestamp: number;
});
```

**Server → Other Clients**

```typescript
socket.emit('edge:added', {
  whiteboardId: string;
  edge: RelationshipEdge;
  userId: string;
  username: string;
  timestamp: number;
});
```

### Edge Deleted

**Client → Server**

```typescript
socket.emit('edge:delete', {
  whiteboardId: string;
  edgeId: string;
  userId: string;
  timestamp: number;
});
```

**Server → Other Clients**

```typescript
socket.emit('edge:deleted', {
  whiteboardId: string;
  edgeId: string;
  userId: string;
  username: string;
  timestamp: number;
});
```

### Edge Updated (Relationship Properties)

**Client → Server**

```typescript
socket.emit('edge:update', {
  whiteboardId: string;
  edgeId: string;
  updates: {
    data?: {
      cardinality?: CardinalityType;
      label?: string;
    };
  };
  userId: string;
  timestamp: number;
});
```

**Server → Other Clients**

```typescript
socket.emit('edge:updated', {
  whiteboardId: string;
  edgeId: string;
  updates: Partial<RelationshipEdge>;
  userId: string;
  username: string;
  timestamp: number;
});
```

---

## Viewport Events (Optional)

### Viewport Changed

**Client → Server** (Optional, throttled)

```typescript
// Throttled to 1 update per second
socket.emit('viewport:change', {
  whiteboardId: string;
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  userId: string;
  timestamp: number;
});
```

**Server → Other Clients** (Optional)

```typescript
// Show other users' viewport positions (for mini-map indicators)
socket.emit('viewport:changed', {
  whiteboardId: string;
  userId: string;
  username: string;
  viewport: ReactFlowViewport;
  timestamp: number;
});
```

---

## Batch Operations

### Bulk Update (e.g., Auto Layout)

**Client → Server**

```typescript
socket.emit('bulk:update', {
  whiteboardId: string;
  operation: 'layout';
  changes: {
    nodes: Array<{
      id: string;
      position: { x: number; y: number };
    }>;
  };
  userId: string;
  timestamp: number;
});
```

**Server → Other Clients**

```typescript
socket.emit('bulk:updated', {
  whiteboardId: string;
  operation: 'layout';
  changes: {
    nodes: Array<{
      id: string;
      position: { x: number; y: number };
    }>;
  };
  userId: string;
  username: string;
  timestamp: number;
});
```

---

## Cursor Tracking (Optional)

### Cursor Position

**Client → Server** (Throttled to 10 Hz = 100ms)

```typescript
socket.emit('cursor:move', {
  whiteboardId: string;
  userId: string;
  position: {
    x: number;  // Viewport coordinates
    y: number;
  };
  timestamp: number;
});
```

**Server → Other Clients**

```typescript
socket.emit('cursor:moved', {
  whiteboardId: string;
  userId: string;
  username: string;
  position: { x: number; y: number };
  timestamp: number;
});
```

---

## Conflict Resolution

### Version-Based Last-Write-Wins

Each update includes a timestamp and optional version number. The server applies the most recent timestamp.

```typescript
// Server-side conflict resolution
function resolveConflict(current, incoming) {
  if (!current.timestamp || incoming.timestamp > current.timestamp) {
    return incoming // Apply newer update
  }
  return current // Keep existing
}
```

### Conflict Notification

**Server → Client** (When client's update was overwritten)

```typescript
socket.emit('conflict:detected', {
  whiteboardId: string;
  entityType: 'node' | 'edge';
  entityId: string;
  yourTimestamp: number;
  winningTimestamp: number;
  winningUserId: string;
  winningUsername: string;
});
```

**Client Handler**

```typescript
socket.on('conflict:detected', (event) => {
  // Show toast notification
  toast.warning(
    `Your change to ${event.entityType} was overwritten by ${event.winningUsername}`,
    { duration: 3000 },
  )
})
```

---

## State Synchronization

### Request Full State (On Reconnection)

**Client → Server**

```typescript
socket.emit('sync:request', {
  whiteboardId: string;
  userId: string;
  lastKnownVersion?: number;
});
```

**Server → Client**

```typescript
socket.emit('sync:response', {
  whiteboardId: string;
  state: {
    nodes: TableNode[];
    edges: RelationshipEdge[];
    viewport: ReactFlowViewport;
    version: number;
  };
  timestamp: number;
});
```

---

## Throttling & Rate Limiting

### Client-Side Throttling

```typescript
// Throttle position updates during dragging
const throttledPositionUpdate = throttle((nodeId, position) => {
  socket.emit('node:position', {
    whiteboardId,
    nodeId,
    position,
    userId: currentUser.id,
    timestamp: Date.now(),
  })
}, 100) // 100ms = 10 updates/second

// Usage in onNodeDrag handler
const onNodeDrag: NodeDragHandler = (event, node) => {
  throttledPositionUpdate(node.id, node.position)
}
```

### Server-Side Rate Limiting

```typescript
// Limit to 50 events per second per user
const rateLimiter = new RateLimiter({
  windowMs: 1000,
  max: 50,
})

socket.use((packet, next) => {
  if (rateLimiter.consume(socket.id)) {
    next()
  } else {
    socket.emit('error', { message: 'Rate limit exceeded' })
  }
})
```

---

## Error Handling

### Error Events

**Server → Client**

```typescript
socket.emit('error', {
  code: string;  // e.g., 'PERMISSION_DENIED', 'INVALID_DATA', 'RATE_LIMIT'
  message: string;
  details?: any;
  timestamp: number;
});
```

**Client Handler**

```typescript
socket.on('error', (error) => {
  console.error('WebSocket error:', error)

  switch (error.code) {
    case 'PERMISSION_DENIED':
      toast.error('You do not have permission to edit this whiteboard')
      break
    case 'RATE_LIMIT':
      toast.warning('Slow down! Too many updates')
      break
    default:
      toast.error(error.message)
  }
})
```

---

## Reconnection Handling

### On Disconnect

```typescript
socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason)
  // Show offline indicator
  setConnectionStatus('disconnected')
})
```

### On Reconnect

```typescript
socket.on('connect', () => {
  console.log('Reconnected')

  // Rejoin whiteboard room
  socket.emit('whiteboard:join', {
    whiteboardId,
    userId: currentUser.id,
    username: currentUser.username,
  })

  // Request full state sync
  socket.emit('sync:request', {
    whiteboardId,
    userId: currentUser.id,
  })

  setConnectionStatus('connected')
})
```

---

## Implementation Example

### Client-Side Integration

```typescript
import { io } from 'socket.io-client'
import { useWhiteboardStore } from '@/stores/whiteboard'

export function useWebSocketSync(whiteboardId: string) {
  const { updateNode, addNode, removeNode, updateEdge, addEdge, removeEdge } =
    useWhiteboardStore()
  const [socket, setSocket] = useState<Socket | null>(null)
  const isProcessingRemote = useRef(false)

  useEffect(() => {
    const socket = io(import.meta.env.VITE_WS_URL)

    // Join whiteboard
    socket.emit('whiteboard:join', {
      whiteboardId,
      userId: currentUser.id,
      username: currentUser.username,
    })

    // Listen for node updates
    socket.on('node:position:update', (event) => {
      isProcessingRemote.current = true
      updateNode(event.nodeId, { position: event.position })
      requestAnimationFrame(() => {
        isProcessingRemote.current = false
      })
    })

    socket.on('node:added', (event) => {
      isProcessingRemote.current = true
      addNode(event.node)
      requestAnimationFrame(() => {
        isProcessingRemote.current = false
      })
    })

    socket.on('node:deleted', (event) => {
      isProcessingRemote.current = true
      removeNode(event.nodeId)
      event.deletedEdgeIds.forEach((edgeId) => removeEdge(edgeId))
      requestAnimationFrame(() => {
        isProcessingRemote.current = false
      })
    })

    // Similar handlers for edge events...

    setSocket(socket)

    return () => {
      socket.emit('whiteboard:leave', { whiteboardId, userId: currentUser.id })
      socket.disconnect()
    }
  }, [whiteboardId])

  return {
    socket,
    isProcessingRemote,
    emitNodeUpdate: (nodeId, updates) => {
      if (socket && !isProcessingRemote.current) {
        socket.emit('node:update', {
          whiteboardId,
          nodeId,
          updates,
          userId: currentUser.id,
          timestamp: Date.now(),
        })
      }
    },
  }
}
```

---

## Summary

This WebSocket protocol defines:

1. **Connection management**: Join/leave whiteboard rooms
2. **Node events**: Position, add, delete, update
3. **Edge events**: Add, delete, update
4. **Viewport events**: Optional viewport synchronization
5. **Batch operations**: Bulk updates for layout
6. **Cursor tracking**: Optional cursor position sharing
7. **Conflict resolution**: Timestamp-based last-write-wins
8. **State sync**: Full state request on reconnection
9. **Throttling**: Client and server rate limiting
10. **Error handling**: Comprehensive error events
11. **Reconnection**: Automatic rejoin and state sync

All events follow the existing Socket.IO pattern and extend it for React Flow state management.

**Note**: Based on research, migrating to React Flow is not recommended. See [research.md](../research.md) for details.
