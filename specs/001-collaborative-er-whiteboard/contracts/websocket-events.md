# WebSocket Events — ER Whiteboard Collaboration

This document describes all Socket.IO events used in the whiteboard collaboration namespace.
Events are namespaced by whiteboard ID: `/whiteboard/:whiteboardId`.

---

## Column Events

### `column:create` (Client → Server)

Emitted when a user creates a new column.

**Payload:**
```json
{
  "tableId": "uuid",
  "name": "string",
  "dataType": "string",
  "order": "number",
  "isPrimaryKey": "boolean (optional)",
  "isForeignKey": "boolean (optional)",
  "isUnique": "boolean (optional)",
  "isNullable": "boolean (optional)"
}
```

---

### `column:created` (Server → Client, broadcast)

Broadcast to all other users when a column is created.

**Payload:** Full `Column` object + `createdBy: userId`

---

### `column:update` (Client → Server)

Emitted when a user updates a column field.

**Payload:**
```json
{
  "columnId": "uuid",
  "name": "string (optional)",
  "dataType": "string (optional)",
  "isPrimaryKey": "boolean (optional)",
  "isForeignKey": "boolean (optional)",
  "isUnique": "boolean (optional)",
  "isNullable": "boolean (optional)",
  "description": "string (optional)"
}
```

---

### `column:updated` (Server → Client, broadcast)

Broadcast to all other users when a column is updated.

**Payload:** `{ columnId, tableId, ...updatedFields, updatedBy: userId }`

---

### `column:delete` (Client → Server)

Emitted when a user deletes a column.

**Payload:** `{ columnId: uuid }`

---

### `column:deleted` (Server → Client, broadcast)

Broadcast to all other users when a column is deleted.

**Payload:** `{ columnId, tableId, deletedBy: userId }`

---

### `column:reorder` (Client → Server)

Emitted when a user drags a column to a new position and drops it.
The client sends the complete desired order for the table's columns.

**Payload:**
```json
{
  "tableId": "uuid",
  "orderedColumnIds": ["uuid", "uuid", ...]
}
```

**Validation:**
- `tableId` must be a valid UUID belonging to the current whiteboard (IDOR check)
- `orderedColumnIds` must be a non-empty array of UUIDs (min 1, max 500)
- All IDs must belong to the specified table

**Server-side FM-07 merge:** If the client omits any columns (e.g., a column was added mid-drag),
the server appends the missing columns in ascending existing-`order` before persisting.

---

### `column:reordered` (Server → Client, broadcast)

Broadcast to all users **except the sender** when a column reorder is persisted.
The payload includes the fully-merged+re-sequenced order (including any FM-07 appended columns).

**Payload:**
```json
{
  "tableId": "uuid",
  "orderedColumnIds": ["uuid", "uuid", ...],
  "reorderedBy": "userId"
}
```

Note: `reorderedBy` is included so receiving clients can show a notification
if they were mid-drag when the remote reorder arrived (REQ-14).

---

### `column:reorder:ack` (Server → originating Client only)

Sent **only to the sender** (not broadcast) to confirm the reorder was persisted.
The payload contains the server's canonical merged+re-sequenced order, which may differ
from the client's optimistic order if FM-07 appended missing columns.

**Payload:**
```json
{
  "tableId": "uuid",
  "orderedColumnIds": ["uuid", "uuid", ...]
}
```

**Client behavior:**
- Pop the head of the FIFO queue for this table
- If queue depth drops to 0, apply the server's canonical order to local state
- If queue depth > 0, do NOT apply yet (SA-H3: prevents in-flight snap-back)

---

## Error Events

### `error` (Server → Client)

Emitted to the originating client on handler failure.

**Payload:**
```json
{
  "event": "column:reorder",
  "error": "FORBIDDEN | VALIDATION_FAILED | UPDATE_FAILED",
  "message": "string"
}
```

**Error codes for `column:reorder`:**
- `FORBIDDEN` — `tableId` belongs to a different whiteboard (IDOR)
- `VALIDATION_FAILED` — Zod parse failure, unknown column IDs, or duplicate IDs
- `UPDATE_FAILED` — Prisma transaction failure

---

## Table Events

### `table:create` (Client → Server)
### `table:created` (Server → Client, broadcast)
### `table:move` (Client → Server)
### `table:moved` (Server → Client, broadcast)
### `table:update` (Client → Server)
### `table:updated` (Server → Client, broadcast)
### `table:delete` (Client → Server)
### `table:deleted` (Server → Client, broadcast)

*(Details omitted — see collaboration.ts handler implementations)*

---

## Relationship Events

### `relationship:create` (Client → Server)
### `relationship:created` (Server → Client, broadcast)
### `relationship:update` (Client → Server)
### `relationship:updated` (Server → Client, broadcast)
### `relationship:delete` (Client → Server)
### `relationship:deleted` (Server → Client, broadcast)

*(Details omitted — see collaboration.ts handler implementations)*

---

## Session Events

### `sync:state` (Server → Client)
Initial state broadcast on join.

### `sync:request` (Client → Server)
Client requests a full state resync (e.g., after reconnect).

### `collaborator:joined` / `collaborator:left`
Broadcast when users join or leave the whiteboard.

### `session_expired`
Sent when the user's session has expired — client should redirect to login.
