# Test Plan: Auth Security Hardening

| Field        | Value                                                   |
| ------------ | ------------------------------------------------------- |
| Feature      | auth-security-hardening                                 |
| Author       | Artemis (QA Agent)                                      |
| Date         | 2026-05-09                                              |
| PRD          | prd.md v2.0                                             |
| Tech Spec    | tech-spec.md v1 (Hephaestus)                            |
| Spec Reviews | spec-review-pm.md (Approved), spec-review-sa.md (Sound) |
| Framework    | Vitest + @testing-library/react + jsdom                 |
| Test Runner  | `bun run test`                                          |

---

## Coverage Summary

| Suite                                                          | Test Count | Priority |
| -------------------------------------------------------------- | ---------- | -------- |
| Unit — `requireRole` / `requireServerFnRole` helpers           | 14         | P0       |
| Unit — `logSampledError` dedup                                 | 4          | P1       |
| Unit — `BatchDeniedError` / `ForbiddenError` shapes            | 4          | P0       |
| Unit — `verifyPassword` AST assertion (SEC-SP-02)              | 2          | P0       |
| Integration — Superpassword removal (SEC-SP-04)                | 4          | P0       |
| Integration — WebSocket `column:create` authz (SEC-WS-04)      | 6          | P0       |
| Integration — Batch RBAC all-or-nothing (SEC-BATCH-04)         | 7          | P0       |
| Integration — `getTableProjectId` throw path (Apollo MEDIUM-1) | 3          | P0       |
| Component — Batch UX contract (SEC-BATCH-UX-05)                | 5          | P0       |
| Integration — Session-expired WebSocket path (SEC-MODAL-04)    | 5          | P0       |
| Integration — Session-expired HTTP 401 path (SEC-MODAL-03)     | 3          | P0       |
| Component — Column-form draft restore (SEC-MODAL-05)           | 5          | P0       |
| Integration — RBAC per-tier denial (SEC-RBAC-05)               | 4          | P0       |
| Static — ESLint rule self-tests (SEC-RBAC-04 + SEC-MODAL-02)   | 8          | P0       |
| Regression — Five pre/post defect probes                       | 5          | P0       |
| **Total**                                                      | **79**     |          |

**P0 requirements covered: 30 / 30 (100%).**
Primary risk areas: `getTableProjectId` DB-throw anti-enumeration leak (Apollo MEDIUM-1), RBAC batch semantics (all-or-nothing pre-validate-then-write), ESLint rule wrapper-allowlist completeness.

---

## Conventions & Framework Notes

- **Runner:** Vitest 4, `bun run test` (`vitest run`).
- **DOM:** jsdom (available; pre-existing failure baseline of 119/166 for component tests — new tests must use `@testing-library/react` and explicitly set `environment: 'jsdom'` in their `describe` block or vitest config override).
- **Mocking:** `vi.mock` / `vi.fn` for Prisma and Socket.IO. Never use real DB in unit/integration tests; mock at the data-layer boundary.
- **Fixtures:** Shared fixture factory in `src/__tests__/fixtures/auth.ts` (create if absent) — produces typed `MockSocket`, `MockUser`, `MockProject`, `MockRole` objects.
- **File naming:** `*.test.ts` for non-DOM tests; `*.test.tsx` for component tests.
- **Accessibility assertions:** Use `@testing-library/dom` queries (`getByRole`, `findByRole`) not raw `querySelector`. `jest-axe` available for axe runs.
- **ESLint rule tests:** Vitest tests that use the `RuleTester` API from `eslint` directly. Fixture files in `tools/eslint-rules/__fixtures__/`.

---

## Prerequisite: Test Framework Health Check

Before running any new tests, confirm the Vitest baseline:

```
bun run test -- --reporter=verbose 2>&1 | grep -E "^(PASS|FAIL|Tests)" | tail -5
```

Expected: existing 119 passing tests continue to pass. New tests are additive.

---

## Suite 1 — Unit: `requireRole` / `requireServerFnRole` (Phase 1.3)

**File:** `src/lib/auth/require-role.test.ts`

These are the foundation helpers. All other suites depend on their correctness.

### TC-RR-01 `requireRole` — authorized user returns false (no denial)

- **Req:** SEC-WS-01, SEC-WS-02
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'EDITOR'`. Mock `getWhiteboardProjectId` → `'project-1'`.
- **Action:** Call `requireRole(mockSocket, 'whiteboard-1', 'column:create', 'EDITOR')`.
- **Assert:** Returns `false`. `mockSocket.emit` never called.

### TC-RR-02 `requireRole` — user with insufficient role emits FORBIDDEN and returns true

- **Req:** SEC-WS-01, SEC-ERR-02
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'VIEWER'`. Mock `getWhiteboardProjectId` → `'project-1'`.
- **Action:** Call `requireRole(mockSocket, 'whiteboard-1', 'column:create', 'EDITOR')`.
- **Assert:** Returns `true`. `mockSocket.emit` called once with `('error', { code: 'FORBIDDEN', event: 'column:create', message: <string> })`. `getDenialCount(userId, 'column:create')` === 1.

### TC-RR-03 `requireRole` — null role (no membership) emits FORBIDDEN and returns true

- **Req:** SEC-WS-01, SEC-ERR-03
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `null`.
- **Action / Assert:** Same as TC-RR-02. Verify the emit payload `code === 'FORBIDDEN'`.

### TC-RR-04 `requireRole` — whiteboard not found (null projectId) emits FORBIDDEN and returns true

- **Req:** SEC-ERR-03 (anti-enumeration: not-found indistinguishable from unauthorized)
- **Priority:** P0
- **Setup:** Mock `getWhiteboardProjectId` → `null`.
- **Assert:** Returns `true`. Emit called with `code: 'FORBIDDEN'`. Same payload shape as TC-RR-02. `findEffectiveRole` must NOT be called (projectId was null — no second lookup).

### TC-RR-05 `requireRole` — role lookup throws → fails closed, emits FORBIDDEN, logs sampled error

- **Req:** PRD §7 row 4, AD-6
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → throws `new Error('DB_TIMEOUT')`. Mock `logSampledError`.
- **Assert:** Returns `true`. Emit called with `code: 'FORBIDDEN'`. `logSampledError` called with `{ userId, errorClass: 'RBAC_LOOKUP_FAILED' }`. Does NOT throw to caller.

### TC-RR-06 `requireRole` — deny counter increments cumulatively across calls

- **Req:** SEC-WS-03
- **Priority:** P1
- **Setup:** Mock `findEffectiveRole` → `'VIEWER'`.
- **Action:** Call `requireRole` three times with same user + event.
- **Assert:** `getDenialCount(userId, eventName)` === 3.

### TC-RR-07 `requireServerFnRole` — authorized user resolves without throwing

- **Req:** SEC-RBAC-01
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'EDITOR'`. `resourceProjectId = 'project-1'`.
- **Action:** `await requireServerFnRole(userId, 'project-1', 'EDITOR')`.
- **Assert:** Resolves (no throw).

### TC-RR-08 `requireServerFnRole` — insufficient role throws ForbiddenError

- **Req:** SEC-RBAC-01, SEC-ERR-01
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'VIEWER'`.
- **Assert:** Throws `ForbiddenError`. Error has `status === 403` and `errorCode === 'FORBIDDEN'`.

### TC-RR-09 `requireServerFnRole` — null projectId throws ForbiddenError (anti-enumeration)

- **Req:** SEC-ERR-03
- **Priority:** P0
- **Action:** `await requireServerFnRole(userId, null, 'EDITOR')`.
- **Assert:** Throws `ForbiddenError`. `findEffectiveRole` not called.

### TC-RR-10 `requireServerFnRole` — role lookup throws → rethrows as ForbiddenError, logs sampled error

- **Req:** AD-6, PRD §7 row 4
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → throws `new Error('CONN_POOL_EXHAUSTED')`.
- **Assert:** Throws `ForbiddenError` (not the raw DB error). `logSampledError` called. Original error detail NOT in the `ForbiddenError` message.

### TC-RR-11 Role tier hierarchy — OWNER satisfies EDITOR minimum

- **Req:** SEC-RBAC-05
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'OWNER'`. `minRole = 'EDITOR'`.
- **Assert:** `requireRole` returns `false` (allow). `requireServerFnRole` resolves.

### TC-RR-12 Role tier hierarchy — VIEWER does not satisfy EDITOR minimum

- **Req:** SEC-RBAC-05
- **Priority:** P0
- **Assert:** `requireRole` returns `true` (deny). `requireServerFnRole` throws `ForbiddenError`.

### TC-RR-13 `WSAuthErrorPayload` shape completeness

- **Req:** SEC-ERR-02
- **Priority:** P0
- **Assert:** The emit payload from any denial has all three fields: `code`, `event`, `message`. No extra fields that could leak tableId, whiteboardId, projectId, or item index.

### TC-RR-14 `requireRole` WARN log contains userId, eventName, whiteboardId, role, required — no PII beyond userId

- **Req:** SEC-WS-03
- **Priority:** P1
- **Setup:** Spy on `console.warn`. Mock `findEffectiveRole` → `'VIEWER'`.
- **Assert:** `console.warn` called. Log string contains `user=<userId>`, `event=column:create`, `whiteboard=<whiteboardId>`. Does NOT contain email, display name, or resource content.

---

## Suite 2 — Unit: `logSampledError` dedup (Phase 1.3)

**File:** `src/lib/auth/log-sample.test.ts`

### TC-LOG-01 First call within window logs to console.error

- **Priority:** P1
- **Action:** `logSampledError({ userId: 'u1', errorClass: 'RBAC_LOOKUP_FAILED', message: 'fail' })`.
- **Assert:** `console.error` called once.

### TC-LOG-02 Second call within 60s window does NOT log (dedup)

- **Priority:** P1
- **Setup:** Use `vi.useFakeTimers`. Advance clock by 30s between calls.
- **Assert:** `console.error` called once total across two calls with same `(userId, errorClass)`.

### TC-LOG-03 Call after 60s window resets and logs again

- **Priority:** P1
- **Setup:** Advance clock by 61s.
- **Assert:** `console.error` called twice total (once per window).

### TC-LOG-04 Different `(userId, errorClass)` combinations each log independently

- **Priority:** P1
- **Assert:** Two distinct combos both produce log calls within the same window.

---

## Suite 3 — Unit: Error class shapes

**File:** `src/lib/auth/require-role.test.ts` (same file, separate describe block)

### TC-ERR-01 `ForbiddenError` — correct HTTP shape

- **Req:** SEC-ERR-01
- **Priority:** P0
- **Assert:** `new ForbiddenError()` has `.status === 403`, `.errorCode === 'FORBIDDEN'`, `.name === 'ForbiddenError'`, and `.message === 'You do not have access to this resource.'`.

### TC-ERR-02 `ForbiddenError` — custom message propagates

- **Priority:** P0
- **Assert:** `new ForbiddenError('custom')` has `.message === 'custom'`.

### TC-ERR-03 `BatchDeniedError` — correct HTTP shape with BATCH_DENIED code

- **Req:** SEC-BATCH-UX-04, SEC-ERR-01
- **Priority:** P0
- **Assert:** `new BatchDeniedError()` has `.status === 403`, `.errorCode === 'BATCH_DENIED'`. Message matches the PRD §4.3a SEC-BATCH-UX-02 verbatim string (includes "One or more items target a resource you no longer have access to").

### TC-ERR-04 `BatchDeniedError` — does NOT expose tableId, item index, or projectId in message

- **Req:** SEC-BATCH-03, SEC-ERR-03
- **Priority:** P0
- **Assert:** `new BatchDeniedError().message` does not contain any dynamic value (just the fixed string from the constructor). Verify by inspecting that the string does not match `/table|index|id|project/i` beyond the expected static text.

---

## Suite 4 — Unit: `verifyPassword` AST Assertion (SEC-SP-02)

**File:** `src/lib/auth/password-ast-assert.test.ts`

This suite implements the Phase 6.4 one-off AST check. Uses `@typescript-eslint/parser`.

### TC-AST-01 Every `ReturnStatement` in `verifyPassword` traces through `bcrypt.compare`

- **Req:** SEC-SP-02, PRD §3 row 1 metric
- **Priority:** P0
- **Setup:** Parse `src/lib/auth/password.ts` using `@typescript-eslint/parser`. Find `verifyPassword` function declaration. Walk all `ReturnStatement` nodes in its body.
- **Assert:** Every `ReturnStatement`'s `argument` is (directly or transitively via `await`) a call to `bcrypt.compare(...)`. Zero `ReturnStatement` nodes return a literal `true`, a string comparison, or a non-compare call.
- **Note:** This test is designed to FAIL before the superpassword branch is removed (the branch contains a `return true` that does not flow through `bcrypt.compare`). It PASSES after Phase 6.2 deletion.

### TC-AST-02 `verifyPassword` body contains no string literal equal to the previously-hardcoded debug value

- **Req:** SEC-SP-01
- **Priority:** P0
- **Setup:** Read `src/lib/auth/password.ts` and `src/routes/api/auth.ts` as text.
- **Assert:** Neither file contains the string `DEBUG_SUPER_PASSWORD` (env var name) in any non-test file after deletion. Also assert neither file contains a `process.env.DEBUG_SUPER_PASSWORD` reference.
- **Note:** This is a belt-and-suspenders check alongside TC-AST-01. TC-AST-01 is the structural proof; this is the grep-level confirmation.

---

## Suite 5 — Integration: Superpassword Removal (SEC-SP-04)

**File:** `src/routes/api/auth.test.ts` (extend existing)

**Regression probe:** These tests are written now and FAIL before Phase 6.2 removes the bypass. They PASS after the fix.

### TC-SP-01 (Regression) Login with debug superpassword fails with generic auth error

- **Req:** SEC-SP-04, SEC-SP-01
- **Priority:** P0
- **Setup:** Seed a test user `{ email: 'test@test.com', passwordHash: bcrypt.hash('realPassword') }`. Set `process.env.DEBUG_SUPER_PASSWORD = 'debug-super-pw-value'` (mock env or use the pre-fix literal from the code review findings).
- **Action:** POST login with `{ email: 'test@test.com', password: 'debug-super-pw-value' }` where `'debug-super-pw-value'` is NOT the user's real password.
- **Assert:** Response body `{ error: 'AUTH_FAILED' }` (or the existing generic invalid-credentials shape). Response status 401. NO session cookie set.
- **Fails-before:** Before Phase 6.2, the bypass branch returns success.

### TC-SP-02 Login with correct real password still succeeds after removal

- **Req:** SEC-SP-03
- **Priority:** P0
- **Action:** POST login with `{ email: 'test@test.com', password: 'realPassword' }`.
- **Assert:** Response status 200. Session cookie set.

### TC-SP-03 Login with wrong password (non-superpassword) fails with generic error

- **Req:** SEC-SP-02
- **Priority:** P0
- **Action:** POST login with `{ email: 'test@test.com', password: 'wrongPassword' }`.
- **Assert:** Same generic error response as TC-SP-01. Indistinguishable from TC-SP-01 response (same status, same body shape).

### TC-SP-04 `DEBUG_SUPER_PASSWORD` env var reference absent from production code paths

- **Req:** SEC-SP-01
- **Priority:** P0
- **Setup:** Read `src/routes/api/auth.ts` and all files under `src/lib/auth/` as text using `fs.readFileSync`.
- **Assert:** No file contains `DEBUG_SUPER_PASSWORD`. (This is a meta-level structural test, not an API call.)

---

## Suite 6 — Integration: WebSocket `column:create` Authorization (SEC-WS-04)

**File:** `src/server/socket.test.ts` (extend existing)

Uses a mock Socket.IO server or vi.mock of the collaboration handler. Mock `requireRole` / `findEffectiveRole`.

**Regression probe:** TC-WS-01 through TC-WS-03 FAIL before Phase 2 replaces the `denyIfInsufficientPermission` no-op.

### TC-WS-01 (Regression) Unauthorized user emitting `column:create` receives FORBIDDEN error, no DB write

- **Req:** SEC-WS-04, SEC-WS-01
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` to return `null` for the user's project. Spy on Prisma `column.create`.
- **Action:** Simulate a socket connection (authenticated user with no project membership) emitting `column:create` with a valid whiteboard payload.
- **Assert:** Socket receives `error` event with `{ code: 'FORBIDDEN', event: 'column:create' }`. `prisma.column.create` NOT called. No row in DB.
- **Fails-before:** Before fix, the no-op stub returns `false` (allowing through), and the column is created.

### TC-WS-02 Authorized user (Editor) emitting `column:create` succeeds

- **Req:** SEC-WS-01
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'EDITOR'`.
- **Assert:** `prisma.column.create` called. No `error` event emitted.

### TC-WS-03 Viewer user emitting `column:create` is denied

- **Req:** SEC-WS-01
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'VIEWER'`.
- **Assert:** `error` event with `code: 'FORBIDDEN'`. No DB write.

### TC-WS-04 Denial counter increments per user per event

- **Req:** SEC-WS-03
- **Priority:** P1
- **Setup:** Mock `findEffectiveRole` → `null`. Import `getDenialCount`.
- **Action:** Emit `column:create` twice from the same socket.
- **Assert:** `getDenialCount(userId, 'column:create')` === 2.

### TC-WS-05 Server logs WARN on denial with userId, projectId, event — no PII beyond userId

- **Req:** SEC-WS-03
- **Priority:** P1
- **Setup:** Spy on `console.warn`. Mock `findEffectiveRole` → `null`.
- **Action:** Emit `column:create`.
- **Assert:** `console.warn` called. Captured message includes `user=<userId>` and `event=column:create`. Does NOT include user email, display name, or column payload values.

### TC-WS-06 Whiteboard not found returns FORBIDDEN (anti-enumeration)

- **Req:** SEC-ERR-03
- **Priority:** P0
- **Setup:** Mock `getWhiteboardProjectId` → `null`.
- **Assert:** `error` event `code: 'FORBIDDEN'`. Indistinguishable from TC-WS-01 response shape.

---

## Suite 7 — Integration: Batch Column RBAC — All-or-Nothing (SEC-BATCH-04)

**File:** `src/routes/api/columns.test.ts` (new file)

Mock `getTableProjectId`, `requireServerFnRole`, `createColumns` (Prisma). Test the `createColumnsFn` server function directly (unit-integration boundary).

**Regression probe:** TC-BATCH-01 through TC-BATCH-03 FAIL before Phase 4.1 adds the pre-validate loop.

### TC-BATCH-01 (Regression) Mixed batch (authorized + unauthorized item) — zero rows written, BATCH_DENIED thrown

- **Req:** SEC-BATCH-04, SEC-BATCH-01, SEC-BATCH-02
- **Priority:** P0
- **Setup:** Three items. Items 1-2: `getTableProjectId` → `'project-A'`; `requireServerFnRole` resolves. Item 3: `getTableProjectId` → `'project-B'`; `requireServerFnRole` throws `ForbiddenError`.
- **Assert:** `createColumnsFn` throws `BatchDeniedError`. `createColumns` (write) NOT called. Zero DB writes.
- **Fails-before:** Before fix, only item 0's RBAC is checked (or no per-item check), item 3 passes through.

### TC-BATCH-02 Fully-authorized batch succeeds and writes all items

- **Req:** SEC-BATCH-04
- **Priority:** P0
- **Setup:** Three items, all `requireServerFnRole` resolve.
- **Assert:** `createColumns` called with all three items. Resolves without throwing.

### TC-BATCH-03 Fully-unauthorized batch is denied

- **Req:** SEC-BATCH-04
- **Priority:** P0
- **Setup:** All items → `requireServerFnRole` throws `ForbiddenError`.
- **Assert:** Throws `BatchDeniedError`. `createColumns` not called.

### TC-BATCH-04 BatchDeniedError does NOT expose which item or tableId triggered the denial

- **Req:** SEC-BATCH-03
- **Priority:** P0
- **Action:** Catch the `BatchDeniedError` from TC-BATCH-01.
- **Assert:** Error message does not contain any of the tableIds from the batch payload. Error does not have an `index`, `tableId`, or `itemId` property.

### TC-BATCH-05 Empty batch resolves immediately without any RBAC calls or writes

- **Priority:** P1
- **Action:** Call `createColumnsFn` with `[]`.
- **Assert:** Returns `[]`. `getTableProjectId` not called. `createColumns` not called.

### TC-BATCH-06 Single-item batch with authorized item succeeds

- **Priority:** P1
- **Assert:** `createColumns` called. Resolves.

### TC-BATCH-07 Single-item batch with unauthorized item throws BatchDeniedError

- **Priority:** P0
- **Assert:** Throws `BatchDeniedError`. `createColumns` not called.

---

## Suite 8 — Integration: `getTableProjectId` Throw Path (Apollo MEDIUM-1)

**File:** `src/routes/api/columns.test.ts` (same file as Suite 7, separate describe block)

This suite explicitly targets the Apollo MEDIUM-1 concern: `getTableProjectId` throwing (DB error, connection pool exhausted) must produce a `BatchDeniedError`, not an unhandled raw error that leaks the tableId.

### TC-GTPI-01 (Regression) `getTableProjectId` throws DB error → BatchDeniedError, no raw error propagation

- **Req:** Apollo MEDIUM-1, SEC-ERR-03, SEC-BATCH-03
- **Priority:** P0
- **Setup:** Mock `getTableProjectId` → throws `new Error('Connection pool exhausted for table-id-abc123')`. The raw error message contains the tableId.
- **Action:** Call `createColumnsFn` with one item targeting that tableId.
- **Assert:** Throws `BatchDeniedError`. The `BatchDeniedError` message does NOT contain `'table-id-abc123'`. `createColumns` not called. `logSampledError` called with the raw error (server-side audit preserved).
- **Fails-before:** Without MEDIUM-1 fix, the raw Prisma `Error` propagates to the caller, potentially leaking the tableId in TanStack Start's error serialization.

### TC-GTPI-02 `getTableProjectId` DB error on item 2 of 3 — still throws BatchDeniedError (not item-1's success)

- **Req:** Apollo MEDIUM-1, SEC-BATCH-02
- **Priority:** P0
- **Setup:** Item 1: `getTableProjectId` → `'project-A'`, `requireServerFnRole` resolves. Item 2: `getTableProjectId` → throws. Item 3: never reached.
- **Assert:** Throws `BatchDeniedError`. Zero writes. Item 1's resolved RBAC check does not cause a partial write.

### TC-GTPI-03 `getTableProjectId` returns null (not-found) → BatchDeniedError, indistinguishable from throw path

- **Req:** SEC-ERR-03
- **Priority:** P0
- **Setup:** `getTableProjectId` → `null` (missing row).
- **Assert:** Throws `BatchDeniedError`. Same error shape as TC-GTPI-01. Client cannot distinguish "table doesn't exist" from "table exists but you're not authorized."

---

## Suite 9 — Component: Batch UX Contract (SEC-BATCH-UX-05)

**File:** `src/components/whiteboard/<column-batch-form>.test.tsx` (path confirmed by Ares during Phase 4.3)

Uses `@testing-library/react`, `vi.mock` for the `createColumnsFn` call.

**Note:** The component file path will be resolved by Ares using `rg "createColumnsFn" src/components`. This plan specifies what to test; Ares confirms the file path.

### TC-BUX-01 Batch form retains input after BATCH_DENIED response

- **Req:** SEC-BATCH-UX-01, SEC-BATCH-UX-05
- **Priority:** P0
- **Setup:** Render the column-batch form with 3 rows of input. Mock `createColumnsFn` → throws `BatchDeniedError`.
- **Action:** Submit the form.
- **Assert:** All 3 rows still rendered with original values (no clear/reset). Form is NOT in an empty state.

### TC-BUX-02 Error banner with SEC-BATCH-UX-02 canonical message appears

- **Req:** SEC-BATCH-UX-02, SEC-BATCH-UX-05
- **Priority:** P0
- **Assert:** Banner visible with text matching "This batch could not be saved. One or more items target a resource you no longer have access to." Use `getByText` or `findByText` with a partial match of this string.

### TC-BUX-03 Bisection affordance (save-individually button or save-half) is present in the DOM

- **Req:** SEC-BATCH-UX-03, SEC-BATCH-UX-05
- **Priority:** P0
- **Assert:** At least one of: a "Save this row only" button per row, OR a "Save half" / "Try smaller batch" button. Use `getByRole('button')` query. At least one such button must exist.

### TC-BUX-04 Bisection affordance is reachable via Tab key navigation

- **Req:** SEC-BATCH-UX-03, SEC-BATCH-UX-05, PRD §12
- **Priority:** P0
- **Setup:** After BATCH_DENIED renders, start with focus on the form container.
- **Action:** Tab through until the bisection button receives focus.
- **Assert:** `document.activeElement` equals the bisection button at some point during Tab traversal. (Use `userEvent.tab()` from `@testing-library/user-event`.)

### TC-BUX-05 Error banner has `role="alert"` or equivalent live-region attribute for screen readers

- **Req:** PRD §12 accessibility, SEC-BATCH-UX-05
- **Priority:** P0
- **Assert:** The banner element has `role="alert"` OR `aria-live="assertive"`. Use `getByRole('alert')`.

---

## Suite 10 — Integration: Session-Expired WebSocket Path (SEC-MODAL-04)

**File:** `src/hooks/use-whiteboard-collaboration-auth.test.ts` (extend existing) OR `src/hooks/use-collaboration.test.ts` (if the former doesn't exist)

Mock the Socket.IO client instance. Use `renderHook` from `@testing-library/react`.

**Regression probe:** TC-MODAL-01 FAILS before Phase 5.1 makes `onSessionExpired` mandatory.

### TC-MODAL-01 (Regression) `session_expired` socket event invokes `triggerSessionExpired` exactly once

- **Req:** SEC-MODAL-04, SEC-MODAL-01
- **Priority:** P0
- **Setup:** Mock the Socket.IO socket. Spy on `triggerSessionExpired` (from `useAuthContext`).
- **Action:** Simulate the socket emitting `'session_expired'`.
- **Assert:** `triggerSessionExpired` called exactly once. `SessionExpiredModal` becomes visible.
- **Fails-before:** Before Phase 5.1, `onSessionExpired` is optional and callers pass `undefined`, so `triggerSessionExpired` is never called.

### TC-MODAL-02 Focus moves to the modal (or first focusable element) when it renders

- **Req:** SEC-MODAL-04, PRD §12 (D26 accessibility extension)
- **Priority:** P0
- **Setup:** Render the component tree including `SessionExpiredModal`. Simulate `session_expired`.
- **Assert:** After one render cycle, `document.activeElement` is the modal or an element inside it. Use `findByRole('dialog')` and check `contains(document.activeElement)`.

### TC-MODAL-03 Single `session_expired` event does NOT call `triggerSessionExpired` more than once (no duplicate handlers)

- **Req:** SEC-MODAL-02
- **Priority:** P0
- **Setup:** Same as TC-MODAL-01.
- **Assert:** `triggerSessionExpired` called exactly 1 time, not 2 or more.

### TC-MODAL-04 `triggerSessionExpired` error does not leave UI stuck (fallback to hard nav)

- **Req:** PRD §7 row 3 failure mode
- **Priority:** P1
- **Setup:** Mock `triggerSessionExpired` → throws. Spy on `window.location.assign` or `window.location.href`.
- **Assert:** Does not throw to the socket event handler. User is navigated to `/login?redirect=<currentUrl>` as fallback.

### TC-MODAL-05 Unsaved-state persistence (draft) runs before modal redirect

- **Req:** SEC-MODAL-05, PRD §5.1 step 4
- **Priority:** P0
- **Setup:** Render column-edit modal with form values filled in. Spy on `sessionStorage.setItem`.
- **Action:** Simulate `session_expired` socket event.
- **Assert:** `sessionStorage.setItem` called with key matching `draft:${whiteboardId}:${columnId}` BEFORE `triggerSessionExpired` is called (check call order via mock call index).

---

## Suite 11 — Integration: Session-Expired HTTP 401 Path (SEC-MODAL-03)

**File:** `src/hooks/use-whiteboard-collaboration-auth.test.ts` (same file as Suite 10)

This suite is explicitly required by PM Minor #1 and Apollo MINOR-4. PRD SEC-MODAL-03 requires "a test asserts both paths."

**Regression probe:** TC-HTTP401-01 FAILS before the fix if the HTTP 401 handler was not wired or was broken by the PR #97 changes.

### TC-HTTP401-01 (Regression) HTTP 401 response triggers `triggerSessionExpired`

- **Req:** SEC-MODAL-03
- **Priority:** P0
- **Setup:** Mock the HTTP client (or TanStack Query's error handler) to return a 401 response for a server function call.
- **Assert:** `triggerSessionExpired` called. `SessionExpiredModal` renders.
- **Fails-before:** If AD-7's changes inadvertently broke the HTTP 401 intercept path, this test fails.

### TC-HTTP401-02 HTTP 401 and WebSocket `session_expired` both route through the same `triggerSessionExpired` call

- **Req:** SEC-MODAL-03
- **Priority:** P0
- **Assert:** Using the same `triggerSessionExpired` spy, both a mocked 401 HTTP response AND a mocked `session_expired` socket event each independently invoke it. The paths are not merged/deduplicated at the call site — two separate triggers each produce exactly one call.

### TC-HTTP401-03 HTTP 401 with `redirect` query parameter preserved

- **Req:** SEC-MODAL-01 (modal behavior: redirects to `/login?redirect=<currentUrl>`)
- **Priority:** P1
- **Setup:** Trigger via HTTP 401. Current URL is `/whiteboard/wb-123`.
- **Assert:** After `triggerSessionExpired` renders the modal and user clicks "Log in again," navigation target is `/login?redirect=%2Fwhiteboard%2Fwb-123` (or equivalent encoded form).

---

## Suite 12 — Component: Column-Form Draft Restore (SEC-MODAL-05)

**File:** `src/components/whiteboard/<column-edit-modal>.test.tsx` (new — path confirmed by Ares, search `rg "createColumnSchema|updateColumnSchema" src/components`)

### TC-DRAFT-01 Column-form changes written to sessionStorage with correct key

- **Req:** SEC-MODAL-05, AD-4
- **Priority:** P0
- **Setup:** Render column-edit modal with `whiteboardId='wb-1'`, `columnId='col-1'`. Spy on `sessionStorage.setItem`.
- **Action:** Change the "Column Name" field to `'new_name'`.
- **Assert:** `sessionStorage.setItem` called with key `'draft:wb-1:col-1'`. Value is JSON-parseable and contains `name: 'new_name'`.

### TC-DRAFT-02 Draft read and prefilled into form on modal mount after re-auth

- **Req:** SEC-MODAL-05
- **Priority:** P0
- **Setup:** Pre-seed `sessionStorage['draft:wb-1:col-1'] = JSON.stringify({ name: 'draft_name', dataType: 'TEXT' })`. Mock `useAuthContext().sessionExpired` → just transitioned from `true` to `false` (re-auth occurred).
- **Action:** Render/mount the column-edit modal.
- **Assert:** Form fields show `'draft_name'` and `'TEXT'`. Apply/Discard banner is visible (contains "apply" or "discard" text).

### TC-DRAFT-03 "Apply" button keeps draft values; "Discard" clears form and removes sessionStorage key

- **Req:** SEC-MODAL-05
- **Priority:** P0
- **Action Discard:** Click Discard button. **Assert:** `sessionStorage.removeItem` called with `'draft:wb-1:col-1'`. Form fields reset to original values.
- **Action Apply:** (separate test run) Click Apply button. **Assert:** Form retains draft values. `sessionStorage` key still present (user hasn't saved yet).

### TC-DRAFT-04 Draft key deleted on successful save

- **Req:** SEC-MODAL-05
- **Priority:** P0
- **Setup:** Draft exists in sessionStorage. User completes form and submits.
- **Assert:** `sessionStorage.removeItem` called with `'draft:wb-1:col-1'` after successful save.

### TC-DRAFT-05 Different columns use non-colliding keys (`draft:wbId:colId` uniqueness)

- **Req:** AD-4
- **Priority:** P1
- **Action:** Set drafts for two columns: `wb-1:col-1` and `wb-1:col-2`.
- **Assert:** `sessionStorage` entries are distinct. Restoring one modal does not prefill the other column's form.

---

## Suite 13 — Integration: RBAC Per-Tier Denial (SEC-RBAC-05)

**File:** `src/lib/server-functions.test.ts` (new file)

Four tests, one per role tier. Use `vi.mock` for Prisma + `findEffectiveRole`. Call server functions directly (bypassing TanStack Start's HTTP transport; test the handler logic in isolation).

**Regression probe:** All four FAIL before Phase 3 adds `requireServerFnRole` calls.

### TC-RBAC-01 (Regression) VIEWER role denied on EDITOR-required function (e.g., `createTable`)

- **Req:** SEC-RBAC-05, SEC-RBAC-01
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'VIEWER'`. Target a server function that requires EDITOR (e.g., `createTableFn` from `src/routes/api/tables.ts` or equivalent in the in-scope file).
- **Assert:** Throws `ForbiddenError` with `status === 403`. No Prisma write called.
- **Fails-before:** Before fix, the TODO no-op allows the call through.

### TC-RBAC-02 (Regression) EDITOR role denied on ADMIN-required function (e.g., update project permissions)

- **Req:** SEC-RBAC-05
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'EDITOR'`. Target a function in `src/routes/api/permissions.ts` that requires ADMIN.
- **Assert:** Throws `ForbiddenError`.

### TC-RBAC-03 (Regression) ADMIN role denied on OWNER-required function (e.g., project delete)

- **Req:** SEC-RBAC-05
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `'ADMIN'`. Target a function requiring OWNER (e.g., `deleteProjectFn` in `src/routes/api/projects.ts`).
- **Assert:** Throws `ForbiddenError`.

### TC-RBAC-04 (Regression) No role (null membership) denied on VIEWER-required read function

- **Req:** SEC-RBAC-05, SEC-RBAC-02
- **Priority:** P0
- **Setup:** Mock `findEffectiveRole` → `null`. Target a read-only function requiring VIEWER (e.g., `getWhiteboardWithDiagram` or equivalent).
- **Assert:** Throws `ForbiddenError`. No Prisma read called.
- **Note:** Verifies that read-only functions also enforce authorization (PRD SEC-RBAC-02 — no public-read-mutating-write asymmetry).

---

## Suite 14 — Static: ESLint Rule Self-Tests (SEC-RBAC-04 + SEC-MODAL-02)

**File:** `tools/eslint-rules/require-server-fn-authz.test.js`

Uses ESLint's `RuleTester` API. Each test lints a small fixture string or fixture file. These tests validate the guard that prevents regression across all 83+ server-function exports.

### TC-ESLINT-01 (Explicitly required by spec) `createServerFn` without RBAC call → rule fails

- **Req:** SEC-RBAC-04
- **Priority:** P0
- **Fixture:** A `createServerFn(...)` with `.handler(async (ctx, data) => { return db.query() })` — no `requireServerFnRole`, no `@requires` JSDoc.
- **Assert:** `RuleTester` reports an error on this code. Error message references the missing authz requirement.

### TC-ESLINT-02 `createServerFn` with `@requires editor` JSDoc but no `requireServerFnRole` call → rule fails

- **Req:** SEC-RBAC-04 (annotations alone are insufficient)
- **Priority:** P0
- **Fixture:** Handler has JSDoc `/** @requires editor */` but body does not call `requireServerFnRole`.
- **Assert:** Rule fails. The annotation without a real call does NOT satisfy the rule.

### TC-ESLINT-03 `createServerFn` with `@requires authenticated` JSDoc → rule passes (escape hatch)

- **Req:** SEC-RBAC-04 (authenticated escape hatch)
- **Priority:** P0
- **Fixture:** Handler has JSDoc `/** @requires authenticated */`. No `requireServerFnRole` call.
- **Assert:** Rule passes. The `@requires authenticated` tag is the valid escape hatch.

### TC-ESLINT-04 `createServerFn` wrapped in `requireAuth(...)` + `requireServerFnRole` call → rule passes

- **Req:** SEC-RBAC-04
- **Priority:** P0
- **Fixture:** `.handler(requireAuth(async ({ user }, data) => { await requireServerFnRole(user.id, projectId, 'EDITOR'); return db.query() }))`.
- **Assert:** Rule passes.

### TC-ESLINT-05 `withAuth(fn)` wrapper NOT in the allowlist → rule fails (gutted-wrapper detection)

- **Req:** SEC-RBAC-04 (wrapper allowlist — closes Nemesis BLOCKING-3)
- **Priority:** P0
- **Fixture:** `.handler(someOtherWrapper(async (ctx, data) => { ... }))` where `someOtherWrapper` is not `requireAuth`.
- **Assert:** Rule fails. The wrapper is not in the allowlist — the rule cannot verify it calls `requireServerFnRole`.

### TC-ESLINT-06 `createServerFn` with `@requires unauthenticated` JSDoc (login/register handlers) → rule passes

- **Req:** SEC-RBAC-04, spec §2.2 accepted-risk handling
- **Priority:** P0
- **Assert:** Rule passes. Pre-auth endpoints are correctly handled via the `@requires unauthenticated` escape hatch.

### TC-ESLINT-07 Two files each containing `socket.on('session_expired', ...)` → rule fails (SEC-MODAL-02)

- **Req:** SEC-MODAL-02 (single-registration assertion)
- **Priority:** P0
- **Note:** Implemented as either a cross-file `Program:exit` rule pass or a separate Vitest meta-test that searches `src/` for the string literal `'session_expired'` in `socket.on(...)` calls and asserts exactly one match. If implemented as `RuleTester`, use multiple source files in the test.
- **Assert:** Rule/test fails when more than one registration is found.

### TC-ESLINT-08 Single file containing `socket.on('session_expired', ...)` → SEC-MODAL-02 check passes

- **Req:** SEC-MODAL-02
- **Priority:** P0
- **Assert:** Rule/test passes with exactly one registration.

---

## Suite 15 — Regression: Five Pre/Post Defect Probes

These five tests are the PRD §6 "fail-before-fix, pass-after-fix" mandate (D6). Each maps to exactly one of the five defects. They should be tagged or grouped so CI can run them in isolation as a regression gate.

| Test ID   | Defect                         | Fails Before | Passes After |
| --------- | ------------------------------ | ------------ | ------------ |
| TC-REG-01 | Superpassword bypass           | TC-SP-01     | Phase 6.2    |
| TC-REG-02 | WebSocket IDOR `column:create` | TC-WS-01     | Phase 2.1    |
| TC-REG-03 | Batch RBAC gap                 | TC-BATCH-01  | Phase 4.1    |
| TC-REG-04 | Session-expired modal unwired  | TC-MODAL-01  | Phase 5.1    |
| TC-REG-05 | Server-function RBAC missing   | TC-RBAC-01   | Phase 3.2    |

These are not separate test cases — each of the five is the first test in its respective integration suite (TC-SP-01, TC-WS-01, TC-BATCH-01, TC-MODAL-01, TC-RBAC-01). They are collected here as a named set for PRD traceability.

**Ares must verify:** run `bun run test` against the unfixed codebase (before any Phase changes) and confirm these five tests fail. Run again after each Phase and confirm they pass.

---

## Requirements Coverage Matrix

| Requirement ID  | Test Cases                                                           | P0? |
| --------------- | -------------------------------------------------------------------- | --- |
| SEC-SP-01       | TC-SP-04, TC-AST-02                                                  | P0  |
| SEC-SP-02       | TC-AST-01                                                            | P0  |
| SEC-SP-03       | TC-SP-02                                                             | P0  |
| SEC-SP-04       | TC-SP-01 (TC-REG-01)                                                 | P0  |
| SEC-WS-01       | TC-WS-01, TC-WS-02, TC-WS-03, TC-WS-06                               | P0  |
| SEC-WS-02       | TC-RR-01, TC-RR-07                                                   | P0  |
| SEC-WS-03       | TC-WS-04, TC-WS-05, TC-RR-06, TC-RR-14                               | P0  |
| SEC-WS-04       | TC-WS-01 (TC-REG-02)                                                 | P0  |
| SEC-BATCH-01    | TC-BATCH-01, TC-BATCH-02                                             | P0  |
| SEC-BATCH-02    | TC-BATCH-01, TC-GTPI-02                                              | P0  |
| SEC-BATCH-03    | TC-BATCH-04, TC-ERR-04, TC-GTPI-01                                   | P0  |
| SEC-BATCH-04    | TC-BATCH-01 (TC-REG-03), TC-BATCH-02, TC-BATCH-03                    | P0  |
| SEC-BATCH-UX-01 | TC-BUX-01                                                            | P0  |
| SEC-BATCH-UX-02 | TC-BUX-02                                                            | P0  |
| SEC-BATCH-UX-03 | TC-BUX-03, TC-BUX-04                                                 | P0  |
| SEC-BATCH-UX-04 | TC-ERR-03, TC-WS-01 (BATCH_DENIED shape)                             | P0  |
| SEC-BATCH-UX-05 | TC-BUX-01 through TC-BUX-05                                          | P0  |
| SEC-MODAL-01    | TC-MODAL-01 (TC-REG-04)                                              | P0  |
| SEC-MODAL-02    | TC-ESLINT-07, TC-ESLINT-08, TC-MODAL-03                              | P0  |
| SEC-MODAL-03    | TC-HTTP401-01, TC-HTTP401-02, TC-HTTP401-03                          | P0  |
| SEC-MODAL-04    | TC-MODAL-01, TC-MODAL-02, TC-MODAL-03                                | P0  |
| SEC-MODAL-05    | TC-MODAL-05, TC-DRAFT-01 through TC-DRAFT-05                         | P0  |
| SEC-RBAC-01     | TC-RR-07, TC-RR-08, TC-RBAC-01 through TC-RBAC-04                    | P0  |
| SEC-RBAC-02     | TC-RBAC-04                                                           | P0  |
| SEC-RBAC-03     | TC-ESLINT-01, TC-ESLINT-02 (JSDoc presence validates by implication) | P0  |
| SEC-RBAC-04     | TC-ESLINT-01 through TC-ESLINT-06                                    | P0  |
| SEC-RBAC-05     | TC-RBAC-01 through TC-RBAC-04 (TC-REG-05 = TC-RBAC-01)               | P0  |
| SEC-ERR-01      | TC-ERR-01, TC-ERR-02, TC-RR-08                                       | P0  |
| SEC-ERR-02      | TC-RR-02, TC-RR-13, TC-WS-01                                         | P0  |
| SEC-ERR-03      | TC-RR-04, TC-RR-09, TC-WS-06, TC-BATCH-04, TC-GTPI-01, TC-GTPI-03    | P0  |
| Apollo MEDIUM-1 | TC-GTPI-01, TC-GTPI-02, TC-GTPI-03                                   | P0  |

**All 30 PRD P0 requirements covered. Apollo MEDIUM-1 explicitly covered.**

---

## File Delivery Map

| Test File                                                | Suite(s) | Status         |
| -------------------------------------------------------- | -------- | -------------- |
| `src/lib/auth/require-role.test.ts`                      | 1, 3     | New            |
| `src/lib/auth/log-sample.test.ts`                        | 2        | New            |
| `src/lib/auth/password-ast-assert.test.ts`               | 4        | New            |
| `src/routes/api/auth.test.ts`                            | 5        | Extend         |
| `src/server/socket.test.ts`                              | 6        | Extend         |
| `src/routes/api/columns.test.ts`                         | 7, 8     | New            |
| `src/components/whiteboard/<column-batch-form>.test.tsx` | 9        | New (path TBD) |
| `src/hooks/use-whiteboard-collaboration-auth.test.ts`    | 10, 11   | Extend         |
| `src/components/whiteboard/<column-edit-modal>.test.tsx` | 12       | New (path TBD) |
| `src/lib/server-functions.test.ts`                       | 13       | New            |
| `tools/eslint-rules/require-server-fn-authz.test.js`     | 14       | New            |
| `tools/eslint-rules/__fixtures__/good-server-fn.ts`      | 14       | New            |
| `tools/eslint-rules/__fixtures__/bad-server-fn.ts`       | 14       | New            |

Two component file paths (column-batch-form, column-edit-modal) are TBD — Ares resolves during Phase 4.3 and Phase 5.3 using `rg "createColumnsFn"` and `rg "createColumnSchema|updateColumnSchema" src/components`.

---

## Edge Cases and Attacker Scenarios

| Scenario                                                                                | Coverage                                                          |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Submitting batch where item N targets a non-existent whiteboard (not just unauthorized) | TC-GTPI-03, TC-WS-06 — same FORBIDDEN response, indistinguishable |
| DB unreachable during RBAC check for a WebSocket event                                  | TC-RR-05 — fail-closed, FORBIDDEN emitted                         |
| DB unreachable during `getTableProjectId` for batch item                                | TC-GTPI-01 — BatchDeniedError, no raw error propagation           |
| Duplicate `session_expired` socket registrations added by future developer              | TC-ESLINT-07, TC-MODAL-03                                         |
| New `createServerFn` export added without `@requires` JSDoc                             | TC-ESLINT-01                                                      |
| New `createServerFn` export with fake annotation but no real `requireServerFnRole` call | TC-ESLINT-02                                                      |
| Wrapper HOF (`withAuth`) that no-ops `requireServerFnRole` ("gutted wrapper")           | TC-ESLINT-05                                                      |
| User with OWNER role calling EDITOR-required function                                   | TC-RR-11 — must be allowed (tier hierarchy)                       |
| `triggerSessionExpired` itself throws                                                   | TC-MODAL-04 — fallback to hard nav, no stuck UI                   |
| Session-expired fires mid-batch-column-operation                                        | TC-MODAL-05 — draft persisted before modal redirect               |
| Superpassword env var set but bypass code deleted                                       | TC-SP-01, TC-SP-04 — both confirm denial                          |

---

## Known Constraints and Mitigations

| Constraint                                                              | Mitigation                                                                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-existing jsdom component test failures (119/166 passing baseline)   | New component tests explicitly set `environment: 'jsdom'` in their describe block or vitest config override; baseline count tracked separately |
| Column-edit modal and column-batch-form file paths unknown at plan time | Suites 9 and 12 specify what to test; Ares confirms paths during implementation; test skeletons use `// TODO: confirm path` comments           |
| ESLint cross-file `Program:exit` state in flat config may be awkward    | TC-ESLINT-07/08 allow an alternative: Vitest meta-test that uses `rg` output to count `session_expired` registrations — acceptable per PRD D20 |
| Real Socket.IO loopback tests are bonus (D10 constraint)                | All socket tests mock the socket; integration loop-back tests are explicitly optional                                                          |
| Phase 6.1 instrumentation (AD-8) is a pre-merge step, not a test        | TC-SP-04 and TC-AST-02 validate post-removal; the instrumentation phase is verified by §13.5 checklist, not by test                            |
