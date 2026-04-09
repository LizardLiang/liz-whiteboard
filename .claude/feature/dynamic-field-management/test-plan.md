# Test Plan: Dynamic Field Management

**Feature**: dynamic-field-management
**Author**: Artemis (QA Agent)
**Date**: 2026-03-30
**Based On**: prd.md (Revised R1), tech-spec.md (Revised R1)
**Framework**: Vitest + @testing-library/react
**Status**: Ready for Implementation

---

## 1. Overview

This test plan covers all test cases for the Dynamic Field Management feature, which adds inline column CRUD operations to the ER diagram whiteboard's TableNode component. The backend (Prisma data layer, server functions, Socket.IO handlers) is pre-existing and untouched; all testing focus is on the new frontend components, hooks, and WebSocket integration.

### Coverage Summary

| Suite                                 | Type        | Test Cases | Priority |
| ------------------------------------- | ----------- | ---------- | -------- |
| TS-01: DataTypeSelector               | Unit        | 6          | P0       |
| TS-02: InlineNameEditor               | Unit        | 8          | P0       |
| TS-03: ConstraintBadges               | Unit        | 12         | P0       |
| TS-04: AddColumnRow                   | Unit        | 9          | P0       |
| TS-05: DeleteColumnDialog             | Unit        | 6          | P0       |
| TS-06: ColumnRow                      | Unit        | 10         | P0       |
| TS-07: useColumnMutations             | Unit        | 12         | P0       |
| TS-08: useColumnCollaboration         | Unit        | 8          | P0       |
| TS-09: ConnectionStatusIndicator      | Unit        | 5          | P0       |
| TS-10: TableNode Integration          | Integration | 12         | P0       |
| TS-11: Real-Time Collaboration        | Integration | 8          | P0       |
| TS-12: Error Handling / Failure Modes | Integration | 10         | P0       |
| TS-13: Optimistic Updates             | Integration | 6          | P1       |
| TS-14: Data Type Enum                 | Unit        | 4          | P1       |
| TS-15: Keyboard Navigation            | Unit        | 5          | P2       |
| TS-16: Accessibility                  | Unit        | 5          | P2       |
| **Total**                             |             | **126**    |          |

### Requirements-to-Test Mapping

| Requirement                      | Priority | Test Suite(s)                     | Min Test Cases |
| -------------------------------- | -------- | --------------------------------- | -------------- |
| REQ-01: Add Field Inline         | P0       | TS-04, TS-07, TS-10, TS-11        | 18             |
| REQ-02: Delete Field with Safety | P0       | TS-05, TS-06, TS-07, TS-10, TS-11 | 14             |
| REQ-03: Edit Field Properties    | P0       | TS-02, TS-03, TS-06, TS-07, TS-10 | 22             |
| REQ-04: Real-Time Collaboration  | P0       | TS-08, TS-11                      | 13             |
| REQ-05: Database Persistence     | P0       | TS-07, TS-10, TS-12               | 10             |
| REQ-06: Connection Status        | P0       | TS-09, TS-12                      | 9              |
| REQ-07: Optimistic UI            | P1       | TS-13                             | 6              |
| REQ-08: Data Type Selection      | P1       | TS-01, TS-14                      | 10             |
| REQ-09: Keyboard Navigation      | P2       | TS-15                             | 5              |
| REQ-10: Accessibility            | P2       | TS-16                             | 5              |

---

## 2. Test Environment

### Framework and Tools

- **Test Runner**: Vitest 4.x (`bun run test`)
- **Component Testing**: @testing-library/react 16.x
- **File Locations**: Co-located next to source files (e.g., `src/components/whiteboard/column/DataTypeSelector.test.tsx`)
- **Test Command**: `bun run test`

### Test File Structure

```
src/
  components/
    whiteboard/
      column/
        DataTypeSelector.test.tsx        (TS-01)
        InlineNameEditor.test.tsx        (TS-02)
        ConstraintBadges.test.tsx        (TS-03)
        AddColumnRow.test.tsx            (TS-04)
        DeleteColumnDialog.test.tsx      (TS-05)
        ColumnRow.test.tsx               (TS-06)
      ConnectionStatusIndicator.test.tsx  (TS-09)
      TableNode.integration.test.tsx     (TS-10, TS-11, TS-12, TS-13)
  hooks/
    use-column-mutations.test.ts         (TS-07)
    use-column-collaboration.test.ts     (TS-08)
  data/
    schema.test.ts                       (TS-14 — extend existing file)
```

### Mock Strategy

- **Socket.IO**: Vitest `vi.fn()` mocks on `emit`, `on`, `off` from `useCollaboration`
- **useCollaboration**: Mock the hook directly; do not test Socket.IO transport
- **Zod schemas**: Import actual schemas from `src/data/schema.ts` — no mocks
- **React Flow**: Use `ReactFlowProvider` wrapper in component tests that render nodes
- **Timers**: Use Vitest fake timers for debounce testing (ConstraintBadges 250ms debounce)

### Test Data Fixtures

```typescript
// Shared test fixtures (src/test/fixtures.ts)

export const mockColumn = {
  id: 'col-001',
  tableId: 'tbl-001',
  name: 'email',
  dataType: 'string' as const,
  isPrimaryKey: false,
  isForeignKey: false,
  isNullable: true,
  isUnique: false,
  description: null,
  order: 1,
}

export const mockPKColumn = {
  ...mockColumn,
  id: 'col-pk',
  name: 'id',
  dataType: 'uuid' as const,
  isPrimaryKey: true,
  isNullable: false,
  isUnique: true,
  order: 0,
}

export const mockFKColumn = {
  ...mockColumn,
  id: 'col-fk',
  name: 'user_id',
  dataType: 'uuid' as const,
  isForeignKey: true,
  order: 2,
}

export const mockEdge = {
  id: 'edge-001',
  source: 'tbl-001',
  target: 'tbl-002',
  data: {
    relationship: {
      id: 'rel-001',
      sourceColumnId: 'col-fk',
      targetColumnId: 'col-pk',
      sourceTableName: 'orders',
      sourceColumnName: 'user_id',
      targetTableName: 'users',
      targetColumnName: 'id',
      cardinality: 'MANY_TO_ONE',
    },
  },
}
```

---

## 3. Test Suites

### TS-01: DataTypeSelector Component

**File**: `src/components/whiteboard/column/DataTypeSelector.test.tsx`
**Requirement**: REQ-08 (P1)

| ID       | Test Case                                                                       | Expected Result                                                               | Priority |
| -------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| TC-01-01 | Renders a Select component (not free-text input)                                | Component does not render an `<input type="text">`                            | P1       |
| TC-01-02 | Shows exactly 8 options in the dropdown                                         | Dropdown renders 8 items matching the Zod enum                                | P1       |
| TC-01-03 | All 8 enum values are present as option values                                  | `int`, `string`, `float`, `boolean`, `date`, `text`, `uuid`, `json` all exist | P1       |
| TC-01-04 | Displays user-friendly labels                                                   | "Integer" shows for `int`, "UUID" shows for `uuid`, etc.                      | P1       |
| TC-01-05 | Selecting a value calls onSelect with the stored enum value (not display label) | `onSelect("int")` called when user picks "Integer"                            | P1       |
| TC-01-06 | Applies `nodrag` class to prevent React Flow drag during interaction            | Root element has `nodrag` CSS class                                           | P1       |

---

### TS-02: InlineNameEditor Component

**File**: `src/components/whiteboard/column/InlineNameEditor.test.tsx`
**Requirement**: REQ-03 (P0)

| ID       | Test Case                                              | Expected Result                                               | Priority |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------- | -------- |
| TC-02-01 | Auto-focuses the input on mount                        | Input element receives focus immediately after render         | P0       |
| TC-02-02 | Pre-fills with the current column name value           | Input value equals the `value` prop on render                 | P0       |
| TC-02-03 | Pressing Enter commits with the new value              | `onCommit("new_name")` called on Enter keydown                | P0       |
| TC-02-04 | Pressing Escape calls onCancel without committing      | `onCancel()` called; `onCommit` not called                    | P0       |
| TC-02-05 | Blurring with a valid non-empty value commits          | `onCommit` called with current input value on blur            | P0       |
| TC-02-06 | Pressing Enter with empty value does NOT call onCommit | `onCommit` not called when value is empty string              | P0       |
| TC-02-07 | Blurring with empty value calls onCancel               | `onCancel()` called on blur when input is empty               | P0       |
| TC-02-08 | Applies `nodrag` and `nowheel` classes                 | Input element has both CSS classes to prevent React Flow drag | P0       |

---

### TS-03: ConstraintBadges Component

**File**: `src/components/whiteboard/column/ConstraintBadges.test.tsx`
**Requirement**: REQ-03 (P0)

| ID       | Test Case                                                                                           | Expected Result                                                                             | Priority |
| -------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| TC-03-01 | PK badge always visible; shows active style when isPrimaryKey=true                                  | PK badge rendered; has active styling when `isPrimaryKey=true`                              | P0       |
| TC-03-02 | PK badge shows muted style when isPrimaryKey=false                                                  | PK badge rendered with inactive/muted styling                                               | P0       |
| TC-03-03 | Clicking PK badge (off->on) calls onToggle with isPrimaryKey=true, isNullable=false, isUnique=true  | `onToggle('isPrimaryKey', true)` triggers a combined update setting all three               | P0       |
| TC-03-04 | Clicking PK badge (on->off) calls onToggle with isPrimaryKey=false only (nullable/unique unchanged) | `onToggle('isPrimaryKey', false)` does NOT change isNullable or isUnique                    | P0       |
| TC-03-05 | N badge always visible; shows active when isNullable=true                                           | N badge rendered; active styling when `isNullable=true`                                     | P0       |
| TC-03-06 | Clicking N badge toggles isNullable independently                                                   | `onToggle('isNullable', false)` when currently true                                         | P0       |
| TC-03-07 | U badge always visible; shows active when isUnique=true                                             | U badge rendered; active styling when `isUnique=true`                                       | P0       |
| TC-03-08 | Clicking U badge toggles isUnique independently                                                     | `onToggle('isUnique', true)` when currently false                                           | P0       |
| TC-03-09 | FK badge visible only when isForeignKey=true                                                        | FK badge present when true; absent when false                                               | P0       |
| TC-03-10 | FK badge is not clickable                                                                           | FK badge has no onClick handler; clicking does nothing                                      | P0       |
| TC-03-11 | Debounce: rapid clicks on PK badge emit only once after 250ms                                       | With fake timers, 3 rapid clicks result in 1 `onToggle` call after timer advances           | P0       |
| TC-03-12 | Debounce: PK and N badges debounce independently                                                    | Clicking PK then N within 250ms results in 2 separate `onToggle` calls (one per constraint) | P0       |

---

### TS-04: AddColumnRow Component

**File**: `src/components/whiteboard/column/AddColumnRow.test.tsx`
**Requirement**: REQ-01 (P0)

| ID       | Test Case                                                                    | Expected Result                                                                               | Priority |
| -------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| TC-04-01 | Renders a "+" button in collapsed state                                      | Button with `aria-label="Add new column"` is present                                          | P0       |
| TC-04-02 | Clicking "+" expands the creation form with name input and type selector     | Name input and DataTypeSelector visible; name input is focused                                | P0       |
| TC-04-03 | Name input auto-focuses when form expands                                    | Input has focus on expansion                                                                  | P0       |
| TC-04-04 | Data type defaults to "string"                                               | DataTypeSelector's initial value is `"string"`                                                | P0       |
| TC-04-05 | Pressing Enter with a valid name calls onCreate with correct payload         | `onCreate({ name: "email", dataType: "string", order: 2 })` called (order = max existing + 1) | P0       |
| TC-04-06 | Order is calculated as max(existing orders) + 1                              | With columns at orders [0, 1], new order = 2                                                  | P0       |
| TC-04-07 | Pressing Escape with empty name discards the form without calling onCreate   | Row closes; `onCreate` not called                                                             | P0       |
| TC-04-08 | Blurring name input with empty value discards the form                       | Row closes on blur with empty input                                                           | P0       |
| TC-04-09 | After successful creation, form resets (name cleared, type back to "string") | Form is ready for rapid entry after `onCreate` resolves                                       | P1       |

---

### TS-05: DeleteColumnDialog Component

**File**: `src/components/whiteboard/column/DeleteColumnDialog.test.tsx`
**Requirement**: REQ-02 (P0)

| ID       | Test Case                                                | Expected Result                                                           | Priority |
| -------- | -------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| TC-05-01 | Renders as AlertDialog (shadcn/ui)                       | Component uses AlertDialog structure with proper accessible roles         | P0       |
| TC-05-02 | Lists all affected relationship names in dialog body     | Dialog shows "orders.user_id -> users.id" for each affected relationship  | P0       |
| TC-05-03 | Shows FK-specific additional warning when column is a FK | Warning text about relationship breakage visible when `isForeignKey=true` | P0       |
| TC-05-04 | Confirm button calls onConfirm                           | `onConfirm()` invoked on confirm action                                   | P0       |
| TC-05-05 | Cancel button calls onCancel                             | `onCancel()` invoked on cancel action; `onConfirm` not called             | P0       |
| TC-05-06 | Confirm button uses destructive visual style             | Confirm button has destructive/danger variant                             | P0       |

---

### TS-06: ColumnRow Component

**File**: `src/components/whiteboard/column/ColumnRow.test.tsx`
**Requirement**: REQ-02, REQ-03 (P0)

| ID       | Test Case                                                                         | Expected Result                                                                      | Priority |
| -------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| TC-06-01 | Renders column name and data type as static text in default state                 | Name and type displayed as text spans, not inputs                                    | P0       |
| TC-06-02 | Double-clicking name calls onStartEdit with correct args                          | `onStartEdit(column.id, 'name')` called on name double-click                         | P0       |
| TC-06-03 | When editingField matches this column's name, InlineNameEditor renders            | InlineNameEditor visible when `editingField = { columnId, field: 'name' }`           | P0       |
| TC-06-04 | Double-clicking dataType calls onStartEdit with dataType field                    | `onStartEdit(column.id, 'dataType')` called on type double-click                     | P0       |
| TC-06-05 | When editingField matches this column's dataType, DataTypeSelector renders        | DataTypeSelector visible when `editingField = { columnId, field: 'dataType' }`       | P0       |
| TC-06-06 | Delete button is hidden by default; visible on row hover                          | Delete button not visible initially; becomes visible on mouse enter                  | P0       |
| TC-06-07 | Clicking delete on column with no relationships calls onDelete directly           | `onDelete(column)` called without confirmation for columns with no edges             | P0       |
| TC-06-08 | Clicking delete on FK column shows DeleteColumnDialog                             | Dialog renders when column's id matches an edge's sourceColumnId or targetColumnId   | P0       |
| TC-06-09 | Row has active/highlighted background when in edit mode                           | Row container has edit-mode highlight class when any field of this column is editing | P0       |
| TC-06-10 | Name/type spans have cursor:text via class; constraint badges have cursor:pointer | Correct cursor CSS classes on each element                                           | P0       |

---

### TS-07: useColumnMutations Hook

**File**: `src/hooks/use-column-mutations.test.ts`
**Requirement**: REQ-01, REQ-02, REQ-03, REQ-05 (P0)

| ID       | Test Case                                                                                 | Expected Result                                                        | Priority |
| -------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| TC-07-01 | createColumn: calls emitColumnCreate with correct payload                                 | `emitColumnCreate` called with `{ tableId, name, dataType, order }`    | P0       |
| TC-07-02 | createColumn: adds optimistic column to node data immediately                             | setNodes called before emit; node data contains column with tempId     | P0       |
| TC-07-03 | createColumn: when `isConnected=false`, shows toast and aborts (no emit, no state change) | `emitColumnCreate` not called; toast with "Not connected" shown        | P0       |
| TC-07-04 | updateColumn: calls emitColumnUpdate with columnId and changed fields                     | `emitColumnUpdate("col-001", { name: "new_name" })` called             | P0       |
| TC-07-05 | updateColumn: applies optimistic update before emit                                       | Node data updated with new value before `emitColumnUpdate`             | P0       |
| TC-07-06 | updateColumn: when `isConnected=false`, shows toast and aborts                            | `emitColumnUpdate` not called; toast shown                             | P0       |
| TC-07-07 | deleteColumn: calls emitColumnDelete with columnId                                        | `emitColumnDelete("col-001")` called                                   | P0       |
| TC-07-08 | deleteColumn: removes column from node data optimistically                                | Column absent from node data after call                                | P0       |
| TC-07-09 | deleteColumn: removes affected edges from edge state optimistically                       | Edges referencing deleted column removed from state                    | P0       |
| TC-07-10 | Rollback on error (create): removes optimistic column, shows toast                        | Column removed from node data when `onColumnError` fires for create    | P0       |
| TC-07-11 | Rollback on error (update): restores previous column value, shows toast                   | Column reverts to pre-edit value when `onColumnError` fires for update | P0       |
| TC-07-12 | Rollback on error (delete): re-inserts column and edges, shows toast                      | Column and edges restored when `onColumnError` fires for delete        | P0       |

---

### TS-08: useColumnCollaboration Hook

**File**: `src/hooks/use-column-collaboration.test.ts`
**Requirement**: REQ-04 (P0)

| ID       | Test Case                                                                    | Expected Result                                                            | Priority |
| -------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| TC-08-01 | Registers `column:created` listener on mount                                 | `on('column:created', ...)` called during initialization                   | P0       |
| TC-08-02 | Registers `column:updated` and `column:deleted` listeners on mount           | Both listeners registered via `on`                                         | P0       |
| TC-08-03 | Removes all listeners on unmount                                             | `off` called for each registered event on cleanup                          | P0       |
| TC-08-04 | `column:created` event from another user triggers `onColumnCreated` callback | Callback invoked when `createdBy !== currentUserId`                        | P0       |
| TC-08-05 | `column:created` event from current user is ignored                          | `onColumnCreated` NOT invoked when `createdBy === currentUserId`           | P0       |
| TC-08-06 | `column:deleted` event from another user triggers `onColumnDeleted` callback | `onColumnDeleted({ columnId, tableId, deletedBy })` invoked                | P0       |
| TC-08-07 | `error` event for a column operation triggers `onColumnError` callback       | `onColumnError` invoked with `{ event, error, message }`                   | P0       |
| TC-08-08 | `isConnected` reflects the underlying socket connection state                | `isConnected=true` when `connectionState === 'connected'`; false otherwise | P0       |

---

### TS-09: ConnectionStatusIndicator Component

**File**: `src/components/whiteboard/ConnectionStatusIndicator.test.tsx`
**Requirement**: REQ-06 (P0)

| ID       | Test Case                                                                   | Expected Result                                                       | Priority |
| -------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------- |
| TC-09-01 | Renders nothing (or minimal dot) when connectionState is "connected"        | No banner or warning text visible in connected state                  | P0       |
| TC-09-02 | Shows amber indicator and "Reconnecting..." text when state is "connecting" | Banner with reconnecting message rendered; has amber color indication | P0       |
| TC-09-03 | Shows red indicator and "Disconnected" text when state is "disconnected"    | Banner with disconnected message rendered; has red color indication   | P0       |
| TC-09-04 | Banner disappears when state transitions from "disconnected" to "connected" | Re-render with `connectionState="connected"` hides the banner         | P0       |
| TC-09-05 | Component is positioned above the canvas (z-index/absolute placement)       | Component has appropriate absolute positioning class                  | P0       |

---

### TS-10: TableNode Integration Tests

**File**: `src/components/whiteboard/TableNode.integration.test.tsx`
**Requirement**: REQ-01, REQ-02, REQ-03, REQ-05 (P0)
**Setup**: Render TableNode with ReactFlowProvider; provide mock column mutation callbacks.

| ID       | Test Case                                                                                     | Expected Result                                                                          | Priority |
| -------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| TC-10-01 | AddColumnRow "+" is visible when showMode is ALL_FIELDS                                       | "+" button present in rendered output                                                    | P0       |
| TC-10-02 | AddColumnRow "+" is visible when showMode is KEY_ONLY                                         | "+" button present                                                                       | P0       |
| TC-10-03 | AddColumnRow "+" is NOT rendered when showMode is TABLE_NAME                                  | No "+" button when mode is TABLE_NAME                                                    | P0       |
| TC-10-04 | Full add-column flow: click "+", type name, Enter -> onColumnCreate called                    | `onColumnCreate("tbl-001", { name: "email", dataType: "string", order: N })` invoked     | P0       |
| TC-10-05 | Discard add flow: click "+", type nothing, Escape -> onColumnCreate NOT called                | Form closes silently; no mutation                                                        | P0       |
| TC-10-06 | Full edit flow: double-click name, type new name, Enter -> onColumnUpdate called              | `onColumnUpdate("col-001", "tbl-001", { name: "new_email" })` invoked                    | P0       |
| TC-10-07 | Cancel edit: double-click name, press Escape -> value reverts, no update                      | Column name unchanged; `onColumnUpdate` not called                                       | P0       |
| TC-10-08 | PK toggle: click PK badge -> onColumnUpdate called with PK+nullable+unique                    | `onColumnUpdate` called with `{ isPrimaryKey: true, isNullable: false, isUnique: true }` | P0       |
| TC-10-09 | Delete column with no relationships: click delete -> onColumnDelete called immediately        | `onColumnDelete("col-001", "tbl-001")` called without dialog                             | P0       |
| TC-10-10 | Delete FK column: click delete -> dialog shown; confirm -> onColumnDelete called              | Dialog appears then `onColumnDelete` called on confirm                                   | P0       |
| TC-10-11 | Delete FK column: click delete -> dialog shown; cancel -> onColumnDelete NOT called           | Dialog appears then dismissed; no mutation                                               | P0       |
| TC-10-12 | Only one field editable at a time: double-click name while type is editing commits type first | Opening second field triggers commit on first                                            | P0       |

---

### TS-11: Real-Time Collaboration Integration

**File**: `src/components/whiteboard/TableNode.integration.test.tsx` (additional describes)
**Requirement**: REQ-04 (P0)
**Setup**: Mock useColumnCollaboration; simulate incoming WebSocket events via callback invocation.

| ID       | Test Case                                                                             | Expected Result                                                                | Priority |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| TC-11-01 | `column:created` event from remote user: column appears in TableNode                  | New column row visible in node after `onColumnCreated` callback fires          | P0       |
| TC-11-02 | `column:updated` event from remote user: column name updates in place                 | Column name text updated in node                                               | P0       |
| TC-11-03 | `column:updated` event from remote user: dataType updates in place                    | Column type badge updates                                                      | P0       |
| TC-11-04 | `column:deleted` event: column disappears from node                                   | Column row removed from DOM                                                    | P0       |
| TC-11-05 | `column:deleted` event for a column being edited: edit mode exits silently            | `editingField` cleared; column removed; no error toast                         | P0       |
| TC-11-06 | Remote create event does not affect currently-editing column state                    | Existing edit session continues when unrelated column is added remotely        | P0       |
| TC-11-07 | Events scoped to correct tableId: event for different table does not update this node | Unrelated tableId event is ignored                                             | P0       |
| TC-11-08 | emitColumnCreate is called with whiteboardId in the socket namespace                  | Emitter payload includes identifiers needed for server-side whiteboard scoping | P0       |

---

### TS-12: Error Handling and Failure Modes

**File**: `src/components/whiteboard/TableNode.integration.test.tsx` (additional describes)
**Requirement**: REQ-05, REQ-06 (P0) and FM-01 through FM-06

| ID       | Test Case                                                                           | Expected Result                                                           | Priority |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| TC-12-01 | FM-01: Server error on create -> optimistic column removed, error toast shown       | Column disappears from node; toast with "Unable to create column" message | P0       |
| TC-12-02 | FM-01: Duplicate column name error -> specific toast message                        | Toast shows "Column name 'email' already exists in this table"            | P0       |
| TC-12-03 | FM-02: Server error on delete -> error toast; column remains visible                | Column still in node data after delete error                              | P0       |
| TC-12-04 | FM-03: Server error on update -> field reverts to pre-edit value, error toast shown | Column name reverts; toast with actionable message                        | P0       |
| TC-12-05 | FM-03: Duplicate name on update -> specific toast message                           | Toast shows "Column name 'X' already exists in this table"                | P0       |
| TC-12-06 | FM-04: Disconnected state -> mutation attempt shows "Not connected" toast           | `isConnected=false` results in toast; no emit; no state change            | P0       |
| TC-12-07 | FM-06: column:deleted event for column in edit mode -> edit exits silently          | No error toast when remote delete hits editing column                     | P0       |
| TC-12-08 | Connection recovery: state transitions from disconnected to connected               | Mutations succeed after reconnection; indicator hides                     | P0       |
| TC-12-09 | Banner shown during reconnecting state                                              | Reconnecting banner visible during connecting state                       | P0       |
| TC-12-10 | FM-05: Concurrent edit (last-write-wins): second update overwrites first            | No conflict UI; latest server state wins                                  | P0       |

---

### TS-13: Optimistic UI Updates

**File**: `src/hooks/use-column-mutations.test.ts` (additional describes)
**Requirement**: REQ-07 (P1)

| ID       | Test Case                                                           | Expected Result                                           | Priority |
| -------- | ------------------------------------------------------------------- | --------------------------------------------------------- | -------- |
| TC-13-01 | Add column: new row appears before emit resolves                    | setNodes called synchronously before `emitColumnCreate`   | P1       |
| TC-13-02 | Add column: optimistic column has a temporary ID (not empty)        | Optimistic column has a non-empty string id               | P1       |
| TC-13-03 | Add column success: no visible flash or re-render disruption        | State stable after server response                        | P1       |
| TC-13-04 | Edit column: new value shows immediately before emit                | Node data updated before `emitColumnUpdate`               | P1       |
| TC-13-05 | Delete column: column absent from state immediately                 | Node data updated before `emitColumnDelete`               | P1       |
| TC-13-06 | Rollback timing: error response reverts state to pre-mutation value | State matches pre-mutation snapshot after `onColumnError` | P1       |

---

### TS-14: Data Type Enum Validation

**File**: `src/data/schema.test.ts` (extend existing file)
**Requirement**: REQ-08 (P1)

| ID       | Test Case                                                  | Expected Result                                                     | Priority |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| TC-14-01 | dataTypeSchema accepts all 8 valid values                  | All pass `safeParse`                                                | P1       |
| TC-14-02 | dataTypeSchema rejects any value not in the enum           | `safeParse` returns `success: false` for "varchar", "integer", etc. | P1       |
| TC-14-03 | DATA_TYPES constant in types.ts contains exactly 8 entries | Array length is 8                                                   | P1       |
| TC-14-04 | DATA_TYPE_LABELS has exactly 8 entries matching the enum   | All enum keys have a label; no extra labels                         | P1       |

---

### TS-15: Keyboard Navigation

**File**: `src/components/whiteboard/column/InlineNameEditor.test.tsx` and `AddColumnRow.test.tsx`
**Requirement**: REQ-09 (P2)

| ID       | Test Case                                                                    | Expected Result                                                   | Priority |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| TC-15-01 | Enter/F2 when column row is focused enters edit mode on name field           | `onStartEdit(columnId, 'name')` called on Enter or F2 keydown     | P2       |
| TC-15-02 | Tab in AddColumnRow moves focus from name to type selector                   | Focus moves to DataTypeSelector after Tab from name input         | P2       |
| TC-15-03 | Enter on last field of new column row calls onCreate and opens new empty row | After `onCreate` resolves, form resets for rapid entry            | P2       |
| TC-15-04 | F2 key on a column row when no other field is editing enters name edit       | Same as Enter key shortcut                                        | P2       |
| TC-15-05 | Keyboard navigation does not conflict with React Flow canvas shortcuts       | Events stopped from propagating to React Flow via stopPropagation | P2       |

---

### TS-16: Accessibility

**File**: `src/components/whiteboard/column/ConstraintBadges.test.tsx` and `AddColumnRow.test.tsx`
**Requirement**: REQ-10 (P2)

| ID       | Test Case                                                        | Expected Result                                         | Priority |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------------- | -------- |
| TC-16-01 | PK badge has role="button" and aria-pressed                      | `role="button"` and `aria-pressed="true/false"` present | P2       |
| TC-16-02 | PK badge has descriptive aria-label                              | `aria-label` includes "primary key" and current state   | P2       |
| TC-16-03 | N badge and U badge have role="button", aria-pressed, aria-label | Same pattern as PK badge                                | P2       |
| TC-16-04 | "+" button has aria-label="Add new column"                       | `aria-label` attribute is "Add new column"              | P2       |
| TC-16-05 | Delete button has aria-label="Delete column [name]"              | Label includes column name, e.g., "Delete column email" | P2       |

---

## 4. Test Execution Order

Run suites in this order for efficient failure triage:

1. **TS-14** (schema validation) — prerequisite; if data types are wrong, everything fails
2. **TS-01** (DataTypeSelector) — depends on schema types
3. **TS-02** (InlineNameEditor) — foundational component
4. **TS-03** (ConstraintBadges) — foundational component
5. **TS-04** (AddColumnRow) — depends on DataTypeSelector + InlineNameEditor
6. **TS-05** (DeleteColumnDialog) — independent
7. **TS-06** (ColumnRow) — depends on all above column components
8. **TS-07** (useColumnMutations) — hook unit tests
9. **TS-08** (useColumnCollaboration) — hook unit tests
10. **TS-09** (ConnectionStatusIndicator) — independent component
11. **TS-10** (TableNode integration) — depends on all components
12. **TS-11** (Real-time collaboration) — depends on TS-10 passing
13. **TS-12** (Error handling) — depends on TS-10 and TS-11
14. **TS-13** (Optimistic updates) — depends on TS-07
15. **TS-15** (Keyboard navigation) — P2 last
16. **TS-16** (Accessibility) — P2 last

---

## 5. Coverage Matrix

### P0 Requirements Coverage

| Requirement                                              | Test Cases                              | Covered?                                    |
| -------------------------------------------------------- | --------------------------------------- | ------------------------------------------- |
| REQ-01 AC-01a: "+" appends row                           | TC-04-02, TC-10-01                      | Yes                                         |
| REQ-01 AC-01b: Name auto-focused                         | TC-04-03, TC-02-01                      | Yes                                         |
| REQ-01 AC-01c: dataType defaults to "string"             | TC-04-04                                | Yes                                         |
| REQ-01 AC-01d: Enter/blur persists column                | TC-04-05, TC-10-04                      | Yes                                         |
| REQ-01 AC-01e: Escape/empty discards row                 | TC-04-07, TC-04-08, TC-10-05            | Yes                                         |
| REQ-01 AC-01f: Remote users see new column               | TC-11-01                                | Yes                                         |
| REQ-01 AC-01g: "+" hidden in TABLE_NAME mode             | TC-10-03                                | Yes                                         |
| REQ-01 AC-01h: Order = max+1                             | TC-04-06                                | Yes                                         |
| REQ-01 AC-01i: Server rejection shows toast              | TC-12-01, TC-12-02                      | Yes                                         |
| REQ-02 AC-02a: Delete affordance on hover                | TC-06-06                                | Yes                                         |
| REQ-02 AC-02b: Dialog shown for columns with edges       | TC-06-08, TC-10-10                      | Yes                                         |
| REQ-02 AC-02c: AlertDialog used                          | TC-05-01                                | Yes                                         |
| REQ-02 AC-02d: Confirm deletes via deleteColumn          | TC-05-04, TC-10-10                      | Yes                                         |
| REQ-02 AC-02e: No dialog for columns with no edges       | TC-06-07, TC-10-09                      | Yes                                         |
| REQ-02 AC-02f: Remote users see deletion                 | TC-11-04                                | Yes                                         |
| REQ-02 AC-02g: FK extra warning                          | TC-05-03                                | Yes                                         |
| REQ-03 AC-03a: Double-click name -> input                | TC-06-02, TC-06-03, TC-10-06            | Yes                                         |
| REQ-03 AC-03b: Double-click type -> dropdown             | TC-06-04, TC-06-05                      | Yes                                         |
| REQ-03 AC-03c: Enter/blur saves                          | TC-02-03, TC-02-05, TC-10-06            | Yes                                         |
| REQ-03 AC-03d: Escape reverts                            | TC-02-04, TC-10-07                      | Yes                                         |
| REQ-03 AC-03e: PK badge toggles                          | TC-03-01, TC-03-03, TC-10-08            | Yes                                         |
| REQ-03 AC-03f: Nullable/unique accessible                | TC-03-05, TC-03-07                      | Yes                                         |
| REQ-03 AC-03g: Edits broadcast                           | TC-11-02, TC-11-03                      | Yes                                         |
| REQ-03 AC-03h: Empty name rejected; duplicate name error | TC-02-06, TC-12-05                      | Yes                                         |
| REQ-03 AC-03i: Save failure reverts + toast              | TC-12-04, TC-12-05                      | Yes                                         |
| REQ-03 AC-03j: Cursor classes                            | TC-06-10                                | Yes                                         |
| REQ-03 AC-03k: Tooltip on hover                          | TC-06-10                                | Yes (visual; verified via title/aria-label) |
| REQ-03 AC-03l: Enter/F2 enters edit                      | TC-15-01, TC-15-04                      | Yes (P2)                                    |
| REQ-04 AC-04a: Remote create visible                     | TC-11-01                                | Yes                                         |
| REQ-04 AC-04b: Remote edit visible                       | TC-11-02, TC-11-03                      | Yes                                         |
| REQ-04 AC-04c: Remote delete + edge removal              | TC-11-04                                | Yes                                         |
| REQ-04 AC-04d: Events include sufficient data            | TC-11-08                                | Yes                                         |
| REQ-04 AC-04e: Scoped to whiteboard namespace            | TC-11-07, TC-11-08                      | Yes                                         |
| REQ-05 AC-05a/b/c: CRUD via existing functions           | TC-07-01, TC-07-04, TC-07-07            | Yes                                         |
| REQ-05 AC-05d: Order maintained                          | TC-04-06                                | Yes                                         |
| REQ-06 AC-06a: Status indicator visible                  | TC-09-02, TC-09-03                      | Yes                                         |
| REQ-06 AC-06b: Banner when not connected                 | TC-09-02, TC-09-03                      | Yes                                         |
| REQ-06 AC-06c: Editing not blocked by WebSocket alone    | TC-12-06 (inverse: disconnected blocks) | Yes                                         |
| REQ-06 AC-06d: HTTP failure -> toast + revert            | TC-12-01, TC-12-04                      | Yes                                         |
| REQ-06 AC-06e: Sync on reconnect                         | TC-12-08                                | Yes                                         |

---

## 6. Performance Considerations

The following performance cases are noted for manual verification during implementation. They are not automated due to complexity but should be validated before feature sign-off.

| Case    | Condition                                        | Expected Behavior                                                    |
| ------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| PERF-01 | Table with 30+ columns                           | No perceptible lag during render or while typing in InlineNameEditor |
| PERF-02 | Rapid constraint toggling (10 clicks in 500ms)   | Only 2 `emitColumnUpdate` calls (250ms debounce per badge)           |
| PERF-03 | 5 concurrent users all editing different columns | All mutations persist; each user sees others' changes; no deadlock   |

---

## 7. Out-of-Scope Testing

The following are explicitly excluded from this test plan, matching the PRD Out-of-Scope section:

- Drag-to-reorder columns
- Table-level CRUD (separate feature)
- Relationship add/remove/edit
- Undo/redo
- Touch/mobile interaction
- Custom data types beyond the 8-value enum
- Column `description` field editing
- Bulk column operations

---

## 8. Definition of Done

The feature is ready to ship when:

1. All P0 test cases pass with no failures
2. All P1 test cases pass
3. No TypeScript errors (`bun run lint` clean)
4. All 10 new components/hooks have co-located test files
5. PERF-01 manually validated: 30+ columns renders without jank
6. Manual smoke test: add a column, edit its name and type, toggle PK, delete it -- all changes visible on a second connected browser tab within 500ms
