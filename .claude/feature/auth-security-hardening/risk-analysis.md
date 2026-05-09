# Risk Analysis: Auth Security Hardening

| Field | Value |
| --- | --- |
| Feature | auth-security-hardening |
| Analyst | Cassandra |
| Stage | 11-review |
| Date | 2026-05-09 |
| Verdict | Caution |

---

## Summary

Implementation fixes 5 P0 security vulnerabilities. Core security objectives achieved: superpassword removed, 13 WS handlers now enforce real RBAC, 85+ server function exports annotated and guarded, session-expired modal wired, batch RBAC pre-validates before writes. No CRITICAL findings. Three HIGH findings, seven MEDIUM findings. All addressable without architectural rework.

---

## Findings

### CRITICAL

None.

---

### HIGH

#### H-1: ESLint Rule Accepts `findEffectiveRole` Alone as RBAC Evidence

**File:** `tools/eslint-rules/require-server-fn-authz.cjs` lines 54-58

**Finding:** The `bodyCallsRequireServerFnRole` helper returns `true` if it detects a call to `findEffectiveRole` OR `hasMinimumRole` independently — not necessarily both together. A handler that calls only `findEffectiveRole(...)` and discards the result (never calling `hasMinimumRole`) passes the ESLint guard. This allows a developer to write a gutted wrapper that acquires a role value but never evaluates it against the minimum role threshold. The guard would emit green while RBAC is completely absent.

**Why it matters:** The ESLint rule (SEC-RBAC-04) is the last enforcement line. If it can be satisfied with `findEffectiveRole` alone, any future handler that follows the legacy "import-then-ignore" pattern goes undetected.

**Required mitigation:** Either require both `findEffectiveRole` AND `hasMinimumRole` in the same body (paired assertion), or deprecate the legacy pattern escape and require all new handlers to use `requireServerFnRole`. At minimum, add a fixture test that has `findEffectiveRole` with no `hasMinimumRole` and assert the rule fires.

---

#### H-2: `getAllProjects` Returns All Projects Without User Filtering (Data Exposure)

**File:** `src/lib/server-functions-project.ts` lines 16-35

**Finding:** `getAllProjects` calls `prisma.project.findMany({})` with no `where` clause scoped to the requesting user. Any authenticated user receives every project in the database — including projects they have no membership in and no ownership of. The function carries `@requires authenticated` and the escape-hatch bypasses the RBAC guard. The comment says "enforced at the DB layer (project.ownerId or ProjectMember membership)" but neither `ownerId` nor a membership join is applied to the query.

**Why it matters:** This is a horizontal privilege escalation. User A who is a member of only Project X can enumerate Project Y, Z, etc., their names, whiteboards, and whiteboard-count. This predates the current feature but the feature's scope explicitly annotated and "approved" this endpoint as `@requires authenticated`, sealing it from future RBAC guard enforcement.

**Required mitigation:** Add a `where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] }` filter to the Prisma query, scoped to the authenticated user from the `requireAuth` context. The accepted-risk annotation in tech-spec.md §2.2 did not explicitly flag this.

---

#### H-3: `BatchColumnForm` Shows BATCH_DENIED Message for All Errors (UX Misdirection + Information Leak)

**File:** `src/components/whiteboard/BatchColumnForm.tsx` lines 139-142

**Finding:** The catch block checks for `BATCH_DENIED` errorCode first, then falls through to `setDenied(true)` unconditionally for all other errors with the comment "show generic banner." The rendered banner always shows the fixed string `BATCH_DENIED_MESSAGE`: "This batch could not be saved. One or more items target a resource you no longer have access to." For a network timeout, validation error, or server 500, the user sees an access-denial message that is false. Worse, the bisection affordance appears (line 195: `rows.length > 1`) for non-RBAC errors, inviting unnecessary bisection attempts.

**Why it matters:** False access-denial messaging trains users to believe they have lost permissions when they have not. On a network error during a 20-row batch submission the user may start removing rows from a table they legitimately own. This also obscures real errors from developers and support.

**Required mitigation:** Add a separate state for generic errors vs RBAC denial. Show a neutral "Save failed. Please try again." for non-BATCH_DENIED errors. Only show the access-denial message and bisection affordance on confirmed `BATCH_DENIED`.

---

### MEDIUM

#### M-1: `isUnauthorizedError` Heuristic Fragile — String-Match on Error Messages

**File:** `src/integrations/tanstack-query/root-provider.tsx` lines 7-21

**Finding:** The 401 detection relies on `error.message.toLowerCase().includes('unauthorized')` OR `error.message.includes('401')`. This is a brittle string-match heuristic. Two failure modes: (a) A server error with "unauthorized" anywhere in its message triggers a session-expired modal — false positive could log users out during a valid session. (b) TanStack Start may change how it serializes error messages; if the string changes to "Forbidden" or an opaque message the 401 path silently breaks, and HTTP 401s stop triggering the modal.

**Severity rationale:** Not CRITICAL because (a) ForbiddenError messages do not contain "unauthorized" or "401" so 403s are not currently affected; (b) the existing requireAuth middleware returns `{error: 'UNAUTHORIZED', status: 401}` as a value (not a throw), so TanStack Start may not surface this through the QueryCache `onError` path at all.

**Mitigation:** Prefer matching on a structured error code field (e.g., check `(error as any).data?.error === 'UNAUTHORIZED'` or TanStack Start's canonical `statusCode === 401`). Add a test that verifies a 403 `ForbiddenError` does NOT trigger `dispatchUnauthorized`.

---

#### M-2: `logSampledError` and `denialCounter` Maps Are Unbounded — Memory Leak in Long-Running Server

**Files:** `src/lib/auth/log-sample.ts` line 6; `src/lib/auth/require-role.ts` line 59

**Finding:** Both module-level Maps grow indefinitely. `lastLogAt` accumulates one entry per `(userId, errorClass)` pair. `denialCounter` accumulates one entry per `(userId, eventName)` pair. In a long-running server with many unique users triggering RBAC errors, these Maps grow without bound. Neither has a TTL eviction, a max-size guard, or a periodic sweep.

**Mitigation:** Cap at a reasonable size (e.g., 10k entries) with LRU eviction, or add a periodic sweep (`setInterval`) that removes entries older than 24h. Acceptable to defer but should be a tracked debt item.

---

#### M-3: Dead Code `getProjectIdForWhiteboard` in `collaboration.ts`

**File:** `src/routes/api/collaboration.ts` lines 235-243

**Finding:** `getProjectIdForWhiteboard` is defined locally but never called — the actual RBAC path now goes through `requireRole` → `getWhiteboardProjectId` (imported from `@/data/resolve-project`). The local function does a direct `prisma.whiteboard.findUnique`. Dead code that duplicates DB access logic is a maintenance hazard: future modifications may accidentally revive it, and it introduces an untested code path with its own query.

**Mitigation:** Delete lines 235-243. No behavior change.

---

#### M-4: WS `column:create` Error Response Leaks `tableId` and `name` on Validation Failure

**File:** `src/routes/api/collaboration.ts` lines 628-635

**Finding:** The error emit on column creation failure includes `tableId: validated?.tableId` and `name: validated?.name`. If validation succeeds but the downstream `createColumn` throws (e.g., DB constraint violation), these fields expose the column name and tableId to the emitting socket. While the socket is authenticated, column names could contain sensitive schema information. More importantly, this was not part of the error shape in the SEC-ERR-02 spec — it is an inconsistency between the new canonical shape and the legacy pattern for this specific handler.

**Mitigation:** Remove `name` and `tableId` from error emits on mutations. Error events should carry only `event`, `error`, and `message`.

---

#### M-5: `requireRole` Emits `BATCH_DENIED` Code from a WS Path That Is Not a Batch

**File:** `src/lib/auth/require-role.ts` lines 78-91; `emitAuthDenied`

**Finding:** `emitAuthDenied` accepts `code: 'FORBIDDEN' | 'BATCH_DENIED'`. The `requireRole` function only ever passes `'FORBIDDEN'`. The `BATCH_DENIED` code in the WS error payload type and the `emitAuthDenied` switch suggests the function was designed to handle both cases, but WS batch handling does not exist (the batch endpoint is HTTP-only). This dead branch causes the WS error type to expose a code value that can never be emitted, creating a misleading API contract.

**Mitigation:** Low urgency but clean up: remove `BATCH_DENIED` from `WSAuthErrorPayload` and `emitAuthDenied` if it will never be used on WS. Or document explicitly why the union is forward-looking.

---

#### M-6: `sessionStorage` Draft Not Cleared on Successful Re-Authentication — Draft Persists Across Login Sessions

**File:** `src/hooks/use-column-draft-persistence.ts` lines 115-119; `clearDraft`

**Finding:** `clearDraft` is called on successful column save, not on successful re-authentication. If a user's session expires mid-edit, they re-authenticate, and the modal re-mounts with the draft applied — but they then dismiss the modal without saving (they changed their mind), the draft remains in `sessionStorage`. On the next session on the same browser tab the draft reappears at mount, which may be stale minutes or hours later. The 30-minute TTL partially mitigates this but `sessionStorage` survives tab navigation within the same session, so a fresh page load could surface a stale draft.

**Mitigation:** Call `discardDraft` on `dismissSessionExpired` (when the modal is dismissed post re-auth without save), or on modal `onClose` without a successful save signal.

---

#### M-7: AD-8 Staging Instrumentation Step Skipped — Superpassword Removed Without Observation Window

**File:** `implementation-notes.md` Technical Debt table

**Finding:** The tech spec (AD-8, Phase 6.1) required a ≥7-day staging observation window with the `console.warn('[auth] DEBUG_SUPER_PASSWORD bypass used')` instrumentation before deleting the bypass. Implementation notes record this as skipped ("AD-8 staging window for superpassword (≥7 days per PRD §13.2) — skipped for implementation"). The bypass has already been deleted. The purpose of the window was to detect any automated systems or developer workflows that still used the bypass.

**Mitigation:** Before deploying to production, communicate to all developers that `DEBUG_SUPER_PASSWORD` no longer works. Review staging access logs for the past 7 days for any login events that previously matched the superpassword pattern. The PRD §13.5 checklist items should be manually executed before the merge PR is approved for production.

---

### LOW

#### L-1: `applyDraft` No-Op Implementation

**File:** `src/hooks/use-column-draft-persistence.ts` lines 106-109

**Finding:** `applyDraft` has an empty body with only a comment: "The caller is responsible for applying draft values to form fields." The hook exposes `applyDraft` in its return type but it does nothing. Callers who invoke `applyDraft()` expecting the draft state to change (e.g., to populate form fields) will be silently doing nothing. Since the column-edit modal wiring is deferred (no UI component calls this hook yet), this is low severity now but is a subtle contract violation that will produce silent bugs when wired.

**Mitigation:** Either remove `applyDraft` from the return type (it's a no-op) or document explicitly that callers must read `draft` and apply values themselves; `applyDraft` is only a semantic marker.

---

#### L-2: `makeRow` Uses Non-Cryptographic ID for Row Keys

**File:** `src/components/whiteboard/BatchColumnForm.tsx` lines 40-43

**Finding:** `makeRow` generates row IDs as `` `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` ``. On the same millisecond (e.g., programmatic batch creation in tests or rapid UI automation), two rows can collide. React's `key={row.id}` will cause DOM reconciliation errors that are hard to diagnose. No security risk; low collision probability in normal UI use.

**Mitigation:** Use a monotonic counter or `crypto.randomUUID()` (noting user's feedback about HTTP LAN environments — `Math.random()` is already used here, which is acceptable; the entropy is the concern). A simple module-level counter is safer than relying on millisecond uniqueness.

---

#### L-3: ESLint `ignores` List Excludes `eslint.config.js` From Its Own Rule

**File:** `eslint.config.js` lines 25-47

**Finding:** `eslint.config.js` is listed in `ignores`, so the file cannot trigger the `sec-authz` rule on itself (it has no `createServerFn` calls, so this has no security effect). However, `*.config.js` in the global `ignores` also silently excludes `prettier.config.js` and any future `*.config.js` that might contain server logic. This is a pattern risk, not a current vulnerability.

---

## Verdict: Caution

Three HIGH findings (H-1, H-2, H-3), all addressable without architectural changes. Zero CRITICAL findings.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 3 |
| Medium | 7 |
| Low | 3 |

H-1 (ESLint rule can be satisfied with `findEffectiveRole` alone) weakens the ongoing enforcement guarantee. H-2 (getAllProjects data exposure) is a pre-existing IDOR that the feature explicitly endorsed. H-3 (BatchColumnForm shows RBAC message on all errors) is a correctness and UX issue that does not break security but misleads users.

All three are fixable in a targeted patch (Ares). None require re-architecting.
