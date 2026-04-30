# Test Plan: Column Reorder

**Feature**: column-reorder
**Author**: Artemis (QA Agent)
**Date**: 2026-04-30
**Based on**: PRD Revision 1, Tech Spec v2, Spec Review SA Round 2 (Apollo, "Sound" verdict)
**Test Framework**: Vitest + @testing-library/react (matches project conventions)
**Priority**: P1 — High

---

## 1. Overview

This plan covers the complete test surface for the column-reorder feature: drag-and-drop column reordering within a table node, persistence via transactional batch update, real-time sync to collaborators, optimistic UI with rollback, concurrent-reorder conflict notification, and reconnect-sync reconciliation.

**Total test cases: 68**
- Unit: 30
- Integration: 28
- E2E: 10

**P0 requirements covered: 9/9** (REQ-01 through REQ-07, REQ-14, REQ-15)

**High-risk areas**: `detectOverwriteConflict` intersection logic, ack vs. broadcast ordering at queue depth ≥ 2, `cancelActiveDrag` plumbing under queue-full path, `dirtyByTable` state after error rollback.

---

## 2. Requirements Coverage Matrix

| Requirement | Priority | Test IDs |
|-------------|----------|----------|
| REQ-01 Drag Handle | P0 | UT-01, UT-02, UT-03, INT-01, INT-02 |
| REQ-02 Drag Visual Feedback | P0 | UT-04, UT-05, INT-03, INT-04 |
| REQ-03 Persist Reordered Position (Transactional) | P0 | UT-06, UT-07, UT-08, INT-05, INT-06, INT-07 |
| REQ-04 Real-Time Sync | P0 | INT-08, INT-09, INT-10, INT-11, INT-12, INT-13 |
| REQ-05 Edges Re-Anchor | P0 | UT-09, INT-14 |
| REQ-06 No-Op Drop is True No-Op | P0 | UT-10, UT-11, INT-15, INT-16 |
| REQ-07 Concurrent Reorder Resolution | P0 | INT-17, INT-18, INT-19 |
| REQ-08 Optimistic UI with Reconciliation | P1 | UT-12, UT-13, INT-20, INT-21, INT-22 |
| REQ-09 Auto-Scroll (Reduced-Motion) | P1 | UT-14, INT-23 |
| REQ-10 Cancel with Escape | P1 | UT-15, INT-24 |
| REQ-12 Drag Handle Tooltip | P1 | UT-16, INT-25 |
| REQ-13 Reduced-Motion Compliance | P1 | UT-17, INT-26 |
| REQ-14 In-Flight Overwrite Notification | P0 | UT-18, UT-19, UT-20, UT-21, INT-27, INT-28 |
| REQ-15 Toast Guidance Policy | P0 | UT-22, UT-23 |
| Apollo SA notes (dirtyByTable after error, ack ordering, cancelActiveDrag, no-op reconciliation, detectOverwriteConflict boundaries) | Risk | UT-24 through UT-30, INT-27 (expanded) |

### Acceptance Criteria Coverage

Every AC listed in the PRD maps to at least one test case. See Section 5 (Suite Details) for the per-AC citation.

---

## 3. Test Suites

| Suite | Type | File | Cases | Focus |
|-------|------|------|-------|-------|
| S1: Zod Schema | Unit | `src/data/schema.test.ts` | 6 | `reorderColumnsSchema` validation |
| S2: Data Layer | Unit | `src/data/column.test.ts` | 5 | `reorderColumns()` transaction |
| S3: detectOverwriteConflict | Unit | `src/hooks/use-column-reorder-mutations.test.ts` | 9 | Intersection logic — boundary cases |
| S4: useColumnReorderMutations | Unit | `src/hooks/use-column-reorder-mutations.test.ts` | 10 | Queue, ack, error, reconcile, dirtyByTable |
| S5: Socket Handler | Integration | `src/routes/api/collaboration.test.ts` | 12 | Server handler, IDOR, FM-07 merge, broadcast |
| S6: Drag Behavior | Integration | `src/components/whiteboard/TableNode.test.tsx` | 10 | DndContext lifecycle, no-op, cancel |
| S7: Collaboration Hook | Integration | `src/hooks/use-column-reorder-collaboration.test.ts` | 6 | Buffer-on-drag, ack routing, error events |
| S8: Edge Re-Anchor | Integration | `src/components/whiteboard/ReactFlowWhiteboard.test.tsx` | 4 | updateNodeInternals timing |
| S9: No-Op Reconciliation | Integration | `src/hooks/use-column-reorder-mutations.test.ts` | 6 | AC-14f buffer flush on no-op |
| S10: E2E Flows | E2E | `tests/e2e/column-reorder.test.ts` | 10 | Full user flows, persistence, sync |

---

## 4. Test Environment

**Framework**: Vitest `^3.x` (existing, `bun run test`)
**Component testing**: `@testing-library/react` + `renderHook`
**Socket mocking**: Inline spy pattern (matches `src/routes/api/collaboration.test.ts` convention)
**E2E**: Playwright (follow pattern in `tests/e2e/` if present, else defer to integration)

**Key mocks required**:
- `vi.mock('sonner')` — toast assertions
- `vi.mock('@/data/column')` — isolate `reorderColumns` in socket handler tests
- `vi.mock('@/data/diagram-table')` — `findDiagramTableById` in IDOR tests
- `@dnd-kit` events — dispatch synthetic `DragStartEvent`, `DragEndEvent`, `DragCancelEvent` via the library's test utilities or custom event factories
- `window.matchMedia` — for `prefers-reduced-motion` tests

---

## 5. Suite Details

### Suite S1: Zod Schema (`reorderColumnsSchema`)

**File**: `src/data/schema.test.ts` (extend existing file)

| ID | Name | Priority | AC | Description |
|----|------|----------|----|-------------|
| UT-01 | valid schema parses correctly | P0 | AC-03f | `{ tableId: valid-uuid, orderedColumnIds: ['uuid1', 'uuid2'] }` — `safeParse` succeeds |
| UT-02 | rejects non-UUID tableId | P0 | AC-03f | `tableId: 'not-a-uuid'` — `safeParse` fails |
| UT-03 | rejects empty orderedColumnIds array | P0 | AC-03f | `orderedColumnIds: []` — `safeParse` fails (`.min(1)`) |
| UT-04 | rejects non-UUID entries in orderedColumnIds | P0 | AC-03f | Array containing `'not-a-uuid'` — fails |
| UT-05 | accepts array of exactly 1 UUID | P0 | AC-03f | Single-column table reorder — passes |
| UT-06 | rejects array exceeding 500 entries | Risk | AC-03f | 501-element array — fails (sanity cap) |

### Suite S2: Data Layer — `reorderColumns()`

**File**: `src/data/column.test.ts` (new file, follows `src/data/project.test.ts` pattern)

Tests use Vitest with Prisma mocked via `vi.mock('@prisma/client')`.

| ID | Name | Priority | AC | Description |
|----|------|----------|----|-------------|
| UT-07 | throws on empty orderedColumnIds | P0 | AC-03b | `reorderColumns('tbl', [])` — throws `Error('orderedColumnIds must not be empty')` |
| UT-08 | throws when any ID does not belong to tableId | P0 | AC-03f | Mock `prisma.column.findMany` returning fewer rows than input — throws |
| UT-09 | calls prisma.$transaction with one update per ID | P0 | AC-03c | N=3 columns — `$transaction` spy called once with array of 3 operations, each setting `order: index` |
| UT-10 | re-sequences to 0..N-1 | P0 | AC-03e | `orderedColumnIds: [c2, c0, c1]` — column c2 gets `order: 0`, c0 gets `order: 1`, c1 gets `order: 2` |
| UT-11 | returns updated columns in new order | P1 | AC-03a | `prisma.$transaction` spy returns mocked updated rows — function returns them |

### Suite S3: `detectOverwriteConflict` — Boundary Tests

**File**: `src/hooks/use-column-reorder-mutations.test.ts` (new file)

These tests exercise the `detectOverwriteConflict(preDragOrder, localFinal, bufferedRemote)` function exported from the hook or testable as a pure function extracted for testability. Apollo SA-H2 mandated this exact truth-table coverage.

Baseline: `preDragOrder = [A, B, C, D, E]`

| ID | Name | Priority | AC | Scenario | Expected |
|----|------|----------|----|----------|----------|
| UT-18 | disjoint moves — no toast | P0 | AC-14e | A moves C (local), B moves E (remote). `movedByA={C}`, `movedByB={E}`, `sharedMoved={}` | `false` — no overwrite |
| UT-19 | shared move, same final index — no toast | P0 | AC-14e | Both A and B move column C to slot 0. `sharedMoved={C}`, local index 0 === remote index 0 | `false` — no overwrite |
| UT-20 | shared move, different final index — toast | P0 | AC-14b | A moves C to slot 0, B moves C to slot 2. `sharedMoved={C}`, indices differ | `true` — overwrite |
| UT-21 | A moves multiple columns, B moves one shared | P0 | AC-14e | A moves C, D, E; B moves only C to a different slot. `sharedMoved={C}`, indices differ | `true` |
| UT-22 | A moves multiple columns, B moves one to same slot A did | P0 | AC-14e | A moves C to slot 0, D to slot 1; B moves C to slot 0 (same). `sharedMoved={C}`, indices match | `false` |
| UT-23 | bufferedRemote is null or undefined | P0 | AC-14a | No buffered event — no comparison attempted | `false` |
| UT-24 | preDragOrder and localFinal are identical (no-op caller) | P0 | AC-14f | Caller should not invoke this on no-op; if called defensively, A moved nothing → `movedByA={}` → `sharedMoved={}` | `false` |
| UT-25 | single-column table — column moved to same slot | P0 | AC-14e | preDrag=[A], local=[A], remote=[A] | `false` |
| UT-26 | all columns moved by both A and B, all different positions | P0 | AC-14b | Full reorder collision | `true` |

### Suite S4: `useColumnReorderMutations` — Hook State Machine

**File**: `src/hooks/use-column-reorder-mutations.test.ts` (continued)

Uses `renderHook` + `act`. Mocks: `vi.mock('sonner')`, `emitColumnReorder` as `vi.fn()`, `setNodes` as `vi.fn()`, `bumpReorderTick` as `vi.fn()`.

| ID | Name | Priority | AC | Description |
|----|------|----------|----|-------------|
| UT-12 | `isQueueFullForTable` returns false when queue is empty | P0 | AC-08d | New hook instance — `isQueueFullForTable('tbl-1')` returns `false` |
| UT-13 | `isQueueFullForTable` returns true at cap (5 pending) | P0 | AC-08d | Call `reconcileAfterDrop` 5 times with real reorders; 6th `isQueueFullForTable` → `true` |
| UT-27 | `onColumnReorderAck` at queue depth 1 — clears dirtyByTable and calls applyServerOrder on FM-07 merge | P0 | AC-08b, SA-H3 | Enqueue 1, ack arrives with merged order ≠ optimistic — `setNodes` called, `dirtyByTable` cleared |
| UT-28 | `onColumnReorderAck` at queue depth 2 — does NOT call applyServerOrder; queue head pops | P0 | SA-H3, AC-04c | Enqueue 2, first ack arrives — `setNodes` NOT called; queue depth drops to 1; second ack arrives — `setNodes` called once |
| UT-29 | `onColumnReorderAck` reverse arrival order (SA-M2 stress test) | P0 | SA-M2 | Enqueue #1 and #2; ack(#2) arrives before ack(#1) — correct end state reached without snap-back |
| UT-30 | `onColumnReorderError` reverts to preState and shows toast | P0 | AC-08c, REQ-15 | Error event → `setNodes` called with `preState`; `toast.error` spy called; `dirtyByTable` NOT cleared |
| UT-14 | `dirtyByTable` remains set after error rollback | Risk | Apollo SA note | After `onColumnReorderError`, `dirtyByTable.has('tbl-1')` is still `true` (intentional — next sync will fire toast if server diverges) |
| UT-15 | `onSyncReconcile` fires AC-08e toast when server order differs from optimistic | P0 | AC-08e | Enqueue reorder for tbl-1; simulate disconnect; `onSyncReconcile` called with server order ≠ `lastOptimistic`; `toast.warning` called once |
| UT-16 | `onSyncReconcile` does NOT fire toast when server matches optimistic | P0 | AC-08e | Same as above but server order === optimistic — no toast |
| UT-17 | `seedConfirmedOrderFromServer` sets lastConfirmedOrder only when not already present | P0 | SA-H1 | Call seed for tbl-1; verify baseline set. Call again with different order — baseline unchanged (idempotent guard) |

**Apollo SA dirtyByTable + error rollback edge case** (UT-14 above):

After `onColumnReorderError`:
- `preState` restored in `setNodes`
- `toast.error` fires
- `dirtyByTable` remains set
- If a subsequent `onSyncReconcile` runs with server order matching the pre-drag baseline (not the rolled-back optimistic), `onSyncReconcile` still sees `dirtyByTable=true` and `lastOptimistic` holding the rolled-back intent, which may differ from server order — causing a second toast.
- Test assertion: document this behavior explicitly. Either assert the second toast fires (acceptable per AC-15 wording), OR assert `dirtyByTable` is cleared on error rollback if we decide to change behavior. This test pins the current spec decision so any future change is a conscious revision.

### Suite S5: Socket Handler (`column:reorder`)

**File**: `src/routes/api/collaboration.test.ts` (extend existing file following the `relationship:delete` pattern with `buildSocketMock()`)

| ID | Name | Priority | AC | Description |
|----|------|----------|----|-------------|
| INT-05 | happy path — persists and broadcasts | P0 | AC-03a, AC-04b | Valid payload → `reorderColumns` called → `socket.broadcast.emit('column:reordered', ...)` → `socket.emit('column:reorder:ack', ...)` |
| INT-06 | IDOR — tableId in wrong whiteboard emits FORBIDDEN | P0 | AC-04f | `findDiagramTableById` returns table with different `whiteboardId` → emit FORBIDDEN error, no broadcast |
| INT-07 | unknown columnId in orderedColumnIds — emits VALIDATION_FAILED | P0 | AC-03f | One ID not in table's current columns → VALIDATION_FAILED, no broadcast, no DB write |
| INT-08 | duplicate columnId — emits VALIDATION_FAILED | P0 | AC-03f | Duplicate UUID in array → VALIDATION_FAILED |
| INT-09 | empty orderedColumnIds — Zod rejects | P0 | AC-03f | `orderedColumnIds: []` → VALIDATION_FAILED before any DB call |
| INT-10 | non-UUID tableId — Zod rejects | P0 | AC-03f | `tableId: 'bad'` → VALIDATION_FAILED |
| INT-11 | FM-07 merge — missing column appended in order | P0 | FM-07 | Client sends 4 IDs, table has 5 columns; missing column at `order=3` → `reorderColumns` called with 5 IDs, missing appended last |
| INT-12 | FM-07 merge — multiple missing columns appended in ascending existing-order | P0 | FM-07 | Client sends 3 IDs, 2 columns missing with orders 1 and 4 — appended as `order:1` first, then `order:4` |
| INT-13 | DB failure (`reorderColumns` throws) — emits UPDATE_FAILED | P0 | FM-03 | Mock `reorderColumns` to throw → UPDATE_FAILED error, no broadcast |
| INT-14 | `column:reorder:ack` payload matches the merged order | P0 | SA-H3 | FM-07 merge case — ack's `orderedColumnIds` matches the merged+re-sequenced order, not the raw client payload |
| INT-15 | session expiry short-circuits handler | Risk | security | `isSessionExpired` returns true → `socket.disconnect(true)` called, no DB access |
| INT-16 | broadcast carries `reorderedBy` field | P0 | AC-14c | `socket.broadcast.emit` called with `reorderedBy === userId` from socket auth |

### Suite S6: Drag Behavior (`TableNode` + `DndContext`)

**File**: `src/components/whiteboard/TableNode.test.tsx` (new file)

These are integration tests rendering `TableNode` with a `DndContext` and simulating drag events via `@testing-library`'s `fireEvent` or `@dnd-kit`'s test utilities.

| ID | Name | Priority | AC | Description |
|----|------|----------|----|-------------|
| INT-01 | drag handle renders on each column row | P0 | AC-01a | Render TableNode with 3 columns; assert 3 elements with `aria-label` matching `Reorder column [name]` pattern |
| INT-02 | pointer-down on non-handle area does not activate drag | P0 | AC-01e | `pointerdown` on column name span — `handleDragStart` spy NOT called |
| INT-03 | drag handle has `nodrag nowheel` classes | P0 | Spike S1 | Assert drag handle button has `className` containing both `nodrag` and `nowheel` |
| INT-04 | original row opacity is 0.5 while dragging, 1 when idle | P0 | AC-02a | Simulate drag start on column row; assert `style.opacity === '0.5'` on source row; after drag end, `opacity === '1'` |
| INT-15 | no-op drop (same slot) calls reconcileAfterDrop with no-op path | P0 | AC-06a-d | Drag column to same overId — `emitColumnReorder` spy NOT called, `setNodes` NOT called for reorder |
| INT-16 | no-op drop (return to original after hovering others) | P0 | AC-06d | Drag over rows 1 and 2, return to row 0, drop — detects as no-op (array unchanged) |
| INT-17 | Escape during drag calls handleDragCancel | P0 | AC-10a | While `activeId` is set, dispatch `keydown` Escape → `onDragCancel` fires, `activeId` cleared |
| INT-18 | cancel returns column list to pre-drag order | P0 | AC-10b | After Escape, `visibleColumns` order matches `preDragOrderRef` snapshot |
| INT-19 | queue-full at drag-start — no ghost row, toast shown | P0 | AC-08d, SA-M3 | Mock `isQueueFullForTable` to return `true`; simulate `pointerdown` — `activeId` remains `null`, `toast.warning` called, no ghost row mounted |
| INT-20 | queue-full path — cancelActiveDrag cleans up correctly (SA-L3) | Risk | SA-L3 | After queue-full early-return in `handleDragStart`, no ghost row visible, insertion line hidden, `localDraggingByTable` NOT set |

### Suite S7: Collaboration Hook (`useColumnReorderCollaboration`)

**File**: `src/hooks/use-column-reorder-collaboration.test.ts` (new file)

Follows pattern of `src/hooks/use-column-collaboration.test.ts`. Uses a mock socket.

| ID | Name | Priority | AC | Description |
|----|------|----------|----|-------------|
| INT-21 | incoming `column:reordered` while local drag is active — buffered | P0 | AC-14a, AC-07c | Set `isLocalDragging('tbl-1') = true`; emit `column:reordered` event — `bufferRemoteReorder` called, `setNodes` NOT called |
| INT-22 | incoming `column:reordered` while NOT dragging — applied directly | P0 | AC-04c | `isLocalDragging` returns false; event arrives — `onColumnReorderedFromOther` → `setNodes` called, `bumpReorderTick` called |
| INT-23 | `column:reorder:ack` routed to `onColumnReorderAck` | P0 | SA-H3 | Server emits `column:reorder:ack` — hook calls `mutations.onColumnReorderAck` with correct payload |
| INT-24 | error event `column:reorder` routed to `onColumnReorderError` | P0 | FM-01 | Server emits error `{ event: 'column:reorder', error: 'VALIDATION_FAILED' }` — hook calls `mutations.onColumnReorderError` |
| INT-25 | `column:reorder:ack` vs `column:reordered` ordering at queue depth 2 — forward order | P0 | SA-M2 | Emit #1 then #2; ack(#1) arrives, then broadcast(#2): assert correct sequential queue drain with no snap-back |
| INT-26 | ack vs broadcast — reverse arrival order stress (SA-M2) | P0 | SA-M2 | Emit #1 then #2; broadcast(#2) arrives first (while not dragging), then ack(#1): end state is correct; no stale optimistic state visible |

### Suite S8: Edge Re-Anchor (`useLayoutEffect` + `updateNodeInternals`)

**File**: `src/components/whiteboard/ReactFlowWhiteboard.test.tsx` (extend or create)

| ID | Name | Priority | AC | Description |
|----|------|----------|----|-------------|
| INT-27 | `updateNodeInternals` called after local optimistic reorder | P0 | AC-05d, SA-M1 | Trigger a reorder; assert `updateNodeInternals` spy called with the reordered `tableId` before the next paint frame (verify via `useLayoutEffect` firing synchronously after `act()`) |
| INT-28 | `updateNodeInternals` called after remote `column:reordered` applied | P0 | AC-05d | Simulate incoming `column:reordered` for tbl-1; assert `updateNodeInternals('tbl-1')` called |
| INT-29 | handle IDs are stable across reorder (no edge breakage) | P0 | AC-05b, AC-05c | After reorder of 3 columns, all edge `sourceColumnId` / `targetColumnId` values unchanged in `nodes` state |
| INT-30 | `seedConfirmedOrderFromServer` called on initial whiteboard load | P0 | SA-H1 | First `whiteboardData` query result resolves — `seedConfirmedOrderFromServer` spy called; on subsequent refetch, `onSyncReconcile` called instead |

### Suite S9: No-Op Drop Reconciliation (`reconcileAfterDrop` no-op branch)

**File**: `src/hooks/use-column-reorder-mutations.test.ts` (continued)

This suite specifically targets AC-14f — the path where A's drop is a no-op while B's remote order is buffered.

| ID | Name | Priority | AC | Description |
|----|------|----------|----|-------------|
| INT-31 | no-op drop with buffered remote — remote applied, no toast | P0 | AC-14f | Set buffer for tbl-1 via `bufferRemoteReorder`; call `reconcileAfterDrop` with `newOrder === preDragOrder` — `applyServerOrder` called with buffered order; toast NOT called |
| INT-32 | no-op drop with no buffer — silent return | P0 | AC-06c | No buffer; `reconcileAfterDrop` no-op — neither `setNodes` nor toast called |
| INT-33 | real drop with buffer, no overwrite detected — buffer cleared, no toast | P0 | AC-14e | Buffer has disjoint move from A's move; `reconcileAfterDrop` with real new order — `detectOverwriteConflict` returns false, no toast, buffer cleared, `emitColumnReorder` called |
| INT-34 | real drop with buffer, overwrite detected — toast shown | P0 | AC-14b, AC-14c | Buffer has shared moved column at different index; `reconcileAfterDrop` — `detectOverwriteConflict` returns true; `toast.info` (or equivalent) called with exact text "Another collaborator reordered columns while you were dragging. Your order was applied — theirs was overwritten." |
| INT-35 | Escape cancel with buffered remote — remote applied | P0 | AC-14f, AC-10c | `reconcileAfterDrop({ newOrder: null })` with buffer present — buffered remote applied, no toast, no DB write |
| INT-36 | queue-full faux-cancel with buffered remote — buffer not applied (drag never started) | P0 | SA-H4 | Queue-full path: `localDraggingByTable` never set; incoming `column:reordered` NOT buffered (applied directly); `reconcileAfterDrop` called with null — buffer is empty, nothing applied |

### Suite S10: E2E Flows

**File**: `tests/e2e/column-reorder.test.ts` (Playwright or manual test script)

These tests require a running server. If the project lacks a Playwright setup, Ares should add it or escalate to manual QA.

| ID | Name | Priority | AC | Description |
|----|------|----------|----|-------------|
| E2E-01 | Drag column to new position — persists on reload | P0 | AC-03a | User drags column 'email' from slot 2 to slot 0; refreshes page; column 'email' appears at slot 0 |
| E2E-02 | Reorder syncs to second browser tab (collaborator) | P0 | AC-04a | Two tabs on same whiteboard; Tab A reorders; Tab B shows new order within 500ms (localhost) |
| E2E-03 | No-op drop produces no DB write | P0 | AC-06a | Drag column, return to original slot, drop; monitor network — no WS `column:reorder` event emitted |
| E2E-04 | Escape during drag reverts to original order | P0 | AC-10a-c | Start drag; press Escape; column list matches pre-drag state; no network activity |
| E2E-05 | Drag handle tooltip appears on hover | P1 | AC-12a | Hover drag handle for 400ms+; tooltip "Drag to reorder" visible |
| E2E-06 | DB failure causes revert and error toast | P0 | AC-03b, FM-03 | Simulate DB failure (kill DB mid-drag); local order reverts; toast "Unable to save column order. Please try again." visible; no "refresh" text in toast |
| E2E-07 | Concurrent reorder — overwrite notification shown | P0 | AC-14b | Tab A mid-drag; Tab B reorders same table; Tab A drops — overwrite toast shown; both tabs converge |
| E2E-08 | FK edge re-anchors after reorder | P0 | AC-05a | Drag FK column to new position; edge visually attaches to new row position; no dangling edge |
| E2E-09 | Reduced-motion — no easing on ghost row | P1 | AC-13a | Enable `prefers-reduced-motion: reduce` via CDP; drag column; ghost follows cursor with no smoothing animation |
| E2E-10 | Queue-full — 6th drag attempt blocked with toast | P0 | AC-08d | Rapidly initiate 6 drags without awaiting ack; 6th attempt shows "Slow down — previous reorders still saving" toast; no ghost row |

---

## 6. Apollo SA Carry-Forward Test Notes

### 6.1 `dirtyByTable` after error rollback (Redundant Toast Risk)

Apollo flagged an informational edge case in the spec review: after a `VALIDATION_FAILED` or `UPDATE_FAILED` error rollback, `dirtyByTable` remains set. If the user then disconnects and reconnects, `onSyncReconcile` may fire the AC-08e toast on top of the already-shown error toast.

**Test UT-14 pins the current behavior.** The assertion is: after an error rollback, a subsequent `onSyncReconcile` with a server order matching the pre-drag baseline (not the failed optimistic) still fires a toast (because `dirtyByTable` is set and `lastOptimistic !== serverOrder`). The test documents this as **expected behavior per current spec** — the PRD's REQ-15 wording ("verify and try again") makes a redundant toast more annoying than wrong.

If Ares or Hera decide to clear `dirtyByTable` on error rollback to suppress the redundant toast, UT-14 will fail and force a conscious spec revision. That is the intent.

### 6.2 `column:reorder:ack` vs `column:reordered` at Queue Depth ≥ 2 (SA-M2)

Tests INT-25 and INT-26 implement the SA-M2 requirement. INT-25 is the forward arrival order (ack(#1) then broadcast(#2)); INT-26 is the reverse (broadcast arrives before ack). Both assert:
- No `applyServerOrder` is called while queue has pending items (SA-H3).
- Correct end state after queue drains.
- No visible optimistic snap-back.

### 6.3 `cancelActiveDrag` Plumbing (SA-L3)

Test INT-20 covers the queue-full path specifically. The test verifies:
- `activeId` is never set (drag never visually starts).
- `localDraggingByTable` is NOT marked dragging for this table.
- Incoming `column:reordered` events after queue-full are applied directly (not buffered).

Ares should note: INT-20 is a whitebox test that depends on the specific `cancelActiveDrag` implementation. If the sensor-cancel-ref approach is used, the test mock captures the ref. If synthetic Escape is used, the test dispatches a competing Escape and verifies the one-frame guard deduplicates correctly. The test should be written against whichever implementation Ares chooses, but must validate the final observable state defined above.

### 6.4 No-Op Drop Reconciliation (AC-14f) — Suite S9

Suite S9 tests the `reconcileAfterDrop` no-op branch exhaustively. INT-31 through INT-36 cover the cross-product of (no-op / real-drop / cancel) × (buffer present / no buffer). This is the highest-density edge-case cluster in the feature.

### 6.5 `detectOverwriteConflict` Boundary Tests — Suite S3

Suite S3 is a pure-function truth table covering the five distinct cases Apollo identified (SA-H2 verification):
1. Disjoint moves — no toast
2. Shared move, same final position — no toast
3. Shared move, different final position — toast
4. Partial overlap (A moved X+Y+Z, B moved only X, X ends up at same slot) — no toast
5. Full collision (all columns moved, all different positions) — toast

The function must be extractable as a pure function for unit testing (or the hook must expose it via a `__test__` export). Ares should ensure `detectOverwriteConflict` is importable in tests.

---

## 7. Edge Cases and Negative Tests

| Scenario | Suite | Test ID | Notes |
|----------|-------|---------|-------|
| Single-column table drag | S3, S5 | UT-25, INT-09 | Array of 1 — no actual reorder possible; server still persists and broadcasts |
| All columns moved (full permutation reorder) | S5, S3 | INT-05, UT-26 | All column IDs present, all orders changed — `reorderColumns` updates all rows |
| Column deleted mid-drag (FM-06) | S7 | INT-22 (extended) | `column:deleted` arrives while dragging — drag cancels; ghost disappears; no reorder emitted |
| Table with maximum 30 columns | S5, S9 | INT-05 (N=30) | Smoke test at PRD's responsiveness threshold — transaction includes 30 updates |
| `orderedColumnIds` with 500 entries (sanity cap boundary) | S1 | UT-06 | Zod `.max(500)` — 500 passes, 501 fails |
| Reconnect with no prior reorder — no spurious toast | S4 | UT-17 | `seedConfirmedOrderFromServer` + `onSyncReconcile` with unchanged order — no toast |
| `reorderedBy` field absent in broadcast (malformed server) | S7 | INT-22 | Hook must not crash if `reorderedBy` is undefined — degrade gracefully, no toast text with `undefined` name |
| Table not in `ALL_FIELDS` mode (drag handles hidden) | S6 | INT-01 (negative) | When `showMode !== 'ALL_FIELDS'`, drag handles NOT rendered (AC-01f) |

---

## 8. Toast Text Assertions

All toast text assertions must use **exact string matching** per PRD AC definitions.

| Toast | Exact Text | AC | Trigger |
|-------|-----------|-----|---------|
| VALIDATION_FAILED / FORBIDDEN | "Unable to reorder columns. Please try again." | AC-04e, FM-01 | Server validation or IDOR rejection |
| UPDATE_FAILED | "Unable to save column order. Please try again." | FM-03 | Prisma transaction failure |
| Overwrite notification | "Another collaborator reordered columns while you were dragging. Your order was applied — theirs was overwritten." | AC-14c | `detectOverwriteConflict` returns true |
| Reconnect reconcile | "Your last column reorder may not have saved. Please verify the order and try again if needed." | AC-08e | `onSyncReconcile` with dirty + diverged order |
| Queue full | "Slow down — previous reorders still saving" | AC-08d | `isQueueFullForTable` true at drag start |

**REQ-15 constraint** (AC-15a): Every error toast test must also assert that the toast text does NOT contain the substring "refresh".

---

## 9. Performance Test Cases

These are not automated by default. They are manual verification benchmarks aligned to the PRD's measurement methodology (Section 3).

| Metric | Target | Method |
|--------|--------|--------|
| Optimistic local repaint p95 | < 100ms | `performance.mark('column-reorder:drop')` at `pointerup`; `performance.mark('column-reorder:local-paint')` in next rAF that confirms new DOM order. Run 30 drops warm. |
| Collaborator sync p95 (localhost) | < 500ms | `performance.mark('column-reorder:drop')` on A; `performance.mark('column-reorder:remote-paint')` on B. Align clocks via WS RTT. 30 drops warm. |
| Collaborator sync p95 (LAN) | < 1000ms | Same methodology, two machines, same Wi-Fi. 30 drops warm. |
| No jank with 30 columns | ≥ 50fps during drag | DevTools FPS monitor or Playwright `page.metrics()` during drag of 30-column table. |

---

## 10. Accessibility Verification

| Check | Method | AC |
|-------|--------|----|
| `aria-label="Reorder column [name]"` present on handle | UT-01 assertion + screen reader smoke | AC-01d |
| Tooltip `aria-describedby` wired by Radix | INT-25 (check DOM after tooltip open) | AC-12e |
| Touch devices: no tooltip (hover state absent) | Manual on mobile / browser emulation | AC-12c |
| V1 WCAG 2.1.1 debt acknowledged | No keyboard reorder in V1 — column rows remain `tabIndex=0` for V2 readiness | REQ-11 (P2) |

---

## 11. Test File Locations (for Ares)

| File | Action | Suites |
|------|--------|--------|
| `src/data/schema.test.ts` | Extend | S1 |
| `src/data/column.test.ts` | Create | S2 |
| `src/hooks/use-column-reorder-mutations.test.ts` | Create | S3, S4, S9 |
| `src/hooks/use-column-reorder-collaboration.test.ts` | Create | S7 |
| `src/routes/api/collaboration.test.ts` | Extend | S5 |
| `src/components/whiteboard/TableNode.test.tsx` | Create | S6 |
| `src/components/whiteboard/ReactFlowWhiteboard.test.tsx` | Create or extend | S8 |
| `tests/e2e/column-reorder.test.ts` | Create | S10 |

---

## 12. Definition of Done

- [ ] All 58 unit + integration tests pass (`bun run test`).
- [ ] All 10 E2E tests pass (or explicitly deferred with documented reason).
- [ ] Zero test assertions use `contains` or `partial match` for toast text — exact string comparison only.
- [ ] `detectOverwriteConflict` is importable as a pure function for Suite S3.
- [ ] INT-20 (`cancelActiveDrag` cleanup) passes regardless of implementation strategy chosen by Ares.
- [ ] `bun run test` produces no new failures in existing test suites.
- [ ] REQ-15 constraint verified: no error toast text includes the word "refresh".

---

## Appendix A: Test Fixtures Needed

The following shared fixtures (to live in `src/test/fixtures.ts` alongside existing `mockColumn`, `mockPKColumn`, `mockFKColumn`) will accelerate multiple suites:

```typescript
// Ordered column list for reorder tests (5 columns, A-E)
export const mockOrderedColumns = [
  { id: 'col-A', name: 'id', order: 0, tableId: 'tbl-001', ... },
  { id: 'col-B', name: 'email', order: 1, tableId: 'tbl-001', ... },
  { id: 'col-C', name: 'name', order: 2, tableId: 'tbl-001', ... },
  { id: 'col-D', name: 'createdAt', order: 3, tableId: 'tbl-001', ... },
  { id: 'col-E', name: 'updatedAt', order: 4, tableId: 'tbl-001', ... },
]

// TableNode with 5 ordered columns and one FK edge
export const mockTableNodeWithEdge = makeTableNode(mockOrderedColumns)
```

These fixtures serve S3 (detectOverwriteConflict truth table), S4 (hook state machine), S6 (drag behavior), and S9 (no-op reconciliation) without duplication.

---

## Appendix B: Deferred Items

| Item | Reason | Owner |
|------|--------|-------|
| REQ-11 keyboard reorder tests | REQ-11 is P2 stretch, explicitly deferred in PRD Section 11 | Athena / future sprint |
| Touch drag tests | Out of V1 scope | Not applicable |
| Audit log / `reorderedBy` persistence tests | `reorderedBy` is payload-only in V1, not persisted to DB | Not applicable |
| Auto-scroll at viewport boundary (AC-09a) | Requires browser layout; defer to E2E or manual QA | Ares manual verification |
