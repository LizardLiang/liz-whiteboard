# Implementation Notes: Dynamic Field Management

**Feature**: dynamic-field-management
**Agent**: Ares (Implementation)
**Date**: 2026-03-30
**Status**: In Progress

---

## Summary

Implementing frontend inline column management for the ER diagram whiteboard. Backend is complete. All work is frontend-only.

---

## Phases

### Phase 1: Foundation
- [x] 1.1 Install alert-dialog, tooltip, dropdown-menu shadcn/ui components
- [x] 1.2 Create `src/components/whiteboard/column/types.ts`
- [x] 1.3 Extend `TableNodeData` with column mutation callbacks + edges prop
- [x] 1.4 Create skeleton `ColumnRow` component
- [x] 1.5 Refactor `TableNode.new.tsx` to use `<ColumnRow>`

### Phase 2: Column Editing
- [x] 2.1 Create `InlineNameEditor` component
- [x] 2.2 Create `DataTypeSelector` component
- [x] 2.3 Create `ConstraintBadges` component
- [x] 2.4 Create skeleton `useColumnMutations` hook
- [x] 2.5 Wire editing sub-components into `ColumnRow`
- [x] 2.6 Add `editingField` local state to `TableNode.new.tsx`

### Phase 3: Column Creation
- [x] 3.1 Create `AddColumnRow` component
- [x] 3.2 Add `createColumn` function to `useColumnMutations`
- [x] 3.3 Add `<AddColumnRow>` to `TableNode.new.tsx`

### Phase 4: Column Deletion
- [x] 4.1 Create `DeleteColumnDialog` component
- [x] 4.2 Add `deleteColumn` function to `useColumnMutations`
- [x] 4.3 Add delete button to `ColumnRow`
- [x] 4.4 Wire delete flow in `TableNode.new.tsx`

### Phase 5: Real-Time Sync
- [x] 5.1 Create `useColumnCollaboration` hook
- [x] 5.2 Create `ConnectionStatusIndicator` component
- [x] 5.3 Wire WebSocket emitters into `useColumnMutations`
- [x] 5.4 Integrate `useColumnCollaboration` into `ReactFlowWhiteboard`
- [x] 5.5 ARIA labels and rapid entry mode

---

## Files Created

- `src/components/whiteboard/column/types.ts`
- `src/components/whiteboard/column/ColumnRow.tsx`
- `src/components/whiteboard/column/InlineNameEditor.tsx`
- `src/components/whiteboard/column/DataTypeSelector.tsx`
- `src/components/whiteboard/column/ConstraintBadges.tsx`
- `src/components/whiteboard/column/AddColumnRow.tsx`
- `src/components/whiteboard/column/DeleteColumnDialog.tsx`
- `src/components/whiteboard/ConnectionStatusIndicator.tsx`
- `src/hooks/use-column-mutations.ts`
- `src/hooks/use-column-collaboration.ts`

## Files Modified

- `src/lib/react-flow/types.ts` — Added column mutation callbacks + edges prop to TableNodeData
- `src/components/whiteboard/TableNode.new.tsx` — Major rewrite with column editing
- `src/components/whiteboard/ReactFlowWhiteboard.tsx` — Integrated useColumnCollaboration + ConnectionStatusIndicator
- `src/components/ui/alert-dialog.tsx` — Installed via shadcn
- `src/components/ui/tooltip.tsx` — Installed via shadcn
- `src/components/ui/dropdown-menu.tsx` — Installed via shadcn

---

## Deviations

None. Implementation follows tech-spec.md exactly.

---

## Test Coverage

Tests written by Ares (2026-03-30) as a follow-up pass after PRD alignment found zero suites.

### Test Files Created

| File | Suite | Tests |
|------|-------|-------|
| `src/test/fixtures.ts` | Shared fixtures | — |
| `src/test/setup.ts` | Vitest setup (cleanup) | — |
| `src/components/whiteboard/ConnectionStatusIndicator.test.tsx` | TS-09 | 5 |
| `src/components/whiteboard/column/InlineNameEditor.test.tsx` | TS-02 | 8 |
| `src/components/whiteboard/column/ConstraintBadges.test.tsx` | TS-03 | 12 |
| `src/components/whiteboard/column/DataTypeSelector.test.tsx` | TS-01 | 6 |
| `src/components/whiteboard/column/DeleteColumnDialog.test.tsx` | TS-05 | 7 |
| `src/components/whiteboard/column/AddColumnRow.test.tsx` | TS-04 | 8 |
| `src/components/whiteboard/column/ColumnRow.test.tsx` | TS-06 | 10 |
| `src/hooks/use-column-mutations.test.ts` | TS-07 + TS-13 | 14 |
| `src/hooks/use-column-collaboration.test.ts` | TS-08 | 10 |

**Total tests added**: 80 (across 9 test files)
**All tests pass**: Yes (160 total pass including pre-existing 80)

### Infrastructure Changes

- Created `vitest.config.ts` — standalone Vitest config that uses `@vitejs/plugin-react` and `vite-tsconfig-paths` without the TanStack Start plugin. This was required because the `tanstackStart()` Vite plugin causes "multiple copies of React" hook errors in the test environment.
- Created `src/test/setup.ts` — registers `afterEach(cleanup)` from `@testing-library/react` so DOM is cleaned between tests.

### Mock Strategy Used

- `@xyflow/react` — mocked `Handle` (renders null) and `Position` in ColumnRow tests
- `DataTypeSelector` — mocked with plain `<select>` in AddColumnRow and ColumnRow tests to avoid Radix UI portal complexity
- `use-collaboration` — mocked entirely in `useColumnCollaboration` tests with controllable `on`/`off`/`emit`/`connectionState`
- `sonner` toast — mocked with `vi.fn()` in `useColumnMutations` tests

---

## Code Review Fixes (2026-03-30)

Addressed the BLOCKER and HIGH findings from `code-review.md` and `risk-analysis.md`.

### BLOCKER Fixed: Delete Dialog Showing UUIDs Instead of Table Names

**File**: `src/components/whiteboard/TableNode.new.tsx`

Added `useNodes` from `@xyflow/react` inside `TableNode` to get the live node list. Built a `tableNameById` memo map (`tableId → tableName`). Updated the `affectedRelationships` builder to resolve human-readable table names via the lookup map, falling back to the raw UUID only if the node is not found.

### HIGH-01: onColumnError No-Op (VERIFIED — already fixed)

**File**: `src/components/whiteboard/ReactFlowWhiteboard.tsx`

Confirmed the `onColumnErrorRef` pattern was already in place from the code review auto-fix. Lines 249, 257-259, and 281-284 show the working ref-forwarding pattern. No further action needed.

### HIGH-02 Fixed: No Reconnect Reconciliation

**Files**: `src/hooks/use-column-collaboration.ts`, `src/components/whiteboard/ReactFlowWhiteboard.tsx`

Added optional `onReconnect` callback to `UseColumnCollaborationCallbacks`. In `useColumnCollaboration`, registered a `connect` listener that fires the callback on reconnect (skipping the initial connection using `hasConnectedRef`). In `ReactFlowWhiteboardInner`, wired `handleReconnect` which calls `queryClient.invalidateQueries` for both `['whiteboard', whiteboardId]` and `['relationships', whiteboardId]`, replacing any stale optimistic state with authoritative server data.

### HIGH-03 Fixed: Duplicate React Flow Handle IDs

**Files**: `src/lib/react-flow/edge-routing.ts`, `src/lib/react-flow/convert-to-edges.ts`, `src/components/whiteboard/column/ColumnRow.tsx`

Updated `createColumnHandleId` to accept an optional 4th `type: 'source' | 'target'` parameter (defaults to `'source'` for backward compatibility). Handle ID format is now `{tableId}__{columnId}__{side}__{type}`. Updated all call sites:
- `ColumnRow.tsx`: left-source, left-target, right-source, right-target handles are now uniquely identified
- `convert-to-edges.ts`: `sourceHandle` uses `'source'` type, `targetHandle` uses `'target'` type
- `recalculateEdgeHandles`: same type-specific IDs

Updated `ColumnRow.test.tsx` mock to accept the optional 4th parameter.

### Test Results After Fixes

- 160 tests: all passing
- Build: clean (no TypeScript errors)

## Known Issues / Deferred Debt

None identified during implementation.
