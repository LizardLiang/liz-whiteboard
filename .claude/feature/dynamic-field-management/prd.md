# PRD: Dynamic Field Management

**Feature**: dynamic-field-management
**Author**: Athena (PM Agent)
**Date**: 2026-03-29
**Revised**: 2026-03-30 (Revision Round 1 -- addressing Athena + Nemesis review findings)
**Status**: Draft (Revised)
**Priority**: P0 - Critical

---

## 1. Problem Statement

Users of the ER diagram whiteboard currently cannot modify table structures directly on the canvas. The TableNode component is read-only -- users can see columns but cannot add new ones, remove existing ones, or edit their properties (name, type, constraints). This forces users to leave the visual context of the diagram to make structural changes, breaking their flow and reducing the tool's usefulness as a live database design environment.

The backend CRUD for columns already exists (`src/data/column.ts`, `src/routes/api/columns.ts`). The Socket.IO server already handles column mutation events (`column:create`, `column:update`, `column:delete`) with validation, persistence, and broadcasting. The gap is entirely on the frontend: the TableNode component needs to become interactive.

---

## 2. Users

### Primary User: Database Designer
A developer or database architect using the ER diagram whiteboard to design and iterate on database schemas visually. They expect to click on a table, add a field, rename it, change its type, and see those changes reflected immediately -- both persisted to the database and broadcast to collaborators.

### Secondary User: Collaborating Viewer
A team member viewing the same whiteboard in real-time. They do not initiate field changes in this session but must see all changes made by the primary user appear in real-time without refreshing.

### Returning User Consideration
Users who designed a schema days or weeks ago and return to make changes may not remember the interaction patterns (double-click to edit, click badge to toggle). All interactive elements must have discoverable affordances (see REQ-03 discoverability requirements).

---

## 3. Goals and Success Metrics

| Goal | Metric | Baseline | Target | Owner |
|------|--------|----------|--------|-------|
| Users can manage fields without leaving the canvas | % of field mutations performed inline (vs. other means) | 0% (no inline capability exists) | 100% (inline is the only way) | Frontend |
| Field changes persist reliably | Data loss incidents (field changes not saved to DB) | N/A | 0 per 100 operations | Backend |
| Changes sync to collaborators in real-time | Latency from mutation to remote render (measured localhost-to-localhost on same machine) | N/A (no column sync on frontend) | < 500ms | WebSocket |
| Inline editing feels responsive | Time from user action to visual feedback (optimistic update) | N/A | < 100ms (optimistic) | Frontend |
| Delete safety prevents accidental data loss | Accidental FK-breaking deletions (no confirmation shown) | N/A | 0 | Frontend |

---

## 4. Requirements

### P0 - Must Have

#### REQ-01: Add Field Inline
**Description**: Users can add a new column to a table directly within the table node on the canvas.

**User Flow**:
1. User sees a "+" button at the bottom of the table node's column list.
2. User clicks the "+" button.
3. A new row appears at the bottom of the column list with two inline editable fields: column name and data type.
4. Name field is auto-focused for immediate typing.
5. The data type field is pre-populated with the default value `"string"`.
6. User enters a column name and optionally changes the data type.
7. On blur or Enter key, the column is created with these defaults: `dataType: "string"`, `isNullable: true`, `isPrimaryKey: false`, `isForeignKey: false`, `isUnique: false`.
8. The new column is persisted to the database.
9. The new column is broadcast to all collaborators via WebSocket.

**Acceptance Criteria**:
- AC-01a: Clicking "+" appends a new editable row to the column list.
- AC-01b: Name field receives focus automatically on creation.
- AC-01c: The data type field defaults to `"string"` and is pre-populated when the new row appears.
- AC-01d: Pressing Enter or blurring the name field with a valid name persists the column to PostgreSQL via the existing `createColumnFn` server function.
- AC-01e: If the user blurs or presses Escape with an empty name, the new row is discarded (no empty columns created).
- AC-01f: The new column appears on all connected collaborators' canvases within 500ms.
- AC-01g: The "+" button is only visible when the table node display mode is not `TABLE_NAME` (i.e., visible in `ALL_FIELDS` and `KEY_ONLY` modes).
- AC-01h: The `order` field of the new column is explicitly calculated as `max(existing orders) + 1` (not relying on the Zod default of 0).
- AC-01i: If the server rejects the column creation (e.g., validation failure), the new row is removed and an error toast is shown with an actionable message (see FM-01).

#### REQ-02: Delete Field with Safety Check
**Description**: Users can delete a column from a table, with a confirmation dialog when the column is involved in relationships.

**User Flow (column has relationships)**:
1. User hovers over a column row and sees a delete icon/button.
2. User clicks the delete button.
3. A confirmation dialog appears listing the affected relationships (e.g., "This column is referenced by: orders.customer_id (FK), invoices.customer_id (FK)").
4. User confirms deletion.
5. The column and its associated relationships are cascade-deleted from the database.
6. The deletion is broadcast to all collaborators.

**User Flow (column has no relationships)**:
1. User clicks the delete button on a column with no relationships.
2. The column is deleted immediately (no dialog).
3. The deletion is persisted and broadcast.

**Relationship Data Source**: The relationship information for the confirmation dialog comes from the React Flow edge data already loaded in the whiteboard state. Each edge contains `sourceColumnId`, `targetColumnId`, and the related table/column names. No additional server query is needed -- the frontend filters edges by the column being deleted.

**Acceptance Criteria**:
- AC-02a: Each column row displays a delete affordance on hover.
- AC-02b: Clicking delete on a column that is referenced by any React Flow edge (relationship) shows a confirmation dialog listing all affected relationships with their table and column names.
- AC-02c: The confirmation dialog uses a shadcn/ui AlertDialog component.
- AC-02d: Confirming deletion removes the column and cascade-deletes relationships via the existing `deleteColumnFn` server function.
- AC-02e: Clicking delete on a column with no relationships deletes immediately without a dialog.
- AC-02f: Deleted columns disappear from all collaborators' canvases in real-time.
- AC-02g: Foreign key columns (`isForeignKey: true`) show an additional warning about relationship breakage.

#### REQ-03: Edit Field Properties Inline
**Description**: Users can edit existing column properties (name, dataType, isPrimaryKey, isNullable, isUnique) directly within the table node.

**User Flow**:
1. User hovers over a column row -- the cursor changes to `text` over the name/type fields, indicating editability.
2. User double-clicks on a column's name or data type to enter edit mode.
3. The text becomes an inline editable input field with a subtle highlighted background to indicate edit state.
4. User modifies the value.
5. On blur or Enter, the change is saved to the database.
6. The change is broadcast to collaborators.

**Discoverability**:
- Column name and data type text show `cursor: text` on hover.
- Constraint badges (PK, N, U) show `cursor: pointer` on hover.
- A tooltip appears on hover over column name/type: "Double-click to edit".
- Edit mode is visually distinct: the input field has a highlighted background and a focused border.

**Edit Mode Behavior**:
- Only one column field can be in edit mode at a time within a table node.
- Entering edit mode on a second field commits the first field's changes (same as blur behavior).
- The currently-editing row has a subtle background highlight.

**Editable Properties**:
- **name**: Inline text input (double-click to edit).
- **dataType**: Inline dropdown (double-click to edit) restricted to the valid enum values.
- **isPrimaryKey**: Toggle via a clickable PK badge.
- **isNullable**: Toggle via a clickable constraint indicator.
- **isUnique**: Toggle via a clickable constraint indicator.

**Acceptance Criteria**:
- AC-03a: Double-clicking a column name converts it to an editable text input, pre-filled with the current value.
- AC-03b: Double-clicking a column data type converts it to a dropdown selector showing the valid data types.
- AC-03c: Pressing Enter or blurring saves the change via `updateColumnFn`.
- AC-03d: Pressing Escape reverts to the original value without saving.
- AC-03e: Clicking the PK badge toggles `isPrimaryKey` and persists immediately.
- AC-03f: Constraint toggles (nullable, unique) are accessible via a compact UI within the column row.
- AC-03g: All edits are broadcast to collaborators in real-time.
- AC-03h: Validation prevents empty column names. Duplicate column names within the same table produce an actionable error message: "Column name '[name]' already exists in this table" (not a generic server error).
- AC-03i: If a save fails (server error, validation error), the UI reverts to the pre-edit value and displays an error toast with a specific message.
- AC-03j: Hovering over name/type fields shows `cursor: text`; hovering over constraint badges shows `cursor: pointer`.
- AC-03k: A tooltip "Double-click to edit" appears on hover over name/type fields.
- AC-03l: Keyboard shortcut: pressing Enter or F2 when a column row is focused enters edit mode on the name field.

**Constraint Toggle Interactions**:
- Toggling `isPrimaryKey` to `true` automatically sets `isNullable` to `false` and `isUnique` to `true` (PKs are inherently not-null and unique).
- Toggling `isPrimaryKey` to `false` does NOT automatically revert `isNullable` or `isUnique` -- those remain as-is.
- All other constraint toggles are independent -- V1 allows any combination. The tool models design intent, not runtime database enforcement.

#### REQ-04: Real-Time Collaboration for Column Mutations
**Description**: All column add/edit/delete operations must be broadcast to collaborators via Socket.IO.

**Server-Side Status**: The Socket.IO server (`src/routes/api/collaboration.ts`) already implements handlers for `column:create`, `column:update`, and `column:delete` events. These handlers validate input via Zod schemas, persist to the database, and broadcast to other users in the same whiteboard namespace. No new server-side work is needed for column events.

**WebSocket Events (already implemented server-side)**:
- `column:create` (client -> server) / `column:created` (server -> clients) -- broadcast when a new column is added
- `column:update` (client -> server) / `column:updated` (server -> clients) -- broadcast when a column property is changed
- `column:delete` (client -> server) / `column:deleted` (server -> clients) -- broadcast when a column is removed

**Acceptance Criteria**:
- AC-04a: When User A adds a column, User B sees the new column appear on their canvas without refreshing.
- AC-04b: When User A edits a column name, User B sees the updated name on their canvas.
- AC-04c: When User A deletes a column, User B sees the column disappear and any affected edges are removed.
- AC-04d: Events include sufficient data for the receiving client to update its local state without re-fetching (column data + tableId + whiteboardId).
- AC-04e: Events are scoped to the whiteboard namespace (only collaborators on the same whiteboard receive them).

#### REQ-05: Database Persistence
**Description**: All field changes must persist to the PostgreSQL database via the existing Prisma data layer.

**Acceptance Criteria**:
- AC-05a: New columns are created using the existing `createColumn` function in `src/data/column.ts`.
- AC-05b: Column updates use the existing `updateColumn` function.
- AC-05c: Column deletions use the existing `deleteColumn` function, which cascade-deletes relationships. (Verified: the Prisma Relationship model has `onDelete: Cascade` on both `sourceColumn` and `targetColumn` foreign keys.)
- AC-05d: The `order` field is maintained correctly when adding new columns.

#### REQ-06: Connection Status and Degraded Mode
**Description**: Users must have visibility into their connection state and understand the impact of connectivity loss on their editing workflow.

**Connection States**:
- **Connected**: Green indicator (or no indicator -- normal state). All operations work normally.
- **Connecting/Reconnecting**: Amber indicator with "Reconnecting..." text. Editing is NOT blocked -- server functions use HTTP, not WebSocket, so they may still work. A subtle banner warns: "Reconnecting -- collaborators may not see your changes."
- **Disconnected**: Red indicator with "Disconnected" text. Editing continues to work IF the server is reachable (server functions use HTTP). If server functions also fail, the UI shows an error toast per FM-01/FM-02/FM-03 handling. A banner warns: "Disconnected -- changes may not sync to collaborators."

**Acceptance Criteria**:
- AC-06a: A connection status indicator is visible in the whiteboard UI (using the existing `connectionState` from `useCollaboration` hook, which already tracks `'disconnected' | 'connecting' | 'connected'`).
- AC-06b: When `connectionState` is not `'connected'`, a non-intrusive banner or indicator warns the user that collaborator sync may be interrupted.
- AC-06c: Editing is never fully blocked by WebSocket disconnection alone -- server functions use HTTP and may still work.
- AC-06d: When a server function fails (HTTP error), the UI shows an error toast and reverts the optimistic update (per FM-01/FM-02/FM-03).
- AC-06e: On reconnection, the `sync:request` event (already implemented) triggers a full state sync to reconcile any missed changes.

### P1 - Should Have

#### REQ-07: Optimistic UI Updates
**Description**: Field mutations should apply optimistically on the client before server confirmation, then reconcile on success/failure.

**Acceptance Criteria**:
- AC-07a: Adding a field shows the new row immediately (with a temporary ID) before the server responds.
- AC-07b: On server success, the temporary ID is replaced with the real database ID.
- AC-07c: On server failure, the optimistic update is rolled back and an error toast is shown.
- AC-07d: Editing a field shows the new value immediately; rolled back on failure.

#### REQ-08: Data Type Selection
**Description**: When editing the data type field, show a dropdown of the valid data types.

**Valid Data Types** (from `dataTypeSchema` in `src/data/schema.ts`):
`int`, `string`, `float`, `boolean`, `date`, `text`, `uuid`, `json`

**Display Labels** (optional, for user friendliness):
| Stored Value | Display Label |
|-------------|---------------|
| `int` | Integer |
| `string` | String |
| `float` | Float |
| `boolean` | Boolean |
| `date` | Date |
| `text` | Text |
| `uuid` | UUID |
| `json` | JSON |

**Acceptance Criteria**:
- AC-08a: The data type field renders as a dropdown selector (not free-text input).
- AC-08b: The dropdown contains exactly 8 options matching the Zod enum: `int`, `string`, `float`, `boolean`, `date`, `text`, `uuid`, `json`.
- AC-08c: The dropdown may display user-friendly labels (e.g., "Integer") but must submit the actual enum value (e.g., `"int"`) to the server.
- AC-08d: No custom/free-text data types are allowed -- the dropdown is the only input method. This ensures all values pass Zod validation.

### P2 - Nice to Have

#### REQ-09: Keyboard Navigation
**Description**: Support keyboard shortcuts for efficient field management.

**Acceptance Criteria**:
- AC-09a: Tab moves focus to the next field within the same column row.
- AC-09b: Enter on the last field of a new column auto-creates the column and opens a new empty row (rapid entry mode).

#### REQ-10: Accessibility for Interactive Elements
**Description**: Interactive constraint badges and editable fields must be accessible to keyboard and screen reader users.

**Acceptance Criteria**:
- AC-10a: Constraint badges (PK, Nullable, Unique) have `role="button"`, `aria-pressed` state, and descriptive `aria-label` (e.g., "Toggle primary key, currently enabled").
- AC-10b: The "+" button has `aria-label="Add new column"`.
- AC-10c: Delete buttons have `aria-label="Delete column [name]"`.

---

## 5. User Flows

### Flow 1: Add a New Column

```
[Table Node visible on canvas]
    |
    v
[User sees "+" button at bottom of column list]
    |
    v
[User clicks "+"]
    |
    v
[New row appears with name input (focused) + type dropdown (pre-set to "string")]
    |
    v
[User types column name, optionally changes type via dropdown]
    |
    +--- [Enter or blur with valid name] ---> [Column created with dataType (default "string"), persisted, broadcast]
    |
    +--- [Escape or blur with empty name] ---> [Row discarded, no side effects]
    |
    +--- [Server rejects (e.g., duplicate name)] ---> [Row removed, error toast: "Column name 'X' already exists"]
```

### Flow 2: Delete a Column (with relationships)

```
[User hovers over column row]
    |
    v
[Delete icon appears]
    |
    v
[User clicks delete]
    |
    v
[Frontend checks React Flow edges for this column's ID]
    |
    +--- [Edges found] ---> [Confirmation dialog listing relationship details from edge data]
    |                          |
    |                          +--- [Confirm] ---> [Column + relationships cascade-deleted, broadcast]
    |                          |
    |                          +--- [Cancel] ---> [No action]
    |
    +--- [No edges] ---> [Column deleted immediately, broadcast]
```

### Flow 3: Edit a Column Property

```
[User hovers over column name -- cursor changes to text, tooltip: "Double-click to edit"]
    |
    v
[User double-clicks column name (or presses Enter/F2 when focused)]
    |
    v
[Text converts to editable input with highlighted background, pre-filled with current value]
[Only this field is in edit mode -- any prior edit is committed]
    |
    v
[User modifies value]
    |
    +--- [Enter or blur] ---> [Validation passes?]
    |                            |
    |                            +--- [YES] ---> [Saved, broadcast, input reverts to text]
    |                            |
    |                            +--- [NO: empty name] ---> [Error toast, reverts to original value]
    |                            |
    |                            +--- [NO: duplicate name] ---> [Error toast: "Column 'X' already exists", reverts]
    |
    +--- [Escape] ---> [Reverts to original, no save]
```

### Flow 4: Toggle a Constraint (PK/Nullable/Unique)

```
[User hovers constraint badge -- cursor changes to pointer]
    |
    v
[User clicks PK badge]
    |
    v
[PK toggles ON: isPrimaryKey=true, isNullable=false, isUnique=true (auto-set)]
[PK toggles OFF: isPrimaryKey=false, isNullable and isUnique unchanged]
    |
    v
[Value toggles immediately (optimistic)]
    |
    v
[Server update fires in background]
    |
    +--- [Success] ---> [No visible change (already updated)]
    |
    +--- [Failure] ---> [Revert toggle, show error toast]
```

### Flow 5: Connectivity Loss During Editing

```
[WebSocket disconnects (connectionState changes)]
    |
    v
[Connection indicator turns amber/red; banner: "Reconnecting..." or "Disconnected"]
    |
    v
[User continues editing -- server functions use HTTP, not WebSocket]
    |
    +--- [Server function succeeds] ---> [Change persisted but not broadcast; banner remains]
    |
    +--- [Server function fails] ---> [Error toast: "Unable to save. Check your connection."; change reverted]
    |
    v
[WebSocket reconnects]
    |
    v
[sync:request fires automatically -- full state sync reconciles missed changes]
[Connection indicator returns to normal]
```

---

## 6. Scope

### In Scope
- Add new columns inline within table nodes (with default dataType `"string"`)
- Delete columns with relationship-aware confirmation (using React Flow edge data)
- Edit column name, dataType, isPrimaryKey, isNullable, isUnique inline
- Persist all changes to PostgreSQL via existing Prisma data layer
- Listen for and handle column WebSocket events on the frontend (server-side handlers already exist)
- Optimistic UI updates for responsiveness
- Data type dropdown restricted to valid Zod enum values
- Error handling with actionable toast notifications (including duplicate name detection)
- Respecting display mode (TABLE_NAME mode hides columns, so editing UI is hidden too)
- Connection status indicator and degraded-mode UX
- Discoverability affordances (cursor changes, tooltips, visual edit state)
- Constraint toggle interactions (PK auto-sets nullable/unique)
- Keyboard entry to edit mode (Enter/F2)
- ARIA labels for interactive constraint badges

### Out of Scope
- Drag-to-reorder columns (explicitly excluded per requirements)
- Adding/removing/editing tables (table-level CRUD is a separate feature)
- Adding/removing/editing relationships (relationship management is a separate feature)
- Undo/redo for field operations
- Bulk field operations (multi-select, bulk delete)
- Column description editing (the `description` field exists in the schema but is not part of this feature's inline editing scope)
- Field-level access control or permissions
- Schema validation rules beyond PK constraints (e.g., "a table must have at least one PK") -- the tool models design intent, not runtime database enforcement
- Touch/mobile device support (the whiteboard is a desktop-focused tool; double-click and hover interactions are not optimized for touch)
- Custom data types beyond the 8 defined enum values (adding new types requires a schema change, which is out of scope)

---

## 7. Failure Modes

### FM-01: Server Error on Column Creation
**Trigger**: Database constraint violation (e.g., duplicate column name within table) or server unavailability.
**User Impact**: New column row appears (optimistic) then disappears.
**Handling**: Revert optimistic update, show error toast with actionable message. For duplicate names: "Column name '[name]' already exists in this table." For server errors: "Unable to create column. Check your connection and try again."

### FM-02: Server Error on Column Deletion
**Trigger**: Column was already deleted by another user, or server unavailability.
**User Impact**: Column remains visible after user expected it to be deleted.
**Handling**: Show error toast. If column no longer exists on server (404), remove it from local state anyway (idempotent delete).

### FM-03: Server Error on Column Update
**Trigger**: Validation failure, race condition with another user's edit, or server unavailability.
**User Impact**: Field reverts to pre-edit value.
**Handling**: Revert to last known good value, show error toast. For duplicate names: "Column name '[name]' already exists in this table." For other errors: "Unable to save changes. Check your connection and try again."

### FM-04: WebSocket Disconnection During Edit
**Trigger**: Network interruption while user is editing a field.
**User Impact**: Local changes may persist to DB (via HTTP server function) but collaborators do not see updates until reconnection.
**Handling**:
1. Connection status indicator changes to amber/red.
2. A non-intrusive banner warns: "Reconnecting -- collaborators may not see your changes."
3. Editing is NOT blocked -- server functions use HTTP and may still succeed.
4. If server functions also fail, FM-01/FM-02/FM-03 handling applies.
5. When WebSocket reconnects, `sync:request` fires automatically and collaborators receive the full current state.

### FM-05: Concurrent Edits to Same Column
**Trigger**: Two users edit the same column property simultaneously.
**User Impact**: Last-write-wins -- the second save overwrites the first.
**Handling**: This is acceptable for V1. The WebSocket broadcast ensures both users see the final state. No conflict resolution UI is needed.

### FM-06: Deletion of Column Being Edited by Another User
**Trigger**: User A is editing column X; User B deletes column X.
**User Impact**: User A's edit form should close, and the column should disappear.
**Handling**: When a `column:deleted` WebSocket event arrives for a column currently in edit mode, exit edit mode and remove the column from the UI. No error toast -- the column simply disappears (the delete was intentional by another user).

---

## 8. Assumptions

| # | Assumption | Risk if Wrong |
|---|-----------|---------------|
| A1 | The existing `createColumnFn`, `updateColumnFn`, and `deleteColumnFn` server functions work correctly and do not need modification. | Medium -- if they have bugs, we need to fix them first, adding scope. |
| A2 | The existing Prisma Column model has all fields needed. No new database migrations are required. (Verified: Column model has id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, description, order. The `dataType` field is `VARCHAR(50)` in Postgres, validated by a Zod enum on the server side.) | Low -- verified by reading `prisma/schema.prisma`. |
| A3 | The Socket.IO server already handles column events (`column:create`, `column:update`, `column:delete`) with validation, persistence, and broadcasting. (Verified: `src/routes/api/collaboration.ts` lines 358-458.) The frontend only needs to wire up listeners and emitters -- no server-side changes are needed. | Low -- verified by reading the server code. |
| A4 | Last-write-wins is acceptable for concurrent edits in V1. | Low -- standard approach for collaborative tools at this maturity level. |
| A5 | The `useCollaboration` hook pattern (which exposes generic `emit`, `on`, `off` functions) can be extended to support column events without architectural changes. | Low -- the hook already demonstrates the pattern with table events. |
| A6 | React Flow node re-rendering on data changes is performant enough to handle inline editing without jank. | Medium -- if TableNode re-renders are expensive, memoization strategy may need adjustment. Testing should verify at 30+ columns. |
| A7 | Relationship data for the delete confirmation dialog is available from React Flow edges already loaded in memory. No additional server query is needed. | Low -- the whiteboard route loads all relationships with the diagram, and edges contain column IDs. |

---

## 9. Dependencies

| Dependency | Type | Status | Risk |
|-----------|------|--------|------|
| Column CRUD server functions (`src/routes/api/columns.ts`) | Backend | Exists | Low |
| Column data layer (`src/data/column.ts`) | Backend | Exists | Low |
| Prisma Column model | Database | Exists | Low |
| Socket.IO server column event handlers (`src/routes/api/collaboration.ts`) | Infrastructure | Exists (verified: `column:create`, `column:update`, `column:delete` handlers with validation and broadcasting) | Low |
| shadcn/ui components (AlertDialog, Input, Button, Tooltip, Select) | UI | Available via shadcn | Low |
| React Flow custom node rendering | Frontend | Exists (TableNode.new.tsx) | Low |
| TanStack Query for cache invalidation | Frontend | Available | Low |
| `useCollaboration` hook (`connectionState`, `emit`, `on`, `off`) | Frontend | Exists | Low |

---

## 10. Open Questions

| # | Question | Impact | Proposed Default |
|---|----------|--------|-----------------|
| OQ-1 | Should the "+" button be visible at all times or only on table hover? | UX polish | Visible at all times (when display mode shows columns) -- reduces discovery friction. |
| OQ-2 | Should editing a column name that is referenced as a FK auto-update the FK reference? | Data integrity | No -- FK references are by column ID (`sourceColumnId`/`targetColumnId` are UUIDs), not name. Renaming a column does not break relationships. Verified in Prisma schema. |
| OQ-3 | What is the maximum number of columns per table? | Performance | No hard limit in V1. The Prisma schema has no constraint. Performance should be tested at 30+ columns during implementation to identify any rendering bottlenecks. |

---

## Appendix A: Existing Backend API Reference

The following server functions already exist and should be reused:

| Function | File | Method | Purpose |
|----------|------|--------|---------|
| `createColumnFn` | `src/routes/api/columns.ts` | POST | Create a single column |
| `updateColumnFn` | `src/routes/api/columns.ts` | PUT | Update column properties |
| `deleteColumnFn` | `src/routes/api/columns.ts` | DELETE | Delete a column (cascade-deletes relationships) |
| `getColumnsByTableId` | `src/routes/api/columns.ts` | GET | Fetch all columns for a table |

**Zod Schemas** (from `src/data/schema.ts`):
- `createColumnSchema`: `{ tableId: uuid, name: string(1-255), dataType: enum('int' | 'string' | 'float' | 'boolean' | 'date' | 'text' | 'uuid' | 'json'), isPrimaryKey?: bool(default: false), isForeignKey?: bool(default: false), isUnique?: bool(default: false), isNullable?: bool(default: true), description?: string, order?: int(default: 0) }`
- `updateColumnSchema`: Same fields as create (minus `tableId`), all optional (partial).

**Cascade Delete Behavior** (from `prisma/schema.prisma`):
- `Relationship.sourceColumn` has `onDelete: Cascade` -- deleting a column that is a relationship source cascade-deletes the relationship.
- `Relationship.targetColumn` has `onDelete: Cascade` -- deleting a column that is a relationship target cascade-deletes the relationship.
- This means REQ-02's delete flow correctly removes orphaned relationships automatically at the database level.

## Appendix B: Existing WebSocket Events

The Socket.IO server (`src/routes/api/collaboration.ts`) already supports table AND column mutation events:

**Table Events (existing)**:
| Event | Direction | Purpose |
|-------|-----------|---------|
| `table:create` | Client -> Server | Create a table |
| `table:created` | Server -> Clients | Broadcast table creation |
| `table:move` | Client -> Server | User moves a table |
| `table:moved` | Server -> Clients | Broadcast table position update |
| `table:update` | Client -> Server | Update table properties |
| `table:updated` | Server -> Clients | Broadcast table property update |
| `table:delete` | Client -> Server | Delete a table |
| `table:deleted` | Server -> Clients | Broadcast table deletion |

**Column Events (existing -- server-side handlers already implemented)**:
| Event | Direction | Purpose | Payload |
|-------|-----------|---------|---------|
| `column:create` | Client -> Server | Create a column | `createColumnSchema` fields |
| `column:created` | Server -> Clients | Broadcast column creation | Full column object + `createdBy` |
| `column:update` | Client -> Server | Update column properties | `{ columnId, ...updateColumnSchema fields }` |
| `column:updated` | Server -> Clients | Broadcast column update | `{ columnId, tableId, ...updated fields, updatedBy }` |
| `column:delete` | Client -> Server | Delete a column | `{ columnId }` |
| `column:deleted` | Server -> Clients | Broadcast column deletion | `{ columnId, tableId, deletedBy }` |

**Other Events (existing)**:
| Event | Direction | Purpose |
|-------|-----------|---------|
| `sync:request` | Client -> Server | Request full state sync (used on reconnection) |
| `sync:data` | Server -> Client | Full whiteboard state response |
| `cursor:update` / `cursor:moved` | Bidirectional | Cursor position tracking |
| `user:connected` / `user:disconnected` | Server -> Clients | Presence notifications |

## Appendix C: Revision Changelog

| Date | Issue ID | Change Summary |
|------|----------|----------------|
| 2026-03-30 | DA-B1 | Fixed REQ-08 (was REQ-07) data type list to match actual Zod enum values. Removed custom type claim. Added display label mapping table. Changed data type input from free-text to restricted dropdown. |
| 2026-03-30 | DA-B2 | Verified Socket.IO server already has column event handlers. Updated REQ-04, Assumption A3, Dependencies table, and Appendix B with verified server-side implementation details. |
| 2026-03-30 | UA-B1 | Added REQ-06 (Connection Status and Degraded Mode). Expanded FM-04 with user-visible indicators and degraded editing behavior. Added Flow 5 for connectivity loss. |
| 2026-03-30 | UA-B2 | Specified default dataType as `"string"` in REQ-01. Added AC-01c and AC-01i. Updated Flow 1 with default and error handling. |
| 2026-03-30 | DA-M2 | Specified relationship data source (React Flow edges) in REQ-02. Added Assumption A7. Updated Flow 2 to reference edge data. |
| 2026-03-30 | DA-M3 | Moved "no new migrations" from AC-05d to Assumption A2 with qualification. |
| 2026-03-30 | DA-M4 | Verified cascade-delete behavior on Relationship model. Documented in AC-05c and Appendix A. |
| 2026-03-30 | DA-M5 | Specified default dataType `"string"` in REQ-01 step 7 and AC-01c. |
| 2026-03-30 | UA-M1 | Added discoverability mechanisms: cursor changes, tooltips, visual edit state. New ACs: AC-03j, AC-03k. |
| 2026-03-30 | UA-M3 | Specified actionable duplicate name error messages in AC-03h and FM-01/FM-03. |
| 2026-03-30 | UA-M4 | Added constraint toggle interaction rules (PK auto-sets nullable/unique) in REQ-03. |
| 2026-03-30 | UA-M5 | Defined edit mode visual treatment and single-edit-at-a-time behavior in REQ-03. |
| 2026-03-30 | UA-m1 | Added keyboard shortcut (Enter/F2) for entering edit mode as AC-03l. |
| 2026-03-30 | UA-m2 | Added REQ-10 for ARIA labels on interactive elements. |
| 2026-03-30 | Appendix A | Listed actual Zod enum values for dataType field. Documented cascade-delete behavior. |
| 2026-03-30 | Section 2 | Added "Returning User Consideration" persona note. |
| 2026-03-30 | Scope | Added touch/mobile and custom data types to Out of Scope. |
