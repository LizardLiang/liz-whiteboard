# Tech Spec Review — Architecture (Apollo)

| Field | Value |
|-------|-------|
| **Feature** | Auto Layout |
| **Reviewer** | Apollo (SA Review Agent) |
| **Spec Author** | Hephaestus |
| **PRD Version** | 1.2 |
| **Spec File** | tech-spec.md |
| **Date** | 2026-05-01 |
| **Verdict** | **Concerns** |

---

## Verdict Summary

The spec is structurally sound and faithfully reflects the PRD v1.2 contract, the four locked decisions in `context.md`, and the existing codebase conventions. The architectural approach (client-side d3-force with RAF chunking, single bulk transaction + single namespace broadcast, optimistic local apply with Retry-on-failure) is well-fitted to the requirement set.

However, **one high-severity gap and four medium-severity concerns** need resolution before implementation. The most consequential is a fundamental contract mismatch between the orchestrator's failure-handling model and the actual `requireAuth` middleware behaviour: the spec assumes auth failures are thrown, but the codebase returns them as a value, which means the orchestrator's success path will fire on an auth failure and silently desync the user from the server.

**Verdict math:** 1 High + 4 Medium → **Concerns** (per Apollo threshold: any high-severity issue triggers Concerns).

---

## Findings

### 1. [HIGH] Auth-failure handling: `requireAuth` returns, does not throw

**Where:** §4 Detailed `updateTablePositionsBulk` error table; §7 Phase 4 `runLayout` flow ("On persist failure: setPersistError(err)").

**Issue:** The spec's error table at §4 lists "Unauthenticated → 401 (raised by requireAuth)" and the orchestrator's `runLayout` flow only branches into the persistence-failure UX when `await updateTablePositionsBulk(...)` **throws**. But the project's `requireAuth` (`src/lib/auth/middleware.ts:38-47`) does **not** throw on auth failure — it **returns** an `AuthErrorResponse` object `{ error: 'UNAUTHORIZED', status: 401 }`. The codebase ships a dedicated type guard `isUnauthorizedError` in `src/lib/auth/errors.ts:16-25` precisely because consumers must check the return value, not catch it.

**Why it matters architecturally:** Under the current spec, an expired session during Auto Layout produces this sequence:

1. d3-force computes positions client-side. ✓
2. Optimistic `setNodes` paints the new layout locally. ✓
3. `updateTablePositionsBulk(...)` resolves to `{error:'UNAUTHORIZED', status:401}`, **does not throw**. ✗
4. Orchestrator's `try` block sees a successful resolve → executes the success path: `setTimeout(fitView, 100)` + `toast.success("Layout applied to N tables")`.
5. Server has zero new positions. No broadcast was emitted. Collaborators see nothing.
6. The local user has been told the layout was saved. It was not.

This breaks the **NFR Persistence — failure UX** contract (the user must be informed of the local/remote divergence) and breaks **NFR Reliability** (no false success).

**Required change:** The spec's orchestrator contract must:
- Treat the resolved value as either a success body `{success:true; count:number}` or an `AuthErrorResponse`. Use `isUnauthorizedError(result)` (or shape-check on `result.error === 'UNAUTHORIZED'`) before treating it as success.
- Route any auth-failure value into the persistence-failure UX (toast + Retry + keep optimistic state) rather than the success branch. The user can choose to re-authenticate and retry.
- Update the §4 error table to distinguish "thrown" errors (DB, IDOR) from "returned" auth errors.
- Optionally surface the 401 to the existing `triggerSessionExpired` path (`AuthContext`) so the user lands on the auth flow without a confusing toast.

---

### 2. [MEDIUM] Cross-client dimension drift breaks 16 px L∞ contract for collaborators

**Where:** §6 Post-pass for 16 px gap; §7 Phase 1 step 1; FR-004 contract.

**Issue:** The L∞ post-pass enforces `gap ≥ 16 px` against **the originator's locally-rendered table dimensions** (`node.measured?.width ?? node.width ?? 250` / `height ?? 150`). The broadcast emits `{tableId, positionX, positionY}` only — no `width` / `height`. Collaborators apply these positions to their own nodes, which may have different rendered dimensions due to:

- Different visible-column counts (e.g., the originator collapsed several tables before clicking Auto Layout, the collaborator has them expanded — `node.measured.height` differs by tens to hundreds of pixels).
- Different React Flow zoom level / DPR-affected layout passes producing slightly different `measured` dimensions before the bulk apply.
- Browser-specific text metric differences for table/column names and data type pills.

If table B's measured height is 240 px on the originator and 320 px on the collaborator, a 20 px L∞ vertical gap on the originator becomes a -60 px gap (i.e., overlap) on the collaborator. **The FR-004 16 px contract holds locally but breaks remotely.**

**Why it matters architecturally:** FR-004 is asserted as "every pair (A, B)" without qualifying "originator's view" — the PRD's reliability contract claims atomicity is preserved on **both** local and remote screens. The spec inherits FR-004 from PRD without addressing this gap.

**Required change (pick one):**
- (Recommended) Compute layout against a **canonical table dimension** (e.g., always treat each table as 250 × 150 for layout purposes, regardless of measured state). This produces deterministic gaps everywhere and matches `elk-layout.ts`'s 250/150 fallback already used in the legacy path. Trade-off: gaps may be visually loose around collapsed tables and tight around tall tables, but they will never overlap.
- Document the limitation explicitly in §6 ("the 16 px contract is enforced against the originator's measured dimensions; collaborators with different rendered dimensions may see < 16 px gaps until they re-trigger layout") and update FR-004 in PRD if needed.
- Include `width`/`height` in the broadcast payload and have the receiver run a local re-pass — this is heavier and creates new race conditions; not recommended.

---

### 3. [MEDIUM] Cross-module import: `server-functions.ts` importing from `@/routes/api/collaboration`

**Where:** §4 Detailed `updateTablePositionsBulk`; §7 Phase 2 step 2 imports.

**Issue:** The spec adds an import of `emitToWhiteboard` from `@/routes/api/collaboration` into `src/lib/server-functions.ts`. A grep across the project shows **zero existing consumers** of `emitToWhiteboard` outside `collaboration.ts` itself — this would be a new cross-module edge from a server-functions module into a route file. Route files commonly carry top-level side effects (Socket.IO server init, request-scope helpers) that load when the module is first imported. Importing a route file into another server module risks pulling in those side-effects in unintended evaluation orders.

`server-functions.ts` is server-only and `collaboration.ts` is also server-only, so there is no immediate client-bundle risk, but the architectural smell is real: helpers reused across modules belong in `src/lib/`, not in `src/routes/`.

**Why it matters architecturally:** This wires together two top-level modules in a way that creates a directional dependency that did not exist before, with no precedent in the codebase. Any future refactor that splits the route file or adds top-level initialization will affect every server function that calls `updateTablePositionsBulk`.

**Required change (pick one):**
- (Recommended) Move `emitToWhiteboard` and `broadcastToWhiteboard` (and the `io` reference they share) to a dedicated `src/lib/collaboration/socket-emit.ts` (or `src/lib/socket/emit.ts`). Have both `collaboration.ts` and `server-functions.ts` import from there. This re-establishes a clean dependency direction.
- If keeping the current location, the spec must explicitly verify (and document) that importing `@/routes/api/collaboration` from a non-route context has no unintended top-level evaluation effects (Socket.IO server registration, route-table mutation, etc.).

---

### 4. [MEDIUM] `lastPayloadRef` Retry across unmount / navigation / whiteboard switch

**Where:** §7 Phase 4 step 2 `handleRetry`; §7 Files to Create — `use-auto-layout-orchestrator.ts`.

**Issue:** The orchestrator stores `lastPayloadRef.current = { whiteboardId, positions }` after an optimistic `setNodes` and uses it inside the toast's Retry handler. The toast (sonner) lives at the app level; it persists across React subtree unmounts. If the user clicks Retry **after** navigating away from the whiteboard (or switching to a different whiteboard) the Retry call:

1. Re-submits `updateTablePositionsBulk(lastPayloadRef.current)` — which contains the **previous** whiteboardId and positionIds.
2. If the user is now viewing a different whiteboard, the IDOR guard in the server function correctly rejects the call. But:
3. If the user navigated back to the same whiteboard and other users have since dragged some of the same tables, Retry overwrites those drags with stale optimistic positions from many seconds ago. (This is technically last-write-wins, but it's destructive and hidden from the user.)
4. If the orchestrator hook itself unmounts, the closure capturing `lastPayloadRef` and `updateTablePositionsBulk` is still alive on the toast's action handler — testing/debugging this is non-trivial.

**Why it matters architecturally:** The persistence-failure-with-Retry contract assumes the user is still focused on the whiteboard when they click Retry. The spec doesn't bound the Retry's lifetime or scope. This is a small but real correctness hole; it also produces a confusing UX where Retry succeeds but writes stale data.

**Required change:**
- Bound the Retry: dismiss the failure toast on whiteboard unmount / navigation, or capture the whiteboardId snapshot and refuse Retry if it no longer matches the current active whiteboard.
- Optionally: add a TTL (e.g., 60 s) after which the toast auto-dismisses and the Retry is no longer offered.
- Document this in §7 Phase 4 alongside the existing failure flow.

---

### 5. [MEDIUM] Sender-guard field-name skew between `table:moved` and `table:move:bulk`

**Where:** §3 Socket.IO Event Payload; Appendix B Codebase Facts Cross-Check; §7 Phase 4 step 1.

**Issue:** The spec acknowledges in Appendix B that the existing `table:moved` listener at `use-whiteboard-collaboration.ts:75-92` reads `data.userId === userId` (the legacy event's payload field name is `userId` — confirmed at `collaboration.ts:418-423`), while the new `table:move:bulk` event uses `updatedBy` and is read as `data.updatedBy === userId`. The same hook will house both listeners with conflicting field-name conventions for the same semantic value (sender's user id).

**Note (informational):** I observed during review that the existing `table:moved` socket emit at `collaboration.ts:418-423` puts the sender id under `updatedBy` while the listener reads `data.userId`. That looks like a pre-existing latent bug in the legacy path (the listener may be reading from the optional `userId?` field that the emit does not populate). It's outside Auto Layout's scope, but the spec's Appendix B claim that the existing listener "guards via `updatedBy === currentUserId`" is technically inaccurate — the listener guards on `data.userId`. The new `table:move:bulk` listener, as specified, does correctly read `data.updatedBy`.

**Why it matters architecturally:** Two payload field names for the same field in one hook is a maintenance trap. A future reader will write `data.userId` in the bulk handler by muscle memory and the guard will silently fail (every collaborator re-applies positions they already see, no observable bug, but doubled CPU and a future debugging nightmare).

**Required change:**
- Pick one convention for the new event. Recommend `updatedBy` (already used by `table:updated` / `table:deleted` / `column:updated` in the project). The spec already does this. Add a comment in `use-whiteboard-collaboration.ts` next to both listeners noting the divergence and pointing at the legacy bug as out-of-scope.
- Update Appendix B to reflect the actual `data.userId` read in the legacy listener, not the claimed `updatedBy` read.

---

### 6. [LOW] `{ user: _user }` rename inconsistent with `_user.id` access

**Where:** §4 `updateTablePositionsBulk` handler signature.

**Issue:** The spec writes `requireAuth(async ({ user: _user }, data): Promise<...> => { ... emitToWhiteboard(..., { ..., updatedBy: _user.id }) ... })`. The leading underscore by project convention signals "intentionally unused" (matches existing `requireAuth(async ({ user: _user }, ...)` in `createTable`, `updateTablePosition`, etc., **none of which actually use `_user`**). This spec uses `_user.id`. Other server functions that need the user simply destructure as `{ user }`.

**Required change:** Change the signature to `requireAuth(async ({ user }, data) => { ... updatedBy: user.id ... })`. Cosmetic but matches both ESLint convention (no-underscore-dangle / no-unused-vars semantics) and the rest of the file's reading pattern.

---

### 7. [LOW] 500-position cap is well-motivated but not stress-tested

**Where:** §3 `bulkUpdatePositionsSchema`; Open Question 5.

**Observation:** The `.max(500)` cap is reasonable, but the spec doesn't include a transaction-size or wire-payload sanity check at the cap (500 `prisma.diagramTable.update` operations in one transaction; 500-row JSON payload). Worth a single-paragraph note in §6 confirming the cap is well within Postgres / Prisma transaction limits and JSON parser ceilings.

---

### 8. Open Question dispositions

- **OQ-1: defer `socket.on('table:move:bulk')` server handler.** **Apollo endorses the deferral.** No client path emits this event in v1; adding the handler now is dead code that may bit-rot before any client uses it. If a future feature needs server-side receipt of bulk events, it can be added then with the right context.
- **OQ-2: audit `onAutoLayoutReady` consumer in `src/routes/whiteboard/$whiteboardId.tsx`.** **Apollo requires this resolved before code begins**, not deferred. Leaving an "audit in Phase 4" open question puts the onus on Ares to make a refactoring decision that should be settled at spec time. Hephaestus or the discuss stage should produce a yes/no answer.
- **OQ-3: production `PerformanceObserver`.** Apollo agrees with "test-time only".
- **OQ-4: success-toast vs failure-toast ordering.** Resolved correctly.
- **OQ-5: 500-cap sizing.** Resolved; see Finding 7.
- **OQ-6: optimistic-state vs collaborator-drag overlap window.** Resolved correctly per PRD Error Flow #6.

---

## Soundness Per Dimension

| Dimension | Verdict | Notes |
|-----------|---------|-------|
| Architecture soundness | **Sound** | Client compute + single transaction + single broadcast is the right shape. Component boundaries (engine ↔ hook ↔ orchestrator ↔ collaboration) are well-separated and individually testable. |
| Security | **Concerns** | IDOR guard is correct (single `findMany` + Set lookup). Auth-failure handling gap (Finding 1) is the dominant security-adjacent issue: a session-expired user sees a false success. RBAC is consciously stubbed — pre-existing codebase condition, not Auto Layout's scope. Input validation via Zod is comprehensive. |
| Performance | **Sound** | RAF + 10-tick budget + 500-tick cap is well-reasoned and meets the FR-007 longtask contract. Single transaction collapses 100 round-trips to 1. Post-pass is O(n²) but bounded — fine. The only performance-adjacent risk is the cross-client dimension drift in Finding 2, which is correctness-shaped not speed-shaped. |
| Maintainability | **Concerns** | The cross-module import in Finding 3 and the field-name skew in Finding 5 both add long-term friction. The deletion of legacy ELK paths (per the locked clean-removal decision) is good. OQ-2 left open as "audit in Phase 4" is a maintenance smell. |
| Integration | **Concerns** | Mostly clean: Toolbar prop surgery, collaboration hook signature change, AlertDialog primitive use are all idiomatic. The auth-error contract mismatch (Finding 1) is fundamentally an integration issue (the orchestrator integrates incorrectly with `requireAuth`'s actual return contract). |

---

## Compliance With Locked Decisions (`context.md`)

All four locked decisions are reflected correctly in the spec:

| Locked Decision | Reflected? | Where |
|-----------------|------------|-------|
| `emitToWhiteboard` + `updatedBy === currentUserId` guard | Yes | §4 + Phase 4 step 1 |
| 10 ticks per RAF frame, 500-tick cap | Yes | §6 + Phase 1 step 1 |
| `fitView({ padding: 0.2, duration: 300 })` after `setTimeout(..., 100)` | Yes | Phase 4 step 2 (`runLayout` success branch) |
| Toolbar prop clean-remove + add | Yes | Phase 3 step 1 |

---

## Issue Count

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 2 |

---

## Required Actions Before Stage 7

1. **(High, blocking)** Resolve auth-failure handling in the orchestrator (Finding 1). Update §4 error table and §7 Phase 4 `runLayout` to handle `AuthErrorResponse` shapes via `isUnauthorizedError`.
2. **(Medium, blocking)** Decide and document the cross-client dimension strategy (Finding 2). Recommended: canonical 250×150 dimensions for layout computation.
3. **(Medium, blocking)** Decide and document the `emitToWhiteboard` import path (Finding 3). Recommended: extract to `src/lib/...` first.
4. **(Medium, blocking)** Bound `handleRetry` lifetime / scope (Finding 4).
5. **(Medium, blocking)** Add a code-comment / convention note for the field-name skew (Finding 5) and correct Appendix B.
6. **(Low)** Drop the `_user` rename and access `user.id` directly (Finding 6).
7. **(Low)** Add a one-sentence sanity note for the 500-cap (Finding 7).
8. **(Process)** Resolve OQ-2 before Stage 7 — do not defer to Phase 4.

---

## Recommendation

**Send back to Hephaestus for revision.** The spec is structurally close enough that a revision pass should be quick (most findings are bounded scope changes in §4, §6, and §7 Phase 4). After revision, this can re-enter Stage 6 for re-review or proceed to Stage 7 if the revisions address all High and Medium findings cleanly.

---

## Gate Status

**Gate: BLOCKED.** Stage 7 (Test Plan) should not begin until Findings 1-5 are resolved in `tech-spec.md`.

---

# Round 2 Review (Re-review after Hephaestus revision 1)

| Field | Value |
|-------|-------|
| **Reviewer** | Apollo (SA Review Agent) |
| **Spec Revision** | 1 |
| **Date** | 2026-05-01 |
| **Round 2 Verdict** | **Sound** |

## Verification of Round 1 Findings

All 5 round-1 blocking findings + both open questions have been verified against the revised `tech-spec.md`:

| # | Finding | Round 2 Status | Where Resolved |
|---|---------|----------------|----------------|
| 1 | HIGH — Auth-error return value (`isUnauthorizedError` check after every `await`) | **RESOLVED** | §4 lines 230-232, 306-323 (resolved-value table); §7 Phase 4 lines 633-651 (`handlePersistResult` branch); 668-686 (`runRetry` re-check after await); auth-failure path also calls `triggerSessionExpired()` per Apollo recommendation. Regression test added at §7 Phase 4 step 5. |
| 2 | MEDIUM — L∞ gap scope as originator-screen guarantee | **RESOLVED** | §1 line 28 (Goals scoped explicitly to "originator's screen"); §2 line 149 (Key Design Decisions row); §6 lines 436-445 (full cross-client contract section: broadcast carries no dimensions, receivers apply verbatim, mitigation path documented, scoping note for PM). Hephaestus chose option (b) over Apollo's preferred canonical-dimensions option (a′) and gave a defensible rationale: option (a′) would desync visible state from persisted state on all clients. Acceptable. |
| 3 | MEDIUM — Circular import (`server-functions.ts` → `routes/api/collaboration`) | **RESOLVED** | §1 line 22, §2 lines 53-54, §4 line 235 + 293 (server function does NOT import `emitToWhiteboard`); §4 lines 325-344 + §7 Phase 2 step 3 (new server-side `socket.on('table:move:bulk', …)` handler re-broadcasts via `broadcastToWhiteboard(whiteboardId, socket.id, …)`); §7 Phase 4 lines 718-727 (orchestrator emits client-side after server-function success — mirrors existing single-table pattern at `$whiteboardId.tsx:265-271`). Clean directional dependency restored. |
| 4 | MEDIUM — Stale Retry across unmount/navigation | **RESOLVED** | §7 Phase 4 lines 622-629 (`isMountedRef` set true on mount, false on unmount); 643, 665, 720, 730, 739, 749 (mount-checks at toast-handler entry, after every await, and around every state setter). Regression test added: "Retry after unmount: simulate the toast Retry click after the component unmounts — `updateTablePositionsBulk` must NOT be called." |
| 5 | MEDIUM — Field-name skew (`data.userId` vs `data.updatedBy`) | **RESOLVED** | §3 lines 199-208 (payload uses `userId` end-to-end); §7 Phase 4 lines 557-582 (listener reads `data.userId` matching the existing same-hook `table:moved` listener verbatim, with an inline code comment noting the convention and pointing at the legacy `collaboration.ts:418-423` emit/listener mismatch as out-of-scope). Appendix B row corrected. |
| OQ-1 | `socket.on('table:move:bulk')` server handler — was "deferred", now required | **RESOLVED** | §4 lines 346-348, §7 Phase 2 step 3 line 526, Open Questions table line 826: "Resolved (revision 1) — REQUIRED, not deferred." Now on the critical path. |
| OQ-2 | `onAutoLayoutReady` bridge | **RESOLVED** | §1 line 24, §7 Phase 4 step 4 (line 794), Files-to-Modify line 492, Open Questions table line 827: explicit DELETE — `reactFlowAutoLayoutRef`, `isAutoLayoutComputing`, `handleAutoLayout`, `handleAutoLayoutReady`, `useAutoLayoutPreference` usage, `computeAutoLayout` import, four legacy `<Toolbar>` props, and `layout:compute`/`layout:computed` socket emits + listeners are all removed in `$whiteboardId.tsx`. The orchestrator owns the entire flow inside `ReactFlowWhiteboard.tsx`. |

All 5 round-1 findings are resolved. The two informational lows (Findings 6 + 7) are also addressed in Appendix C. The revision is faithful to the spirit of the original feedback and goes beyond minimum compliance (e.g., adding `triggerSessionExpired()` to the auth-failure path; documenting the cross-client gap limitation in PRD-feedback-loop terms rather than just code comments).

## New Findings Introduced by the Revision

The revision moves the broadcast trigger from a server function (server-side `emitToWhiteboard`) to a new client-side emit + server-side `socket.on('table:move:bulk')` handler. This shift introduces three small but real concerns. None block the gate; the medium-severity item is a defense-in-depth gap addressable with a 3-line copy-paste from the existing socket-handler template.

### R2-1. [MEDIUM] New `socket.on('table:move:bulk')` handler skips established session/permission guards

**Where:** §4 Detailed `socket.on('table:move:bulk', …)` code block at lines 332-342; §7 Phase 2 step 3 at line 526.

**Issue:** Every other `socket.on(...)` handler in `src/routes/api/collaboration.ts` (verified by `rg`: lines 341, 381, 441, 500, 559, 617, 678, 734, 844) follows a uniform prelude:

```ts
socket.on('event', async (data) => {
  if (isSessionExpired(socket)) {
    socket.emit('session_expired')
    socket.disconnect(true)
    return
  }
  if (await denyIfInsufficientPermission(socket, whiteboardId)) return
  // …handler body…
  await safeUpdateSessionActivity(socket.id)
})
```

The spec's new handler does none of this — it calls `broadcastToWhiteboard(whiteboardId, socket.id, 'table:move:bulk', data)` directly with no validation, no session check, no permission check, and no `safeUpdateSessionActivity` call. While `whiteboardNsp.use(...)` guards the namespace at connect time, the per-handler `isSessionExpired` check exists precisely to defend against session lapses *during* a connected session — that's why every other handler runs it.

**Why it matters architecturally:** The bulk broadcast is a higher-impact operation than a single-table drag (it overwrites every collaborator's whiteboard layout in one tick). Allowing this to fire from a session-expired-but-still-connected socket — or from a user whose permission was revoked mid-session — is a defense-in-depth gap. It also breaks the codebase's established pattern, which would be a maintenance smell flagged in any future audit.

**Required change (recommended):** Add the standard prelude to the new handler, plus a payload-shape validation:

```ts
socket.on('table:move:bulk', async (data: {
  positions: Array<{ tableId: string; positionX: number; positionY: number }>
  userId: string
}) => {
  if (isSessionExpired(socket)) {
    socket.emit('session_expired')
    socket.disconnect(true)
    return
  }
  if (await denyIfInsufficientPermission(socket, whiteboardId)) return

  // Light shape validation; reject obviously malformed payloads.
  if (!data || !Array.isArray(data.positions) || typeof data.userId !== 'string') return

  broadcastToWhiteboard(whiteboardId, socket.id, 'table:move:bulk', data)
  await safeUpdateSessionActivity(socket.id)
})
```

This brings the handler in line with every existing socket handler in the file and addresses the implicit "handler validates the payload shape" claim Hephaestus made at §7 Phase 2 step 3 (the current code sketch performs no validation).

---

### R2-2. [LOW] Spec claim "handler validates the payload shape" not realized in code sketch

**Where:** §7 Phase 2 step 3 line 526.

**Issue:** The spec says: "The handler validates the payload shape (`positions: Array<{tableId, positionX, positionY}>; userId: string`) and re-broadcasts." The actual code sketch at §4 lines 332-342 does no validation — it just calls `broadcastToWhiteboard(...)` with the raw `data`. A malformed payload (missing fields, wrong types, an `Array` of non-objects) would be re-broadcast verbatim and crash receivers. Easy to fix with a 1-line shape check (covered by R2-1's recommended block).

---

### R2-3. [LOW] Inconsistency with existing single-table broadcast mechanism

**Where:** §4 lines 332-342 (new handler); existing pattern at `collaboration.ts:418-423`.

**Issue:** The existing single-table flow uses `socket.broadcast.emit('table:moved', ...)` — Socket.IO's namespace-scoped broadcast that excludes the sender automatically. The new flow uses `broadcastToWhiteboard(whiteboardId, socket.id, 'table:move:bulk', data)` — a manual iteration over namespace sockets. Both achieve the same result (broadcast except sender), but they use different mechanisms. The spec's choice is defensible (it reuses the existing `broadcastToWhiteboard` helper, which is consistent with the rest of the codebase's "named helper" pattern), but it's worth noting that `socket.broadcast.emit('table:move:bulk', data)` would be one line shorter and match the immediate neighbour at line 418. Not a blocker; raised so a future reader has context.

---

### R2-4. [INFO] `useAutoLayoutPreference` hook still consumed elsewhere

**Where:** §7 line 501 ("`src/hooks/use-auto-layout-preference.ts` — becomes unused after the route's `autoLayoutEnabled` toggle is deleted").

**Issue:** A repository search shows `src/routes/whiteboard/$whiteboardId.new.tsx:39, :139` also imports and uses `useAutoLayoutPreference`. After Auto Layout's revisions, the hook is **not** orphaned — `$whiteboardId.new.tsx` still consumes it. The spec's claim "becomes unused" is inaccurate. Since the spec already says "Left in place for follow-up cleanup; deleting it is non-blocking and not in scope," this is purely informational — Ares should not delete the hook file regardless. Worth a one-line correction in §7's Files-not-Modified note.

---

## Updated Soundness Per Dimension (Round 2)

| Dimension | Round 1 | Round 2 | Notes |
|-----------|---------|---------|-------|
| Architecture soundness | Sound | **Sound** | The revised broadcast architecture (server function persistence-only + client-emitted broadcast + server `socket.on` re-broadcast) is *better* than the original spec — it mirrors the existing single-table pattern instead of inventing a new server-functions → routes edge. |
| Security | Concerns | **Sound** (with R2-1 caveat) | Auth-failure handling (Finding 1) is now correctly modelled. The new R2-1 finding is a defense-in-depth gap on the server-side socket handler — important to fix but a one-block copy-paste, not an architectural reshape. IDOR guard, Zod validation, and namespace-level auth all remain solid. |
| Performance | Sound | **Sound** | RAF + 10-tick budget + 500-tick cap + single transaction unchanged. The new client-emit-then-broadcast shape adds one local emit between server-function resolve and visible-confirmation; sub-millisecond overhead, no impact on the 2 s p95 budget. |
| Maintainability | Concerns | **Sound** | Cross-module import (round 1 Finding 3) is gone. Field-name skew (round 1 Finding 5) is documented with an inline comment. OQ-2 is closed (delete the bridge), not deferred. The R2-3 broadcast-mechanism inconsistency is the only remaining maintainability nit, and it's a low. |
| Integration | Concerns | **Sound** | Auth-error contract is now correctly integrated (`isUnauthorizedError`). Toolbar prop surgery, AlertDialog, and collaboration hook signature change are all idiomatic. The parent route's auto-layout bridge is cleanly removed. |

## Round 2 Issue Count

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 1 (R2-1: socket-handler guard skip) |
| Low | 2 (R2-2: validation claim mismatch, R2-3: broadcast-mechanism inconsistency) |
| Info | 1 (R2-4: `useAutoLayoutPreference` still consumed in `.new.tsx`) |

## Verdict Math

Per Apollo thresholds: **Sound = no critical, no high, ≤ 1 medium**. Round 2 has exactly 1 medium + 2 low + 1 info. **Verdict: Sound.**

The R2-1 finding is a real defense-in-depth concern but does not warrant blocking the gate — it's a 3-line copy-paste from the established pattern at `collaboration.ts:381-386` and can be applied during implementation (Ares) or caught by Hermes during code review. All five round-1 blockers are genuinely resolved (verified against the actual revised spec text and the underlying codebase APIs).

## Gate Status (Round 2)

**Gate: PASSED.** Stage 7 (Test Plan) may begin. Recommended: include R2-1 in the test plan as an explicit "session expiry mid-bulk-emit" and "permission revoked mid-bulk-emit" test case so the implementation cannot ship the handler without the guards.
