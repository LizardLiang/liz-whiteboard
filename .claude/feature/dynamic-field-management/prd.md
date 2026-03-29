# PRD: Dynamic Field Management

**Feature**: dynamic-field-management
**Author**: Athena (PM Agent)
**Date**: 2026-03-29
**Status**: Draft
**Priority**: P0 - Critical

---

## 1. Problem Statement

Users of the ER diagram whiteboard currently cannot modify table structures directly on the canvas. The TableNode component is read-only -- users can see columns but cannot add new ones, remove existing ones, or edit their properties (name, type, constraints). This forces users to leave the visual context of the diagram to make structural changes, breaking their flow and reducing the tool's usefulness as a live database design environment.

The backend CRUD for columns already exists (`src/data/column.ts`, `src/routes/api/columns.ts`). The gap is entirely on the frontend: the TableNode component needs to become interactive.

---

## 2. Users

### Primary User: Database Designer
A developer or database architect using the ER diagram whiteboard to design and iterate on database schemas visually. They expect to click on a table, add a field, rename it, change its type, and see those changes reflected immediately -- both persisted to the database and broadcast to collaborators.

### Secondary User: Collaborating Viewer
A team member viewing the same whiteboard in real-time. They do not initiate field changes in this session but must see all changes made by the primary user appear in real-time without refreshing.

---

## 3. Goals and Success Metrics

| Goal | Metric | Baseline | Target | Owner |
|------|--------|----------|--------|-------|
| Users can manage fields without leaving the canvas | % of field mutations performed inline (vs. other means) | 0% (no inline capability exists) | 100% (inline is the only way) | Frontend |
| Field changes persist reliably | Data loss incidents (field changes not saved to DB) | N/A | 0 per 100 operations | Backend |
| Changes sync to collaborators in real-time | Latency from mutation to remote render | N/A (no column sync events exist) | < 500ms on same network | WebSocket |
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
5. User enters a column name and selects/types a data type.
6. On blur or Enter key, the column is created with sensible defaults (isNullable: true, isPrimaryKey: false, isForeignKey: false, isUnique: false).
7. The new column is persisted to the database.
8. The new column is broadcast to all collaborators via WebSocket.

**Acceptance Criteria**:
- AC-01a: Clicking "+" appends a new editable row to the column list.
- AC-01b: Name field receives focus automatically on creation.
- AC-01c: Pressing Enter or blurring the name field with a valid name persists the column to PostgreSQL via the existing `createColumnFn` server function.
- AC-01d: If the user blurs or presses Escape with an empty name, the new row is discarded (no empty columns created).
- AC-01e: The new column appears on all connected collaborators' canvases within 500ms.
- AC-01f: The "+" button is only visible when the table node display mode is not `TABLE_NAME` (i.e., visible in `ALL_FIELDS` and `KEY_ONLY` modes).
- AC-01g: The `order` field of the new column is set to `max(existing orders) + 1` to append at the end.

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

**Acceptance Criteria**:
- AC-02a: Each column row displays a delete affordance on hover.
- AC-02b: Clicking delete on a column with `sourceRelationships` or `targetRelationships` shows a confirmation dialog listing all affected relationships.
- AC-02c: The confirmation dialog uses a shadcn/ui AlertDialog component.
- AC-02d: Confirming deletion removes the column and cascade-deletes relationships via the existing `deleteColumnFn` server function.
- AC-02e: Clicking delete on a column with no relationships deletes immediately without a dialog.
- AC-02f: Deleted columns disappear from all collaborators' canvases in real-time.
- AC-02g: Foreign key columns (`isForeignKey: true`) show an additional warning about relationship breakage.

#### REQ-03: Edit Field Properties Inline
**Description**: Users can edit existing column properties (name, dataType, isPrimaryKey, isNullable, isUnique) directly within the table node.

**User Flow**:
1. User double-clicks or clicks on a column's name or data type to enter edit mode.
2. The text becomes an inline editable input field.
3. User modifies the value.
4. On blur or Enter, the change is saved to the database.
5. The change is broadcast to collaborators.

**Editable Properties**:
- **name**: Inline text input (double-click to edit).
- **dataType**: Inline text input or dropdown with common types (double-click to edit).
- **isPrimaryKey**: Toggle via a clickable PK badge.
- **isNullable**: Toggle via a clickable constraint indicator.
- **isUnique**: Toggle via a clickable constraint indicator.

**Acceptance Criteria**:
- AC-03a: Double-clicking a column name converts it to an editable text input, pre-filled with the current value.
- AC-03b: Double-clicking a column data type converts it to an editable input, pre-filled with the current value.
- AC-03c: Pressing Enter or blurring saves the change via `updateColumnFn`.
- AC-03d: Pressing Escape reverts to the original value without saving.
- AC-03e: Clicking the PK badge toggles `isPrimaryKey` and persists immediately.
- AC-03f: Constraint toggles (nullable, unique) are accessible via a compact UI within the column row.
- AC-03g: All edits are broadcast to collaborators in real-time.
- AC-03h: Validation prevents empty column names and duplicate column names within the same table.
- AC-03i: If a save fails (server error, validation error), the UI reverts to the pre-edit value and displays an error toast.

#### REQ-04: Real-Time Collaboration for Column Mutations
**Description**: All column add/edit/delete operations must be broadcast to collaborators via Socket.IO.

**New WebSocket Events Required**:
- `column:created` -- broadcast when a new column is added
- `column:updated` -- broadcast when a column property is changed
- `column:deleted` -- broadcast when a column is removed

**Acceptance Criteria**:
- AC-04a: When User A adds a column, User B sees the new column appear on their canvas without refreshing.
- AC-04b: When User A edits a column name, User B sees the updated name on their canvas.
- AC-04c: When User A deletes a column, User B sees the column disappear and any affected edges are removed.
- AC-04d: Events include sufficient data for the receiving client to update its local state without re-fetching (column data + tableId + whiteboardId).
- AC-04e: Events are scoped to the whiteboard room (only collaborators on the same whiteboard receive them).

#### REQ-05: Database Persistence
**Description**: All field changes must persist to the PostgreSQL database via the existing Prisma data layer.

**Acceptance Criteria**:
- AC-05a: New columns are created using the existing `createColumn` function in `src/data/column.ts`.
- AC-05b: Column updates use the existing `updateColumn` function.
- AC-05c: Column deletions use the existing `deleteColumn` function (which cascade-deletes relationships per Prisma schema).
- AC-05d: No new database migrations are required (the Column model already has all necessary fields).
- AC-05e: The `order` field is maintained correctly when adding new columns.

### P1 - Should Have

#### REQ-06: Optimistic UI Updates
**Description**: Field mutations should apply optimistically on the client before server confirmation, then reconcile on success/failure.

**Acceptance Criteria**:
- AC-06a: Adding a field shows the new row immediately (with a temporary ID) before the server responds.
- AC-06b: On server success, the temporary ID is replaced with the real database ID.
- AC-06c: On server failure, the optimistic update is rolled back and an error toast is shown.
- AC-06d: Editing a field shows the new value immediately; rolled back on failure.

#### REQ-07: Data Type Suggestions
**Description**: When editing the data type field, show a dropdown of common SQL data types to aid selection.

**Acceptance Criteria**:
- AC-07a: Common types are suggested: VARCHAR, INTEGER, TEXT, BOOLEAN, TIMESTAMP, UUID, FLOAT, SERIAL, JSON, DATE.
- AC-07b: The user can also type a custom data type not in the list.
- AC-07c: The dropdown appears on focus/click of the data type field.

### P2 - Nice to Have

#### REQ-08: Keyboard Navigation
**Description**: Support keyboard shortcuts for efficient field management.

**Acceptance Criteria**:
- AC-08a: Tab moves focus to the next field within the same column row.
- AC-08b: Enter on the last field of a new column auto-creates the column and opens a new empty row (rapid entry mode).

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
[New row appears with name input (focused) + type input]
    |
    v
[User types column name, tabs to type, enters data type]
    |
    +--- [Enter or blur with valid name] ---> [Column created, persisted, broadcast]
    |
    +--- [Escape or blur with empty name] ---> [Row discarded, no side effects]
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
[System checks: does this column have relationships?]
    |
    +--- [YES] ---> [Confirmation dialog with relationship list]
    |                   |
    |                   +--- [Confirm] ---> [Column + relationships deleted, broadcast]
    |                   |
    |                   +--- [Cancel] ---> [No action]
    |
    +--- [NO] ---> [Column deleted immediately, broadcast]
```

### Flow 3: Edit a Column Property

```
[User double-clicks column name or data type]
    |
    v
[Text converts to editable input, pre-filled with current value]
    |
    v
[User modifies value]
    |
    +--- [Enter or blur] ---> [Validation passes?]
    |                            |
    |                            +--- [YES] ---> [Saved, broadcast, input reverts to text]
    |                            |
    |                            +--- [NO] ---> [Error toast, reverts to original value]
    |
    +--- [Escape] ---> [Reverts to original, no save]
```

### Flow 4: Toggle a Constraint (PK/Nullable/Unique)

```
[User clicks PK badge or constraint indicator]
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

---

## 6. Scope

### In Scope
- Add new columns inline within table nodes
- Delete columns with relationship-aware confirmation
- Edit column name, dataType, isPrimaryKey, isNullable, isUnique inline
- Persist all changes to PostgreSQL via existing Prisma data layer
- Broadcast all changes via Socket.IO to collaborators
- Optimistic UI updates for responsiveness
- Data type suggestion dropdown
- Error handling with toast notifications
- Respecting display mode (TABLE_NAME mode hides columns, so editing UI is hidden too)

### Out of Scope
- Drag-to-reorder columns (explicitly excluded per requirements)
- Adding/removing/editing tables (table-level CRUD is a separate feature)
- Adding/removing/editing relationships (relationship management is a separate feature)
- Undo/redo for field operations
- Bulk field operations (multi-select, bulk delete)
- Column description editing (the `description` field exists in the schema but is not part of this feature's inline editing scope)
- Field-level access control or permissions
- Schema validation rules (e.g., "a table must have at least one PK") -- the tool allows any valid column configuration

---

## 7. Failure Modes

### FM-01: Server Error on Column Creation
**Trigger**: Database constraint violation (e.g., duplicate column name within table) or server unavailability.
**User Impact**: New column row appears (optimistic) then disappears.
**Handling**: Revert optimistic update, show error toast with actionable message (e.g., "Column name 'email' already exists in this table").

### FM-02: Server Error on Column Deletion
**Trigger**: Column was already deleted by another user, or server unavailability.
**User Impact**: Column remains visible after user expected it to be deleted.
**Handling**: Show error toast. If column no longer exists on server, remove it from local state anyway.

### FM-03: Server Error on Column Update
**Trigger**: Validation failure, race condition with another user's edit, or server unavailability.
**User Impact**: Field reverts to pre-edit value.
**Handling**: Revert to last known good value, show error toast.

### FM-04: WebSocket Disconnection During Edit
**Trigger**: Network interruption while user is editing a field.
**User Impact**: Local changes persist to DB (via HTTP server function) but collaborators do not see updates.
**Handling**: When WebSocket reconnects, collaborators should re-fetch the latest whiteboard state to reconcile. The editing user's changes are not lost (they persist via server functions, not WebSocket).

### FM-05: Concurrent Edits to Same Column
**Trigger**: Two users edit the same column property simultaneously.
**User Impact**: Last-write-wins -- the second save overwrites the first.
**Handling**: This is acceptable for V1. The WebSocket broadcast ensures both users see the final state. No conflict resolution UI is needed.

### FM-06: Deletion of Column Being Edited by Another User
**Trigger**: User A is editing column X; User B deletes column X.
**User Impact**: User A's edit form should close, and the column should disappear.
**Handling**: When a `column:deleted` WebSocket event arrives for a column currently in edit mode, exit edit mode and remove the column from the UI.

---

## 8. Assumptions

| # | Assumption | Risk if Wrong |
|---|-----------|---------------|
| A1 | The existing `createColumnFn`, `updateColumnFn`, and `deleteColumnFn` server functions work correctly and do not need modification. | Medium -- if they have bugs, we need to fix them first, adding scope. |
| A2 | The existing Prisma Column model has all fields needed (no migration required). | Low -- verified by reading `prisma/schema.prisma`. |
| A3 | Socket.IO server infrastructure already exists and supports custom event emission from the client. | Medium -- if the server does not relay custom events, server-side Socket.IO handler changes are needed. |
| A4 | Last-write-wins is acceptable for concurrent edits in V1. | Low -- standard approach for collaborative tools at this maturity level. |
| A5 | The `use-whiteboard-collaboration.ts` hook pattern can be extended to support column events without architectural changes. | Low -- the hook already demonstrates the pattern with `table:moved`. |
| A6 | React Flow node re-rendering on data changes is performant enough to handle inline editing without jank. | Medium -- if TableNode re-renders are expensive, memoization strategy may need adjustment. |

---

## 9. Dependencies

| Dependency | Type | Status | Risk |
|-----------|------|--------|------|
| Column CRUD server functions (`src/routes/api/columns.ts`) | Backend | Exists | Low |
| Column data layer (`src/data/column.ts`) | Backend | Exists | Low |
| Prisma Column model | Database | Exists | Low |
| Socket.IO server (relay of column events) | Infrastructure | Partially exists (only relays `table:moved`) | Medium -- needs new event handlers |
| shadcn/ui components (AlertDialog, Input, Button, Tooltip) | UI | Available via shadcn | Low |
| React Flow custom node rendering | Frontend | Exists (TableNode.new.tsx) | Low |
| TanStack Query for cache invalidation | Frontend | Available | Low |

---

## 10. Open Questions

| # | Question | Impact | Proposed Default |
|---|----------|--------|-----------------|
| OQ-1 | Should the "+" button be visible at all times or only on table hover? | UX polish | Visible at all times (when display mode shows columns) -- reduces discovery friction. |
| OQ-2 | Should editing a column name that is referenced as a FK auto-update the FK reference? | Data integrity | No -- FK references are by column ID, not name. Renaming a column does not break relationships. |
| OQ-3 | What is the maximum number of columns per table? | Performance | No hard limit in V1. The Prisma schema has no constraint, and tables with 50+ columns are rare in ER diagrams. |

---

## Appendix A: Existing Backend API Reference

The following server functions already exist and should be reused:

| Function | File | Method | Purpose |
|----------|------|--------|---------|
| `createColumnFn` | `src/routes/api/columns.ts` | POST | Create a single column |
| `updateColumnFn` | `src/routes/api/columns.ts` | PUT | Update column properties |
| `deleteColumnFn` | `src/routes/api/columns.ts` | DELETE | Delete a column (cascade) |
| `getColumnsByTableId` | `src/routes/api/columns.ts` | GET | Fetch all columns for a table |

**Zod Schemas** (from `src/data/schema.ts`):
- `createColumnSchema`: `{ tableId: uuid, name: string(1-255), dataType: enum, isPrimaryKey?: bool, isForeignKey?: bool, isUnique?: bool, isNullable?: bool, description?: string, order?: int }`
- `updateColumnSchema`: Same as create but all fields optional, no `tableId`.

## Appendix B: Existing WebSocket Events

Currently, the collaboration system supports only table position events:

| Event | Direction | Purpose |
|-------|-----------|---------|
| `table:move` | Client -> Server | User moves a table |
| `table:moved` | Server -> Clients | Broadcast table position update |

This feature requires new column mutation events (see REQ-04).
