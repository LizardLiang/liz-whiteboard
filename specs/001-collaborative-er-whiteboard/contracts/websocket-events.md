# WebSocket Events: Real-Time Collaboration

**Protocol**: Socket.IO
**Namespace**: `/whiteboard/:whiteboardId`
**Transport**: WebSocket (fallback to long-polling)

## Connection

### Client → Server: Connect to Whiteboard

```typescript
// Client connects with authentication
const socket = io('/whiteboard/:whiteboardId', {
  auth: {
    userId: string, // User UUID
    token: string, // JWT auth token (future)
  },
})
```

### Server → Client: Connection Acknowledged

```typescript
socket.on(
  'connected',
  (data: {
    sessionId: string // Collaboration session UUID
    activeUsers: Array<{
      // List of other active users
      userId: string
      cursor?: { x: number; y: number }
      lastActivityAt: string
    }>
  }) => {
    // Handle connection confirmation
  },
)
```

---

## Presence Events

### Client → Server: Update Cursor Position

**Event**: `cursor:update`

```typescript
socket.emit('cursor:update', {
  x: number, // Canvas X coordinate
  y: number, // Canvas Y coordinate
})
```

**Broadcast**: All other clients receive

```typescript
socket.on('cursor:moved', (data: { userId: string; x: number; y: number }) => {
  // Update user cursor visualization
})
```

**Throttle**: Client throttles to 60Hz (every 16ms)

---

### Client → Server: User Activity Heartbeat

**Event**: `activity:heartbeat`

```typescript
socket.emit('activity:heartbeat', {
  action: string, // "typing" | "drawing" | "idle"
})
```

**Purpose**: Keep session alive, prevent timeout

---

### Server → Client: User Disconnected

**Event**: `user:disconnected`

```typescript
socket.on('user:disconnected', (data: { userId: string }) => {
  // Remove user from active list
})
```

---

## Diagram Mutation Events

All mutation events follow this pattern:

1. Client sends operation
2. Server validates and persists to database
3. Server broadcasts to all other clients (except sender)

### Client → Server: Create Table

**Event**: `table:create`

```typescript
socket.emit('table:create', {
  name: string,
  description?: string,
  positionX: number,
  positionY: number,
  width?: number,
  height?: number,
});
```

**Server → Clients: Table Created**

```typescript
socket.on(
  'table:created',
  (data: {
    id: string // New table UUID
    whiteboardId: string
    name: string
    description?: string
    positionX: number
    positionY: number
    width?: number
    height?: number
    createdBy: string // User UUID who created
    createdAt: string
  }) => {
    // Add table to local diagram state
  },
)
```

---

### Client → Server: Update Table Position

**Event**: `table:move`

```typescript
socket.emit('table:move', {
  tableId: string,
  positionX: number,
  positionY: number,
})
```

**Broadcast**:

```typescript
socket.on(
  'table:moved',
  (data: {
    tableId: string
    positionX: number
    positionY: number
    updatedBy: string
  }) => {
    // Update table position in local state
  },
)
```

**Throttle**: Debounced to 100ms on server

---

### Client → Server: Update Table

**Event**: `table:update`

```typescript
socket.emit('table:update', {
  tableId: string,
  name?: string,
  description?: string,
  width?: number,
  height?: number,
});
```

**Broadcast**:

```typescript
socket.on(
  'table:updated',
  (data: {
    tableId: string
    name?: string
    description?: string
    width?: number
    height?: number
    updatedBy: string
  }) => {
    // Merge updates into local table
  },
)
```

---

### Client → Server: Delete Table

**Event**: `table:delete`

```typescript
socket.emit('table:delete', {
  tableId: string,
})
```

**Broadcast**:

```typescript
socket.on('table:deleted', (data: { tableId: string; deletedBy: string }) => {
  // Remove table from local state (cascade to columns/relationships)
})
```

---

### Client → Server: Create Column

**Event**: `column:create`

```typescript
socket.emit('column:create', {
  tableId: string,
  name: string,
  dataType: 'int' | 'string' | 'float' | 'boolean' | 'date' | 'text' | 'uuid' | 'json',
  isPrimaryKey?: boolean,
  isForeignKey?: boolean,
  isUnique?: boolean,
  isNullable?: boolean,
  description?: string,
  order?: number,
});
```

**Broadcast**:

```typescript
socket.on(
  'column:created',
  (data: {
    id: string
    tableId: string
    name: string
    dataType: string
    isPrimaryKey: boolean
    isForeignKey: boolean
    isUnique: boolean
    isNullable: boolean
    description?: string
    order: number
    createdBy: string
    createdAt: string
  }) => {
    // Add column to table in local state
  },
)
```

---

### Client → Server: Update Column

**Event**: `column:update`

```typescript
socket.emit('column:update', {
  columnId: string,
  name?: string,
  dataType?: string,
  isPrimaryKey?: boolean,
  isForeignKey?: boolean,
  isUnique?: boolean,
  isNullable?: boolean,
  description?: string,
  order?: number,
});
```

**Broadcast**:

```typescript
socket.on('column:updated', (data: {
  columnId: string,
  tableId: string,
  .../* updated fields */,
  updatedBy: string,
}) => {
  // Merge column updates in local state
});
```

---

### Client → Server: Delete Column

**Event**: `column:delete`

```typescript
socket.emit('column:delete', {
  columnId: string,
})
```

**Broadcast**:

```typescript
socket.on(
  'column:deleted',
  (data: { columnId: string; tableId: string; deletedBy: string }) => {
    // Remove column from local state (cascade to relationships)
  },
)
```

---

### Client → Server: Create Relationship

**Event**: `relationship:create`

```typescript
socket.emit('relationship:create', {
  sourceTableId: string,
  targetTableId: string,
  sourceColumnId: string,
  targetColumnId: string,
  cardinality: 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY',
  label?: string,
  routingPoints?: Array<{ x: number, y: number }>,
});
```

**Broadcast**:

```typescript
socket.on(
  'relationship:created',
  (data: {
    id: string
    whiteboardId: string
    sourceTableId: string
    targetTableId: string
    sourceColumnId: string
    targetColumnId: string
    cardinality: string
    label?: string
    routingPoints?: Array<{ x: number; y: number }>
    createdBy: string
    createdAt: string
  }) => {
    // Add relationship to local diagram
  },
)
```

---

### Client → Server: Update Relationship

**Event**: `relationship:update`

```typescript
socket.emit('relationship:update', {
  relationshipId: string,
  cardinality?: string,
  label?: string,
  routingPoints?: Array<{ x: number, y: number }>,
});
```

**Broadcast**:

```typescript
socket.on('relationship:updated', (data: {
  relationshipId: string,
  .../* updated fields */,
  updatedBy: string,
}) => {
  // Merge relationship updates
});
```

---

### Client → Server: Delete Relationship

**Event**: `relationship:delete`

```typescript
socket.emit('relationship:delete', {
  relationshipId: string,
})
```

**Broadcast**:

```typescript
socket.on(
  'relationship:deleted',
  (data: { relationshipId: string; deletedBy: string }) => {
    // Remove relationship from local state
  },
)
```

---

## Canvas State Events

### Client → Server: Update Canvas Viewport

**Event**: `canvas:update`

```typescript
socket.emit('canvas:update', {
  zoom: number,
  offsetX: number,
  offsetY: number,
})
```

**Broadcast**: None (canvas state is per-user, not synced)

**Persistence**: Saved to database on disconnect or periodic save

---

## Text Editor Events

### Client → Server: Update Text Source

**Event**: `text:update`

```typescript
socket.emit('text:update', {
  textSource: string, // Full diagram text syntax
  cursorPosition: number, // Caret position in text
})
```

**Broadcast**:

```typescript
socket.on(
  'text:updated',
  (data: {
    textSource: string
    updatedBy: string
    cursor: { userId: string; position: number }
  }) => {
    // Merge text changes (last write wins)
  },
)
```

**Throttle**: Debounced to 500ms

**Note**: Text changes trigger diagram re-parse and render

---

## Layout Events

### Client → Server: Trigger Auto-Layout

**Event**: `layout:compute`

```typescript
socket.emit('layout:compute', {
  maxIterations?: number,   // Default 300
});
```

**Server → Clients: Layout Result**

```typescript
socket.on(
  'layout:computed',
  (data: {
    tablePositions: Array<{
      tableId: string
      positionX: number
      positionY: number
    }>
    computedBy: string
  }) => {
    // Apply layout positions to tables
  },
)
```

**Note**: Layout computation runs on server to ensure all clients see same result

---

## Error Handling

### Server → Client: Operation Error

```typescript
socket.on(
  'error',
  (data: {
    event: string // Original event name
    error: string // Error code (VALIDATION_ERROR, NOT_FOUND, etc.)
    message: string // Human-readable error
    details?: object // Additional error context
  }) => {
    // Display error to user, roll back optimistic update
  },
)
```

**Common Error Codes**:

- `VALIDATION_ERROR`: Invalid payload
- `NOT_FOUND`: Referenced entity doesn't exist
- `CONFLICT`: Concurrent modification conflict
- `UNAUTHORIZED`: User lacks permission
- `RATE_LIMIT`: Too many operations

---

## Reconnection Handling

### Client Reconnects After Disconnect

**Flow**:

1. Client reconnects with same `userId`
2. Server sends `connected` event with latest state
3. Client reconciles local state with server state
4. If conflicts, server state wins (last write wins per spec)

**Server → Client: Sync State**

```typescript
socket.on(
  'sync:required',
  (data: {
    whiteboardId: string
    lastSyncedAt: string // Timestamp of client's last known state
  }) => {
    // Client requests full diagram refresh
    socket.emit('sync:request')
  },
)
```

```typescript
socket.on(
  'sync:data',
  (data: {
    whiteboard: WhiteboardWithDiagram // Full diagram snapshot
  }) => {
    // Replace local state with server snapshot
  },
)
```

---

## Performance Optimizations

1. **Event Throttling**:
   - `cursor:update`: Client throttles to 60Hz
   - `table:move`: Server debounces to 100ms
   - `text:update`: Server debounces to 500ms

2. **Batching**:
   - Multiple column creates can be batched into single `columns:create-batch` event

3. **Delta Compression**:
   - For large payloads (text source), send diffs instead of full content

4. **Binary Encoding**:
   - Use MessagePack for non-text data (positions, routing points)

---

## Security

1. **Authentication**:
   - JWT token in connection handshake
   - Verify user has access to whiteboard

2. **Authorization**:
   - Validate user can edit whiteboard before applying mutations
   - Check project/folder ownership

3. **Rate Limiting**:
   - Max 100 events/second per user
   - Max 10 tables created/minute

4. **Input Validation**:
   - All payloads validated against Zod schemas
   - Sanitize text inputs to prevent XSS

---

## Example Client Usage

```typescript
import { io } from 'socket.io-client'

// Connect to whiteboard
const socket = io(`/whiteboard/${whiteboardId}`, {
  auth: { userId: currentUser.id },
})

// Listen for connection
socket.on('connected', ({ sessionId, activeUsers }) => {
  console.log('Connected:', sessionId)
  console.log('Active users:', activeUsers)
})

// Listen for table creation
socket.on('table:created', (table) => {
  addTableToCanvas(table)
})

// Create a table
const createTable = (name: string, x: number, y: number) => {
  socket.emit('table:create', {
    name,
    positionX: x,
    positionY: y,
  })
}

// Throttled cursor updates
const updateCursor = throttle((x: number, y: number) => {
  socket.emit('cursor:update', { x, y })
}, 16) // 60Hz

// Handle errors
socket.on('error', ({ event, error, message }) => {
  toast.error(`${event} failed: ${message}`)
})
```
