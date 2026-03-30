# Risk Analysis — dynamic-field-management (Re-Review Round 2)

**Analyst**: Cassandra
**Date**: 2026-03-30
**Mode**: Pipeline (Stage 11 — Re-Review)
**Feature Branch**: feature/dynamic-field-management
**Files in scope**: 46 changed files (re-review focused on 5 fixed files)

---

## Re-Review Summary

Three HIGH findings from Round 1 were targeted for fix. All three are confirmed resolved.
One new MEDIUM finding was introduced by the HIGH-02 fix (reconnect reconciliation).

| Severity | Round 1 | Round 2 |
|----------|---------|---------|
| CRITICAL | 0       | 0       |
| HIGH     | 3       | 0       |
| MEDIUM   | 3       | 4       |
| LOW      | 4       | 4       |

**Verdict: SHIP WITH CAUTION**

No CRITICAL findings. No HIGH findings. Four MEDIUM findings remain — three carried forward
from Round 1, one newly introduced. None block deployment, but MEDIUM-04 (stale
`pendingMutations` after reconnect) can cause silent data corruption in a narrow race
window and should be addressed promptly after ship.

---

## Verification of Round 1 HIGH Findings

### HIGH-01 — `onColumnError` no-op — CONFIRMED FIXED

**File verified**: `src/components/whiteboard/ReactFlowWhiteboard.tsx`, lines 249, 265-278, 297-300

The fix uses a `useRef`-forwarding pattern. `onColumnErrorRef` is initialized to a no-op
ref. The `columnMutationsCallbacks` memo calls through the ref (`(data) => onColumnErrorRef.current(data)`)
rather than capturing the callbacks object directly. After `useColumnMutations` returns,
a `useEffect` immediately assigns `columnMutations.onColumnError` to `onColumnErrorRef.current`.

This breaks the circular dependency correctly: `useColumnCollaboration` receives stable
callbacks, and the error handler resolves to the live function at call time via the ref.
Server rejections will now trigger the real rollback logic in `useColumnMutations.onColumnError`.

Status: RESOLVED.

---

### HIGH-02 — No reconnect reconciliation — CONFIRMED FIXED

**Files verified**: `src/components/whiteboard/ReactFlowWhiteboard.tsx` (lines 253-262, 273-275),
`src/hooks/use-column-collaboration.ts` (lines 68-110)

`handleReconnect` calls `queryClient.invalidateQueries` for both `['whiteboard', whiteboardId]`
and `['relationships', whiteboardId]`, triggering a server re-fetch that replaces stale
optimistic state with authoritative data. The `onReconnectRef` pattern keeps the callback
current without re-registering socket listeners.

In `use-column-collaboration.ts`, `hasConnectedRef` distinguishes the initial `connect`
event from subsequent reconnects — the `onReconnect` callback fires only on reconnect,
not on first connection, avoiding a spurious re-fetch on mount.

Status: RESOLVED. See MEDIUM-04 for a residual risk introduced by this fix.

---

### HIGH-03 — Duplicate React Flow handle IDs — CONFIRMED FIXED

**Files verified**: `src/components/whiteboard/column/ColumnRow.tsx` (lines 117, 123, 237, 243),
`src/lib/react-flow/edge-routing.ts` (lines 27-34),
`src/lib/react-flow/convert-to-edges.ts` (lines 155-166)

`createColumnHandleId` now accepts a fourth `type: 'source' | 'target'` parameter
(defaulting to `'source'`), producing IDs in the format `{tableId}__{columnId}__{side}__{type}`.

All four call sites in `ColumnRow.tsx` pass the correct type suffix. Both call sites in
`convert-to-edges.ts` explicitly pass `'source'` and `'target'`. Both call sites in
`edge-routing.ts` (`recalculateEdgeHandles`) pass the correct type. No call site uses
the old 3-argument form. The `ColumnRow.test.tsx` mock also matches the updated 4-argument
signature.

Status: RESOLVED.

---

## CRITICAL Findings

None.

---

## HIGH Findings

None.

---

## MEDIUM Findings

### MEDIUM-01 — `ColumnUpdatedEvent` uses `[key: string]: any` — unsafe spread into node state (carried forward)

**File**: `src/hooks/use-column-collaboration.ts`, line 24; `src/components/whiteboard/ReactFlowWhiteboard.tsx`, lines 191-212

`ColumnUpdatedEvent` retains its `[key: string]: any` index signature. The `onColumnUpdated`
handler still spreads the unvalidated remainder of the server socket payload directly into
column state with no field allowlist or validation.

**Impact**: Any unexpected or attacker-influenced WebSocket field merges verbatim into
column objects in React state. React's JSX escaping prevents XSS from `{column.name}`,
but properties that drive logic (e.g., `isPrimaryKey`, `isForeignKey`) can be overwritten
by a malicious or malformed server event. Erodes type safety for future code reading
column fields.

**Recommendation**: Replace the index signature with an explicit union of all updatable
column fields. Validate or whitelist `rest` before merging.

---

### MEDIUM-02 — `AddColumnRow.handleBlur` creates a column on any focus loss (carried forward)

**File**: `src/components/whiteboard/column/AddColumnRow.tsx`, lines 83-87

Blur-to-commit fires when the user tabs to the data type selector or clicks the canvas
background. A partially typed name creates a column the user may not have intended to
finalize. In React 19 concurrent batching, `isSelectingType` may not have flushed when
`handleBlur` runs.

**Impact**: Unintended column creation on canvas interaction. With HIGH-01 now fixed,
server rejections will roll back, but noisy partial columns add latency and collaborative
noise.

**Recommendation**: Require explicit Enter-key commit. At minimum, add a `setTimeout(..., 0)`
guard to ensure state updates flush before the blur handler reads `isSelectingType`.

---

### MEDIUM-03 — `ConstraintBadges` debounce-then-delete race (carried forward)

**File**: `src/components/whiteboard/column/ConstraintBadges.tsx`, lines 56-63

A constraint badge click followed by column deletion within 250ms sends a `column:update`
followed by a `column:delete` on the same `columnId`. The server may receive the update
after the delete, causing a spurious error or inconsistent state in the server log.

**Impact**: Rare timing issue. UI is correct (column is gone), but server may log errors
and the `onColumnError` rollback for the update could trigger on an already-deleted
column's state.

**Recommendation**: In `handleDeleteColumn`, cancel any pending debounce timers for
the target column before emitting `column:delete`.

---

### MEDIUM-04 — Reconnect re-fetch does not drain `pendingMutations` — stale rollback risk (NEW)

**File**: `src/hooks/use-column-mutations.ts` (lines 54, 361-374); `src/components/whiteboard/ReactFlowWhiteboard.tsx` (lines 253-255)

The HIGH-02 fix calls `queryClient.invalidateQueries` on reconnect, which triggers a
server re-fetch and replaces node state with authoritative data. However,
`pendingMutations.current` (the `Map` tracking optimistic mutations) is never cleared
or reconciled when this re-fetch completes.

The race window:

1. User emits `column:create` (optimistic insert, temp ID in `pendingMutations`).
2. WebSocket disconnects before `column:created` arrives.
3. Reconnect fires — `invalidateQueries` replaces node state with fresh server data.
   The column may or may not exist on the server depending on when the disconnect occurred.
4. The deferred `column:created` or `error` event arrives from the server after reconnect
   (Socket.IO queues undelivered events and replays them on reconnect).
5. If it is an `error` event: `onColumnError` calls `pending.rollback()`, which calls
   `setNodes` to remove the temp ID from node state. But the fresh server data may
   already contain the real column (if the create succeeded and the server queued a
   `column:created` event). The rollback removes a column that now has a real server ID,
   not the temp ID, so the remove predicate (`c.id !== tempId`) matches nothing — this
   case is benign.
6. If it is a `column:created` event (own event): the deduplication check
   (`if (data.createdBy === userId) return`) correctly swallows it. Benign.
7. However, if `pendingMutations` accumulates entries across multiple disconnect cycles
   (each cycle: optimistic insert, disconnect before confirm, reconnect clears UI but
   not the map), the map grows without bound over the session lifetime. Previously
   HIGH-02 identified this as a concern — it is now reduced but not eliminated.

The more acute sub-case: a `column:update` is pending, reconnect fires, re-fetch
restores pre-update server state, and then the deferred server `error` event for that
update triggers `rollback()` on the now-restored state — the rollback reverts the column
to `previousColumn` (captured before the optimistic update), which is identical to the
just-fetched server state. This is benign by coincidence, not by design.

**Impact**: The risk from HIGH-02 is substantially mitigated by the re-fetch. The residual
risk is `pendingMutations` growing across disconnect cycles and, in a narrow timing window,
a stale rollback clobbering freshly-fetched state. Low probability but non-zero; no user
notification that a re-fetch replaced pending state.

**Recommendation**: On reconnect (in `handleReconnect`), after calling `invalidateQueries`,
also clear `pendingMutations.current` via a ref exposed from `useColumnMutations`. Add
a toast notifying users that connection was restored and unsaved changes may have been
discarded — the `ConnectionStatusIndicator` message currently says "changes may not sync
to collaborators", which understates the user-visible impact.

---

## LOW Findings (unchanged from Round 1)

### LOW-01 — Hardcoded `userId = 'temp-user-id'` in production component

**File**: `src/components/whiteboard/ReactFlowWhiteboard.tsx`, line 483

All collaborators share the same user identity, causing each user's incoming real-time
events to be filtered out as their own. Pre-existing; blocked by auth work.

---

### LOW-02 — `npm audit` reports 16 HIGH, 15 MODERATE vulnerabilities in transitive dependencies

All in build tooling and MCP infrastructure — no runtime user-input paths. All have
fixes available. Pre-existing; not introduced by this feature.

---

### LOW-03 — `DeleteColumnDialog` renders raw table UUIDs instead of human-readable names

**File**: `src/components/whiteboard/TableNode.new.tsx`, lines 155-158

Delete confirmation dialog shows raw UUIDs for relationship table references. UX
degradation only. Pre-existing.

---

### LOW-04 — `InlineNameEditor` commits on blur with no length validation

**File**: `src/components/whiteboard/column/InlineNameEditor.tsx`, lines 31-38

No `maxLength` constraint. Extremely long names could cause DB truncation errors or
layout breakage. No XSS risk due to React escaping.

---

## Breaking Changes Assessment (unchanged)

| Area | Status |
|------|--------|
| `TableNodeData` interface | Added optional fields only. Backward compatible. |
| `TableNode.new.tsx` API | Existing props unchanged. Non-breaking. |
| `ReactFlowWhiteboard.tsx` props | No removed or renamed props. Non-breaking. |
| Prisma schema | No removals. Cardinality enum extended with migration. Non-breaking. |
| Exported symbols | All existing exports preserved. New exports are additive. |
| `createColumnHandleId` signature | Fourth parameter added with default value. Backward compatible for 3-arg callers. |

---

*"They called me mad. Then Troy burned."*
