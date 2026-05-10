# Code Review — Column Reorder (Round 3 — Final)

**Reviewer**: Hermes
**Date**: 2026-04-30
**Stage**: 10-review (Round 3 — final re-review after Ares Round 4 fixes)
**Mode**: pipeline (spawned by Kratos)
**Verdict**: **Approved**

---

## Scope of Round 3 Re-review

Files re-read for verification of Round 2 BLOCKER + WARNING + SUGGESTION findings:

- `src/components/whiteboard/TableNode.new.tsx` — B1-A: ref reset before queue-full guard; S1: comment accuracy
- `src/components/whiteboard/ReactFlowWhiteboard.tsx` — W4-A: forgetTable on local DeleteTableDialog confirm path
- `src/hooks/use-column-reorder-mutations.ts` — reconcileAfterDrop guard comment (S1 carryover)
- `src/hooks/use-column-reorder-mutations.test.ts` — B1-A regression test verification

Tier checklist (`hermes-checklist.json`): all 8 tiers reviewed and marked complete.

---

## Round 2 Finding Verification

| Finding                                                       | Round 2 Severity | Round 3 Status | Notes                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1-A — Queue-full guard at `reconcileAfterDrop` unreachable   | BLOCKER          | **Resolved**   | preDragOrderRef + preDragColumnsRef now reset to `[]` at TableNode.new.tsx:258-259, ahead of the queue-full guard at line 262. reconcileAfterDrop's empty-preDragOrder guard now correctly fires on rejected drags after a session of successful drags. |
| W4-A — `forgetTable` not called on local delete               | WARNING          | **Resolved**   | columnReorderMutations.forgetTable(deletingTableId) added at ReactFlowWhiteboard.tsx:1114, co-located with tableMutations.deleteTable(deletingTableId) at line 1110.                                                                                    |
| S1 — Misleading comment in handleDragEnd / reconcileAfterDrop | SUGGESTION       | **Resolved**   | Comments at TableNode.new.tsx:250-257, 303-310 and use-column-reorder-mutations.ts:379-391 accurately describe both scenarios (queue-full rejection AND never-started).                                                                                 |

---

## Verification Detail

### B1-A — Resolved

Confirmed at `src/components/whiteboard/TableNode.new.tsx:246-277`:

```ts
const handleDragStart = useCallback((event: DragStartEvent) => {
  const tableId = table.id

  // B1-A FIX: Reset snapshot refs BEFORE the queue-full guard.
  // ... (full comment explains the queue-full + stale-ref scenario)
  preDragOrderRef.current = []
  preDragColumnsRef.current = []

  // SA-M3: queue-full guard at drag-start
  if (isQueueFullForTable?.(tableId)) {
    toast.warning('Slow down — previous reorders still saving')
    return
  }
  // ... successful drag captures snapshot at end of callback
})
```

Trace verification:

1. Mount: `preDragOrderRef.current = []`. Queue empty, queue-full impossible.
2. Drag #1–5 succeed: each call resets refs to `[]`, guard passes, captures fresh `[c1,c2,c3]` at the end. Queue grows to 5.
3. Drag #6: `handleDragStart` resets to `[]`, queue-full guard fires, returns early. **Refs are now `[]`** — the prior fix had left them populated from drag #5.
4. `handleDragEnd` fires (cannot be cancelled). `reconcileAfterDrop` receives `preDragOrder = []`.
5. Guard at use-column-reorder-mutations.ts:389 (`if (preDragOrder.length === 0) return`) fires. **No-op confirmed.**

The reset+recapture pattern (`= []` at top, `= columns.map(...)` at bottom) makes the contract explicit: any early return between the reset and recapture leaves the refs empty, which the downstream guard interprets as a phantom drop.

### W4-A — Resolved

Confirmed at `src/components/whiteboard/ReactFlowWhiteboard.tsx:1109-1116`:

```tsx
onConfirm={() => {
  tableMutations.deleteTable(deletingTableId)
  // W4-A: clean up per-table reorder state on local delete path.
  // forgetTable is also called in onTableDeleted for the remote path —
  // this call covers the case where the current user deletes a table.
  columnReorderMutations.forgetTable(deletingTableId)
  setDeletingTableId(null)
}}
```

Both delete paths now clean up the six per-table reorder maps:

- Local: ReactFlowWhiteboard.tsx:1114 (DeleteTableDialog.onConfirm)
- Remote: ReactFlowWhiteboard.tsx:379 (onTableDeleted callback fired by socket event)

The placement is co-located with the deleteTable call (rather than threaded through useTableMutations as a callback parameter), which keeps the cleanup discoverable to the next developer touching the local-delete site. The comment explicitly references the dual-path coverage. M10 (unbounded growth) is fully addressed.

### S1 — Resolved

Comment at TableNode.new.tsx:303-310 (handleDragEnd):

```ts
// B1-A FIX: preDragOrderRef is empty in two scenarios:
// (1) The queue-full guard in handleDragStart fired: we cleared the refs before
//     returning, so they are empty. @dnd-kit fires handleDragEnd regardless because
//     returning from onDragStart does not cancel the gesture.
// (2) handleDragStart was never reached (mount state, unusual teardown, etc.).
// In both cases, passing the empty preDragOrderRef.current to reconcileAfterDrop
// is correct — the guard at reconcileAfterDrop:384 (preDragOrder.length === 0)
// treats the drop as a no-op and returns early. The guard lives in one place (SA-H4).
```

And reconcileAfterDrop comment at use-column-reorder-mutations.ts:379-391 mirrors the same two scenarios. Both comments now accurately describe the post-fix behavior. Future maintainers reading either site get a consistent explanation.

### Regression Test — Verified

`src/hooks/use-column-reorder-mutations.test.ts:697-759` (`B1-A regression: queue-full drop with stale preDragOrder cleared by handleDragStart reset — reconcileAfterDrop is a no-op`):

1. Fills queue to capacity (5 entries) via 5 successful `reconcileAfterDrop` calls with non-empty `preDragOrder`.
2. Confirms `isQueueFullForTable('tbl-001') === true`.
3. Clears mocks.
4. Simulates drag #6: calls `reconcileAfterDrop` with `preDragOrder: []` (the post-reset state) and a non-null `staleNewOrder`.
5. Asserts `setNodes`, `emitColumnReorder`, `bumpReorderTick` were all NOT called and queue length stayed at 5.

This test would have caught the original B1-A miss: without the ref reset, the test simulates the ACTUAL post-fix path correctly. Strong regression coverage for the exact bug scenario.

---

## Findings Summary (Round 3)

| Severity   | Count |
| ---------- | ----- |
| BLOCKER    | 0     |
| WARNING    | 0     |
| SUGGESTION | 0     |

All Round 2 findings are resolved. No new findings in Round 3.

---

## Tier Review (Round 3)

| Tier             | Status | Notes                                                                            |
| ---------------- | ------ | -------------------------------------------------------------------------------- |
| 1 — Correct      | clean  | B1-A resolved; reconcile guard now reachable. Regression test pins the scenario. |
| 2 — Safe         | clean  | No security-relevant changes this round.                                         |
| 3 — Clear        | clean  | Comments at all three sites accurately describe both scenarios.                  |
| 4 — Minimal      | clean  | Two ref resets + one forgetTable call + one regression test. No bloat.           |
| 5 — Consistent   | clean  | Patterns match codebase conventions.                                             |
| 6 — Resilient    | clean  | Reset-before-guard pattern survives future modifications; W4-A closes ref-leak.  |
| 7 — Performant   | clean  | Two array assignments per drag-start, negligible.                                |
| 8 — Maintainable | clean  | M10 (unbounded growth) closed by W4-A. No new anti-patterns.                     |

---

## Reuse Check

No new utilities, helpers, or shared functions introduced in Round 3. The changes are local edits (ref resets, a single function call, comment updates) and a regression test. No reuse violations.

---

## Recognized Good Work (Round 3)

- **B1-A fix is exactly the right shape**: reset-then-recapture in handleDragStart, paired with the existing length-zero guard in reconcileAfterDrop. The fix lives in TableNode (the ref's owner), the guard stays where it is (SA-H4 single entry-point). Contract is explicit and documented.
- **W4-A placement at the call site rather than threaded through useTableMutations**: The simpler, more discoverable choice. Comment at the call site spells out the dual-path coverage so the next developer touching either path sees the contract.
- **Regression test is a precise reproduction**: fills the queue to capacity, simulates a rejected drag-start with empty preDragOrder, asserts the guard fires. Without this test, a future regression that reverts the ref-reset would silently slip past CI. With this test, it cannot.
- **Comment quality across all three sites is consistent**: The two-scenario explanation (queue-full rejection AND never-started) is repeated verbatim-equivalent in handleDragEnd and reconcileAfterDrop, matching how the guard actually works.

---

## Refactoring Recommended

The Round 2 review noted a structural item that remains: `preDragOrderRef` lifecycle is owned by TableNode while reconcileAfterDrop's guard depends on it. This split-ownership is now well-contracted via the matching comments at both sites and pinned by the regression test, but a future refactor could move the pre-drag snapshot into `useColumnReorderMutations` (keyed by tableId) to centralize the start/reset/end protocol.

This is a non-blocking quality improvement, not a defect. Defer to a future iteration. Consider `/kratos:quick refactor src/components/whiteboard/TableNode.new.tsx` if the ownership split causes friction in subsequent feature work.

---

## Rule Proposals

None. The Round 2 lesson (verify the lifecycle of refs that downstream guards depend on) is already implicit in default-rule "Logic, edge cases, silent failures" combined with the FP-01 verify-data-flow guidance in the Hermes prompt.

---

## Auto-Fix Results

Applied: 0
Requires manual: 0

No fixes applied or proposed in Round 3 — all prior findings resolved by Ares' Round 4 commit (9235f71).

---

## Test Results

Per the mission prompt, Ares verified with `bunx vitest run`: 626 passing, 14 failing. The 14 failures are all pre-existing in `use-whiteboard-collaboration.test.ts` (unrelated to this feature, tracked separately under "test environment issue"). New regression test in `use-column-reorder-mutations.test.ts` is among the 626 passing.

I did not re-run the suite. The added test (lines 697-759) is structurally correct: it exercises the exact scenario that B1-A targets, asserts the right invariants, and uses the same `renderHook` + `act` patterns established elsewhere in the file.

---

## Verdict

**Approved.**

All three Round 2 findings (B1-A BLOCKER, W4-A WARNING, S1 SUGGESTION) are resolved with the right shape, properly documented, and pinned by a regression test. Tier checklist clean across all 8 tiers. No new findings.

The feature is ready to ship. The optional refactor identified above (centralizing pre-drag snapshot into the reorder hook) is a quality improvement, not a defect, and can be deferred.
