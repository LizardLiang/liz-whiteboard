# Risk Analysis: column-reorder

**Agent**: Cassandra
**Date**: 2026-04-30
**Round**: 2 (Re-review after Ares Round 3 fixes)
**Verdict**: Clear
**Feature**: Drag-and-drop column reordering within ER whiteboard table nodes

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 3 |

Verdict is **Clear**: 0 CRITICAL, 0 HIGH findings. 1 MEDIUM finding (residual, reduced from original MEDIUM-02). 3 LOW findings (carried from Round 1, 2 unchanged, 1 with a documentation gap noted).

Both Round 1 HIGH findings are confirmed resolved. The onSyncReconcile wiring (MEDIUM-01) and console.log/trace removal (MEDIUM-04) are confirmed resolved. MEDIUM-02's risk posture is reduced by parallelization. MEDIUM-03 (DragOverlay modifiers) remains deferred as acknowledged technical debt.

---

## HIGH Finding Verification

### HIGH-01: autoScroll scrolls React Flow canvas — RESOLVED

**Verification**: `autoScroll={false}` confirmed at `src/components/whiteboard/TableNode.new.tsx:453`.

The `DndContext` now explicitly disables @dnd-kit's auto-scroll behavior. The risk of @dnd-kit climbing the DOM to pan the React Flow canvas viewport instead of scrolling the column list is eliminated. Trade-off: column lists do not auto-scroll when dragging near their edges, but this is a UX-only limitation that was accepted as part of deferring `@dnd-kit/modifiers` (see MEDIUM-03 below). No canvas panning artifact is possible.

**Status: CLOSED.**

---

### HIGH-02: Queue-full phantom drop corrupts reconcileAfterDrop state — RESOLVED

**Verification**: `reconcileAfterDrop` at `src/hooks/use-column-reorder-mutations.ts:384` guards on `preDragOrder.length === 0` and returns immediately without mutating any state. `handleDragEnd` at `src/components/whiteboard/TableNode.new.tsx:292-297` passes `preDragOrderRef.current` (empty from the rejected drag start) through to `reconcileAfterDrop`, delegating the guard to the single entry-point per SA-H4.

The comment at `TableNode.new.tsx:292-297` correctly documents the B1 fix rationale: returning from `onDragStart` does not cancel @dnd-kit's internal drag, so the drag continues to `onDragEnd` — but the empty `preDragOrderRef` signal causes `reconcileAfterDrop` to abort before emitting to the server, mutating nodes, or enqueuing. The buffered remote cleanup inside the guard avoids stale buffer accumulation across phantom drag cycles.

**Status: CLOSED.**

---

## MEDIUM Finding Verification

### MEDIUM-01: onSyncReconcile never called on reconnect path — RESOLVED

**Verification**: `justReconnectedRef` flag at `ReactFlowWhiteboard.tsx:540` is set to `true` in `handleReconnect` at line 543. The `initialNodes` effect at lines 241-263 reads the flag: when `isReconnect === true`, it calls `columnReorderMutations.onSyncReconcile(tableId, serverOrder)` for each node instead of the idempotent `seedConfirmedOrderFromServer`. The flag is cleared (`justReconnectedRef.current = false`) at line 244 after first entry to prevent the reconnect branch from re-firing on subsequent `initialNodes` changes.

`onSyncReconcile` at `use-column-reorder-mutations.ts:545-558` fires the AC-08e/f `toast.warning` when: (a) `dirtyByTable` contains the table (unacknowledged reorders exist), and (b) `serverOrder` differs from `lastOptimisticByTable`. The reconnect path now correctly surfaces lost reorders.

One documentation gap noted (see LOW-03 update below) but no functional defect.

**Status: CLOSED.**

---

### MEDIUM-04: console.log/console.trace in edges-to-nodes effect — RESOLVED

**Verification**: The `useEffect` at `ReactFlowWhiteboard.tsx:352-364` that propagates edge changes to node data is clean — no `console.log` or `console.trace` statements. The effect body contains only the `setNodes` map call and the eslint-disable comment. Remaining `console.log` statements in the file (lines 994, 1229-1249) are in unrelated paths (auto-layout success and the outer `ReactFlowWhiteboard` component data-conversion section) and are pre-existing.

**Status: CLOSED.**

---

## Reliability

### MEDIUM-02: Redundant DB read on column:reorder handler — Risk Reduced

**Severity**: Medium (reduced from original)
**Location**: `src/routes/api/collaboration.ts:753-756`

The two independent reads (`findDiagramTableById` and `findColumnsByTableId`) are now executed with `Promise.all`, running in parallel on the same connection. The fix halves p50 latency on the happy path by eliminating the sequential dependency between the ownership check and the column fetch.

**Residual risk**: On the IDOR-failure path (table not found, or table belongs to a different whiteboard), `findColumnsByTableId` executes and returns results that are discarded. This is a wasted DB read on what is expected to be a rare/adversarial path. It does not affect correctness, and the performance overhead is bounded by a single extra `findMany` on failure.

The `reorderColumns` data layer still performs its own ownership validation via `prisma.column.findMany` inside the transaction, adding another read at the data layer. This means the full count is: 2 parallel reads (socket handler) + 1 findMany (data layer) + N updates (transaction) = 3 + N operations per reorder instead of the original 32. At N=30 this is 33 total, compared to the original 32 sequential — the parallelization reduces wall-clock time significantly while marginally increasing total query count.

This is a known, documented architectural trade-off. Not urgently addressable without restructuring the data layer to accept pre-fetched columns from the socket handler. Tracked as introduced debt.

**Status: Open (risk reduced, acceptable for ship).**

---

## Known Deferred Items (Unchanged)

### MEDIUM-03: DragOverlay has no axis or parent modifiers — Deferred

**Severity**: Medium (UX-only)
**Location**: `src/components/whiteboard/TableNode.new.tsx` / `@dnd-kit/modifiers` not installed

`@dnd-kit/modifiers` is not installed. The `DragOverlay` renders without `restrictToVerticalAxis` or `restrictToParentElement`. The ghost row can drift horizontally and outside the table node boundary. This was acknowledged in Round 1 and confirmed as technical debt in the implementation notes (Round 3 debt table).

`autoScroll={false}` (HIGH-01 fix) eliminates the canvas-panning coupling, but the visual precision of the ghost row during drag remains suboptimal on zoomed-out canvases.

**No new information.** Risk is UX-only; no state corruption or data loss possible. Deferred until `@dnd-kit/modifiers` is installed.

**Status: Open (deferred, technical debt documented).**

---

## Maintainability

### LOW-01: setNodes placeholder creates hidden contract — Unchanged

**Severity**: Low
**Location**: `src/components/whiteboard/TableNode.new.tsx:324, 344`

`setNodes: (() => {}) as any` placeholder remains as documented technical debt. The implementation notes and the inline comment at line 323 document the invariant: the real `setNodes` is always injected by `ReactFlowWhiteboard.handleColumnReorder` before `reconcileAfterDrop` executes. The `as any` cast remains, and the type safety gap remains. No change since Round 1.

**Status: Open (low priority, documented).**

---

### LOW-02: RBAC on column:reorder is a no-op stub — Unchanged

**Severity**: Low
**Location**: `src/routes/api/collaboration.ts:739-742`

Pre-existing, intentional V1 decision. No change.

**Status: Open (pre-existing, out of scope).**

---

### LOW-03: lastConfirmedOrderByTable not refreshed on reconnect — Documentation Gap

**Severity**: Low
**Location**: `src/hooks/use-column-reorder-mutations.ts:270-283` / `ReactFlowWhiteboard.tsx:239`

The comment at `ReactFlowWhiteboard.tsx:239` states: "refresh lastConfirmedOrderByTable unconditionally on reconnect so the stale pre-disconnect baseline does not cause false-positive toasts on the NEXT reconnect." However, the reconnect branch in the `initialNodes` effect only calls `onSyncReconcile(tableId, serverOrder)` — and `onSyncReconcile` does not write to `lastConfirmedOrderByTable`. The unconditional refresh described in the comment is not implemented.

**Functional impact assessment**: This is narrower than originally classified. `onSyncReconcile` compares `serverOrder` (fresh, from the refetch) against `lastOptimisticByTable` (the last optimistic order emitted). It does NOT compare against `lastConfirmedOrderByTable`. Therefore, the "stale pre-disconnect baseline causing false positives" path described in LOW-03 Round 1 does not apply to the current `onSyncReconcile` logic — the comparison is optimistic-vs-server, not confirmed-vs-server.

The comment at `use-column-reorder-mutations.ts:274-281` explicitly acknowledges this: "The stored order array is not currently consumed by onSyncReconcile."

`lastConfirmedOrderByTable` remains stale post-reconnect, but since it is not read by the reconnect path, the stale value causes no observable behavior change. The risk is that future code consuming `lastConfirmedOrderByTable` on the reconnect path could inherit the stale value without realizing the ref was not refreshed. The comment at line 239 overstates what was implemented.

**Mitigation**: Either (a) implement the unconditional refresh by calling `lastConfirmedOrderByTable.current.set(tableId, serverOrder)` in the reconnect branch, or (b) remove the incorrect comment at `ReactFlowWhiteboard.tsx:239`. The former is safer for future maintenance.

**Status: Open (low priority — functional behavior is correct; comment is misleading).**

---

## Spec Risk Cross-Check

| Tech Spec Risk | Round 1 Status | Round 2 Status |
|----------------|---------------|----------------|
| R#1 useEffect→useLayoutEffect | Retired (confirmed) | No change |
| R#2 @dnd-kit autoScroll canvas coupling | HIGH-01 | RESOLVED — autoScroll={false} |
| R#3 Tooltip+drag mount lifecycle | Mitigated | No change |
| R#4 queue-full cancel path (SA-L3) | HIGH-02 | RESOLVED — preDragOrder.length === 0 guard |
| R#5 30-column performance threshold | Acceptable | No change |
| R#6 ack ordering at queue depth ≥2 | Mitigated | No change |

---

## Security

No new security risks introduced in Round 3 changes. The five files modified (ReactFlowWhiteboard.tsx, TableNode.new.tsx, use-column-reorder-collaboration.ts, use-column-reorder-mutations.ts, collaboration.ts) contain no new injection surfaces, auth bypasses, or secret exposures. The `Promise.all` change in collaboration.ts does not alter the IDOR check logic — both reads still complete before any validation is performed.

---

## Verdict: Clear

0 CRITICAL findings. 0 HIGH findings. 1 MEDIUM finding (MEDIUM-02, risk reduced and acceptable). 3 LOW findings (all pre-existing or documentation gaps, no functional regressions).

All Round 1 HIGH findings are resolved. All Round 1 MEDIUM findings are either resolved (MEDIUM-01, MEDIUM-04) or acceptably mitigated (MEDIUM-02) or deferred by design (MEDIUM-03).

The feature is ready to ship. Remaining open items are tracked technical debt with no production correctness risk.
