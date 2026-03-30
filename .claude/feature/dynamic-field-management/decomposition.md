# Decomposition: Dynamic Field Management

**Feature**: dynamic-field-management
**Agent**: Daedalus (Decomposition)
**Date**: 2026-03-30
**Input**: tech-spec.md (R1) + prd.md (Revised R1)
**Status**: Complete

---

## Summary

| | |
|---|---|
| **Phases** | 5 |
| **Tasks** | 24 |
| **Critical Path** | Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 |
| **Parallel Opportunities** | Phase 3 and Phase 4 can begin in parallel once Phase 2 is complete |

The work is entirely frontend. The backend (Prisma schema, server functions, Socket.IO column handlers) already exists and requires no modification. The decomposition reflects that dependency boundary: all phases build on existing infrastructure rather than creating new backend surfaces.

---

## Dependency Map

```
Phase 1: Foundation
    |
    +-- Phase 2: Column Editing (inline edit, constraint toggles)
            |
            +-- Phase 3: Column Creation ----------+
            |                                       |
            +-- Phase 4: Column Deletion -----------+
                                                    |
                                              Phase 5: Real-Time Sync + Error Handling
```

Phase 3 and Phase 4 both depend on Phase 2 (shared ColumnRow component and useColumnMutations hook skeleton) but do not depend on each other. They can be developed in parallel. Phase 5 depends on all mutation paths (Phases 2, 3, 4) being in place before WebSocket wiring and optimistic rollback are fully connected.

---

## Phase 1: Foundation

**Goal**: Install dependencies, define shared types, scaffold component structure, refactor TableNode to use ColumnRow without changing behavior. No new interactivity — pure structural setup.

**Depends on**: Nothing (no other phases)
**Blocks**: All subsequent phases

### What IS in this phase
- Install three missing shadcn/ui components: `alert-dialog`, `tooltip`, `dropdown-menu`
- Create `src/components/whiteboard/column/types.ts` with shared types and DATA_TYPE_LABELS constant
- Extend `TableNodeData` in `src/lib/react-flow/types.ts` with optional column mutation callbacks and `edges` prop
- Create a skeleton `ColumnRow` component that renders exactly what the current TableNode renders (column name, dataType text, existing handles) — no editing
- Refactor `TableNode.new.tsx` to map columns through `<ColumnRow>` instead of inline JSX

### What is NOT in this phase
- Any interactive editing behavior (Phase 2)
- The `AddColumnRow`, `DeleteColumnDialog`, or editor sub-components (Phases 3, 4)
- Hook creation (Phases 2+)
- WebSocket wiring (Phase 5)

### Tasks

#### Wave 1 — No dependencies within phase

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 1.1 | Install `alert-dialog`, `tooltip`, `dropdown-menu` shadcn/ui components | `src/components/ui/` | XS | 1 |
| 1.2 | Create `types.ts` with `EditingField`, `CreateColumnPayload`, `ColumnRelationship` interfaces and `DATA_TYPE_LABELS`, `DATA_TYPES` constants | `src/components/whiteboard/column/types.ts` | XS | 1 |
| 1.3 | Extend `TableNodeData` with optional `onColumnCreate`, `onColumnUpdate`, `onColumnDelete` callbacks and `edges` prop | `src/lib/react-flow/types.ts` | XS | 1 |

**Task 1.1 verify**:
```bash
ls /home/shotup/programing/react/liz-whiteboard/src/components/ui/alert-dialog.tsx && ls /home/shotup/programing/react/liz-whiteboard/src/components/ui/tooltip.tsx && ls /home/shotup/programing/react/liz-whiteboard/src/components/ui/dropdown-menu.tsx
```

**Task 1.2 verify**:
```bash
grep -n "DATA_TYPE_LABELS\|EditingField\|CreateColumnPayload" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/types.ts
```

**Task 1.3 verify**:
```bash
grep -n "onColumnCreate\|onColumnUpdate\|onColumnDelete\|edges" /home/shotup/programing/react/liz-whiteboard/src/lib/react-flow/types.ts
```

#### Wave 2 — Requires 1.2 and 1.3

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 1.4 | Create skeleton `ColumnRow` component (display only — no editing state, renders current TableNode column output with existing handles) | `src/components/whiteboard/column/ColumnRow.tsx` | S | 2 |
| 1.5 | Refactor `TableNode.new.tsx` to use `<ColumnRow>` components instead of inline column mapping | `src/components/whiteboard/TableNode.new.tsx` | S | 2 |

**Task 1.4 verify**:
```bash
grep -n "ColumnRow\|ColumnRowProps" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/ColumnRow.tsx
```

**Task 1.5 verify**:
```bash
cd /home/shotup/programing/react/liz-whiteboard && bunx tsc --noEmit 2>&1 | grep -c "error TS" | xargs -I{} sh -c '[ "{}" = "0" ] && echo "PASS: 0 TypeScript errors" || echo "FAIL: {} TypeScript errors"'
```

### Acceptance Criteria
- [ ] `bunx tsc --noEmit` reports 0 errors
- [ ] Three new shadcn/ui components installed under `src/components/ui/`
- [ ] `TableNode.new.tsx` no longer has an inline column `.map()` — delegates to `<ColumnRow>`
- [ ] Visual output of the whiteboard is identical to before this phase (no regression)

---

## Phase 2: Column Editing

**Goal**: Users can inline-edit column name, data type, and constraint badges (PK/N/U). No persistence yet — editing state is local.

**Depends on**: Phase 1 (ColumnRow skeleton, types, TableNodeData extensions)
**Blocks**: Phase 3, Phase 4 (both use the editing sub-components and the useColumnMutations hook skeleton created here)

### What IS in this phase
- `InlineNameEditor` component (text input, auto-focus, Enter/Escape/blur handling, `nodrag`/`nowheel` classes)
- `DataTypeSelector` component (shadcn Select, auto-opens, 8 valid data types, `nodrag` class)
- `ConstraintBadges` component (PK/N/U clickable badges, ARIA attributes, PK auto-sets nullable/unique rule, per-constraint 250ms debounce)
- Local editing state in `TableNode.new.tsx` (`editingField`, single-edit-at-a-time enforcement)
- Skeleton `useColumnMutations` hook with `updateColumn` function (optimistic update path, rollback placeholder — WebSocket emit not wired yet)
- Double-click handlers on name and dataType spans (`stopPropagation` to prevent React Flow drag)
- Keyboard entry to edit mode: Enter/F2 when column row is focused enters edit on name field
- Cursor styling (`cursor: text` on name/type, `cursor: pointer` on badges)
- Tooltip "Double-click to edit" on name/type spans
- CSS variables for edit highlight, hover, badge colors in `src/styles/react-flow-theme.css` (or equivalent theme file)
- `nodrag`/`nowheel` classes on all interactive elements
- React.memo comparators on ColumnRow and ConstraintBadges

### What is NOT in this phase
- Persistence (WebSocket emit) — wired in Phase 5
- Adding columns (Phase 3)
- Deleting columns (Phase 4)
- Connection status indicator (Phase 5)
- Error toasts for server failures (Phase 5)

### Tasks

#### Wave 1 — No dependencies within phase

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 2.1 | Create `InlineNameEditor` component (auto-focus, Enter commits, Escape cancels, blur commits, validates non-empty, `nodrag`/`nowheel` classes) | `src/components/whiteboard/column/InlineNameEditor.tsx` | S | 1 |
| 2.2 | Create `DataTypeSelector` component (shadcn Select, all 8 DATA_TYPES, auto-open on mount, immediate commit on selection, Escape cancels, `nodrag` class) | `src/components/whiteboard/column/DataTypeSelector.tsx` | S | 1 |
| 2.3 | Create `ConstraintBadges` component (PK/N/U always visible with active/inactive styling, FK badge non-clickable, ARIA role/pressed/label, 250ms per-constraint debounce, PK auto-sets isNullable=false + isUnique=true) | `src/components/whiteboard/column/ConstraintBadges.tsx` | M | 1 |
| 2.4 | Create skeleton `useColumnMutations` hook with `updateColumn` function (optimistic local state update, rollback function stub, no WebSocket emit yet) | `src/hooks/use-column-mutations.ts` | M | 1 |

**Task 2.1 verify**:
```bash
grep -n "onCommit\|onCancel\|autoFocus\|nodrag" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/InlineNameEditor.tsx
```

**Task 2.2 verify**:
```bash
grep -n "DATA_TYPES\|SelectContent\|nodrag" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/DataTypeSelector.tsx
```

**Task 2.3 verify**:
```bash
grep -n "aria-pressed\|isPrimaryKey\|isNullable\|isUnique\|debounce" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/ConstraintBadges.tsx
```

**Task 2.4 verify**:
```bash
grep -n "updateColumn\|pendingMutations\|rollback" /home/shotup/programing/react/liz-whiteboard/src/hooks/use-column-mutations.ts
```

#### Wave 2 — Requires 2.1, 2.2, 2.3

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 2.5 | Wire editing sub-components into `ColumnRow`: double-click handlers on name/type spans, keyboard handlers (Enter/F2 for edit mode), single-edit-at-a-time enforcement, cursor styling, tooltip on name/type | `src/components/whiteboard/column/ColumnRow.tsx` | M | 2 |
| 2.6 | Add `editingField` local state to `TableNode.new.tsx`, thread edit state + callbacks down to ColumnRow components, add CSS variables to theme file | `src/components/whiteboard/TableNode.new.tsx`, `src/styles/react-flow-theme.css` | S | 2 |

**Task 2.5 verify**:
```bash
grep -n "onDoubleClick\|stopPropagation\|editingField\|cursor-text\|cursor-pointer" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/ColumnRow.tsx
```

**Task 2.6 verify**:
```bash
grep -n "editingField\|setEditingField\|rf-column-edit-bg" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/TableNode.new.tsx
```

### Acceptance Criteria
- [ ] Double-clicking a column name shows an inline text input pre-filled with the current name
- [ ] Double-clicking a column dataType shows the Select dropdown with 8 options
- [ ] Pressing Escape reverts to the original value with no state change
- [ ] Only one field is in edit mode at a time — entering edit on a second field commits the first
- [ ] Constraint badges show PK/N/U, are clickable, toggle visually
- [ ] Clicking PK ON auto-sets N to false and U to true in local state
- [ ] `bunx tsc --noEmit` reports 0 errors
- [ ] Node dragging does not trigger when clicking/typing in editing elements

---

## Phase 3: Column Creation

**Goal**: "+" button and inline creation form allowing users to add new columns to a table.

**Depends on**: Phase 2 (ColumnRow with editing state pattern, DataTypeSelector component, useColumnMutations hook skeleton)
**Blocks**: Phase 5 (create emission wired there)

### What IS in this phase
- `AddColumnRow` component ("+" button expands to name input + DataTypeSelector, auto-focus, Enter/blur creates column, Escape discards, aria-label="Add new column", rapid entry mode auto-opens new row after create)
- `createColumn` function added to `useColumnMutations` (optimistic insert with temp ID via `crypto.randomUUID()`, `order = max(existing) + 1`, no WebSocket emit yet)
- Show `<AddColumnRow>` in `TableNode.new.tsx` when `showMode !== 'TABLE_NAME'`
- Discard new row on empty name or Escape
- Default dataType pre-set to `"string"`

### What is NOT in this phase
- WebSocket emission for create (Phase 5)
- Error toast on server rejection (Phase 5)
- Delete functionality (Phase 4)

### Tasks

#### Wave 1 — No dependencies within phase

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 3.1 | Create `AddColumnRow` component ("+" button, expandable name input + DataTypeSelector, auto-focus, Enter/blur creates, Escape discards, default type "string", `aria-label="Add new column"`, `nodrag`/`nowheel` on inputs) | `src/components/whiteboard/column/AddColumnRow.tsx` | M | 1 |
| 3.2 | Add `createColumn` function to `useColumnMutations` hook (generate temp ID, calculate `order = max + 1`, optimistic insert into node columns, store rollback, no emit yet) | `src/hooks/use-column-mutations.ts` | M | 1 |

**Task 3.1 verify**:
```bash
grep -n "AddColumnRow\|aria-label.*Add new column\|nodrag" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/AddColumnRow.tsx
```

**Task 3.2 verify**:
```bash
grep -n "createColumn\|randomUUID\|Math.max.*order" /home/shotup/programing/react/liz-whiteboard/src/hooks/use-column-mutations.ts
```

#### Wave 2 — Requires 3.1, 3.2

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 3.3 | Add `<AddColumnRow>` to `TableNode.new.tsx` (render below column list when `showMode !== 'TABLE_NAME'`, pass `createColumn` callback, `addingColumn` local state) | `src/components/whiteboard/TableNode.new.tsx` | S | 2 |

**Task 3.3 verify**:
```bash
grep -n "AddColumnRow\|showMode.*TABLE_NAME\|addingColumn" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/TableNode.new.tsx
```

### Acceptance Criteria
- [ ] Clicking "+" in ALL_FIELDS or KEY_ONLY mode appends a new editable row
- [ ] Name input is auto-focused
- [ ] Data type selector is pre-set to `"string"`
- [ ] Pressing Escape or blurring with an empty name discards the row (no column added)
- [ ] "+" button is not visible in TABLE_NAME mode
- [ ] New column appears in local node state with a temp ID
- [ ] `order` is correctly calculated as `max(existing orders) + 1`

---

## Phase 4: Column Deletion

**Goal**: Delete button per column row, with relationship-aware confirmation via AlertDialog.

**Depends on**: Phase 2 (ColumnRow component, useColumnMutations hook skeleton)
**Blocks**: Phase 5 (delete emission wired there)

### What IS in this phase
- `DeleteColumnDialog` component (shadcn AlertDialog, lists affected relationship details, FK extra warning, confirm/cancel buttons)
- Delete button in `ColumnRow` (hover-visible, `aria-label="Delete column [name]"`)
- Relationship lookup logic (pre-computed `Map<columnId, RelationshipEdgeType[]>` in TableNode from edges prop)
- `deleteColumn` function added to `useColumnMutations` (optimistic removal of column + affected edges from state, store rollback data, no WebSocket emit yet)
- Conditional flow: column has edges → show dialog; column has no edges → immediate optimistic delete
- Handle FM-06: if `editingField.columnId` matches deleted column, clear edit mode

### What is NOT in this phase
- WebSocket emission for delete (Phase 5)
- Error toast on server failure (Phase 5)

### Tasks

#### Wave 1 — No dependencies within phase

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 4.1 | Create `DeleteColumnDialog` component (shadcn AlertDialog, relationship list with sourceTableName/sourceColumnName/targetTableName/targetColumnName/cardinality, FK extra warning, destructive confirm button, cancel button) | `src/components/whiteboard/column/DeleteColumnDialog.tsx` | S | 1 |
| 4.2 | Add `deleteColumn` function to `useColumnMutations` hook (optimistic remove column from node data, optimistic remove affected edges from edge state, store rollback snapshot, no emit yet) | `src/hooks/use-column-mutations.ts` | M | 1 |

**Task 4.1 verify**:
```bash
grep -n "AlertDialog\|affectedRelationships\|destructive" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/DeleteColumnDialog.tsx
```

**Task 4.2 verify**:
```bash
grep -n "deleteColumn\|setEdges.*filter\|rollback" /home/shotup/programing/react/liz-whiteboard/src/hooks/use-column-mutations.ts
```

#### Wave 2 — Requires 4.1, 4.2

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 4.3 | Add delete button to `ColumnRow` (hover-visible, `aria-label="Delete column [name]"`, calls `onDelete(column)` prop, passes column object) and pre-compute `Map<columnId, edges[]>` in `TableNode.new.tsx` from `edges` prop | `src/components/whiteboard/column/ColumnRow.tsx`, `src/components/whiteboard/TableNode.new.tsx` | M | 2 |

**Task 4.3 verify**:
```bash
grep -n "aria-label.*Delete column\|onDelete\|columnEdgeMap\|useMemo" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/ColumnRow.tsx
```

#### Wave 3 — Requires 4.3

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 4.4 | Wire delete flow in `TableNode.new.tsx`: handle `onDelete` from ColumnRow, check pre-computed edge map, show `DeleteColumnDialog` for columns with relationships, immediate delete for columns without, handle FM-06 (clear editingField if deleted column was being edited) | `src/components/whiteboard/TableNode.new.tsx` | M | 3 |

**Task 4.4 verify**:
```bash
grep -n "DeleteColumnDialog\|columnEdgeMap\|editingField.*columnId" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/TableNode.new.tsx
```

### Acceptance Criteria
- [ ] Delete icon appears on column row hover
- [ ] Clicking delete on a column with no edges immediately removes it from local state (no dialog)
- [ ] Clicking delete on a column that appears in any edge shows AlertDialog listing affected relationships
- [ ] Confirming the dialog removes the column and its edges from local state
- [ ] Canceling the dialog makes no state change
- [ ] FK columns show the additional warning text in the dialog
- [ ] If the deleted column was being edited, edit mode is exited silently

---

## Phase 5: Real-Time Sync, WebSocket Wiring, and Error Handling

**Goal**: Wire all mutations through WebSocket (sole persistence path), handle incoming events from other users, implement optimistic rollback on server errors, add connection status indicator, and surface actionable error toasts.

**Depends on**: Phases 2, 3, 4 (all mutation paths in useColumnMutations must exist before wiring emitters)
**Blocks**: Nothing (final phase)

### What IS in this phase
- `useColumnCollaboration` hook (registers `column:created` / `column:updated` / `column:deleted` / `error` event listeners, exposes emitters `emitColumnCreate` / `emitColumnUpdate` / `emitColumnDelete`, ignores events where `createdBy/updatedBy/deletedBy === userId`, exposes `isConnected`)
- Wire WebSocket emitters into `useColumnMutations`: each mutation now emits the correct event after the optimistic update
- `isConnected` guard in all mutations: if disconnected, show toast "Not connected. Please wait for reconnection." and abort without state change
- Incoming `column:created` handler in `ReactFlowWhiteboard`: add column to node data (other users only)
- Incoming `column:updated` handler: update column in node data (other users only)
- Incoming `column:deleted` handler: remove column from node data + filter affected edges from edge state (all users, including FM-06 edit mode check)
- Temp-to-real ID replacement on originating client: on `column:created` from server (error case only — happy path keeps temp ID until sync:request)
- Server error rollback: `onColumnError` invokes the pending mutation's rollback function + shows specific error toast (duplicate name detection via Prisma P2002 error string)
- `ConnectionStatusIndicator` component (absolute-positioned top-center banner, hidden when connected, amber "Reconnecting..." when connecting, red "Disconnected" when disconnected)
- Add `useColumnCollaboration` to `ReactFlowWhiteboard`, thread `isConnected` into node data so ColumnRow can gate mutations
- Pass `edges` into node data from ReactFlowWhiteboard for the delete confirmation edge map

### What is NOT in this phase
- Any new component UI structure (all components created in Phases 1-4)
- Backend changes (all server-side already exists)

### Tasks

#### Wave 1 — No dependencies within phase

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 5.1 | Create `useColumnCollaboration` hook (registers listeners for `column:created`, `column:updated`, `column:deleted`, `error` events; exposes `emitColumnCreate`, `emitColumnUpdate`, `emitColumnDelete`; ignores own-user events; exposes `isConnected`) | `src/hooks/use-column-collaboration.ts` | M | 1 |
| 5.2 | Create `ConnectionStatusIndicator` component (banner hidden when connected, amber banner on connecting, red banner on disconnected; reads `connectionState` prop) | `src/components/whiteboard/ConnectionStatusIndicator.tsx` | S | 1 |

**Task 5.1 verify**:
```bash
grep -n "emitColumnCreate\|emitColumnUpdate\|emitColumnDelete\|column:created\|isConnected" /home/shotup/programing/react/liz-whiteboard/src/hooks/use-column-collaboration.ts
```

**Task 5.2 verify**:
```bash
grep -n "ConnectionStatusIndicator\|connectionState\|Reconnecting\|Disconnected" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/ConnectionStatusIndicator.tsx
```

#### Wave 2 — Requires 5.1 (emitters must exist before wiring into mutations)

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 5.3 | Wire WebSocket emitters into `useColumnMutations`: add `emitColumnCreate/Update/Delete` parameters, add `isConnected` guard at top of each mutation function, fire emit after optimistic update, hook up `onColumnError` rollback path with specific toast messages | `src/hooks/use-column-mutations.ts` | L | 2 |

**Task 5.3 verify**:
```bash
grep -n "isConnected\|emitColumn\|onColumnError\|Not connected" /home/shotup/programing/react/liz-whiteboard/src/hooks/use-column-mutations.ts
```

#### Wave 3 — Requires 5.1, 5.2, 5.3

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 5.4 | Integrate `useColumnCollaboration` into `ReactFlowWhiteboard`: mount hook, implement `onColumnCreated/Updated/Deleted` callbacks that update node data via `setNodes` and edge data via `setEdges`, thread `edges` into node data, add `<ConnectionStatusIndicator>` to layout | `src/components/whiteboard/ReactFlowWhiteboard.tsx` | L | 3 |

**Task 5.4 verify**:
```bash
grep -n "useColumnCollaboration\|ConnectionStatusIndicator\|onColumnCreated\|onColumnDeleted" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/ReactFlowWhiteboard.tsx
```

#### Wave 4 — Requires 5.4 (full integration must be in place before end-to-end verification)

| ID | Task | Target File(s) | Effort | Wave |
|----|------|---------------|--------|------|
| 5.5 | Add ARIA labels to all remaining interactive elements (AC-10a: constraint badges already done in Phase 2; AC-10b: AddColumnRow "+" button already done in Phase 3; AC-10c: delete button aria-label done in Phase 4) — verify all pass, add Tab navigation within new column row (AC-09a), add rapid entry mode (AC-09b: Enter on last field re-opens add row) | `src/components/whiteboard/column/AddColumnRow.tsx`, `src/components/whiteboard/column/ConstraintBadges.tsx` | S | 4 |

**Task 5.5 verify**:
```bash
grep -rn "aria-label\|aria-pressed\|role=\"button\"" /home/shotup/programing/react/liz-whiteboard/src/components/whiteboard/column/ | grep -c "aria-" | xargs -I{} sh -c '[ $(echo "{} >= 5" | bc) = "1" ] && echo "PASS: ARIA labels present" || echo "CHECK: review ARIA coverage"'
```

### Acceptance Criteria
- [ ] Creating a column on User A's browser appears on User B's browser within 500ms (manual two-tab test)
- [ ] Editing a column name on User A's browser updates the name on User B's browser
- [ ] Deleting a column on User A's browser removes it from User B's browser and removes affected edges
- [ ] When WebSocket is disconnected, mutation attempts show toast "Not connected. Please wait for reconnection." and make no state changes
- [ ] `ConnectionStatusIndicator` shows amber banner when WebSocket is connecting/reconnecting
- [ ] `ConnectionStatusIndicator` shows red banner when WebSocket is disconnected
- [ ] On server validation error (e.g., duplicate column name), the optimistic update is reverted and a specific toast appears: "Column name '[name]' already exists in this table."
- [ ] `bunx tsc --noEmit` reports 0 errors across all new and modified files

---

## Cross-Cutting Concerns

### React Flow Handle Architecture
The existing `TableNode.new.tsx` uses column-level handles (each column has a `source` handle on the right and a `target` handle on the left, with IDs containing the columnId). `ColumnRow` must preserve these handles exactly. Any renaming or restructuring of handles will break existing edges. Do not change handle ID format.

### Optimistic State Management
All mutations follow the same pattern: optimistic update first, emit second, rollback on error. The `pendingMutations` ref in `useColumnMutations` is the rollback coordination point. Each wave of Phases 3, 4, and 5 builds on this pattern — do not skip the rollback stub in Phase 2 even though it's not triggered yet.

### Memo Comparators
`ColumnRow` and `ConstraintBadges` must be wrapped in `React.memo`. The `TableNode.new.tsx` memo comparator should allow re-renders when `data.table.columns` reference changes (mutations) but skip re-renders when only position changes (dragging). This is critical for performance with 30+ columns.

### WebSocket-Only Persistence
This feature uses WebSocket-only persistence for column mutations (matching the existing table mutation pattern). The HTTP server functions in `src/routes/api/columns.ts` are NOT called by this feature. Calling them would cause double database writes. Ares must not introduce HTTP calls for column mutations.

### `nodrag` / `nowheel` Classes
Every interactive element within the column editing UI (inputs, selects, buttons) must carry both the `nodrag` and `nowheel` CSS class names. React Flow uses these to suppress drag and scroll capture. Missing these classes will cause node dragging when users click or type inside editing elements.

---

## Risk Register

| Risk | Phase | Likelihood | Impact | Mitigation |
|------|-------|-----------|--------|------------|
| shadcn Select popover clips inside React Flow node bounds | 2 | Medium | Low | Radix portal renders outside DOM — test early in Phase 2. Fall back to `dropdown-menu` if clipped. |
| Double-click intercepted by React Flow node selection | 2 | Low | Low | `stopPropagation()` on column element double-click handlers. React Flow's default double-click is on the pane, not nodes. |
| Stale edges after column deletion not cleaned up | 4, 5 | Medium | Medium | Explicitly filter edges in `onColumnDeleted` handler (TD-3 decision). Do not rely on React Flow auto-cleanup. |
| Rapid constraint toggle race conditions | 5 | Medium | Low | 250ms per-constraint debounce on emit (not on optimistic update). Implemented in ConstraintBadges (Phase 2). |
| Node re-render performance with 30+ columns | 2+ | Low | Medium | `React.memo` on ColumnRow and ConstraintBadges. Comparator on TableNode. Test with 30+ columns during Phase 2. |
| Temp ID in node state after reconnection | 5 | Low | Low | `sync:request` on reconnection reconciles all IDs. Acceptable for V1. |
