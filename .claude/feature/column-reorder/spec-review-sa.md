# Spec Review (SA) — Column Reorder (Round 2)

**Reviewer**: Apollo (Architecture Review Agent)
**Date**: 2026-04-30
**Tech Spec Version**: Draft v2 (Hephaestus, 2026-04-30 — Round 1 revision)
**Based On**: PRD Revision 1 (approved 2026-04-30)
**Round 1 Verdict**: Concerns (4 HIGH, 3 MEDIUM, 2 LOW)
**Round 2 Verdict**: **Sound**

---

## Executive Summary

Hephaestus has addressed every Round 1 finding correctly and at the right level of design rigor. The four HIGH-severity findings (SA-H1 through SA-H4) — each of which was a direct PRD acceptance-criterion gap — now have explicit, testable mechanisms in the spec, and each fix has been promoted into the §5 Decisions Log with its rationale and trade-off recorded. The three MEDIUM findings are similarly resolved, with SA-M2 producing a concrete Phase 4 test case and SA-M1 / SA-M3 promoted from "open risks" into resolved decisions. Both LOW findings are also addressed (SA-L1 RBAC-stub forward-compatibility note inline at the handler; SA-L2 websocket-events.md added to Phase 1 deliverables and §7 file list).

The architecture is unchanged in shape — same library choice, same component topology, same protocol surface — which means the Round 1 "Architecture Soundness / Security / Performance / Maintainability / Integration" pass-grades carry forward intact. The revisions are surgical fixes to state-management semantics within the established design.

I performed the following Round 2 checks:

1. Re-traced each previous HIGH/MEDIUM finding against the §2.4 code blocks to verify the described fix actually implements the corrective behavior (not just a textual claim).
2. Looked for new gaps the revisions might have introduced — particularly interaction effects between SA-H1's `dirtyByTable` flag, SA-H3's defer-on-pending-ack logic, and SA-H4's `reconcileAfterDrop` single entry-point.
3. Cross-checked the §4 AC mapping for each affected criterion (AC-04c, AC-05d, AC-08d, AC-08e/f, AC-14e, AC-14f) to ensure the cited mechanism matches the §2 implementation.

No new HIGH issues. One new minor observation (SA-L3, low-severity, non-blocking) regarding `cancelActiveDrag` plumbing is recorded below — Hephaestus has already self-flagged it in §6 R#4, so no further action is required to clear the gate.

**Gate**: Open. Spec proceeds to Stage 7 (Artemis test planning).

---

## Verification of Round 1 Findings

### SA-H1 — RESOLVED ✓

**Round 1 finding**: AC-08e/f detection comparing `serverOrder` vs. `lastConfirmed` would short-circuit to `false` on the first-ever-reorder-loss case (no prior ack → `lastConfirmed === undefined`).

**Round 2 implementation** (§2.4.1 internal state, §2.4.2 enqueue, §2.4.6 reconcile):

- `lastOptimisticByTable.current.set(tableId, newOrder)` is now captured **on every enqueue** inside `reconcileAfterDrop`'s real-reorder branch (line 885).
- `dirtyByTable.current.add(tableId)` is set on every enqueue (line 886) and is the gating flag for the toast — distinct from `pendingByTable.size > 0` so it survives queue drains (e.g., error rollback during disconnect).
- `seedConfirmedOrderFromServer(tables)` populates `lastConfirmedOrder` from the server's column order on initial whiteboard load. The implementation correctly uses `if (!lastConfirmedOrder.current.has(table.id))` to avoid clobbering a more-recent ack/broadcast.
- `onSyncReconcile` now compares `serverOrder` vs. `lastOptimisticByTable.get(table.id)` gated by `dirtyByTable.has(table.id)`. The first-ever-reorder-loss case is now detected: `dirtyByTable` was set on enqueue, `lastOptimisticByTable` was captured at enqueue, and on reconcile both exist — toast fires.
- After reconcile: `lastConfirmedOrder` is updated to server truth, `lastOptimisticByTable` is cleared, `dirtyByTable` is cleared, and the FIFO is drained (since pre-disconnect emits will never receive ack).

**Verification checks**:

- The "first-ever reorder lost" trace I called out in Round 1 now flows: enqueue → `dirtyByTable.add(t)` + `lastOptimisticByTable.set(t, A's order)`. Disconnect occurs, server never receives the emit. Reconnect → refetch resolves → `onSyncReconcile` runs. `wasDirty === true`, `lastOptimistic === A's order`, `serverOrder === B's pre-A order`. Condition matches, toast fires. **Pass.**
- The "ack arrives between fetch start and seed run" race is correctly handled by the `if (!lastConfirmedOrder.current.has(table.id))` guard.
- The wiring effect (line 1265-1287) correctly distinguishes initial-load from reconnect via `previousWhiteboardData.current` ref. Initial load only seeds; subsequent refetches reconcile. **Pass.**

### SA-H2 — RESOLVED ✓

**Round 1 finding**: REQ-14 overwrite detection used `arraysEqual(buffered, newOrderedIds)`, producing false-positive toasts whenever B's reorder displaced columns A didn't touch (the dominant case in N=30 tables). Violated AC-14e.

**Round 2 implementation** (§2.4.2 `detectOverwriteConflict`):

The new function correctly implements AC-14e via column-level intersection of moved-columns:

1. `collectMovedColumnIds(baseline, after)` returns the set of columns whose index changed between baseline and after.
2. `movedByA = collectMovedColumnIds(preDragOrder, localFinal)` — what A moved.
3. `movedByB = collectMovedColumnIds(preDragOrder, bufferedRemote)` — what B moved.
4. `sharedMoved = movedByA ∩ movedByB`. If empty → `return false` (disjoint moves, no toast). **AC-14e disjoint-move case satisfied.**
5. For each shared-moved column, compare `localFinal.indexOf(id)` vs. `bufferedRemote.indexOf(id)`. If different for any shared column → `return true` (overwrite, toast). If all shared columns end at the same index → `return false`. **AC-14e same-final-position case satisfied.**

**Verification checks**:

- Disjoint-moves scenario (B moved columns A didn't touch): `sharedMoved` empty → no toast. **Pass.**
- Same-column-same-final-position scenario (both moved column X to slot 0): `sharedMoved = {X}`, indices match → no toast. **Pass.**
- Different-final-position scenario: `sharedMoved = {X}`, indices differ → toast. **Pass.**
- Edge case: A and B move the same column to the same NEW slot but A's reorder also displaces other unrelated columns. `movedByA = {X, Y, Z}`; `movedByB = {X}`; `sharedMoved = {X}`; indices match → no toast. Correct because B's intent (move X to slot 0) is preserved. **Pass.**

The §3 Phase 3 unit-test list now includes a truth-table test for `detectOverwriteConflict` covering all three branches. Good test discipline.

### SA-H3 — RESOLVED ✓

**Round 1 finding**: `applyServerOrder` on ack at queue depth ≥ 2 wiped out in-flight optimistic state for emit #2+, causing visible snap-back violating AC-04c.

**Round 2 implementation** (§2.4.3 `onColumnReorderAck`):

- After popping the head, `if (remaining.length > 0) return;` — the ack only updates `lastConfirmedOrder` and exits. **`applyServerOrder` is NOT called while the queue still has pending items.**
- Only when `remaining.length === 0` does the code (a) clear `dirtyByTable`, and (b) call `applyServerOrder` if `head.optimistic !== data.orderedColumnIds` (i.e., FM-07 merge case).
- The §5 Decisions Log records the trade-off: a sub-second window where the FM-07-merged column may not be visible until the queue drains, which is within PRD's "subsecond reconciliation" tolerance for FM-07.

**Verification checks**:

- The Round 1 failing trace (t=0 emit #1, t=50ms emit #2, ack #1 with FM-07-merged Z arrives) now resolves correctly: ack #1 pops, sees `remaining.length === 1 > 0`, returns without calling `applyServerOrder`. A's optimistic state for emit #2 (Y at slot 1) is preserved. When ack #2 arrives, queue becomes empty, and `applyServerOrder` runs once with the cumulative server-merged order. **Pass.**
- `onColumnReorderedFromOther` (§2.4.3) is correctly unaffected — a remote broadcast carries cumulative server-canonical state and supersedes optimistic view directly. The inline comment at lines 1069-1075 acknowledges the SA-M2 ordering concern explicitly.
- Phase 3 / Phase 4 test list now includes the SA-H3 explicit case ("ack at queue depth ≥ 2 does not call `applyServerOrder`; ack at queue empty does"). Good test coverage.

### SA-H4 — RESOLVED ✓

**Round 1 finding**: `handleDragEnd` returned early on no-op without flushing `bufferedRemoteByTable`, so AC-14f's "buffered remote applied to A's view in post-drop reconciliation" was never executed.

**Round 2 implementation** (§2.3.5 lifecycle handlers, §2.4.2 `reconcileAfterDrop`):

- `handleDragEnd`, `handleDragCancel`, and even the queue-full early-return path in `handleDragStart` now ALL route through `reorderMutations.reconcileAfterDrop({ tableId, preDragOrder, newOrder })`.
- `reconcileAfterDrop` always (1) clears `localDraggingByTable`; (2) on no-op or invalid/null `newOrder`, applies the buffered remote (if any) via `applyServerOrder` and clears the buffer; (3) on real reorder, runs `detectOverwriteConflict`, toasts iff overwrite detected, clears the buffer, then enqueues + emits.
- `setLocalDragging(table.id, true)` is now explicitly called in `handleDragStart` (line 613) — closing the "where is this set?" gap I flagged in Round 1.

**Verification checks**:

- AC-14f trace (A drops in original slot while B's reorder is buffered): `handleDragEnd` computes `newOrder = arrayMove(preDragOrder, oldIndex, newIndex)`. If oldIndex === newIndex, `arrayMove` returns the same order → `arraysEqual(newOrder, preDragOrder) === true` → `isNoOp = true` → buffered branch runs → `applyServerOrder(tableId, buffered)` + clear buffer + no toast. **Pass.**
- AC-10 trace (Escape during drag): `handleDragCancel` runs `reconcileAfterDrop({ newOrder: null })`. `isNoOp = true` since `!newOrder`. Buffered branch handles. **Pass.**
- Invalid drop (e.g., drop outside SortableContext, `event.over === null`): `newOrder = null` per the `if (overIdLocal && preDragOrderRef.current)` guard. `isNoOp = true`. Buffered remote applied if any. **Pass.**
- Queue-full faux-cancel path: `handleDragStart` short-circuits with `preDragOrderRef.current = null`, then `cancelActiveDrag()` is invoked. The eventual `handleDragEnd` (or `handleDragCancel` triggered by the synthetic Escape) runs with `preDragOrderRef.current = null`. In `reconcileAfterDrop`, `isNoOp = !newOrder || (preDragOrder != null && arraysEqual(...))` — since `newOrder` is null, `isNoOp` evaluates to `true` regardless of `preDragOrder` being null. The buffered branch then checks `if (buffered)` — no buffer should exist because `localDraggingByTable` was never set in this path, so `onColumnReorderedFromOther` would have applied directly. **Pass — defensive logic is correct.**

The §5 Decisions Log entry for SA-H4 records the rationale clearly. The §4 AC mapping for AC-14f correctly cites `reconcileAfterDrop`'s no-op branch.

### SA-M1 — RESOLVED ✓

**Round 1 finding**: `useEffect` for `updateNodeInternals` runs post-paint and could miss AC-05d's "same render pass" guarantee.

**Round 2 implementation** (§2.4.4):

- The hook is now `useLayoutEffect`. The §2.4.4 comment explicitly explains why (`useLayoutEffect` runs synchronously after DOM mutation but before browser paint; `useEffect` runs after paint).
- The §5 Decisions Log includes the entry "useLayoutEffect for updateNodeInternals (not useEffect) — SA-M1 resolved" with the trade-off analysis (the only theoretical downside, SSR warning, is irrelevant because ReactFlowProvider is client-only post-hydration).
- §6 R#1 from v1 has been removed (per the §6 preamble: "R#1 from v1 — useEffect timing — and R#4 from v1 — REQ-14 strict-subset detection — have been resolved in v2").

**Verification**: The §4 AC mapping for AC-05d ("Same-commit setNodes + tick bump → useLayoutEffect → updateNodeInternals (pre-paint, SA-M1)") is now consistent with the implementation. **Pass.**

### SA-M2 — RESOLVED ✓

**Round 1 finding**: Need explicit unit test for ack vs. broadcast ordering at queue depth ≥ 2.

**Round 2 implementation** (§3 Phase 4):

- New test #4: "simulate the sequence 'A emits #1 → A emits #2 → ack(#1) arrives → broadcast(#2) arrives' and assert: After ack(#1): queue depth drops from 2 to 1; `applyServerOrder` is NOT called (SA-H3); `lastConfirmedOrder` updated. After broadcast(#2) arrives while A is NOT dragging: `applyServerOrder` IS called with the cumulative order. No buffered-remote bookkeeping (since A was not mid-drag). Repeat with reverse arrival order — should still produce correct end state."
- New test #5: "A is mid-drag on table X; ack(#1) for an earlier reorder of table X arrives. Assert that no `bufferedRemoteByTable` write happens (only `column:reordered` writes there, never ack), `localDraggingByTable` is unchanged, `lastConfirmedOrder` updates, and the queue head pops correctly."

Both tests directly address my Round 1 concern. The "reverse arrival order" addition is even better than I asked for — it stress-tests the SA-H3 logic against the contract that out-of-order delivery is tolerated.

§6 R#5 documents the residual risk for Cassandra's later review. Appropriate — the Socket.IO TCP-ordering guarantee is informal and worth flagging. **Pass.**

### SA-M3 — RESOLVED ✓

**Round 1 finding**: Queue-full check should fire at `handleDragStart`, not `handleDragEnd`, to prevent phantom optimistic moves.

**Round 2 implementation** (§2.3.5, §2.4.2):

- `useColumnReorderMutations` now exposes `isQueueFullForTable(tableId): boolean` as a synchronous pre-flight check.
- `handleDragStart` calls `if (reorderMutations.isQueueFullForTable(table.id)) { toast.warning(...); ... cancelActiveDrag(); return; }` BEFORE setting `activeId` or `setLocalDragging`. The drag never visually starts (or is cancelled before drop).
- `reconcileAfterDrop` retains a defensive belt-and-suspenders check (line 867) that catches edge cases where a parallel code path enqueues — appropriately defensive.

§5 Decisions Log captures the rationale; §4 AC mapping for AC-08d cites the new gate location.

**Residual concern (SA-L3 below, not blocking)**: the `cancelActiveDrag()` plumbing is described as either a sensor-cancel ref or a synthetic Escape `keydown`. Hephaestus already self-flagged this in §6 R#4 as a Cassandra-stage risk and recommends the sensor-cancel ref pattern. I agree — synthetic-keydown collisions are subtle. This does not block the gate but should be confirmed during implementation and risk review. **Pass with note.**

### SA-L1 — RESOLVED ✓

§2.2.3 now contains the inline NOTE comment explaining `denyIfInsufficientPermission` is intentionally a no-op for V1 per OQ-3, with forward-compatibility intact. **Pass.**

### SA-L2 — RESOLVED ✓

§3 Phase 1 now includes "Documentation (SA-L2): update `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md` to document the three new events with their payloads, RBAC notes, and emit-direction semantics." §7 lists the file in "Modified" with the explanation. **Pass.**

---

## New Observations (No HIGH issues introduced)

### SA-L3 (LOW): `cancelActiveDrag` plumbing is the only remaining loose end

**Location**: §2.3.5 `handleDragStart` queue-full branch, §6 R#4

**Observation**: The spec correctly delegates the implementation choice ("sensor-cancel ref" vs. "synthetic Escape `keydown`") to Ares but flags both as risky. Hephaestus has already self-acknowledged this in §6 R#4 ("the synthetic Escape route is fragile — if the user presses Escape themselves during the same frame, the events could collide").

**No required change for the spec gate**: Hephaestus has elevated this to a Cassandra-stage risk, which is the correct disposition for an implementation-detail concern that depends on `@dnd-kit` API behavior verifiable only at integration time.

**Recommendation for Ares (informational, not blocking)**: Prefer the sensor-cancel-ref pattern over synthetic Escape. Implementation sketch — declare `const cancelActiveDragRef = useRef<(() => void) | null>(null)` in `TableNode`. Inside a custom `useSensor` wrapper, capture the sensor's `onCancel` into the ref on activation. The queue-full branch calls `cancelActiveDragRef.current?.()`. If `@dnd-kit`'s public API does not expose a stable `onCancel` reference, fall back to dispatching a `KeyboardEvent('keydown', { key: 'Escape', bubbles: true })` on the document AND set a one-frame guard ref to dedupe a colliding user-Escape — but this fallback is more complex and should only ship if the sensor-ref approach is genuinely impossible.

**Severity**: Low — implementation tactic, not architecture. Already on Cassandra's risk register.

---

### Observation on `dirtyByTable` interaction with error rollback (informational, not a finding)

**Location**: §2.4.3 `onColumnReorderError`, §2.4.6 `onSyncReconcile`

**Observation**: When the server returns `UPDATE_FAILED` for a reorder, `onColumnReorderError` rolls back to `head.preState` and pops the queue head. But it does NOT clear `dirtyByTable`. This is intentional and correct — if the user had unconfirmed reorders that errored AND then reconnects, `dirtyByTable` is still set, `lastOptimisticByTable` still holds the user's intent, and `onSyncReconcile` will fire the toast iff the server truth diverges from that intent. Good.

**Edge subcase**: After a successful rollback (server told us our reorder failed and we reverted), the user's "intent" is technically nullified — they wanted X, server said no, we reverted. If a reconnect-sync now runs, `lastOptimisticByTable[t]` still holds the (now-rolled-back) intent, and if `serverOrder` happens to match the pre-drag baseline, `arraysEqual(serverOrder, lastOptimistic) === false` → toast fires. This may produce a redundant "your last reorder may not have saved" toast on top of the already-shown error toast.

This is a minor UX wrinkle, not an architecture flaw. The PRD's REQ-15 toast wording is informational ("verify and try again"), so a redundant toast is more annoying than wrong. No spec change required, but an informational note for Artemis to consider as a test case ("after error rollback + reconnect, only one toast should fire OR redundant toasts are acceptable per AC-15 wording") would be wise.

**Severity**: Informational, not a finding. Listed here for Artemis/Hera to review during test plan and PRD alignment.

---

## Dimension Review

### Architecture Soundness — PASS

All Round 1 architectural conclusions hold. The state-management semantics are now precisely specified for every transition (drop, ack, error, broadcast, reconcile) and tested via the augmented Phase 3/4 test list. The single-entry-point reconciliation (`reconcileAfterDrop`) is a strictly better factoring than the v1 duplicated branches and reduces the chance of future divergence between drop, cancel, and queue-reject paths.

### Security — PASS

Unchanged from Round 1. The Round 2 revisions touch state-management semantics on the client; no new server surface, no new IDOR vectors, no new validation paths. The SA-L1 inline note correctly forward-references RBAC restoration without adding a security gap.

### Performance — PASS

Unchanged from Round 1. The added `lastOptimisticByTable` Map and `dirtyByTable` Set add O(N_tables) memory, negligible. `detectOverwriteConflict` is O(N_columns) per drop, well within budget at N≤30. `useLayoutEffect` over `useEffect` adds zero observable cost — both fire once per commit.

### Maintainability — PASS

Improved. The §5 Decisions Log now contains 17 entries (up from ~10 in v1) including all six SA-fix rationales. Future maintainers can read the spec and understand why each non-obvious choice was made. The §6 R#1 / R#4 retirements (formerly "open risks" now "resolved decisions") tighten the remaining risk register to 5 genuinely-open items for Cassandra.

### Integration — PASS

Unchanged from Round 1. The added `seedConfirmedOrderFromServer` and `onSyncReconcile` wiring in `ReactFlowWhiteboard` slot cleanly into the existing `handleReconnect` query-invalidation path. The `previousWhiteboardData.current` ref pattern for distinguishing initial-load from refetch is a standard React idiom.

---

## Summary

| Severity | Round 1 Count | Round 2 Count | Findings                                         |
| -------- | ------------- | ------------- | ------------------------------------------------ |
| Critical | 0             | 0             | —                                                |
| High     | 4             | **0**         | All resolved (SA-H1, SA-H2, SA-H3, SA-H4)        |
| Medium   | 3             | **0**         | All resolved (SA-M1, SA-M2, SA-M3)               |
| Low      | 2             | **1**         | SA-L1, SA-L2 resolved; SA-L3 (new, non-blocking) |

**Verdict**: **Sound**

Per Apollo's verdict thresholds: 0 critical, 0 high, 1 low (≤1 medium tolerance not even exercised). All Round 1 findings have explicit, testable corrective mechanisms. The one new low-severity observation (SA-L3 cancelActiveDrag plumbing) is already on Cassandra's risk register and is an implementation tactic, not an architecture concern.

**Gate status**: **Open**. Spec proceeds to Stage 7 (Artemis test planning).

---

## Carry-Forward Notes for Downstream Stages

For Artemis (Stage 7 test plan):

- Phase 3 / Phase 4 test cases enumerated by Hephaestus (SA-H1 through SA-M3 explicit test points) should be the seed set for the test plan; consider expanding with the FM-07-merge-during-queue-depth-2 case noted in SA-H3 verification.
- The "informational" observation about `dirtyByTable` after error rollback (above) should be acknowledged in the test plan — either as an explicit test ("redundant toast is acceptable") or as a non-issue confirmed by inspection.
- The `cancelActiveDrag` queue-full path (§2.3.5 + §6 R#4) needs at least one integration test that simulates a 6th drag attempt at queue depth 5 and asserts no optimistic ghost row appears.

For Cassandra (Stage 10 risk review):

- §6 R#4 (cancelActiveDrag plumbing — SA-L3) and §6 R#5 (Socket.IO ordering at queue depth ≥ 2 — SA-M2) are the two architecture-adjacent risks Apollo has not been able to fully retire and that depend on integration-time behavior.

For Ares (Stage 8 implementation):

- Prefer the sensor-cancel-ref pattern over synthetic-Escape for `cancelActiveDrag` (see SA-L3).
- The `previousWhiteboardData.current !== whiteboardData` guard in §2.4.6 wiring assumes TanStack Query produces a new object reference on refetch (not in-place mutation). Confirm during implementation; if Query mutates in place, switch to a content-hash or `dataUpdatedAt` comparison.

---

## References

- Round 1 review (this file's predecessor, now superseded): the v1 of this file recorded 4 HIGH + 3 MEDIUM + 2 LOW findings.
- Tech Spec under review: `.claude/feature/column-reorder/tech-spec.md` (v2, 2026-04-30)
- PRD: `.claude/feature/column-reorder/prd.md` (Revision 1)
- Decisions log: `.claude/feature/column-reorder/decisions.md` (now contains the SA Round 1 revision-requests block)
- Existing reconnect query-invalidation pattern: `src/components/whiteboard/ReactFlowWhiteboard.tsx:501-510`
- `useUpdateNodeInternals` exported from installed `@xyflow/react ^12.9.2`
- @dnd-kit/core ^6.3.1 / @dnd-kit/sortable ^10.0.0 (added in this spec)
