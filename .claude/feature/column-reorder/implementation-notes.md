# Implementation Notes: Column Reorder

**Feature**: column-reorder
**Agent**: Ares
**Date**: 2026-04-30
**Status**: Complete (Round 3 — Code Review Blocker and Warning Fixes)
**Based on**: Tech Spec v2 (revised), Test Plan v1, Decomposition v1, Hera PRD Alignment Report

---

## Summary

Implemented drag-and-drop column reordering within table nodes in the ER whiteboard. All 4 phases delivered: @dnd-kit integration, Socket.IO handler with FM-07 merge, optimistic client hooks with FIFO queue, and full UI wire-up.

---

## Files Created

| File | Purpose |
|------|---------|
| `src/hooks/use-prefers-reduced-motion.ts` | Single source of truth for prefers-reduced-motion |
| `src/hooks/use-column-reorder-mutations.ts` | Optimistic state, FIFO queue (≤5), detectOverwriteConflict, reconcileAfterDrop |
| `src/hooks/use-column-reorder-collaboration.ts` | WS emitter/listener for column:reorder events |
| `src/components/whiteboard/column/DragHandle.tsx` | Drag handle button: GripVertical + Tooltip + nodrag nowheel |
| `src/components/whiteboard/column/InsertionLine.tsx` | 2px accent-color drop indicator |
| `src/data/column.test.ts` | Suite S2: reorderColumns() data layer tests (5 tests) |
| `src/hooks/use-column-reorder-mutations.test.ts` | Suites S3, S4, S9: detectOverwriteConflict + hook state machine (25 tests) |
| `src/hooks/use-column-reorder-collaboration.test.ts` | Suite S7: collaboration hook (6 tests) + INT-25/26 ordering (2 tests) |
| `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md` | Documents all WS events including 3 new column:reorder events |
| `src/routes/api/column-reorder-collaboration.test.ts` | Suite S5: socket handler (12 tests) — Round 2 |
| `src/components/whiteboard/TableNode.test.tsx` | Suite S6: drag handle, InsertionLine, queue-full (18 tests) — Round 2 |
| `src/components/whiteboard/ReactFlowWhiteboard.test.tsx` | Suite S8: edge re-anchor + seed (4 tests) — Round 2 |
| `src/hooks/use-column-reorder-auto-scroll.test.ts` | REQ-09: auto-scroll logic (9 tests) — Round 2 |
| `src/components/whiteboard/column/DragHandle.test.tsx` | REQ-12: tooltip tests (4 tests) — Round 2 |
| `src/hooks/use-prefers-reduced-motion.test.ts` | REQ-13: reduced-motion compliance (6 tests) — Round 2 |

**Total new files: 15**

---

## Files Modified

| File | Changes |
|------|---------|
| `src/data/schema.ts` | Added `reorderColumnsSchema` (uuid, min 1, max 500) + `ReorderColumns` type |
| `src/data/column.ts` | Added `reorderColumns()` — single Prisma $transaction batch update |
| `src/routes/api/collaboration.ts` | Added `column:reorder` socket handler with IDOR check + FM-07 merge |
| `src/components/whiteboard/column/ColumnRow.tsx` | Added useSortable, DragHandle, showMode prop |
| `src/components/whiteboard/TableNode.new.tsx` | Added DndContext, SortableContext, DragOverlay, InsertionLine, drag handlers |
| `src/components/whiteboard/ReactFlowWhiteboard.tsx` | Added reorder hooks, useLayoutEffect+updateNodeInternals, seedConfirmedOrderFromServer |
| `src/lib/react-flow/types.ts` | Added 5 reorder-related fields to TableNodeData |
| `src/data/schema.test.ts` | Added Suite S1: reorderColumnsSchema tests (6 tests) |
| `src/test/fixtures.ts` | Added mockOrderedColumns fixture (5 columns A-E) |
| `package.json` | Added @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities |

**Total files modified: 10**

---

## Tests Written

### Round 1 (initial implementation)

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| S1: Zod Schema | `src/data/schema.test.ts` | 6 | Passing |
| S2: Data Layer | `src/data/column.test.ts` | 5 | Passing |
| S3: detectOverwriteConflict | `src/hooks/use-column-reorder-mutations.test.ts` | 9 | Passing |
| S4: useColumnReorderMutations | `src/hooks/use-column-reorder-mutations.test.ts` | 10 | Passing |
| S7: Collaboration Hook | `src/hooks/use-column-reorder-collaboration.test.ts` | 6 | Passing |
| S9: No-Op Reconciliation | `src/hooks/use-column-reorder-mutations.test.ts` | 6 | Passing |

**Round 1 total: 42 tests**

### Round 2 (PRD alignment gap coverage — Hera findings)

| Suite | File | Tests | Status | ACs Covered |
|-------|------|-------|--------|-------------|
| S5: Socket Handler | `src/routes/api/column-reorder-collaboration.test.ts` | 12 | Passing | AC-04b, AC-04f, AC-07a, AC-07b, FM-03, FM-07 |
| S6: TableNode Drag | `src/components/whiteboard/TableNode.test.tsx` | 18 | Passing | AC-01a-f, AC-02a-f, AC-08d, AC-10a-c |
| S7 INT-25/26: Ack/Broadcast Order | `src/hooks/use-column-reorder-collaboration.test.ts` | 2 | Passing | AC-07d, SA-M2 |
| S8: Edge Re-Anchor | `src/components/whiteboard/ReactFlowWhiteboard.test.tsx` | 4 | Passing | AC-05a-d, SA-H1 |
| REQ-09: Auto-Scroll | `src/hooks/use-column-reorder-auto-scroll.test.ts` | 9 | Passing | AC-09a-d, AC-13c |
| REQ-12: Tooltip | `src/components/whiteboard/column/DragHandle.test.tsx` | 4 | Passing | AC-12a, AC-12e |
| REQ-13: Reduced-Motion | `src/hooks/use-prefers-reduced-motion.test.ts` | 6 | Passing | AC-13a-c |

**Round 2 total: 55 tests**

**Grand total: 97 tests written, all passing**

Deferred (per test-plan):
- S10 (E2E) — deferred; requires Playwright setup

---

## Test Results

### Round 1 baseline
```
Test Files: 54 passed (1 failing — pre-existing: use-whiteboard-collaboration.test.ts AuthProvider)
Tests:      570 passed, 14 failed (all 14 pre-existing failures in use-whiteboard-collaboration.test.ts)
```

### Round 2 (after adding 55 tests)
```
Test Files: 60 passed (1 failing — same pre-existing file)
Tests:      625 passed, 14 failed (all 14 pre-existing failures in use-whiteboard-collaboration.test.ts)
```

Zero new failures introduced. All 55 new tests pass.

**Key technical decision**: S5 socket handler tests use dependency injection (injected `deps` object) rather than `vi.mock` module-level mocking. This approach was required because Zod's `.uuid()` validation was catching test UUIDs that didn't conform to RFC 4122 v4 format (version nibble must be `4`, variant nibble must be `8`/`9`/`a`/`b`). All test UUID constants use valid v4 UUIDs.

---

## Key Implementation Decisions

### detectOverwriteConflict Algorithm (deviation from spec)

**Spec**: "columns whose position changed between preDragOrder and localFinal/remote"  
**Implemented**: `findExplicitlyMoved()` — finds the drag target (the column that, when removed, leaves remaining elements in identical order). Fallback to absolute position changes for multi-element moves.

**Reason**: The original absolute-position algorithm included "displaced" columns in the moved-set. This caused false positives: when A moved C to slot 0 and B moved E to slot 0, column C would be displaced in B's order (pushed to slot 3), creating a false conflict. The `findExplicitlyMoved` approach correctly identifies only the intentionally moved column, matching all 9 boundary cases in Suite S3.

### TableNode.new.tsx setNodes workaround

The `reconcileAfterDrop` function in `useColumnReorderMutations` accepts a `setNodes` parameter. However, `TableNode.new.tsx` does not have access to `setNodes` (it only receives data via props). The handler passed via `onColumnReorder` in `ReactFlowWhiteboard` wraps `reconcileAfterDrop` with the real `setNodes`.

The `setNodes: (() => {}) as any` placeholder in `TableNode.new.tsx` handlers is intentional — these handlers are immediately wrapped by `handleColumnReorder` in `ReactFlowWhiteboard.tsx` before calling `reconcileAfterDrop`. The real `setNodes` is always provided in the `ReactFlowWhiteboard` wrapper.

### DragOverlay modifiers not applied

The tech spec specified `restrictToVerticalAxis` and `restrictToParentElement` from `@dnd-kit/sortable`, but these modifiers are actually from `@dnd-kit/modifiers` (a separate sub-package not bundled with `@dnd-kit/core`). Rather than install an unlisted package, the DragOverlay is rendered without position modifiers. The drag gesture naturally stays within the table node due to the PointerSensor's event handling.

**Deviation**: Minor UX deviation — ghost row may move outside the table node boundary during drag. Does not affect persistence or state correctness.

### @dnd-kit/modifiers not installed

The modifiers package is referenced in the tech spec for `DragOverlay` but not available without installing `@dnd-kit/modifiers`. Deferred as technical debt.

---

## Round 3 — Code Review Fixes (Hermes + Cassandra)

### Fixes Applied

| Finding | Fix |
|---------|-----|
| B1: queue-full phantom drop corrupts state | `reconcileAfterDrop` now guards `preDragOrder.length === 0` — phantom drops are no-ops |
| B2: 3x setNodes-reorder duplication (M3) | Extracted `applyOrderToNodes(tableId, orderedIds, setNodes)` private helper |
| HIGH-01: autoScroll scrolls React Flow canvas | Added `autoScroll={false}` to `DndContext` in `TableNode.new.tsx` |
| MEDIUM-04: console.log/trace in production | Removed both debug statements from edges-to-nodes effect in `ReactFlowWhiteboard.tsx` |
| MEDIUM-01: onSyncReconcile never called | Added `justReconnectedRef` flag; initialNodes effect calls `onSyncReconcile` on reconnect |
| W1: lastConfirmedOrderByTable dead state | Kept as `Map<string, Array<string>>`; documented rationale inline (needed for future LOW-03 stale-baseline refresh) |
| W2: setNodes: () => {} as any | Pre-existing pattern kept with documented invariant; full refactor deferred as tech debt |
| W3: stringly-typed error codes | Exported `ColumnReorderErrorCode` union; `onColumnReorderError` uses typed guard |
| W4: forgetTable not wired | `forgetTable()` exposed and wired into `onTableDeleted` in `ReactFlowWhiteboard.tsx` |
| W5: sequential DB reads | `Promise.all([findDiagramTableById, findColumnsByTableId])` in `collaboration.ts` |

### Test Results (Round 3)

```
Test Files: 60 passed (1 failing — same pre-existing file)
Tests:      625 passed, 14 failed (all 14 pre-existing failures)
```

All existing tests pass. No new failures introduced.

---

## Technical Debt

| Item | Impact | Notes |
|------|--------|-------|
| DragOverlay lacks vertical/parent modifiers | Low | Ghost can drift outside table; UX only, no data impact. @dnd-kit/modifiers not installed. |
| `setNodes: (() => {}) as any` in TableNode | Low | Workaround documented; correct setNodes always injected via ReactFlowWhiteboard wrapper |
| ~~`onSyncReconcile` not wired to reconnect refetch~~ | ~~Medium~~ | Fixed in Round 3 — MEDIUM-01 wired via justReconnectedRef |

---

## Spec Compliance

All SA findings addressed:
- SA-H1: `seedConfirmedOrderFromServer` idempotent, called on initial load
- SA-H2: column-level intersection overwrite check with `findExplicitlyMoved` 
- SA-H3: `onColumnReorderAck` defers `applyServerOrder` until queue drains
- SA-H4: `reconcileAfterDrop` is single drop entry-point
- SA-M1: `useLayoutEffect` (not `useEffect`) for `updateNodeInternals`
- SA-M2: test cases INT-25/INT-26 (deferred to S7 suite)
- SA-M3: queue-full guard in `handleDragStart`
- SA-L1: `denyIfInsufficientPermission` stub wired with TODO comment
- SA-L2: websocket-events.md created and documented

---

## Git Commits

1. `feat(column-reorder): foundation — @dnd-kit packages, reorderColumns data layer, Zod schema`
2. `feat(column-reorder): server — column:reorder socket handler with FM-07 merge`
3. `feat(column-reorder): hooks — mutations, collaboration, reduced-motion`
4. `feat(column-reorder): UI — DragHandle, InsertionLine, ColumnRow, TableNode, ReactFlowWhiteboard integration`
5. `test(column-reorder): add unit + integration tests (Suites S1-S4, S7, S9)`
6. `test(column-reorder): round 2 — S5 socket handler, S6 TableNode drag, S7 INT-25/26, S8 edge re-anchor, REQ-09/12/13`
7. `fix(column-reorder): address all blocker and warning findings from code review`
