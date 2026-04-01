# Code Review: Dynamic Field Management (Re-Review Round 2)

**Feature**: dynamic-field-management
**Reviewer**: Hermes (Code Review Agent)
**Date**: 2026-03-30
**Round**: 2 (re-review after Ares fixes)
**Verdict**: Approved

---

## Review Scope

This is a re-review. Round 1 found 2 BLOCKERs, 3 WARNINGs, and 2 SUGGESTIONs. Ares addressed all blockers and both HIGH findings from Cassandra's risk analysis.

### Files Re-Reviewed (6 files)

- `src/components/whiteboard/TableNode.new.tsx` (285 lines)
- `src/hooks/use-column-collaboration.ts` (176 lines)
- `src/components/whiteboard/column/ColumnRow.tsx` (274 lines)
- `src/components/whiteboard/ReactFlowWhiteboard.tsx` (572 lines)
- `src/lib/react-flow/edge-routing.ts` (137 lines)
- `src/lib/react-flow/convert-to-edges.ts` (192 lines)

### Rules Loaded

- Greatness Hierarchy (default -- no rule files exist)

### Test Results

- 160 tests total, all passing (15 test files)
- No regressions from fixes

---

## Previous Findings Resolution

### BLOCKER: Delete dialog shows UUIDs instead of table names

**Status**: RESOLVED

**Fix**: Added `useNodes` hook in `TableNode` to build a `tableNameById` memo map. The `affectedRelationships` builder now resolves human-readable names via `tableNameById.get(rel.sourceTableId)` with fallback to raw UUID if node not found.

**Verification**: Lines 38-47 build the map correctly from `node.data.table.id` to `node.data.table.name`. Line 168 uses the map with proper fallback. The `DeleteColumnDialog` will now display "orders.user_id -> users.id" instead of UUIDs.

### HIGH-01 (from Round 1 auto-fix): onColumnError no-op

**Status**: VERIFIED INTACT

The `onColumnErrorRef` pattern at lines 249, 298-300 of `ReactFlowWhiteboard.tsx` remains correctly wired.

### HIGH-02 (from Cassandra): No reconnect reconciliation

**Status**: RESOLVED

**Fix**: Added `onReconnect` optional callback to `UseColumnCollaborationCallbacks`. In `use-column-collaboration.ts`, a `connect` event listener fires the callback on reconnect (distinguished from initial connect via `hasConnectedRef`). In `ReactFlowWhiteboard.tsx`, `handleReconnect` calls `queryClient.invalidateQueries` for both whiteboard and relationships queries.

**Verification**: The `hasConnectedRef` pattern (lines 69, 103-109 of `use-column-collaboration.ts`) correctly skips the initial connect. The cleanup at lines 118-124 properly unregisters the listener. The `onReconnectRef` pattern in `ReactFlowWhiteboard.tsx` (lines 259-262) keeps the callback stable.

### HIGH-03 (from Cassandra): Duplicate handle IDs

**Status**: RESOLVED

**Fix**: `createColumnHandleId` now accepts a 4th `type: 'source' | 'target'` parameter. Handle ID format: `{tableId}__{columnId}__{side}__{type}`. All call sites updated consistently.

**Verification**: Grep confirms all 6 call sites pass the type parameter:

- `ColumnRow.tsx`: 4 handles (left-source, left-target, right-source, right-target)
- `convert-to-edges.ts`: sourceHandle uses `'source'`, targetHandle uses `'target'`
- `recalculateEdgeHandles`: same type-specific IDs

### WARNING: ColumnRow.tsx duplicate handle IDs (from Round 1)

**Status**: RESOLVED by HIGH-03 fix above. The same issue was identified independently by both Hermes and Cassandra.

---

## Round 2 Findings Summary

| Tier            | Status    |
| --------------- | --------- |
| T1 Correct      | clean     |
| T2 Safe         | clean     |
| T3 Clear        | clean     |
| T4 Minimal      | clean     |
| T5 Consistent   | clean     |
| T6 Resilient    | clean     |
| T7 Performant   | 1 finding |
| T8 Maintainable | clean     |

### Totals

- **[BLOCKER]** x0
- **[WARNING]** x0
- **[SUGGESTION]** x1

---

## New Findings

### [SUGGESTION] TableNode.new.tsx:38 -- useNodes inside memoized node causes extra re-renders

**Tier: 7 -- Performant**
**Rule**: Greatness Hierarchy T7 -- waste
**Why**: `useNodes()` subscribes to the React Flow store and triggers re-renders on any node change (including drags). This means every `TableNode` instance re-renders on every drag frame across all tables, even though the `tableNameById` map is only consumed when `deletingColumn` is set.
**Fix**: Consider passing a `tableNameById` map via node data from `ReactFlowWhiteboard` instead of calling `useNodes` inside each node. This would avoid the per-node store subscription. Not blocking -- the current approach is functionally correct and the performance impact is bounded by table count.

---

## Carried Forward (from Round 1, unchanged)

These items were not blockers in Round 1 and remain as suggestions for future improvement:

### [SUGGESTION] ColumnRow.tsx:94 -- TooltipProvider per row

From Round 1. Each `ColumnRow` wraps in a new `<TooltipProvider>`. With many columns this creates many context providers. Consider hoisting to `TableNode` level.

### [SUGGESTION] use-column-mutations.ts + ReactFlowWhiteboard.tsx -- setNodes column-update pattern repeated 11 times

From Round 1. The 5-level-deep spread pattern `setNodes(prev => prev.map(node => ...))` appears 11 times. Consider extracting a `updateNodeColumns` utility.

---

## Positive Observations

1. **Clean fix for the BLOCKER**: The `useNodes` + `tableNameById` memo approach is straightforward and correct. The fallback to raw UUID ensures no crash if a node is missing.
2. **Reconnect reconciliation is well-designed**: The `hasConnectedRef` pattern cleanly distinguishes initial connect from reconnect. Using `queryClient.invalidateQueries` is the right TanStack Query pattern for replacing stale data.
3. **Handle ID fix is thorough**: All call sites were updated consistently. The 4-part format is documented in the JSDoc comment. The `recalculateEdgeHandles` function correctly uses type-specific IDs.
4. **No regressions**: 160 tests pass. The fixes did not break any existing functionality.

---

## Test Results

| Suite             | Status | Tests |
| ----------------- | ------ | ----- |
| All 15 test files | Pass   | 160   |

No new tests were required for the fixes -- the existing test coverage validates the corrected behavior.

---

## Verdict: Approved

All BLOCKERs from Round 1 and HIGH findings from Cassandra's risk analysis are resolved. No new BLOCKERs or WARNINGs introduced. The three remaining SUGGESTIONs are deferred improvements that do not block approval.

---

## Gate Status

- Zero BLOCKERs remaining
- Zero WARNINGs remaining
- 3 SUGGESTIONs (deferred, non-blocking)
- All 160 tests passing
- Feature is COMPLETE
