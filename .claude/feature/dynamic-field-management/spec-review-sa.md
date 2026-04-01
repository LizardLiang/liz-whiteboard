# Spec Review (SA) -- Dynamic Field Management (Round 2)

**Reviewer**: Apollo (Architecture Review Agent)
**Date**: 2026-03-30
**Tech Spec Version**: Revised Draft R1 (addresses SA-C1, SA-M1, SA-M2)
**Previous Verdict**: Concerns (Round 1)
**Verdict**: **Sound**

---

## Executive Summary

The revised tech spec addresses all three issues raised in Round 1. The double-persistence flaw (SA-C1) is resolved by switching to WebSocket-only persistence. The authorization gap (SA-M1) is documented as a known limitation in Section 15.1. The constraint toggle race condition (SA-M2) is mitigated with a 250ms per-constraint debounce. No new critical or high-severity issues were introduced by the revision.

One medium-severity observation is noted below (SA-R2-M1) regarding a factual inaccuracy in the spec's justification, but the architectural decision itself is correct.

---

## 1. Resolution Verification

### SA-C1 (Critical): Double Persistence -- RESOLVED

**What was required**: Eliminate dual DB writes by choosing a single persistence path.

**What was done**: The spec adopted Option A (WebSocket-only). Sections 2.2, 5.1, 5.2, 7.1, and the Scope Summary (Section 1) were all revised consistently:

- Section 2.2 now states "Column mutations use WebSocket-only persistence" with explicit rationale
- Section 5.1 (`useColumnCollaboration`) is described as "the sole persistence path"
- Section 5.2 (`useColumnMutations`) explicitly states "Does not call HTTP server functions"
- Section 3.3 lists `src/routes/api/columns.ts` as "exist but NOT used by this feature"
- Section 7.1 event flow diagram correctly shows the WebSocket-only path
- The trade-off (mutations require active WebSocket connection) is documented with mitigation (ConnectionStatusIndicator, `isConnected` check, error toast)

**Verification against server code**: Confirmed that `src/routes/api/collaboration.ts` lines 358-458 handle `column:create`, `column:update`, `column:delete` with Zod validation, DB persistence via `createColumn`/`updateColumn`/`deleteColumn`, and `socket.broadcast.emit` for success broadcasts. Error events are sent back to the originator via `socket.emit('error', ...)`. The spec's data flow description accurately reflects this server behavior.

**Consistency check**: Searched the full spec for residual HTTP references. Section 3.3 correctly notes server functions exist but are unused. No other sections reference `createColumnFn`, `updateColumnFn`, or `deleteColumnFn` as active persistence paths. The PRD (AC-01d, AC-02d, AC-03c) references server functions -- these are PRD-level acceptance criteria that describe the persistence requirement abstractly; the tech spec correctly translates this into WebSocket-only implementation. No inconsistency.

**Verdict on SA-C1**: Fully resolved. The WebSocket-only approach is architecturally sound.

### SA-M1 (Medium): Authorization Gap -- RESOLVED

**What was required**: Document the authorization gap as a known limitation.

**What was done**: Section 15.1 "Known Limitations" contains a thorough write-up: it identifies the gap, scopes it as pre-existing (applies to table/relationship mutations too), explains why this spec does not widen it, and recommends future middleware-based authorization across all mutation types.

**Verdict on SA-M1**: Fully resolved. The documentation is clear, correctly scoped, and includes a concrete recommendation for future remediation.

### SA-M2 (Medium): Constraint Toggle Race Condition -- RESOLVED

**What was required**: Add debounce (200-300ms) to constraint toggles or document as known limitation.

**What was done**: Section 4.5 specifies a 250ms per-constraint debounce with trailing edge semantics. The implementation sketch shows a `Map<string, NodeJS.Timeout>` pattern where each constraint key (isPrimaryKey, isNullable, isUnique) has its own independent timer. Optimistic UI updates fire immediately; only the WebSocket emit is debounced. Section 13.3 references this mitigation.

**Assessment**: The per-constraint debounce is the right design -- PK and N toggles should not block each other. The 250ms window is within the recommended 200-300ms range. The trailing-edge behavior (last click wins) correctly maps to user intent.

**Verdict on SA-M2**: Fully resolved.

---

## 2. New Issue Assessment

### SA-R2-M1 (Medium -- non-blocking): Inaccurate "matches existing pattern" claim

**Finding**: Section 2.2 states the WebSocket-only approach "matches the existing pattern used by `table:create`, `table:move`, `table:update`, and `table:delete`." This is factually incorrect. The existing table mutation code in `src/routes/whiteboard/$whiteboardId.new.tsx` (lines 109-121) uses a dual-path pattern: HTTP server function first (`createTableFn`), then on success emits via WebSocket (`emit('table:create', createdTable)`). The same pattern applies to `table:move` (HTTP `updateTablePositionFn`, then WebSocket emit). The existing table code has the same double-persistence bug that SA-C1 identified for columns.

**Architectural impact**: None. The WebSocket-only decision is correct regardless of what the existing table code does. The existing table code is buggy (it double-persists), and the column spec correctly avoids repeating that bug. The claim is a documentation inaccuracy, not an architectural flaw.

**Recommendation**: Update Section 2.2 to say "This approach avoids the double-persistence issue present in the current table mutation code" rather than claiming it matches that pattern. This prevents a future implementer from looking at the table code as a reference and reintroducing the dual-path bug for columns.

**Severity**: Medium (documentation accuracy). Does not affect the verdict because the architectural decision itself is correct and the implementation guidance (Sections 5.1, 5.2, 7.1) is clear and unambiguous.

### SA-R2-O1 (Observation): Temp ID not replaced by server for originator

Section 7.1 correctly identifies that `socket.broadcast.emit` means the originator does NOT receive `column:created`. The spec accepts that the temp ID persists until `sync:request` reconciliation. This is a pragmatic V1 trade-off. However, if the temp ID is used as a key in any React state (e.g., React `key` prop on `ColumnRow`), changing it during sync could cause unnecessary unmount/remount. The spec should ensure that the sync reconciliation updates the ID in-place without triggering a full component tree rebuild.

**Severity**: Low observation. Not a blocking issue -- React handles key changes gracefully (it rebuilds the component, which is acceptable for a sync event that happens rarely).

---

## 3. Full Dimension Review (Revised Spec)

### 3.1 Architecture Soundness -- PASS

- WebSocket-only persistence eliminates the dual-path complexity
- Component hierarchy is well-decomposed with clear single-responsibility
- State management (local to TableNode) is appropriate for V1
- The `isConnected` gate on mutations is a correct safeguard
- Pending mutations map with rollback functions is a sound error recovery pattern

### 3.2 Security -- PASS (with documented limitation)

- Input validation is handled server-side via Zod schemas (unchanged)
- Authorization gap documented in Section 15.1 (SA-M1 resolution)
- No new attack surface introduced by WebSocket-only approach (the Socket.IO handlers already existed)
- The `isConnected` check prevents silent data loss on disconnection

### 3.3 Performance -- PASS

- Memoization strategy (React.memo on ColumnRow, pre-computed edge map) is sound
- Constraint debounce reduces unnecessary server round-trips
- 30+ column test target is appropriate
- No new N+1 query risks (all persistence is server-side, unchanged)

### 3.4 Maintainability -- PASS

- File organization under `src/components/whiteboard/column/` is clean
- Hook separation (collaboration vs. mutations) follows single-responsibility
- Type definitions are complete and consistent
- 7-phase implementation plan with Phase 1 as pure refactor is excellent risk management

### 3.5 Integration -- PASS

- WebSocket integration accurately reflects server behavior (verified against source)
- Handle architecture preserved (createColumnHandleId pattern)
- Edge removal explicitly handled (TD-3)
- sync:request reconciliation for reconnection is correct

---

## Issue Summary

| ID       | Severity | Category                 | Status             | Issue                                                                                                                         |
| -------- | -------- | ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| SA-C1    | Critical | Architecture / Data Flow | **RESOLVED**       | Double persistence eliminated via WebSocket-only approach                                                                     |
| SA-M1    | Medium   | Security                 | **RESOLVED**       | Authorization gap documented in Section 15.1                                                                                  |
| SA-M2    | Medium   | Performance              | **RESOLVED**       | 250ms per-constraint debounce added to Section 4.5                                                                            |
| SA-R2-M1 | Medium   | Documentation            | NEW (non-blocking) | "Matches existing pattern" claim is factually inaccurate -- existing table code uses dual-path. Does not affect architecture. |
| SA-R2-O1 | Low      | Performance              | NEW (observation)  | Temp ID persistence until sync:request may cause React key change on reconciliation                                           |

---

## Verdict Rationale

- **0 Critical issues**: SA-C1 is resolved.
- **0 High-severity issues**: None.
- **1 Medium-severity issue** (SA-R2-M1): Documentation inaccuracy, non-blocking. The architectural decision is correct and implementation guidance is unambiguous.
- **1 Low observation** (SA-R2-O1): Minor React reconciliation note.

Per verdict thresholds: no critical, no high, 1 medium or fewer = **Sound**.

---

## Recommendations (Non-Blocking)

1. **SA-R2-M1**: Update Section 2.2 decision rationale to acknowledge the existing table code uses a different (dual-path) pattern, and note that the WebSocket-only approach is an intentional improvement. This prevents future confusion.

2. **SA-R2-O1**: During implementation, ensure that the `sync:request` handler updates column IDs in-place (mutating the columns array within setNodes) rather than replacing the entire node, to minimize React reconciliation cost.

3. **Existing table mutation bug**: The double-persistence pattern in `$whiteboardId.new.tsx` for `table:create` and `table:move` should be tracked as a separate tech-debt item. It is out of scope for this feature but is a real bug that would cause duplicate table rows on creation.

---

## Positive Observations

1. **Thorough SA-C1 resolution**: The WebSocket-only approach is applied consistently across all sections -- Scope Summary, Data Flow, Hook Specs, Event Flow, and File Changes all align. No residual HTTP references in the persistence path.
2. **Well-designed debounce**: The per-constraint debounce in Section 4.5 with trailing-edge semantics and independent timers is exactly the right pattern. The code sketch is clear and implementable.
3. **Honest trade-off documentation**: The temp-ID-persists-until-sync decision (Section 7.1) is a pragmatic V1 choice that is transparently documented with its limitations.
4. **Authorization gap write-up**: Section 15.1 goes beyond a simple acknowledgment -- it scopes the gap, explains it is pre-existing, and provides a concrete future remediation path.
5. **Pending mutations map**: The rollback coordination pattern (Section 5.2) with stored rollback functions is robust and avoids the stale-error problem.
