# Test Plan — Auto Layout

## Document Info

| Field | Value |
|-------|-------|
| **Feature** | Auto Layout |
| **Author** | Artemis (QA Agent) |
| **PRD Version** | 1.2 |
| **Tech Spec Revision** | 1 (post-Apollo) |
| **Date** | 2026-05-01 |
| **Test Framework** | Vitest + @testing-library/react (jsdom) |
| **Test Command** | `bun run test` |
| **Priority** | P0 |

---

## 1. Scope

This test plan covers the full Auto Layout feature as specified in `prd.md` v1.2 and `tech-spec.md` revision 1. It targets **all four implementation phases** plus the five Apollo-flagged high-risk areas that must have explicit coverage before the feature ships.

### In Scope

- Phase 1 — d3-force layout engine (`computeD3ForceLayout`, `useD3ForceLayout`)
- Phase 2 — Bulk persistence server function (`updateTablePositionsBulk`), Socket.IO collaboration handler (`socket.on('table:move:bulk', ...)`)
- Phase 3 — Toolbar button (`Toolbar.tsx`) and confirmation dialog (`AutoLayoutConfirmDialog`)
- Phase 4 — Orchestrator hook (`useAutoLayoutOrchestrator`), collaboration hook extension (`useWhiteboardCollaboration`), and integration through `ReactFlowWhiteboard`
- Apollo R2-1 risk: session expiry / permission guard on the new socket handler
- Auth error return-value path (R1 Finding 1 — `isUnauthorizedError` branch)
- `isMountedRef` stale Retry guard (R1 Finding 4)
- L∞ 16 px post-pass correctness (FR-004)
- Collaborator `table:move:bulk` userId sender guard (R1 Finding 5)

### Out of Scope

- Performance / longtask benchmarking (Stage 10 Cassandra responsibility)
- Visual regression / screenshot comparison
- Keyboard shortcut (FR-031 — P2, not in v1)
- Animated transitions (FR-030 — P2, not in v1)
- Legacy ELK path (untouched by this feature)
- `useAutoLayoutPreference` hook (left in place, not deleted)

---

## 2. Requirements → Coverage Matrix

| Req ID | Requirement | Min Test Level | Suite(s) |
|--------|-------------|---------------|----------|
| FR-001 | Auto Layout button visible in toolbar when ≥ 1 table | Unit | TS-TOOLBAR |
| FR-002 | Button disabled with tooltip when 0 or 1 tables | Unit | TS-TOOLBAR |
| FR-003 | FK-related tables placed closer than unrelated | Unit | TS-ENGINE |
| FR-004 | Every pair has L∞ gap ≥ 16 px after post-pass | Unit | TS-ENGINE |
| FR-005 | Every table receives a new position (no fixed tables) | Unit | TS-ORCH |
| FR-006 | Viewport auto-fits after layout | Integration | TS-ORCH, TS-INTEGRATION |
| FR-007 | No longtask ≥ 200 ms during run | Unit (per-tick timing) | TS-ENGINE |
| FR-008 | New positions persist on reload | Integration | TS-SERVER |
| FR-009 | Collaborators apply all positions in one render tick via `table:move:bulk` | Unit + Integration | TS-COLLAB, TS-INTEGRATION |
| FR-010 | 0-FK whiteboard produces non-overlapping layout | Unit | TS-ENGINE |
| FR-011 | Pre-run dialog for > 50 tables with full a11y | Unit + Integration | TS-DIALOG, TS-INTEGRATION |
| NFR-Auth | Auth failure → persist-failure UX (no false success) | Unit + Integration | TS-SERVER, TS-ORCH, TS-INTEGRATION |
| NFR-Reliability | No partial layout state on either screen | Unit + Integration | TS-ORCH, TS-INTEGRATION |
| NFR-Persistence | Retry after persist failure re-submits payload | Unit + Integration | TS-ORCH, TS-INTEGRATION |
| R2-1 | Socket handler runs session/permission guards | Unit | TS-COLLAB |

---

## 3. Test Suites

### TS-ENGINE — d3-force Layout Engine

**Files:**
- `src/lib/auto-layout/d3-force-layout.test.ts`
- `src/hooks/use-d3-force-layout.test.ts`

**Purpose:** Verify the layout algorithm produces correct, contract-compliant positions and terminates reliably.

---

#### TC-AL-E-01 — Zero tables: rejects with error (P0)

**Req:** FR-001 precondition, engine guard  
**File:** `d3-force-layout.test.ts`  
**Setup:** Call `computeD3ForceLayout([], [])`.  
**Expected:** Promise rejects with `"No nodes to layout"` (or equivalent non-empty error message).

---

#### TC-AL-E-02 — Single table: returns original position unchanged (P1)

**Req:** FR-005  
**File:** `d3-force-layout.test.ts`  
**Setup:** Call with 1 node, 0 edges.  
**Expected:** Promise resolves with 1 result entry whose `{ id }` matches the input node. Position values are finite numbers (may differ from input since simulation centres).

---

#### TC-AL-E-03 — Two tables, no FK edges: gap ≥ 16 px for the only pair (P0)

**Req:** FR-004, FR-010  
**File:** `d3-force-layout.test.ts`  
**Setup:** 2 nodes (w=200, h=100), 0 edges.  
**Expected:** `L∞gap(A, B) ≥ 16` where `L∞gap = max(A.left - B.right, B.left - A.right, A.top - B.bottom, B.top - A.bottom)` and each node's bounding box is computed from the returned `{ x, y }` plus its input dimensions.

---

#### TC-AL-E-04 — FK-pair proximity ratio on 10-table fixture (P0)

**Req:** FR-003  
**File:** `d3-force-layout.test.ts`  
**Setup:** 10 nodes with deterministic dimensions (200×100); 8 direct FK edges forming 3 clusters; at least 1 unrelated pair.  
**Expected:** After layout, `median(dist over FK-related pairs) ≤ 0.60 × median(dist over non-FK-related pairs)`, where `dist` is Euclidean centre-to-centre distance.

---

#### TC-AL-E-05 — 16 px L∞ gap holds on every pair in a 10-table fixture (P0)

**Req:** FR-004 (originator-screen guarantee)  
**File:** `d3-force-layout.test.ts`  
**Setup:** 10 nodes with FK edges (same fixture as TC-AL-E-04).  
**Expected:** For every distinct pair `(A, B)`, `L∞gap(A, B) ≥ 16`. Assertion checked across 3 consecutive `computeD3ForceLayout` runs to confirm the guarantee holds every time.

---

#### TC-AL-E-06 — Isolated tables (no FK to anyone) still satisfy gap contract (P0)

**Req:** FR-003 edge case (c), FR-004  
**File:** `d3-force-layout.test.ts`  
**Setup:** 5 nodes; 2 nodes form one FK pair; 3 nodes have no edges at all (isolated).  
**Expected:** All pairs — including pairs involving isolated nodes — satisfy `L∞gap ≥ 16`.

---

#### TC-AL-E-07 — Circular FK references satisfy gap contract (P0)

**Req:** FR-003 edge case (d), FR-004  
**File:** `d3-force-layout.test.ts`  
**Setup:** 3 nodes A → B → C → A (circular FK, 3 direct edges).  
**Expected:** All 3 pairs satisfy `L∞gap ≥ 16`. Each pair counted once as a direct FK-related pair.

---

#### TC-AL-E-08 — Single table (no FK partner): no crash, gap assertion skipped (P1)

**Req:** FR-003 edge case (a) — 0 FK relationships  
**File:** `d3-force-layout.test.ts`  
**Setup:** 1 node, 0 edges.  
**Expected:** Promise resolves without throwing. No pair to check for FR-003/FR-004.

---

#### TC-AL-E-09 — Fully-connected schema: proximity assertion skipped (P1)

**Req:** FR-003 edge case (b)  
**File:** `d3-force-layout.test.ts`  
**Setup:** 4 nodes, every pair connected by a direct FK edge (6 edges, 0 non-FK pairs).  
**Expected:** Promise resolves. Gap contract FR-004 still asserted for all pairs. FK proximity assertion is skipped (no non-FK pairs to compare against).

---

#### TC-AL-E-10 — 500-tick hard cap: simulation always terminates (P0)

**Req:** FR-007, NFR-Reliability  
**File:** `d3-force-layout.test.ts`  
**Setup:** Spy on `simulation.tick()`; call `computeD3ForceLayout` with 10 nodes, 5 edges.  
**Expected:** Promise resolves (does not hang). `tick` call count ≤ 500 (hard cap). Best-so-far positions are returned when cap fires before convergence.

---

#### TC-AL-E-11 — Per-RAF chunk respects 10-tick budget (P0)

**Req:** FR-007 (no longtask ≥ 200 ms)  
**File:** `d3-force-layout.test.ts`  
**Setup:** Wrap `simulation.tick()` in a timer; inject a mock `requestAnimationFrame` that records calls.  
**Expected:** Between consecutive RAF callbacks, exactly 10 ticks are executed (or fewer on the final frame). No single synchronous block accumulates > 10 ticks before yielding.

---

#### TC-AL-E-12 — `useD3ForceLayout` hook: `isRunning` transitions (P1)

**Req:** FR-020, NFR-Reliability  
**File:** `use-d3-force-layout.test.ts`  
**Setup:** Mock `computeD3ForceLayout` to resolve after a deferred tick. Use `renderHook`.  
**Expected:**
- `isRunning` is `false` before `runLayout` is called.
- `isRunning` becomes `true` while awaiting.
- `isRunning` returns to `false` after the promise resolves.
- `error` is `null` on success.

---

#### TC-AL-E-13 — `useD3ForceLayout` hook: error is surfaced without mutating nodes (P0)

**Req:** Error Flow 1 (layout sim throws)  
**File:** `use-d3-force-layout.test.ts`  
**Setup:** Mock `computeD3ForceLayout` to reject. Call `runLayout`.  
**Expected:**
- `error` is set to the thrown error.
- `runLayout` returns `null` (no positions).
- `isRunning` is `false` afterwards.
- Hook does NOT call `setNodes` (verify via mock).

---

### TS-SERVER — Bulk Persistence Server Function

**Files:**
- `src/lib/server-functions.test.ts` (append to existing) or `src/lib/server-functions-bulk.test.ts`
- `src/data/schema.test.ts` (append `bulkUpdatePositionsSchema` cases)

**Purpose:** Verify `updateTablePositionsBulk` persists atomically, enforces IDOR, rejects bad input, and surfaces `AuthErrorResponse` as a return value (not a throw).

---

#### TC-AL-S-01 — Happy path: N positions persisted in one transaction (P0)

**Req:** FR-008, NFR-Persistence  
**File:** `server-functions.test.ts`  
**Setup:** 3 tables in a whiteboard; authenticated session; call `updateTablePositionsBulk` with valid payload.  
**Expected:** Returns `{ success: true, count: 3 }`. Each `diagramTable` row has updated `positionX` / `positionY`. All 3 updates are committed atomically (verified by checking all 3 rows, not individual ones).

---

#### TC-AL-S-02 — IDOR: table ID from a different whiteboard is rejected (P0)

**Req:** Security — IDOR prevention  
**File:** `server-functions.test.ts`  
**Setup:** Use a valid `whiteboardId` but include a `positions[].id` that belongs to a different whiteboard.  
**Expected:** Throws `"Table does not belong to this whiteboard"`. No DB rows modified.

---

#### TC-AL-S-03 — Empty positions array: Zod rejects before DB call (P0)

**Req:** Input validation  
**File:** `server-functions.test.ts`  
**Setup:** Call with `positions: []`.  
**Expected:** Throws a Zod validation error. No DB query executed (mock `prisma.$transaction` not called).

---

#### TC-AL-S-04 — Positions array over 500 entries: Zod rejects (P1)

**Req:** Input validation, safety cap  
**File:** `server-functions.test.ts`  
**Setup:** Call with `positions` array of 501 items.  
**Expected:** Throws a Zod validation error. No DB query executed.

---

#### TC-AL-S-05 — Non-UUID `whiteboardId`: Zod rejects (P1)

**Req:** Input validation  
**File:** `server-functions.test.ts`  
**Setup:** Call with `whiteboardId: "not-a-uuid"`.  
**Expected:** Throws a Zod validation error.

---

#### TC-AL-S-06 — Non-finite coordinate: Zod rejects (P1)

**Req:** Input validation  
**File:** `server-functions.test.ts`  
**Setup:** Call with `positionX: Infinity` (or `NaN`).  
**Expected:** Throws a Zod validation error.

---

#### TC-AL-S-07 — Whiteboard not found: throws "Whiteboard not found" (P0)

**Req:** Security — IDOR prevention  
**File:** `server-functions.test.ts`  
**Setup:** Use a valid UUID `whiteboardId` that does not exist in the DB.  
**Expected:** Throws `"Whiteboard not found"`. No transaction attempted.

---

#### TC-AL-S-08 — Auth failure: returns `AuthErrorResponse`, does NOT throw (P0)

**Req:** HIGH Apollo Finding 1 (isUnauthorizedError return value contract)  
**File:** `server-functions.test.ts`  
**Setup:** Simulate an expired session (mock `requireAuth` to return `{ error: 'UNAUTHORIZED', status: 401 }`).  
**Expected:**
- The function **resolves** (does not throw).
- The resolved value passes `isUnauthorizedError(result) === true`.
- The resolved value has shape `{ error: 'UNAUTHORIZED', status: 401 }`.
- `prisma.$transaction` is NOT called.

---

#### TC-AL-S-09 — Transaction rollback: DB error → full rollback, rethrows (P0)

**Req:** NFR-Reliability (no partial writes)  
**File:** `server-functions.test.ts`  
**Setup:** Mock `prisma.$transaction` to throw a Prisma error mid-way.  
**Expected:**
- The function re-throws.
- DB state: all position rows remain at their pre-call values (no partial updates).

---

#### TC-AL-S-10 — `denyIfInsufficientPermission` path blocks handler (P0)

**Req:** R2-1 (Apollo Round 2) — socket handler permission guard; analogous coverage for server function auth gate  
**File:** `server-functions.test.ts`  
**Setup:** Mock `requireAuth` to simulate insufficient permission (returns or throws permission error based on the codebase pattern).  
**Expected:** Server function does not reach DB code; returns or throws a permission/auth error.

---

#### TC-AL-S-11 — `bulkUpdatePositionsSchema`: valid payload parses correctly (P1)

**Req:** Schema contract  
**File:** `schema.test.ts`  
**Setup:** Parse a well-formed payload `{ whiteboardId: '<valid-uuid>', positions: [{ id: '<uuid>', positionX: 100, positionY: 200 }] }`.  
**Expected:** `safeParse` succeeds; typed output matches input.

---

#### TC-AL-S-12 — `bulkUpdatePositionsSchema`: non-UUID `id` in positions is rejected (P1)

**Req:** Schema contract (project standard: `z.string().uuid()`, never `.cuid()`)  
**File:** `schema.test.ts`  
**Setup:** Parse with `positions[0].id = "not-a-uuid"`.  
**Expected:** `safeParse` fails.

---

### TS-COLLAB — Socket.IO Collaboration Handler

**Files:**
- `src/server/socket.test.ts` (append) or `src/routes/api/collaboration.test.ts`
- `src/hooks/use-whiteboard-collaboration.test.ts` (append)

**Purpose:** Verify the new `table:move:bulk` server handler correctly applies the session/permission prelude, re-broadcasts only to non-sender sockets, and that the client-side hook listener applies the sender guard and forwards positions.

---

#### TC-AL-C-01 — `table:move:bulk` server handler: broadcasts to other sockets, not to sender (P0)

**Req:** FR-009 multi-user atomicity  
**File:** `collaboration.test.ts`  
**Setup:** Two sockets connected to the same whiteboard namespace. Socket A emits `table:move:bulk` with a valid payload.  
**Expected:**
- Socket B receives `table:move:bulk` with the verbatim payload.
- Socket A does NOT receive the event (sender excluded by `broadcastToWhiteboard`).

---

#### TC-AL-C-02 — Handler: session expired → emits `session_expired`, disconnects, no broadcast (P0)

**Req:** R2-1 (Apollo Round 2 Finding 1) — `isSessionExpired` guard  
**File:** `collaboration.test.ts`  
**Setup:** Connect a socket; mock `isSessionExpired(socket)` to return `true`; emit `table:move:bulk` from that socket.  
**Expected:**
- `socket.emit('session_expired')` is called.
- `socket.disconnect(true)` is called.
- No `broadcastToWhiteboard` call is made.

---

#### TC-AL-C-03 — Handler: insufficient permission → returns without broadcast (P0)

**Req:** R2-1 — `denyIfInsufficientPermission` guard  
**File:** `collaboration.test.ts`  
**Setup:** Mock `denyIfInsufficientPermission(socket, whiteboardId)` to return `true` (denies). Emit `table:move:bulk` from a connected socket.  
**Expected:** No `broadcastToWhiteboard` call. Other sockets receive nothing.

---

#### TC-AL-C-04 — Handler: malformed payload (missing `positions`) → returns without broadcast (P0)

**Req:** R2-2 (payload shape validation)  
**File:** `collaboration.test.ts`  
**Setup:** Emit `table:move:bulk` with `data = { userId: 'u1' }` (missing `positions`).  
**Expected:** Handler returns early. No `broadcastToWhiteboard` call. Other sockets receive nothing.

---

#### TC-AL-C-05 — Handler: malformed payload (`positions` not an array) → returns without broadcast (P1)

**Req:** R2-2  
**File:** `collaboration.test.ts`  
**Setup:** Emit `table:move:bulk` with `data = { positions: 'not-an-array', userId: 'u1' }`.  
**Expected:** Handler returns early. No broadcast.

---

#### TC-AL-C-06 — Handler: `safeUpdateSessionActivity` is called after successful broadcast (P1)

**Req:** R2-1 — session activity update (matches existing handler pattern)  
**File:** `collaboration.test.ts`  
**Setup:** Valid payload, no session expiry, permission granted.  
**Expected:** `safeUpdateSessionActivity(socket.id)` is called once after `broadcastToWhiteboard`.

---

#### TC-AL-C-07 — Client listener: `table:move:bulk` received → calls `onBulkPositionUpdate` with positions (P0)

**Req:** FR-009, NFR-Collaboration  
**File:** `use-whiteboard-collaboration.test.ts`  
**Setup:** Render the hook with `onBulkPositionUpdate` spy; simulate the socket emitting `{ positions: [...], userId: 'other-user' }`.  
**Expected:** `onBulkPositionUpdate` is called with the positions array.

---

#### TC-AL-C-08 — Client listener: sender guard — ignores event when `data.userId === currentUserId` (P0)

**Req:** Apollo Finding 5 — userId guard; defensive sender guard  
**File:** `use-whiteboard-collaboration.test.ts`  
**Setup:** Hook initialized with `userId = 'user-a'`; simulate the socket emitting `{ positions: [...], userId: 'user-a' }` (same user).  
**Expected:** `onBulkPositionUpdate` is NOT called. Positions are NOT applied.

---

#### TC-AL-C-09 — Client listener: registers `table:move:bulk` handler on mount, removes on unmount (P1)

**Req:** Cleanup correctness  
**File:** `use-whiteboard-collaboration.test.ts`  
**Setup:** Render the hook with `onBulkPositionUpdate`; inspect `mockOn` calls; unmount; inspect `mockOff` calls.  
**Expected:**
- `mockOn` was called with `'table:move:bulk'`.
- `mockOff` was called with `'table:move:bulk'` on unmount.

---

#### TC-AL-C-10 — `emitBulkPositionUpdate` emits `table:move:bulk` with userId (P0)

**Req:** FR-009, Apollo Finding 5 — `userId` field (not `updatedBy`)  
**File:** `use-whiteboard-collaboration.test.ts`  
**Setup:** Call `emitBulkPositionUpdate([{ tableId: 'T1', positionX: 10, positionY: 20 }])` on the returned hook value.  
**Expected:** `mockEmit` was called with `'table:move:bulk'` and a payload of `{ positions: [{ tableId: 'T1', positionX: 10, positionY: 20 }], userId: <hookUserId> }`. Payload field is named `userId`, not `updatedBy`.

---

### TS-TOOLBAR — Toolbar Button

**File:** `src/components/whiteboard/Toolbar.test.tsx`

**Purpose:** Verify the Auto Layout button renders with correct states, triggers the right callback, and the legacy ELK props no longer exist.

---

#### TC-AL-T-01 — Button is visible with label "Auto Layout" when `tableCount >= 2` (P0)

**Req:** FR-001  
**Setup:** Render `<Toolbar tableCount={2} onAutoLayoutClick={spy} isAutoLayoutRunning={false} ... />`.  
**Expected:** Element with text "Auto Layout" is present and not disabled.

---

#### TC-AL-T-02 — Button is disabled when `tableCount < 2` (P0)

**Req:** FR-002  
**Setup:** Render with `tableCount={1}`.  
**Expected:** Button has `disabled` attribute (or `aria-disabled="true"`). `onAutoLayoutClick` is not called on click attempt.

---

#### TC-AL-T-03 — Button disabled with `tableCount === 0` (P0)

**Req:** FR-002  
**Setup:** Render with `tableCount={0}`.  
**Expected:** Button is disabled. Tooltip contains "Add at least 2 tables".

---

#### TC-AL-T-04 — Button shows `Loader2` spinner and is disabled when `isAutoLayoutRunning === true` (P0)

**Req:** FR-007 (re-entry guard), FR-020  
**Setup:** Render with `tableCount={5}`, `isAutoLayoutRunning={true}`.  
**Expected:** Button is disabled. Loading spinner (`Loader2` icon or equivalent) is visible within the button.

---

#### TC-AL-T-05 — Button click calls `onAutoLayoutClick` when enabled (P0)

**Req:** FR-001  
**Setup:** Render with `tableCount={3}`, `isAutoLayoutRunning={false}`, `onAutoLayoutClick` spy. Click the button.  
**Expected:** `onAutoLayoutClick` called exactly once.

---

#### TC-AL-T-06 — Legacy ELK props no longer accepted (P1)

**Req:** Tech-spec Toolbar prop surgery (clean removal)  
**Setup:** TypeScript compile check — attempt to pass `onAutoLayout`, `isAutoLayoutLoading`, `autoLayoutEnabled`, `onAutoLayoutEnabledChange` to `<Toolbar>`.  
**Expected:** TypeScript error (`bunx tsc --noEmit` reports type error). These props do not exist on `ToolbarProps`.

---

#### TC-AL-T-07 — "Auto-arrange new tables" Switch is absent from rendered output (P1)

**Req:** Tech-spec Toolbar prop surgery  
**Setup:** Render `<Toolbar tableCount={5} .../>`.  
**Expected:** No element with text "Auto-arrange new tables" or equivalent Switch for auto-arrange exists in the rendered output.

---

### TS-DIALOG — AutoLayoutConfirmDialog

**File:** `src/components/whiteboard/AutoLayoutConfirmDialog.test.tsx`

**Purpose:** Verify all FR-011 a11y acceptance criteria and interaction behaviour.

---

#### TC-AL-D-01 — Dialog has `role="alertdialog"` when open (P0)

**Req:** FR-011 a11y AC (a)  
**Setup:** Render `<AutoLayoutConfirmDialog open={true} tableCount={55} onConfirm={vi.fn()} onCancel={vi.fn()} />`.  
**Expected:** The dialog content element has `role="alertdialog"`.

---

#### TC-AL-D-02 — `aria-labelledby` points to the title element (P0)

**Req:** FR-011 a11y AC (e)  
**Setup:** Same as TC-AL-D-01.  
**Expected:** Dialog content has `aria-labelledby` attribute whose value matches the `id` of the visible title element ("Apply Auto Layout?").

---

#### TC-AL-D-03 — `aria-describedby` points to the description element (P0)

**Req:** FR-011 a11y AC (e)  
**Setup:** Same as TC-AL-D-01.  
**Expected:** Dialog content has `aria-describedby` attribute whose value matches the `id` of the description paragraph (which contains the table count and warning text).

---

#### TC-AL-D-04 — Table count appears in dialog body (P0)

**Req:** FR-011  
**Setup:** Render with `tableCount={73}`.  
**Expected:** The string "73" appears somewhere in the dialog body text.

---

#### TC-AL-D-05 — "Run Layout" button receives initial focus on open (P0)

**Req:** FR-011 a11y AC (c)  
**Setup:** Render the open dialog. Use `document.activeElement`.  
**Expected:** `document.activeElement` is the "Run Layout" button (or its inner element) immediately after render.

---

#### TC-AL-D-06 — Clicking "Cancel" calls `onCancel` (P0)

**Req:** FR-011  
**Setup:** Click the "Cancel" button.  
**Expected:** `onCancel` called once.

---

#### TC-AL-D-07 — Pressing Esc calls `onCancel` (P0)

**Req:** FR-011 a11y AC (d)  
**Setup:** Fire `keydown` Escape key inside the open dialog.  
**Expected:** `onCancel` called once. `onConfirm` not called.

---

#### TC-AL-D-08 — Clicking "Run Layout" calls `onConfirm` (P0)

**Req:** FR-011  
**Setup:** Click the "Run Layout" button.  
**Expected:** `onConfirm` called once.

---

#### TC-AL-D-09 — Dialog is not rendered when `open={false}` (P1)

**Req:** Conditional rendering  
**Setup:** Render with `open={false}`.  
**Expected:** No element with `role="alertdialog"` present in the DOM.

---

### TS-ORCH — Auto Layout Orchestrator Hook

**File:** `src/hooks/use-auto-layout-orchestrator.test.ts`

**Purpose:** Verify the orchestrator's three result branches (success, thrown error, auth-error return value), the `isMountedRef` guard, fitView timing, and toast behaviour.

---

#### TC-AL-O-01 — Success path: optimistic `setNodes`, persist, emit broadcast, fitView, success toast (P0)

**Req:** FR-005, FR-006, FR-008, FR-009, FR-022  
**Setup:** Mock `runD3ForceLayout` to resolve with 2 positions. Mock `updateTablePositionsBulk` to resolve `{ success: true, count: 2 }`. Call `runLayout`.  
**Expected (in order):**
1. `setNodes` called once with all new positions (optimistic apply).
2. `updateTablePositionsBulk` called once with the correct payload.
3. `emitBulkPositionUpdate` called with the correct positions.
4. `setTimeout` fires and `fitView({ padding: 0.2, duration: 300 })` is called.
5. `toast.success(...)` called with "Layout applied to 2 tables" (or similar).
6. `isRunning` returns to `false`.

---

#### TC-AL-O-02 — Layout simulation throws: no `setNodes`, no persist, no emit, error toast, positions unchanged (P0)

**Req:** Error Flow 1  
**Setup:** Mock `runD3ForceLayout` to throw. Call `runLayout`.  
**Expected:**
- `setNodes` NOT called (diagram left in pre-click positions).
- `updateTablePositionsBulk` NOT called.
- `emitBulkPositionUpdate` NOT called.
- `toast.error(...)` called with "Auto Layout failed" message.
- `isRunning` returns to `false`.

---

#### TC-AL-O-03 — Auth error (returned value, not thrown): persist-failure UX, no success toast, no fitView, no broadcast (P0)

**Req:** Apollo R1 Finding 1 (HIGH) — `isUnauthorizedError` return value  
**File:** `use-auto-layout-orchestrator.test.ts`  
**Setup:**
- Mock `runD3ForceLayout` to resolve with positions.
- Mock `updateTablePositionsBulk` to resolve with `{ error: 'UNAUTHORIZED', status: 401 }`.
- Spy on `triggerSessionExpired`.
- Call `runLayout`.  
**Expected:**
- `setNodes` IS called (optimistic apply precedes the await).
- `isUnauthorizedError(result)` returns `true` → enters the auth-error branch.
- `triggerSessionExpired()` is called.
- `toast.success(...)` is NOT called.
- `fitView(...)` is NOT called.
- `emitBulkPositionUpdate` is NOT called.
- `toast.error(...)` is called with a Retry action.
- `isRunning` returns to `false`.

---

#### TC-AL-O-04 — Persist throws (DB / network error): persist-failure UX, positions retained, no fitView, no broadcast (P0)

**Req:** NFR-Persistence failure UX  
**Setup:** Mock `updateTablePositionsBulk` to throw a generic Error. Call `runLayout`.  
**Expected:**
- `setNodes` IS called (optimistic apply).
- `toast.error(...)` called with Retry action.
- `fitView(...)` NOT called.
- `emitBulkPositionUpdate` NOT called.
- `isRunning` returns to `false`.

---

#### TC-AL-O-05 — Retry success: re-submits same payload, emits broadcast, clears error, no recompute (P0)

**Req:** NFR-Persistence failure UX — Retry  
**Setup:** Bring hook to persist-failure state (TC-AL-O-04 setup). Mock `updateTablePositionsBulk` to resolve successfully on the retry call. Call `handleRetry`.  
**Expected:**
- `updateTablePositionsBulk` called with the same payload as the original run (from `lastPayloadRef`).
- `emitBulkPositionUpdate` called.
- `runD3ForceLayout` NOT called again (no recompute).
- `setPersistError(null)` (error state cleared).

---

#### TC-AL-O-06 — Retry after unmount: `updateTablePositionsBulk` NOT called (P0)

**Req:** Apollo R1 Finding 4 (MEDIUM) — `isMountedRef` stale Retry guard  
**File:** `use-auto-layout-orchestrator.test.ts`  
**Setup:**
1. Bring hook to persist-failure state.
2. Unmount the hook (simulates navigation away).
3. Simulate clicking the Retry action in the sonner toast (call the Retry `onClick` handler directly).  
**Expected:**
- `updateTablePositionsBulk` is NOT called (the `isMountedRef.current === false` check fires first).
- No state updates occur after unmount.

---

#### TC-AL-O-07 — `isMountedRef` mid-await guard: state setters not called after unmount (P0)

**Req:** Apollo R1 Finding 4 — mid-await mount check  
**Setup:** Mock `updateTablePositionsBulk` to resolve after a deferred tick. Start `runLayout`. Unmount the hook before the await resolves. Let the promise resolve.  
**Expected:** No state-setter calls (`setIsRunning`, `setPersistError`) occur after unmount.

---

#### TC-AL-O-08 — `handleAutoLayoutClick` with `tableCount ≤ 50`: runs layout immediately without dialog (P0)

**Req:** FR-011 (dialog only > 50 tables)  
**Setup:** Call `handleAutoLayoutClick(5)`. Mock `runLayout` to resolve.  
**Expected:** `showConfirmDialog` remains `false`. `runLayout` executes.

---

#### TC-AL-O-09 — `handleAutoLayoutClick` with `tableCount > 50`: sets `showConfirmDialog = true` without running layout (P0)

**Req:** FR-011  
**Setup:** Call `handleAutoLayoutClick(51)`.  
**Expected:** `showConfirmDialog === true`. `runLayout` has NOT been called.

---

#### TC-AL-O-10 — `handleConfirm`: hides dialog and calls `runLayout` (P0)

**Req:** FR-011  
**Setup:** Call `handleAutoLayoutClick(51)` to open dialog; then call `handleConfirm`.  
**Expected:** `showConfirmDialog === false`. `runLayout` executes.

---

#### TC-AL-O-11 — `handleCancel`: hides dialog without running layout (P0)

**Req:** FR-011  
**Setup:** Call `handleAutoLayoutClick(51)` to open dialog; then call `handleCancel`.  
**Expected:** `showConfirmDialog === false`. `runLayout` NOT called.

---

#### TC-AL-O-12 — `isRunning` is `true` during run, `false` after (P0)

**Req:** FR-007 re-entry guard  
**Setup:** Mock `runD3ForceLayout` with a deferred resolve. Check `isRunning` mid-await.  
**Expected:** `isRunning === true` between call and resolution; `false` afterwards.

---

#### TC-AL-O-13 — Retry with auth-error on second attempt: re-shows error toast, does not emit broadcast (P0)

**Req:** NFR-Persistence — repeated Retry failure  
**Setup:** Bring to persist-failure state; mock `updateTablePositionsBulk` for retry to resolve with `{ error: 'UNAUTHORIZED', status: 401 }`. Call `handleRetry`.  
**Expected:** `emitBulkPositionUpdate` NOT called. `toast.error(...)` re-shown with Retry action.

---

### TS-INTEGRATION — ReactFlowWhiteboard Integration

**File:** `src/components/whiteboard/ReactFlowWhiteboard.test.tsx`

**Purpose:** End-to-end integration tests verifying all phases wired together correctly inside the host component.

---

#### TC-AL-I-01 — 2-table whiteboard: button click triggers layout, persist, and fitView (P0)

**Req:** FR-001, FR-005, FR-006, FR-008  
**Setup:** Render `ReactFlowWhiteboard` with 2 table nodes. Mock the orchestrator to resolve successfully. Click "Auto Layout".  
**Expected:**
- `setNodes` called once with 2 updated positions.
- `updateTablePositionsBulk` called with both table IDs.
- `fitView` called after 100 ms delay.
- Success toast visible.

---

#### TC-AL-I-02 — 1-table whiteboard: Auto Layout button is disabled (P0)

**Req:** FR-002  
**Setup:** Render with 1 table node.  
**Expected:** "Auto Layout" button is disabled. Clicking it does not invoke the orchestrator.

---

#### TC-AL-I-03 — 0-table whiteboard: Auto Layout button is disabled (P0)

**Req:** FR-002  
**Setup:** Render with 0 nodes.  
**Expected:** "Auto Layout" button is disabled.

---

#### TC-AL-I-04 — > 50 tables: click opens confirmation dialog (P0)

**Req:** FR-011  
**Setup:** Render with 51 table nodes. Click "Auto Layout".  
**Expected:** `AutoLayoutConfirmDialog` is rendered with `open={true}` and correct `tableCount={51}`.

---

#### TC-AL-I-05 — > 50 tables: Cancel on dialog → no layout runs (P0)

**Req:** FR-011  
**Setup:** Render with 51 nodes; click "Auto Layout"; click "Cancel" in dialog.  
**Expected:** `runD3ForceLayout` NOT called. Dialog closes.

---

#### TC-AL-I-06 — > 50 tables: Confirm on dialog → layout runs (P0)

**Req:** FR-011  
**Setup:** Render with 51 nodes; click "Auto Layout"; click "Run Layout" in dialog.  
**Expected:** Layout computation begins (`runD3ForceLayout` called). Dialog closes.

---

#### TC-AL-I-07 — Persist throws: error toast with Retry shown; local positions remain visible (P0)

**Req:** NFR-Persistence failure UX  
**Setup:** Mock `updateTablePositionsBulk` to throw. Click "Auto Layout".  
**Expected:**
- `setNodes` was called (positions visible locally).
- Error toast with "Retry" button visible.
- `fitView` NOT called.

---

#### TC-AL-I-08 — Persist returns `AuthErrorResponse`: error toast shown, `triggerSessionExpired` called, no success toast, no fitView (P0)

**Req:** Apollo R1 Finding 1 (HIGH)  
**Setup:** Mock `updateTablePositionsBulk` to resolve `{ error: 'UNAUTHORIZED', status: 401 }`. Click "Auto Layout".  
**Expected:**
- `toast.success(...)` NOT called.
- `fitView` NOT called.
- `triggerSessionExpired()` called.
- Error toast (with Retry) visible.

---

#### TC-AL-I-09 — Retry success: toast dismissed, positions remain, broadcast emitted (P0)

**Req:** NFR-Persistence — Retry  
**Setup:** Put component in persist-failure state; mock `updateTablePositionsBulk` to succeed on retry; click Retry in toast.  
**Expected:** `emitBulkPositionUpdate` called. Success toast shown. Error toast dismissed.

---

#### TC-AL-I-10 — Retry after navigation (unmount): `updateTablePositionsBulk` NOT called (P0)

**Req:** Apollo R1 Finding 4 (MEDIUM) — `isMountedRef` guard  
**Setup:** Put component in persist-failure state; unmount the component; click Retry action handler directly.  
**Expected:** `updateTablePositionsBulk` is NOT called.

---

#### TC-AL-I-11 — Collaborator receives `table:move:bulk` and applies all positions in one `setNodes` call (P0)

**Req:** FR-009 one-render-tick atomicity  
**Setup:** Render with `useWhiteboardCollaboration` receiving a mock `table:move:bulk` event from a different `userId`. Spy on `setNodes`.  
**Expected:** `setNodes` called exactly once (not per-position). Positions applied match the broadcast payload exactly.

---

#### TC-AL-I-12 — Collaborator ignores own `table:move:bulk` event (P0)

**Req:** Apollo Finding 5 — userId sender guard  
**Setup:** Simulate the socket emitting `table:move:bulk` with `userId` matching the current user's ID.  
**Expected:** `setNodes` NOT called (no positions applied).

---

#### TC-AL-I-13 — Layout simulation error: diagram stays at pre-click positions, error toast shown (P0)

**Req:** Error Flow 1  
**Setup:** Mock `runD3ForceLayout` to throw. Click "Auto Layout".  
**Expected:** `setNodes` NOT called. Error toast with "Auto Layout failed" message visible.

---

#### TC-AL-I-14 — Parent route contains no auto-layout state, callbacks, or socket listeners (P1)

**Req:** Tech-spec OQ-2 (DELETE the bridge)  
**File:** `src/routes/whiteboard/$whiteboardId.test.tsx` (or a TypeScript compile-only check)  
**Setup:** Verify `$whiteboardId.tsx` source file (via rg or compile check).  
**Expected:**
- `reactFlowAutoLayoutRef` does not exist.
- `handleAutoLayout` does not exist.
- `handleAutoLayoutReady` / `onAutoLayoutReady` prop does not exist.
- `layout:compute` / `layout:computed` socket listeners do not exist.
- `useAutoLayoutPreference` is not imported (in this route file).

---

## 4. Edge-Case Matrix

The following table summarises the edge cases that must be covered across the test suites, with the primary test ID that covers each:

| Edge Case | Risk | Primary Test |
|-----------|------|-------------|
| Zero tables | Button disabled, no crash | TC-AL-T-02, TC-AL-I-03 |
| Single table | Button disabled, engine returns | TC-AL-E-02, TC-AL-T-02, TC-AL-I-02 |
| All tables isolated (no FK) | FR-010 still applies 16px gap | TC-AL-E-06, TC-AL-E-03 |
| Circular FK (A→B→C→A) | All 3 pairs satisfy 16px gap | TC-AL-E-07 |
| Fully-connected schema | Proximity assertion skipped | TC-AL-E-09 |
| Session expiry mid-bulk-emit (socket handler) | No broadcast; session_expired emitted | TC-AL-C-02 |
| Auth error returned (not thrown) from server function | No false success path | TC-AL-S-08, TC-AL-O-03, TC-AL-I-08 |
| Retry after component unmount | `updateTablePositionsBulk` not called | TC-AL-O-06, TC-AL-I-10 |
| `isMountedRef` mid-await guard | No state mutation after unmount | TC-AL-O-07 |
| Collaborator same-userId guard | Own event ignored | TC-AL-C-08, TC-AL-I-12 |
| > 50 tables: dialog opened | FR-011 pre-run warning | TC-AL-D-01–08, TC-AL-I-04–06 |
| > 500 positions: Zod rejects | Safety cap | TC-AL-S-04 |
| `Infinity` / `NaN` coordinate | Zod rejects | TC-AL-S-06 |
| Transaction partial failure | Full rollback | TC-AL-S-09 |
| IDOR: foreign table ID | Rejected before transaction | TC-AL-S-02 |
| Socket handler skipping guards | Defense-in-depth | TC-AL-C-02, TC-AL-C-03 |

---

## 5. P0 Coverage Summary

All 11 P0 requirements (FR-001 through FR-011) and the four Apollo-flagged high/medium risks have at least one P0-priority test case. The table below maps each P0 item to its primary P0 test(s):

| Item | P0 Test(s) |
|------|-----------|
| FR-001 (button visible) | TC-AL-T-01, TC-AL-I-01 |
| FR-002 (button disabled) | TC-AL-T-02, TC-AL-T-03, TC-AL-I-02, TC-AL-I-03 |
| FR-003 (FK proximity) | TC-AL-E-04 |
| FR-004 (16px L∞ gap) | TC-AL-E-03, TC-AL-E-05, TC-AL-E-06, TC-AL-E-07 |
| FR-005 (all positions overwritten) | TC-AL-O-01, TC-AL-I-01 |
| FR-006 (fitView) | TC-AL-O-01, TC-AL-I-01 |
| FR-007 (no longtask) | TC-AL-E-10, TC-AL-E-11 |
| FR-008 (positions persist) | TC-AL-S-01, TC-AL-I-01 |
| FR-009 (atomic bulk broadcast) | TC-AL-C-01, TC-AL-C-07, TC-AL-I-11 |
| FR-010 (0 FK → non-overlapping) | TC-AL-E-03, TC-AL-E-06 |
| FR-011 (pre-run dialog + a11y) | TC-AL-D-01–08, TC-AL-I-04–06 |
| Apollo R1 Finding 1 (auth error return) | TC-AL-S-08, TC-AL-O-03, TC-AL-I-08 |
| Apollo R1 Finding 4 (isMountedRef Retry) | TC-AL-O-06, TC-AL-O-07, TC-AL-I-10 |
| Apollo R2-1 (socket session/permission guards) | TC-AL-C-02, TC-AL-C-03 |
| Apollo Finding 5 (userId sender guard) | TC-AL-C-08, TC-AL-C-10, TC-AL-I-12 |

---

## 6. Test File → Responsible Party (for Ares)

| Test File | Phase | Suite(s) |
|-----------|-------|---------|
| `src/lib/auto-layout/d3-force-layout.test.ts` | 1 | TS-ENGINE (TC-AL-E-01 – E-11) |
| `src/hooks/use-d3-force-layout.test.ts` | 1 | TS-ENGINE (TC-AL-E-12 – E-13) |
| `src/data/schema.test.ts` (append) | 2 | TS-SERVER (TC-AL-S-11 – S-12) |
| `src/lib/server-functions.test.ts` (append) or `server-functions-bulk.test.ts` | 2 | TS-SERVER (TC-AL-S-01 – S-10) |
| `src/routes/api/collaboration.test.ts` (append) | 2 | TS-COLLAB (TC-AL-C-01 – C-06) |
| `src/hooks/use-whiteboard-collaboration.test.ts` (append) | 4 | TS-COLLAB (TC-AL-C-07 – C-10) |
| `src/components/whiteboard/Toolbar.test.tsx` (update) | 3 | TS-TOOLBAR (TC-AL-T-01 – T-07) |
| `src/components/whiteboard/AutoLayoutConfirmDialog.test.tsx` (create) | 3 | TS-DIALOG (TC-AL-D-01 – D-09) |
| `src/hooks/use-auto-layout-orchestrator.test.ts` (create) | 4 | TS-ORCH (TC-AL-O-01 – O-13) |
| `src/components/whiteboard/ReactFlowWhiteboard.test.tsx` (append) | 4 | TS-INTEGRATION (TC-AL-I-01 – I-14) |

---

## 7. Test Conventions

- **Framework:** Vitest + `@testing-library/react` (jsdom, per `vitest.config.ts`)
- **Imports:** `import { describe, it, expect, vi, beforeEach } from 'vitest'`
- **React hooks:** `import { renderHook, act } from '@testing-library/react'`
- **Component tests:** `import { render, screen, fireEvent } from '@testing-library/react'`
- **Mocking:** `vi.mock(...)`, `vi.fn()`, `vi.spyOn(...)` — follow patterns in `use-whiteboard-collaboration.test.ts`
- **Test ID format:** `TC-AL-<Suite>-<NN>` (as used throughout this document)
- **Async:** Use `await act(async () => {...})` for state updates triggered by async operations
- **Timer faking:** Use `vi.useFakeTimers()` / `vi.runAllTimers()` for `setTimeout` calls (fitView delay)
- **UUID:** All IDs in test fixtures must be valid UUIDs (`'11111111-1111-1111-1111-111111111111'` format)

---

## 8. Definition of Done (Tests)

- [ ] All P0 test cases written and passing: `bun run test`
- [ ] All P1 test cases written and passing
- [ ] `bunx tsc --noEmit` reports no type errors
- [ ] `bun run lint` reports no new lint errors
- [ ] Every P0 requirement (FR-001 – FR-011) has at least one passing P0 test
- [ ] All four Apollo risk areas (R1-F1, R1-F4, R2-1, F5) have explicit test cases as called out in Sections 3 and 5
