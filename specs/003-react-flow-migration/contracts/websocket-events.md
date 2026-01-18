# WebSocket Events Contract: React Flow Migration

**Feature**: 003-react-flow-migration
**Date**: 2025-11-15

## Overview

This document defines the WebSocket event contracts for real-time collaboration in the React Flow-based whiteboard. **These contracts remain unchanged from the Konva implementation** to maintain backward compatibility.

## Event Namespace

All whiteboard collaboration events use the `whiteboard` namespace:

```typescript
const socket = io('/whiteboard', {
  query: { whiteboardId },
})
```

## Client → Server Events

### 1. `table:position-update`

Sent when a user drags a table to a new position.

**Payload**:

```typescript
interface TablePositionUpdatePayload {
  whiteboardId: string
  tableId: string
  positionX: number
  positionY: number
  userId?: string // Optional user ID for tracking who made the change
}
```

**Example**:

```typescript
socket.emit('table:position-update', {
  whiteboardId: 'whiteboard-123',
  tableId: 'table-abc',
  positionX: 450.5,
  positionY: 230.75,
  userId: 'user-xyz',
})
```

**Server Response**: Broadcasts to all clients except sender

---

### 2. `cursor:move`

Sent when a user moves their cursor on the canvas (for collaborative cursor display).

**Payload**:

```typescript
interface CursorMovePayload {
  whiteboardId: string
  userId: string
  x: number
  y: number
  userName?: string
}
```

**Example**:

```typescript
socket.emit('cursor:move', {
  whiteboardId: 'whiteboard-123',
  userId: 'user-xyz',
  x: 500,
  y: 300,
  userName: 'Alice',
})
```

**Server Response**: Broadcasts to all clients except sender

---

### 3. `join-whiteboard`

Sent when a user joins a whiteboard session.

**Payload**:

```typescript
interface JoinWhiteboardPayload {
  whiteboardId: string
  userId: string
  userName?: string
}
```

**Example**:

```typescript
socket.emit('join-whiteboard', {
  whiteboardId: 'whiteboard-123',
  userId: 'user-xyz',
  userName: 'Alice',
})
```

**Server Response**: Broadcasts `user:joined` to all clients

---

### 4. `leave-whiteboard`

Sent when a user leaves a whiteboard session.

**Payload**:

```typescript
interface LeaveWhiteboardPayload {
  whiteboardId: string
  userId: string
}
```

**Example**:

```typescript
socket.emit('leave-whiteboard', {
  whiteboardId: 'whiteboard-123',
  userId: 'user-xyz',
})
```

**Server Response**: Broadcasts `user:left` to all clients

---

## Server → Client Events

### 1. `table:position-updated`

Broadcasted when another user updates a table position.

**Payload**:

```typescript
interface TablePositionUpdatedPayload {
  whiteboardId: string
  tableId: string
  positionX: number
  positionY: number
  userId?: string
  timestamp: number // Unix timestamp in milliseconds
}
```

**Example**:

```typescript
socket.on('table:position-updated', (data) => {
  // Update React Flow node position
  setNodes((nds) =>
    nds.map((node) =>
      node.id === data.tableId
        ? { ...node, position: { x: data.positionX, y: data.positionY } }
        : node,
    ),
  )
})
```

---

### 2. `cursor:moved`

Broadcasted when another user moves their cursor.

**Payload**:

```typescript
interface CursorMovedPayload {
  whiteboardId: string
  userId: string
  x: number
  y: number
  userName?: string
}
```

**Example**:

```typescript
socket.on('cursor:moved', (data) => {
  // Update collaborative cursor position
  updateCursorPosition(data.userId, { x: data.x, y: data.y })
})
```

---

### 3. `user:joined`

Broadcasted when a new user joins the whiteboard.

**Payload**:

```typescript
interface UserJoinedPayload {
  whiteboardId: string
  userId: string
  userName?: string
  timestamp: number
}
```

**Example**:

```typescript
socket.on('user:joined', (data) => {
  // Show notification: "Alice joined"
  showNotification(`${data.userName || 'A user'} joined the whiteboard`)
})
```

---

### 4. `user:left`

Broadcasted when a user leaves the whiteboard.

**Payload**:

```typescript
interface UserLeftPayload {
  whiteboardId: string
  userId: string
  timestamp: number
}
```

**Example**:

```typescript
socket.on('user:left', (data) => {
  // Remove collaborative cursor
  removeCursorForUser(data.userId)
})
```

---

### 5. `table:created`

Broadcasted when a new table is created on the whiteboard.

**Payload**:

```typescript
interface TableCreatedPayload {
  whiteboardId: string
  table: {
    id: string
    name: string
    positionX: number
    positionY: number
    columns: Array<{
      id: string
      name: string
      dataType: string
      isPrimaryKey: boolean
      isForeignKey: boolean
    }>
  }
  userId?: string
  timestamp: number
}
```

**Example**:

```typescript
socket.on('table:created', (data) => {
  // Add new node to React Flow
  const newNode = convertTableToNode(data.table)
  setNodes((nds) => [...nds, newNode])
})
```

---

### 6. `table:deleted`

Broadcasted when a table is deleted from the whiteboard.

**Payload**:

```typescript
interface TableDeletedPayload {
  whiteboardId: string
  tableId: string
  userId?: string
  timestamp: number
}
```

**Example**:

```typescript
socket.on('table:deleted', (data) => {
  // Remove node from React Flow
  setNodes((nds) => nds.filter((node) => node.id !== data.tableId))
  // Remove related edges
  setEdges((eds) =>
    eds.filter(
      (edge) => edge.source !== data.tableId && edge.target !== data.tableId,
    ),
  )
})
```

---

### 7. `relationship:created`

Broadcasted when a new relationship is created.

**Payload**:

```typescript
interface RelationshipCreatedPayload {
  whiteboardId: string
  relationship: {
    id: string
    sourceTableId: string
    targetTableId: string
    sourceColumnId: string
    targetColumnId: string
    cardinality: 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY'
    label?: string
  }
  userId?: string
  timestamp: number
}
```

**Example**:

```typescript
socket.on('relationship:created', (data) => {
  // Add new edge to React Flow
  const newEdge = convertRelationshipToEdge(data.relationship)
  setEdges((eds) => [...eds, newEdge])
})
```

---

### 8. `relationship:deleted`

Broadcasted when a relationship is deleted.

**Payload**:

```typescript
interface RelationshipDeletedPayload {
  whiteboardId: string
  relationshipId: string
  userId?: string
  timestamp: number
}
```

**Example**:

```typescript
socket.on('relationship:deleted', (data) => {
  // Remove edge from React Flow
  setEdges((eds) => eds.filter((edge) => edge.id !== data.relationshipId))
})
```

---

## Error Events

### `error`

Sent by server when an operation fails.

**Payload**:

```typescript
interface ErrorPayload {
  message: string
  code?: string
  data?: unknown
}
```

**Example**:

```typescript
socket.on('error', (error) => {
  console.error('WebSocket error:', error.message)
  showErrorNotification(error.message)
})
```

---

## Connection Events

### `connect`

Emitted when socket successfully connects.

```typescript
socket.on('connect', () => {
  console.log('Connected to whiteboard:', socket.id)
  // Rejoin whiteboard after reconnection
  socket.emit('join-whiteboard', { whiteboardId, userId })
})
```

### `disconnect`

Emitted when socket disconnects.

```typescript
socket.on('disconnect', (reason) => {
  console.log('Disconnected from whiteboard:', reason)
  // Show "reconnecting..." indicator
})
```

### `reconnect`

Emitted when socket reconnects after disconnect.

```typescript
socket.on('reconnect', (attemptNumber) => {
  console.log('Reconnected after', attemptNumber, 'attempts')
  // Refresh whiteboard data
})
```

---

## Migration Notes

### Unchanged from Konva Implementation

All WebSocket events maintain the same structure and behavior as the Konva implementation. The migration to React Flow only affects how events are handled in the UI layer:

**Konva Implementation**:

```typescript
socket.on('table:position-updated', (data) => {
  // Update Konva shape position
  const tableShape = stage.findOne(`#${data.tableId}`)
  tableShape?.position({ x: data.positionX, y: data.positionY })
  layer.batchDraw()
})
```

**React Flow Implementation**:

```typescript
socket.on('table:position-updated', (data) => {
  // Update React Flow node position
  setNodes((nds) =>
    nds.map((node) =>
      node.id === data.tableId
        ? { ...node, position: { x: data.positionX, y: data.positionY } }
        : node,
    ),
  )
})
```

### Position Coordinate System

Both Konva and React Flow use the same coordinate system:

- Origin (0, 0) is top-left corner of canvas
- Positive X extends to the right
- Positive Y extends downward
- Units are pixels

This ensures seamless compatibility with the database schema (`DiagramTable.positionX`, `DiagramTable.positionY`).

---

## Implementation Example

```typescript
// src/hooks/use-whiteboard-collaboration.ts
import { useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import type { Node, Edge } from '@xyflow/react'

export function useWhiteboardCollaboration(
  whiteboardId: string,
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>,
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
) {
  useEffect(() => {
    const socket = io('/whiteboard', {
      query: { whiteboardId },
    })

    // Join whiteboard
    socket.emit('join-whiteboard', {
      whiteboardId,
      userId: getCurrentUserId(),
      userName: getCurrentUserName(),
    })

    // Handle position updates
    socket.on('table:position-updated', (data) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === data.tableId
            ? { ...node, position: { x: data.positionX, y: data.positionY } }
            : node,
        ),
      )
    })

    // Handle table creation
    socket.on('table:created', (data) => {
      const newNode = convertTableToNode(data.table)
      setNodes((nds) => [...nds, newNode])
    })

    // Handle table deletion
    socket.on('table:deleted', (data) => {
      setNodes((nds) => nds.filter((node) => node.id !== data.tableId))
      setEdges((eds) =>
        eds.filter(
          (edge) =>
            edge.source !== data.tableId && edge.target !== data.tableId,
        ),
      )
    })

    // Handle relationship creation
    socket.on('relationship:created', (data) => {
      const newEdge = convertRelationshipToEdge(data.relationship)
      setEdges((eds) => [...eds, newEdge])
    })

    // Handle relationship deletion
    socket.on('relationship:deleted', (data) => {
      setEdges((eds) => eds.filter((edge) => edge.id !== data.relationshipId))
    })

    // Cleanup
    return () => {
      socket.emit('leave-whiteboard', {
        whiteboardId,
        userId: getCurrentUserId(),
      })
      socket.disconnect()
    }
  }, [whiteboardId, setNodes, setEdges])
}
```

---

## Testing

### Integration Test Example

```typescript
import { io } from 'socket.io-client'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('WebSocket Collaboration', () => {
  let socket: Socket

  beforeEach(() => {
    socket = io('/whiteboard', {
      query: { whiteboardId: 'test-whiteboard' },
    })
  })

  afterEach(() => {
    socket.disconnect()
  })

  it('should broadcast table position updates to other clients', (done) => {
    socket.on('table:position-updated', (data) => {
      expect(data.tableId).toBe('table-123')
      expect(data.positionX).toBe(100)
      expect(data.positionY).toBe(200)
      done()
    })

    socket.emit('table:position-update', {
      whiteboardId: 'test-whiteboard',
      tableId: 'table-123',
      positionX: 100,
      positionY: 200,
    })
  })
})
```

---

## Summary

The WebSocket event contracts remain fully compatible with the Konva implementation. The migration to React Flow requires zero changes to the server-side WebSocket handling. Only client-side event handlers need updates to work with React Flow's state management (`setNodes`, `setEdges`) instead of Konva's imperative API.
