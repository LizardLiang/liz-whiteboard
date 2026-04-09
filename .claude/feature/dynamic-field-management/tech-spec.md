# Technical Specification: Dynamic Field Management

**Feature**: dynamic-field-management
**Author**: Hephaestus (Tech Spec Agent)
**Date**: 2026-03-30
**Based On**: prd.md (Revised 2026-03-30, Revision Round 1)
**Status**: Revised Draft (R1 -- addresses SA-C1, SA-M1, SA-M2)

---

## 1. Overview

This spec defines the frontend implementation for inline column (field) management within React Flow TableNode components. The backend CRUD (server functions, Prisma data layer, Socket.IO handlers) already exists and requires no modification. The work is entirely frontend: making TableNode interactive with add, edit, delete, and real-time sync capabilities.

### Scope Summary

| Area                                                 | Work Required                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Prisma schema                                        | None -- Column model is complete                                                                          |
| Server functions (`src/routes/api/columns.ts`)       | None -- exist but NOT used by this feature (WebSocket-only persistence, see Section 2.2)                  |
| Socket.IO server (`src/routes/api/collaboration.ts`) | None -- column:create/update/delete handlers exist (lines 358-458) and serve as the sole persistence path |
| Data layer (`src/data/column.ts`)                    | None -- all CRUD functions exist                                                                          |
| Frontend: TableNode component                        | Major rewrite -- add interactivity                                                                        |
| Frontend: Collaboration hooks                        | New hook for column events                                                                                |
| Frontend: UI components                              | New components for inline editing, delete confirmation                                                    |
| Frontend: Connection status                          | New indicator component                                                                                   |
| shadcn/ui components                                 | Install: alert-dialog, tooltip, dropdown-menu                                                             |

---

## 2. Architecture

### 2.1 Component Architecture

```
ReactFlowWhiteboard (state owner)
  |
  +-- useColumnCollaboration (new hook -- column WebSocket events)
  |
  +-- ReactFlowCanvas
       |
       +-- TableNode.new.tsx (major enhancement)
            |
            +-- ColumnRow (new component -- single column display/edit)
            |    |
            |    +-- InlineNameEditor (new -- double-click to edit name)
            |    +-- DataTypeSelector (new -- double-click to edit type)
            |    +-- ConstraintBadges (new -- clickable PK/N/U toggles)
            |    +-- DeleteColumnButton (new -- hover-visible delete)
            |
            +-- AddColumnRow (new -- "+" button + inline creation form)
            |
            +-- DeleteColumnDialog (new -- AlertDialog for FK columns)
       |
       +-- ConnectionStatusIndicator (new -- WebSocket status display)
```

### 2.2 Data Flow

**Column mutations use WebSocket-only persistence (matching existing table mutation pattern):**

1. **Optimistic update**: User action immediately updates local React Flow node data
2. **WebSocket emit**: Client emits `column:create` / `column:update` / `column:delete` via Socket.IO
3. **Server persistence + broadcast**: The Socket.IO server handler validates input (Zod), persists to the database, and broadcasts the result to other clients (see `src/routes/api/collaboration.ts` lines 358-458)
4. **Server error handling**: On server error, the Socket.IO handler emits an `error` event back to the originating client, which triggers optimistic rollback + error toast

**Incoming WebSocket events (from other users):**

1. `column:created` -> Add column to the relevant TableNode's data.table.columns array
2. `column:updated` -> Update the column in the relevant TableNode's data
3. `column:deleted` -> Remove column from TableNode data + remove affected edges

**Decision: WebSocket-only persistence (no HTTP server functions for column mutations)**

- Why: The Socket.IO server handlers for `column:create`, `column:update`, and `column:delete` already validate, persist, and broadcast. Using HTTP server functions (createColumnFn/updateColumnFn/deleteColumnFn) in addition would cause **double database writes** -- the HTTP call persists once, and the subsequent WebSocket emit triggers the server handler to persist again. For deletes, the second attempt would fail with "Column not found." This WebSocket-only approach matches the existing pattern used by `table:create`, `table:move`, `table:update`, and `table:delete` in the same collaboration.ts file.
- Trade-off: Column mutations require an active WebSocket connection. Edits cannot be performed when the WebSocket is disconnected. This is acceptable because (1) the same limitation already applies to all table mutations, (2) the ConnectionStatusIndicator (Section 4.8) will clearly communicate connection state to the user, and (3) mutation attempts while disconnected will show an error toast ("Not connected. Please wait for reconnection.").
- What was given up: Offline edit capability. If offline support is needed in the future, a client-side queue could buffer mutations and replay them on reconnection.

### 2.3 State Management

**Node data is the source of truth for column state on the canvas.**

Columns live inside `node.data.table.columns` in the React Flow node state. The `setNodes` function in `ReactFlowWhiteboard` is the mechanism for updating column data.

**New state needed in ReactFlowWhiteboard:**

- None at the whiteboard level -- all column editing state is local to the TableNode component (which column is being edited, whether add-row is visible, etc.)

**New state local to TableNode:**

| State               | Type                                                        | Purpose                               |
| ------------------- | ----------------------------------------------------------- | ------------------------------------- |
| `editingField`      | `{ columnId: string, field: 'name' \| 'dataType' } \| null` | Which field is currently in edit mode |
| `addingColumn`      | `boolean`                                                   | Whether the add-column row is visible |
| `newColumnName`     | `string`                                                    | Name input for new column being added |
| `newColumnDataType` | `DataType`                                                  | Data type selection for new column    |
| `pendingColumnId`   | `string \| null`                                            | Temporary ID for optimistic add       |

**Decision: Local state in TableNode, not lifted to Whiteboard**

- Why: Edit state is purely UI-local. Only one table can be edited at a time (React Flow selection). Lifting state would add complexity with no benefit.
- Trade-off: If we later need cross-table coordination (e.g., preventing simultaneous edits), we'd need to lift. Acceptable for V1.

---

## 3. File Changes

### 3.1 Files to Create

| File                                                      | Purpose                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/components/whiteboard/column/ColumnRow.tsx`          | Single column row with inline editing, constraint badges, delete button |
| `src/components/whiteboard/column/InlineNameEditor.tsx`   | Inline text input for column name editing                               |
| `src/components/whiteboard/column/DataTypeSelector.tsx`   | Dropdown selector for data type (uses shadcn Select)                    |
| `src/components/whiteboard/column/ConstraintBadges.tsx`   | Clickable PK/N/U badge toggles                                          |
| `src/components/whiteboard/column/AddColumnRow.tsx`       | "+" button and inline creation form                                     |
| `src/components/whiteboard/column/DeleteColumnDialog.tsx` | AlertDialog for confirming deletion of FK-related columns               |
| `src/components/whiteboard/column/types.ts`               | Shared types for column editing components                              |
| `src/hooks/use-column-collaboration.ts`                   | Hook for column WebSocket event listeners + emitters                    |
| `src/hooks/use-column-mutations.ts`                       | Hook encapsulating column CRUD with optimistic updates                  |
| `src/components/whiteboard/ConnectionStatusIndicator.tsx` | WebSocket connection status display                                     |

### 3.2 Files to Modify

| File                                                | Changes                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/components/whiteboard/TableNode.new.tsx`       | Major rewrite: replace static column rendering with ColumnRow components, add AddColumnRow, integrate editing state |
| `src/components/whiteboard/ReactFlowWhiteboard.tsx` | Add useColumnCollaboration hook, pass column mutation callbacks to nodes, add ConnectionStatusIndicator             |
| `src/components/whiteboard/ReactFlowCanvas.tsx`     | Pass new node data props through (if needed for column callbacks)                                                   |
| `src/lib/react-flow/types.ts`                       | Extend TableNodeData with column mutation callbacks                                                                 |

### 3.3 Files Unchanged

| File                              | Reason                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `prisma/schema.prisma`            | Column model already has all needed fields                                           |
| `src/data/column.ts`              | CRUD functions are complete                                                          |
| `src/data/schema.ts`              | Zod schemas are complete (dataTypeSchema has all 8 values)                           |
| `src/routes/api/columns.ts`       | Server functions exist but are not used by this feature (WebSocket-only persistence) |
| `src/routes/api/collaboration.ts` | Column WebSocket handlers are complete                                               |

---

## 4. Component Specifications

### 4.1 TableNode.new.tsx (Enhanced)

The existing TableNode is a pure display component (memo'd). It must become interactive while maintaining React Flow handle architecture.

**Key Design Constraint**: React Flow nodes re-render when their `data` prop changes. Column mutations must update `node.data.table.columns` to trigger re-render. The `memo` wrapper should use a custom comparator that allows re-renders when columns change but skips unnecessary re-renders from position changes.

**Changes:**

- Replace inline column mapping with `<ColumnRow>` components
- Add `<AddColumnRow>` at bottom when `showMode !== 'TABLE_NAME'`
- Add local editing state management
- Prevent node dragging during edit (stop event propagation on interactive elements with `noDrag` class)

```typescript
// New data callbacks added to TableNodeData
interface TableNodeData {
  // ... existing fields ...
  onColumnCreate?: (
    tableId: string,
    data: CreateColumnPayload,
  ) => Promise<Column>
  onColumnUpdate?: (
    columnId: string,
    data: UpdateColumnPayload,
  ) => Promise<Column>
  onColumnDelete?: (columnId: string) => Promise<void>
}
```

**Decision: Callbacks passed via node data, not context**

- Why: React Flow nodes receive data via props. Using React context would require a provider inside the React Flow tree, which is fragile. The existing pattern (e.g., showMode) passes data through node.data.
- Trade-off: Slightly verbose -- every callback must be spread into node data. But it's explicit and follows existing patterns.

### 4.2 ColumnRow Component

Renders a single column with its handles, name, data type, constraint badges, and delete button.

**Props:**

```typescript
interface ColumnRowProps {
  column: Column
  tableId: string
  isLast: boolean
  editingField: EditingField | null
  onStartEdit: (columnId: string, field: 'name' | 'dataType') => void
  onCommitEdit: (columnId: string, field: string, value: any) => void
  onCancelEdit: () => void
  onToggleConstraint: (
    columnId: string,
    constraint: string,
    value: boolean,
  ) => void
  onDelete: (column: Column) => void
  edges: Array<RelationshipEdgeType> // For delete confirmation check
}
```

**Behavior:**

- Preserves existing Handle placement (left/right source/target per column)
- Name text: `cursor: text` on hover, tooltip "Double-click to edit", double-click enters edit mode
- Data type text: same behavior, opens DataTypeSelector dropdown
- Constraint badges: `cursor: pointer`, single-click toggles
- Delete icon: visible on row hover, hidden otherwise
- Row highlight: subtle background when in edit mode

**Decision: ColumnRow receives edges as prop for FK check**

- Why: The PRD specifies using React Flow edge data (already in memory) to determine if a column has relationships. Passing edges as a prop avoids a separate context or global store lookup.
- Trade-off: Edges array is passed to every ColumnRow, but the FK check is a simple filter (O(n) where n = total edges, typically < 50).

### 4.3 InlineNameEditor Component

Activated on double-click of column name. Shows a text input with highlighted background.

**Props:**

```typescript
interface InlineNameEditorProps {
  value: string
  onCommit: (newValue: string) => void
  onCancel: () => void
}
```

**Behavior:**

- Auto-focuses on mount
- Pre-filled with current name
- Highlighted background (e.g., `bg-accent` or similar)
- Enter commits, Escape cancels
- Blur commits (unless Escape was pressed)
- Validates non-empty before commit
- Applies `nodrag` and `nowheel` CSS classes to prevent React Flow drag during typing

### 4.4 DataTypeSelector Component

Dropdown restricted to the 8 valid data type enum values.

**Props:**

```typescript
interface DataTypeSelectorProps {
  value: DataType
  onSelect: (dataType: DataType) => void
  onCancel: () => void
}
```

**Implementation:**

- Uses shadcn/ui `Select` component (already installed at `src/components/ui/select.tsx`)
- Options: `int`, `string`, `float`, `boolean`, `date`, `text`, `uuid`, `json`
- Display labels: `Integer`, `String`, `Float`, `Boolean`, `Date`, `Text`, `UUID`, `JSON`
- Auto-opens on mount
- Selection immediately commits
- Escape cancels
- Applies `nodrag` class

**Decision: Use existing shadcn Select, not a custom dropdown**

- Why: Select component is already installed and provides keyboard navigation, accessibility, and consistent styling out of the box.
- Trade-off: The Select component's popover may overflow the node bounds. This is acceptable -- React Flow nodes support overflow by default, and the Select portal renders outside the node DOM.

### 4.5 ConstraintBadges Component

Renders PK, N (Nullable), U (Unique) as clickable badges.

**Props:**

```typescript
interface ConstraintBadgesProps {
  isPrimaryKey: boolean
  isNullable: boolean
  isUnique: boolean
  isForeignKey: boolean
  onToggle: (
    constraint: 'isPrimaryKey' | 'isNullable' | 'isUnique',
    value: boolean,
  ) => void
}
```

**Behavior:**

- PK badge: Yellow/gold when active, muted when inactive. Click toggles.
  - Toggling PK ON: auto-sets isNullable=false, isUnique=true (sent as single update)
  - Toggling PK OFF: only sets isPrimaryKey=false (nullable/unique unchanged)
- N badge: Shown when isNullable=true. Click toggles isNullable.
- U badge: Shown when isUnique=true. Click toggles isUnique.
- FK badge: Shown when isForeignKey=true. **Not clickable** -- FK is managed by relationships, not manual toggle.
- All clickable badges have `role="button"`, `aria-pressed`, and `aria-label`.
- `cursor: pointer` on hover.

**Decision: Show N/U only when active, not as toggleable always-visible badges**

- Why: With 5 possible badges (PK, FK, N, U, plus column name and type), the row gets crowded. Showing N/U only when active reduces visual noise. PK and FK are always shown when active because they are primary indicators.
- Trade-off: Discoverability of toggling nullable/unique is lower. Mitigation: right-click context menu or a small "..." overflow in a future iteration. For V1, PK toggle is the primary interaction; N/U can be toggled by clicking where the badge would appear (the slot is still clickable).

**Revised approach after consideration**: Actually, to meet PRD AC-03f ("Constraint toggles (nullable, unique) are accessible via a compact UI within the column row"), all constraint badges should be visible, just visually distinct (muted vs. active). This ensures discoverability.

- PK badge: Always visible. Gold/active or muted/inactive.
- FK badge: Visible only when true. Not clickable.
- N badge: Always visible. Active styling or muted. Clickable.
- U badge: Always visible. Active styling or muted. Clickable.

**Debounce on constraint toggles (SA-M2 mitigation):**
Rapid clicking on constraint badges can cause race conditions with out-of-order server responses. Each badge toggle handler is debounced at 250ms. Implementation: the `onToggle` callback is wrapped in a per-constraint debounce (not a shared debounce -- PK and N can be toggled independently). The debounce uses the trailing edge, so the last click within the 250ms window wins. The optimistic UI update is applied immediately on each click (so the user sees instant feedback), but the WebSocket emit is debounced. If the user toggles PK on-off-on within 250ms, only one emit fires with the final state (on).

```typescript
// Per-constraint debounce in ConstraintBadges
const debouncedToggle = useMemo(() => {
  const timers = new Map<string, NodeJS.Timeout>()
  return (constraint: string, value: boolean) => {
    // Optimistic UI update is immediate (via onToggle prop)
    clearTimeout(timers.get(constraint))
    timers.set(
      constraint,
      setTimeout(() => {
        onToggle(constraint, value) // This triggers the WebSocket emit
        timers.delete(constraint)
      }, 250),
    )
  }
}, [onToggle])
```

### 4.6 AddColumnRow Component

"+" button at the bottom of the column list that expands into an inline creation form.

**Props:**

```typescript
interface AddColumnRowProps {
  tableId: string
  existingColumns: Array<Column>
  onCreate: (data: {
    name: string
    dataType: DataType
    order: number
  }) => Promise<void>
}
```

**Behavior:**

- "+" button visible at all times when showMode is ALL_FIELDS or KEY_ONLY (per PRD OQ-1 resolution)
- Click expands into a row with: name input (auto-focused) + data type selector (pre-set to "string")
- Enter or blur with valid name: create column with `order = max(existing orders) + 1`
- Escape or blur with empty name: discard row
- After successful creation, row resets for potential rapid entry (PRD REQ-09 AC-09b)
- `aria-label="Add new column"` on the button

**Order calculation:**

```typescript
const nextOrder =
  existingColumns.length > 0
    ? Math.max(...existingColumns.map((c) => c.order)) + 1
    : 0
```

### 4.7 DeleteColumnDialog Component

shadcn/ui AlertDialog that lists affected relationships.

**Props:**

```typescript
interface DeleteColumnDialogProps {
  column: Column
  affectedRelationships: Array<{
    id: string
    sourceTableName: string
    sourceColumnName: string
    targetTableName: string
    targetColumnName: string
    cardinality: string
  }>
  onConfirm: () => void
  onCancel: () => void
}
```

**Behavior:**

- Shows relationship list: "This column is referenced by: [table].[column] (FK)" for each affected relationship
- FK columns get additional warning text
- Confirm button: destructive variant
- Cancel button: default variant

**Relationship lookup** (from React Flow edges, done in ColumnRow):

```typescript
const affectedEdges = edges.filter(
  (edge) =>
    edge.data?.relationship.sourceColumnId === column.id ||
    edge.data?.relationship.targetColumnId === column.id,
)
```

### 4.8 ConnectionStatusIndicator Component

Displays WebSocket connection state.

**Props:**

```typescript
interface ConnectionStatusIndicatorProps {
  connectionState: ConnectionState // 'connected' | 'connecting' | 'disconnected'
}
```

**Behavior:**

- Connected: No visible indicator (or small green dot) -- normal state, minimal UI
- Connecting/Reconnecting: Amber dot + "Reconnecting..." text in a subtle top banner
- Disconnected: Red dot + "Disconnected" text in a top banner

**Placement**: Absolute-positioned in the whiteboard container, top-center, with z-index above the canvas.

**Decision: Banner-style, not persistent badge**

- Why: Connected state should be invisible (zero UI noise). Only degraded states need attention. A banner is more noticeable than a corner badge for connection issues.
- Trade-off: Takes vertical space when visible. Acceptable since it only shows during errors.

---

## 5. Hook Specifications

### 5.1 useColumnCollaboration Hook

Listens for incoming column WebSocket events and provides emit functions. This hook is the **sole persistence path** for column mutations -- emitters trigger server-side validation, database persistence, and broadcast to other clients.

**File**: `src/hooks/use-column-collaboration.ts`

**Signature:**

```typescript
function useColumnCollaboration(
  whiteboardId: string,
  userId: string,
  callbacks: {
    onColumnCreated: (column: Column & { createdBy: string }) => void
    onColumnUpdated: (data: {
      columnId: string
      tableId: string
      [key: string]: any
      updatedBy: string
    }) => void
    onColumnDeleted: (data: {
      columnId: string
      tableId: string
      deletedBy: string
    }) => void
    onColumnError: (data: {
      event: string
      error: string
      message: string
    }) => void
  },
): {
  emitColumnCreate: (data: CreateColumn) => void
  emitColumnUpdate: (columnId: string, data: UpdateColumn) => void
  emitColumnDelete: (columnId: string) => void
  isConnected: boolean
}
```

**Implementation Pattern** (follows `useWhiteboardCollaboration`):

- Uses `useCollaboration` hook's `on`, `off`, `emit` functions
- Registers listeners in `useEffect` with cleanup
- Ignores events from current user (`data.createdBy === userId`) for `column:created`, `column:updated`, `column:deleted`
- Listens for `error` events matching column operations (`event: 'column:create' | 'column:update' | 'column:delete'`) and invokes `onColumnError` to trigger rollback
- Emitters only fire when socket is connected; if disconnected, they throw an error that `useColumnMutations` catches for immediate rollback
- Exposes `isConnected` for the UI to disable mutation controls when disconnected

### 5.2 useColumnMutations Hook

Encapsulates column CRUD operations with optimistic updates and error handling. **Does not call HTTP server functions** -- all persistence goes through WebSocket emitters (see Section 2.2 for rationale).

**File**: `src/hooks/use-column-mutations.ts`

**Signature:**

```typescript
function useColumnMutations(
  setNodes: React.Dispatch<React.SetStateAction<Array<TableNodeType>>>,
  setEdges: React.Dispatch<React.SetStateAction<Array<RelationshipEdgeType>>>,
  emitColumnCreate: (data: CreateColumn) => void,
  emitColumnUpdate: (columnId: string, data: UpdateColumn) => void,
  emitColumnDelete: (columnId: string) => void,
  isConnected: boolean,
): {
  createColumn: (
    tableId: string,
    data: { name: string; dataType: DataType; order: number },
  ) => Promise<void>
  updateColumn: (
    columnId: string,
    tableId: string,
    data: Partial<UpdateColumn>,
  ) => Promise<void>
  deleteColumn: (columnId: string, tableId: string) => Promise<void>
}
```

**Optimistic Update Strategy:**

**Create:**

1. Check `isConnected`; if false, show toast "Not connected. Please wait for reconnection." and abort
2. Generate temporary ID: `crypto.randomUUID()`
3. Insert column into node.data.table.columns with temp ID (optimistic)
4. Emit `column:create` via WebSocket (server validates, persists, broadcasts)
5. On `column:created` event from server (received via useColumnCollaboration): replace temp ID with real DB id in node data
6. On `error` event from server: remove optimistic column, show error toast

**Update:**

1. Check `isConnected`; if false, show toast and abort
2. Store previous value
3. Update column in node data immediately (optimistic)
4. Emit `column:update` via WebSocket (server validates, persists, broadcasts)
5. On `error` event from server: revert to previous value, show error toast

**Delete:**

1. Check `isConnected`; if false, show toast and abort
2. Store column data and affected edges for potential revert
3. Remove column from node data immediately (optimistic)
4. Remove affected edges from edge state immediately (optimistic)
5. Emit `column:delete` via WebSocket (server validates, persists, broadcasts)
6. On `error` event from server: re-insert column and edges, show error toast

**Pending Mutations Map (for rollback coordination):**

```typescript
// Track optimistic mutations for rollback on server error
const pendingMutations = useRef<
  Map<
    string,
    {
      type: 'create' | 'update' | 'delete'
      rollback: () => void
    }
  >
>(new Map())
```

When an `error` event arrives from the server (via `onColumnError` callback), the hook looks up the pending mutation by event type and column context, then invokes the stored rollback function.

**Temp-to-Real ID Replacement (Create flow):**
When the originating client's `column:created` event arrives from the server, the hook must match it to the pending optimistic create. Matching strategy: use `tableId` + `name` + `order` as a composite key (these values are unique within the pending create window). On match, replace the temp ID with the server-assigned real ID.

**Error Detection:**

- Not connected: "Not connected. Please wait for reconnection."
- Duplicate column name: Check if server error message contains "Unique constraint" (Prisma P2002 error). Display: "Column name '[name]' already exists in this table."
- Column not found (delete race): "Column was already deleted."
- Generic server error: "Unable to save changes. Please try again."

**Decision: Optimistic updates with rollback, not pessimistic**

- Why: PRD requires < 100ms visual feedback. Server round-trips are 50-200ms. Optimistic updates provide instant UI response.
- Trade-off: Complexity of rollback logic. Acceptable given clear success/failure paths.

**Decision: No HTTP server functions for column mutations**

- Why: The Socket.IO server handlers already perform validation, persistence, and broadcast. Calling HTTP server functions would cause double database writes (SA-C1). This matches the existing pattern for table:create, table:move, table:update, and table:delete.
- What was given up: HTTP fallback when WebSocket is disconnected. See Section 2.2 for trade-off analysis.

---

## 6. Data Type Mapping

Constant defined in `src/components/whiteboard/column/types.ts`:

```typescript
import type { DataType } from '@/data/schema'

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  int: 'Integer',
  string: 'String',
  float: 'Float',
  boolean: 'Boolean',
  date: 'Date',
  text: 'Text',
  uuid: 'UUID',
  json: 'JSON',
}

export const DATA_TYPES: DataType[] = [
  'int',
  'string',
  'float',
  'boolean',
  'date',
  'text',
  'uuid',
  'json',
]
```

---

## 7. WebSocket Integration

### 7.1 Event Flow (Create Example)

```
User A clicks "+" and enters "email" column
  |
  [1] Optimistic: Add column with tempId to local nodes
  |
  [2] Emit: socket.emit('column:create', { tableId, name: "email", dataType: "string", order: 3 })
  |
  [Server receives]
  |   - Validates via createColumnSchema.parse()
  |   - Persists: createColumn(validated)
  |   - Broadcasts: socket.broadcast.emit('column:created', { ...column, createdBy: "userA" })
  |
  +-- [Success: column:created event received by User A] ---+
  |                                                         |
  |   [3] Match by tableId+name+order, replace tempId with real DB id
  |   [4] Remove pending mutation entry
  |
  +-- [Success: column:created event received by User B] ---+
  |                                                         |
  |   [3] User B: Add column to their local nodes
  |
  +-- [Failure: error event received by User A] ---+
  |                                                |
  |   [3] Invoke rollback: remove optimistic column from local nodes
  |   [4] Show error toast with server message
```

**Note on originator receiving broadcast:** The Socket.IO server uses `socket.broadcast.emit` (not `socket.emit`) for the success broadcast, meaning the originating client does NOT receive the `column:created` event for its own mutation. The originating client keeps its optimistic state as-is. To get the real DB id, the originating client must listen for a separate acknowledgment. **Implementation choice:** Use Socket.IO's callback-based acknowledgment pattern (`socket.emit('column:create', data, (response) => {...})`) if the server supports it, OR accept that the optimistic tempId remains until the next `sync:request` reconciliation. For V1, accept the tempId approach -- the column functions correctly with either ID, and `sync:request` on reconnection will reconcile all IDs.

**Revised flow accounting for broadcast.emit:**

```
User A clicks "+" and enters "email" column
  |
  [1] Optimistic: Add column with tempId to local nodes
  |
  [2] Emit: socket.emit('column:create', { tableId, name: "email", dataType: "string", order: 3 })
  |
  [Server receives, validates, persists, broadcasts to OTHERS only]
  |
  +-- [No error event within timeout] ---+
  |   User A: optimistic state is confirmed (tempId remains until sync)
  |
  +-- [Error event received by User A] ---+
  |   Invoke rollback, show toast
  |
  +-- [User B receives column:created] ---+
      Add column to local nodes with real DB id
```

### 7.2 Handling column:deleted for Columns in Edit Mode (FM-06)

When a `column:deleted` event arrives:

1. Check if the deleted column is currently being edited (`editingField?.columnId === deletedColumnId`)
2. If yes: clear `editingField` state (exit edit mode silently)
3. Remove column from node data
4. React Flow will automatically remove edges that reference deleted handles (handle IDs contain columnId)

**Note on edge removal**: When a column is deleted, its handles are removed from the DOM. React Flow edges connected to non-existent handles will show warnings but may not auto-remove from state. The `onColumnDeleted` callback in `ReactFlowWhiteboard` must also filter edges that reference the deleted column.

---

## 8. Interaction Specifications

### 8.1 Double-Click to Edit

React Flow captures double-click on nodes. To intercept double-click on specific elements within a node:

- The ColumnRow component attaches `onDoubleClick` handlers to name and dataType text spans
- These handlers call `e.stopPropagation()` to prevent React Flow's node double-click behavior
- They then set the `editingField` state

### 8.2 Preventing Node Drag During Edit

React Flow provides the `noDrag` class name convention. Any element with class `noDrag` (or `nodrag`) will not initiate node dragging when clicked/dragged.

All input elements (text inputs, selects, buttons) within the column editing UI must have the `nodrag` and `nowheel` classes.

### 8.3 Keyboard Navigation

| Key    | Context                  | Action                                              |
| ------ | ------------------------ | --------------------------------------------------- |
| Enter  | Column row focused       | Enter edit mode on name field                       |
| F2     | Column row focused       | Enter edit mode on name field                       |
| Enter  | Name input focused       | Commit edit                                         |
| Escape | Any input focused        | Cancel edit, revert value                           |
| Tab    | Name input in new column | Move focus to data type selector                    |
| Enter  | Last field of new column | Create column, optionally open new add row (REQ-09) |

### 8.4 Focus Management

- Adding column: name input auto-focuses
- Entering edit mode: the edited input auto-focuses with text selected
- Committing edit: focus returns to the column row (for keyboard continuation)
- Canceling edit: focus returns to the column row

---

## 9. Styling

### 9.1 CSS Variables (extend existing theme)

The project uses CSS custom properties in `src/styles/react-flow-theme.css`. New variables needed:

```css
:root {
  --rf-column-edit-bg: hsl(210 40% 96.1%); /* Light edit highlight */
  --rf-column-hover-bg: hsl(210 40% 96.1% / 0.5); /* Subtle hover */
  --rf-badge-pk-active: hsl(45 93% 47%); /* Gold for PK */
  --rf-badge-pk-inactive: hsl(0 0% 70%); /* Muted PK */
  --rf-badge-constraint-active: hsl(210 40% 50%); /* Active N/U */
  --rf-badge-constraint-inactive: hsl(0 0% 80%); /* Muted N/U */
  --rf-badge-fk: hsl(280 60% 50%); /* Purple for FK */
  --rf-delete-hover: hsl(0 84% 60%); /* Red delete icon */
  --rf-status-connected: hsl(142 76% 36%); /* Green */
  --rf-status-connecting: hsl(38 92% 50%); /* Amber */
  --rf-status-disconnected: hsl(0 84% 60%); /* Red */
}

.dark {
  --rf-column-edit-bg: hsl(210 40% 20%);
  --rf-column-hover-bg: hsl(210 40% 20% / 0.5);
  /* Badge colors work in both themes */
}
```

### 9.2 Column Row Styling

```
Normal state:     No background, standard text
Hover state:      var(--rf-column-hover-bg) background, delete icon visible
Edit state:       var(--rf-column-edit-bg) background, focused border on input
```

### 9.3 Badge Sizing

Badges are compact: `font-size: 10px`, `padding: 1px 4px`, `border-radius: 2px`. This keeps them from overwhelming the column row at 13px font size.

---

## 10. shadcn/ui Components Required

### Already Installed

- `button` -- For "+" add button, delete button
- `input` -- For inline name editing
- `select` -- For data type dropdown
- `dialog` -- Base dialog (AlertDialog extends this pattern)

### To Install

- `alert-dialog` -- For delete confirmation (PRD AC-02c)
- `tooltip` -- For "Double-click to edit" hover hints (PRD AC-03k)
- `dropdown-menu` -- Alternative if Select positioning is problematic inside React Flow nodes

Installation commands:

```bash
bunx shadcn@latest add alert-dialog
bunx shadcn@latest add tooltip
bunx shadcn@latest add dropdown-menu
```

---

## 11. Type Extensions

### 11.1 TableNodeData Extension

In `src/lib/react-flow/types.ts`:

```typescript
export interface TableNodeData {
  // ... existing fields ...

  /** Column mutation callbacks (injected by ReactFlowWhiteboard) */
  onColumnCreate?: (
    tableId: string,
    data: {
      name: string
      dataType: DataType
      order: number
    },
  ) => Promise<Column | null>

  onColumnUpdate?: (
    columnId: string,
    tableId: string,
    data: Partial<{
      name: string
      dataType: DataType
      isPrimaryKey: boolean
      isNullable: boolean
      isUnique: boolean
    }>,
  ) => Promise<Column | null>

  onColumnDelete?: (columnId: string, tableId: string) => Promise<void>

  /** All edges in the diagram (for relationship lookup in delete confirmation) */
  edges?: Array<RelationshipEdgeType>
}
```

### 11.2 Column Editing Types

In `src/components/whiteboard/column/types.ts`:

```typescript
export interface EditingField {
  columnId: string
  field: 'name' | 'dataType'
}

export interface CreateColumnPayload {
  name: string
  dataType: DataType
  order: number
}

export interface ColumnRelationship {
  id: string
  sourceTableName: string
  sourceColumnName: string
  targetTableName: string
  targetColumnName: string
  cardinality: string
}
```

---

## 12. Implementation Plan

### Phase 1: Foundation (No Interactivity Yet)

**Goal**: Set up component structure, install dependencies, define types.

1. Install shadcn/ui components: `alert-dialog`, `tooltip`, `dropdown-menu`
2. Create `src/components/whiteboard/column/types.ts` with shared types and DATA_TYPE_LABELS constant
3. Extend `TableNodeData` in `src/lib/react-flow/types.ts` with callback props
4. Create skeleton `ColumnRow` component that renders existing column display (matching current TableNode output)
5. Refactor `TableNode.new.tsx` to use `ColumnRow` components instead of inline mapping
6. Verify: No visual or behavioral change -- pure refactor

### Phase 2: Column Editing (REQ-03)

**Goal**: Inline editing of name, dataType, and constraint toggles.

1. Create `InlineNameEditor` component
2. Create `DataTypeSelector` component
3. Create `ConstraintBadges` component with toggle logic (including PK auto-sets)
4. Add editing state management to `TableNode`
5. Create `useColumnMutations` hook with updateColumn function
6. Wire up double-click handlers, keyboard shortcuts (Enter/F2), escape/blur behavior
7. Add cursor changes and tooltips for discoverability
8. Add `nodrag`/`nowheel` classes to interactive elements
9. Verify: Can edit column name, type, constraints inline. Changes persist to DB.

### Phase 3: Column Creation (REQ-01)

**Goal**: Add new columns via "+" button.

1. Create `AddColumnRow` component
2. Add createColumn to `useColumnMutations` hook with optimistic update
3. Implement order calculation (`max + 1`)
4. Handle empty name discard, default dataType "string"
5. Add to `TableNode` (visible in ALL_FIELDS and KEY_ONLY modes)
6. Verify: Can add columns. New columns persist and appear in correct order.

### Phase 4: Column Deletion (REQ-02)

**Goal**: Delete columns with safety check for relationships.

1. Create `DeleteColumnDialog` component using shadcn AlertDialog
2. Add deleteColumn to `useColumnMutations` hook with optimistic update
3. Implement relationship lookup from edges
4. Add delete button to `ColumnRow` (hover-visible)
5. Wire up: no-relationship -> immediate delete, has-relationship -> dialog
6. Handle edge removal after column deletion
7. Verify: Can delete columns. FK columns show confirmation. Edges removed.

### Phase 5: Real-Time Collaboration (REQ-04)

**Goal**: Column events sync across clients via WebSocket.

1. Create `useColumnCollaboration` hook
2. Integrate into `ReactFlowWhiteboard`: listen for column:created/updated/deleted
3. Implement incoming event handlers (add/update/remove columns in node data)
4. Implement outgoing event emission in `useColumnMutations` (WebSocket emit as sole persistence path)
5. Handle FM-06: column deleted while being edited by another user
6. Handle edge state: remove edges for deleted columns
7. Verify: Changes appear on second browser tab in real-time.

### Phase 6: Error Handling and Connection Status (REQ-06, FM-01 through FM-04)

**Goal**: Robust error UX and connection awareness.

1. Create `ConnectionStatusIndicator` component
2. Add to whiteboard layout
3. Implement error toast messages with specific text (duplicate name, server error)
4. Implement optimistic rollback on all failure paths
5. Test degraded mode (WebSocket disconnected: mutations blocked, error toast shown, UI reflects disconnected state)
6. Verify: Errors show actionable toasts. Connection status is visible.

### Phase 7: Accessibility and Polish (REQ-09, REQ-10)

**Goal**: Keyboard navigation, ARIA labels, visual polish.

1. Add ARIA labels to all interactive elements (AC-10a, AC-10b, AC-10c)
2. Add Tab navigation within column rows (AC-09a)
3. Add rapid entry mode (AC-09b -- Enter on last field creates column and opens new row)
4. Add CSS variables for dark mode support
5. Performance test with 30+ columns per table
6. Verify: Keyboard-only operation works. Screen reader labels are correct.

---

## 13. Performance Considerations

### 13.1 React Flow Node Re-rendering

**Risk**: Updating a column triggers re-render of the entire TableNode, which includes all columns and their handles.

**Mitigation**:

- `ColumnRow` is wrapped in `React.memo` with a comparator that checks only its own column data
- `ConstraintBadges` is wrapped in `React.memo`
- The `TableNode` memo comparator should compare `data.table.columns` by reference, not deep equality -- use the fact that `setNodes` creates new column arrays on mutation

### 13.2 Edge Filtering for Delete Confirmation

**Risk**: Passing all edges to every ColumnRow and filtering per-column could be slow with many edges.

**Mitigation**:

- Pre-compute a `Map<columnId, RelationshipEdgeType[]>` in the TableNode component (O(n) once, O(1) lookup per column)
- Pass the pre-computed map instead of raw edges array

### 13.3 Optimistic Update Race Conditions

**Risk**: Rapid successive edits could cause state inconsistency if the first edit's server response arrives after the second edit has been applied. Specifically, rapid constraint badge toggles (e.g., clicking PK on/off/on quickly) fire independent WebSocket emits that may resolve out of order.

**Mitigation**:

- Constraint toggles are debounced at 250ms per constraint (see Section 4.5). Only the final state within the debounce window is emitted to the server, eliminating the rapid-toggle race condition.
- Each mutation carries a monotonic version/timestamp for non-debounced mutations (name edit, data type change).
- On server error response, only invoke rollback if the pending mutation map still contains the matching entry (stale errors are ignored).
- For V1, name and data type edits are low risk because single-edit mode means only one field edits at a time.

---

## 14. Testing Strategy

### Unit Tests

- `ConstraintBadges`: PK toggle auto-sets nullable/unique
- `useColumnMutations`: Optimistic update + rollback
- `DataTypeSelector`: All 8 types present, correct values emitted
- Order calculation: `max + 1` logic

### Integration Tests

- Create column flow: click "+", type name, press Enter -> column in node data
- Edit column flow: double-click name, change value, press Enter -> column updated
- Delete column flow (no FK): click delete -> column removed
- Delete column flow (with FK): click delete -> dialog shown -> confirm -> column + edges removed

### Manual Testing

- Two browser tabs: create/edit/delete on one, verify sync on other
- Disconnect WebSocket (dev tools Network tab), attempt edits, verify error toast "Not connected" and no state corruption
- Reconnect WebSocket, verify `sync:request` reconciles state (temp IDs replaced with real IDs)
- Rapid-click constraint badges (PK on/off/on/off quickly), verify final state matches last click
- 30+ columns per table: verify scrolling and rendering performance
- Dark mode: verify all new CSS variables apply correctly

---

## 15. Risks and Mitigations

| Risk                                                 | Likelihood | Impact | Mitigation                                                                                                              |
| ---------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| Select dropdown positioning inside React Flow node   | Medium     | Low    | shadcn Select uses Radix portal, renders outside DOM tree. If still clipped, use DropdownMenu as fallback.              |
| Node re-render performance with many columns         | Low        | Medium | Memo comparators on ColumnRow. Test with 30+ columns early.                                                             |
| Double-click conflict with React Flow node selection | Low        | Low    | `stopPropagation` on column elements. React Flow's default double-click behavior (fit view) is on the pane, not nodes.  |
| Prisma unique constraint error format changes        | Low        | Low    | Error detection uses string matching. Wrap in a utility function for easy adjustment.                                   |
| Stale edges after column deletion                    | Medium     | Medium | Explicitly filter edges in the onColumnDeleted handler, not relying on React Flow auto-cleanup.                         |
| WebSocket disconnected blocks all mutations          | Medium     | Low    | ConnectionStatusIndicator warns the user. Mutations check `isConnected` and show actionable toast. No silent data loss. |

### 15.1 Known Limitations

**Authorization gap (SA-M1):** Column mutation endpoints (both the Socket.IO handlers and the HTTP server functions) do not perform per-user authorization checks. The Socket.IO connection authenticates with `userId` via handshake auth, but the server does not verify whether that user has permission to modify columns in the given whiteboard. This is a **pre-existing gap** in the codebase -- it applies equally to table mutations, relationship mutations, and all other collaboration events. This spec does not introduce or widen the gap, but it is documented here because column mutations (especially delete) are destructive. **Recommended future work:** Add a middleware layer to the Socket.IO event handlers that verifies the user's role/permissions for the whiteboard before allowing mutations. This should be addressed as a separate security hardening initiative across all mutation types, not just columns.

---

## 16. Open Technical Decisions

| #    | Decision Point                 | Recommended                    | Alternative                       | Notes                                  |
| ---- | ------------------------------ | ------------------------------ | --------------------------------- | -------------------------------------- |
| TD-1 | Where to store editing state   | Local to TableNode             | Lifted to ReactFlowWhiteboard     | Local is simpler; lift later if needed |
| TD-2 | How to pass mutation callbacks | Via node.data props            | Via React context                 | Props follows existing pattern         |
| TD-3 | Edge removal on column delete  | Explicit filter in handler     | Rely on React Flow handle cleanup | Explicit is safer                      |
| TD-4 | Rapid entry mode (REQ-09)      | Auto-open new row after create | Require explicit "+" click        | Auto-open matches PRD AC-09b           |
