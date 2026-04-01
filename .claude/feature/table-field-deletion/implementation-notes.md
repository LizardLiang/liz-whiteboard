# Implementation Notes: table-field-deletion

**Agent**: Ares (Implementation Agent)
**Date**: 2026-04-01
**Feature**: table-field-deletion
**Branch**: feature/dynamic-field-management

---

## Summary

Implemented the table & field deletion feature entirely on the frontend. The backend (data layer, server function, WebSocket events) was already complete. Followed the 4-wave decomposition plan.

**Files Created**: 4
**Files Modified**: 5
**Tests**: All pre-existing 240 pass; 1 pre-existing failure in ConstraintBadges (pre-dates this feature, see Deferred Debt)

---

## Wave A — Foundation (Tasks 1.1-1.5, 4.1)

All 6 tasks completed and verified.

### Task 1.1 — Install shadcn context-menu
- Ran `bunx shadcn@latest add context-menu`
- Created: `src/components/ui/context-menu.tsx`

### Task 1.2 — Add `onRequestTableDelete` to `TableNodeData`
- Modified: `src/lib/react-flow/types.ts`
- Added optional callback `onRequestTableDelete?: (tableId: string) => void` after `onColumnDelete`

### Task 1.3 — Create `useTableMutations` hook
- Created: `src/hooks/use-table-mutations.ts`
- Mirrors `useColumnMutations` pattern with `pendingMutations` ref (Map<tableId, PendingTableMutation>)
- `deleteTable`: guards `isConnected`, captures node + edges, optimistic remove, stores rollback, emits via WebSocket
- `onTableError`: rolls back by re-inserting node (with existence check) and edges, shows toast
- Rollback guard: checks `prev.some(n => n.id === tableId)` before re-inserting to handle concurrent remote deletion

### Task 1.4 — Create `useTableDeletion` hook
- Created: `src/hooks/use-table-deletion.ts`
- Registers document-level `keydown` listener in `useEffect`
- Guards: key must be Delete/Backspace; not in input/textarea/contenteditable; no `.column-row` or `.add-column-row` ancestor
- Uses `useReactFlow().getNodes()` to read selected nodes; acts only if exactly 1 is selected
- Must be used inside ReactFlowProvider

### Task 1.5 — Extend `useWhiteboardCollaboration`
- Modified: `src/hooks/use-whiteboard-collaboration.ts`
- Added parameters: `onTableDeleted?: (tableId: string) => void`, `onTableError?: (data: TableErrorEvent) => void`
- Added `table:deleted` listener that ignores own events (deletedBy === userId)
- Added `error` listener filtered by `event === 'table:delete'` (SA-M1 cross-contamination prevention)
- Added `emitTableDelete(tableId)` emitter
- Removed stale unused imports (`Edge`, `Node`, `RelationshipEdgeType`, `TableNodeType` from @xyflow/react)

### Task 4.1 — ColumnRow Delete key handler
- Modified: `src/components/whiteboard/column/ColumnRow.tsx`
- Added `Delete` key branch in `handleKeyDown` with `!isEditing` guard
- `e.stopPropagation()` for React synthetic event propagation
- CSS class guard in `useTableDeletion` handles native document listener priority (AD-5)

---

## Wave B — UI Components (Tasks 2.1, 2.2)

Both tasks completed and verified.

### Task 2.1 — `DeleteTableDialog`
- Created: `src/components/whiteboard/DeleteTableDialog.tsx`
- Mirrors `DeleteColumnDialog` pattern with shadcn `AlertDialog`
- Shows table name, column count, and relationship list (conditional)
- `open` always `true` (parent mounts/unmounts to control)
- Cancel auto-focused (Radix AlertDialog default)
- Escape key handled via `onOpenChange`

### Task 2.2 — `TableNodeContextMenu`
- Created: `src/components/whiteboard/TableNodeContextMenu.tsx`
- Wraps `ContextMenuTrigger asChild` around children
- Single "Delete table" item with `className="text-destructive focus:text-destructive"` and `ContextMenuShortcut` Del hint
- No coordinate transformation needed (Radix portal uses browser page coordinates)

---

## Wave C — Node & Orchestration Wiring (Tasks 3.1, 3.2)

### Task 3.1 — Modify `TableNode.new.tsx`
- Modified: `src/components/whiteboard/TableNode.new.tsx`
- Imported `TableNodeContextMenu` and destructured `onRequestTableDelete` from data
- Added `handleRequestTableDelete` callback (calls `data.onRequestTableDelete?.(table.id)`)
- Wrapped root div with `<TableNodeContextMenu onDeleteTable={handleRequestTableDelete}>`
- Added `onRequestTableDelete` to memo comparator

### Task 3.2 — `ReactFlowWhiteboard.tsx` hooks + state
- Modified: `src/components/whiteboard/ReactFlowWhiteboard.tsx`
- Added `deletingTableId: string | null` state
- Added `onTableDeleted` callback (removes node + edges from state, closes dialog if matching)
- Added `onTableErrorRef` to break circular dependency (pattern from `onColumnErrorRef`)
- Extended `useWhiteboardCollaboration` call with new params + destructured `emitTableDelete`
- Instantiated `useTableMutations` with `(setNodes, setEdges, emitTableDelete, isConnected)`
- Wired `onTableError` ref after `tableMutations` available
- Called `useTableDeletion` with `setDeletingTableId`

---

## Wave D — Dialog Render + Callback Injection (Task 3.3)

### Task 3.3 — `ReactFlowWhiteboard.tsx` dialog + injection
- Added `handleRequestTableDelete` callback opening dialog via `setDeletingTableId`
- Added `handleRequestTableDeleteRef` following existing ref pattern (stable identity for effects)
- Injected `onRequestTableDelete` into node data in both the `isConnected` effect and the mount effect
- Preserved `onRequestTableDelete` in the `initialNodes` refetch preservation effect
- Computed `deletingNode` and `tableDeleteAffectedRelationships` (useMemo) from current nodes/edges
- Rendered `<DeleteTableDialog>` conditionally on `deletingTableId && deletingNode`
- `onConfirm`: calls `tableMutations.deleteTable(deletingTableId)` then clears state (double-emit guard via dialog unmount)
- `onCancel`: clears `deletingTableId`

---

## Deviations from Tech Spec

None. All changes follow the spec precisely.

---

## Deferred Technical Debt

### Pre-existing: ConstraintBadges TC-03-04b test failure
- **Status**: Pre-existed before this feature; present in working tree before Wave A started
- **What**: `ConstraintBadges.tsx` was already modified (unstaged) to emit only 1 WebSocket event for PK toggle instead of 3. The test TC-03-04b expects the old 3-emit behavior.
- **Not caused by this feature**: Confirmed by running `git stash` (reverts working tree to committed ConstraintBadges) and observing the test passes with the committed code.
- **Action needed**: Update the test to match the new single-emit design, or revert the ConstraintBadges change and handle cascade in TableNode only.

---

## Architecture Notes

### Ref pattern for circular dependency
The `onTableErrorRef` follows the same pattern as `onColumnErrorRef` in `ReactFlowWhiteboard`: `useWhiteboardCollaboration` needs the error callback but `useTableMutations` provides it. A ref breaks this circular dependency by providing a stable wrapper that delegates to the current mutation function.

### Dialog at orchestration level (AD-1)
`DeleteTableDialog` renders at `ReactFlowWhiteboardInner` level, not inside `TableNode`. This allows the dialog to read the full nodes/edges state for computing affected relationships, and avoids prop-drilling dialog state through the memo boundary.

### CSS class guard for keyboard priority (AD-5)
The `useTableDeletion` hook checks `active.closest('.column-row')` so that Delete on a focused column row triggers the React `onKeyDown` (column deletion) rather than table deletion. React's `stopPropagation()` would not stop the native document listener.

---

## Test Results

- All 240 pre-existing tests pass
- 1 pre-existing test failure: ConstraintBadges TC-03-04b (not caused by this feature)
- No new test failures introduced
