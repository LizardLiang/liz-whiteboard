# Decomposition: Auth Security Hardening

| Field         | Value                                 |
| ------------- | ------------------------------------- |
| Feature       | auth-security-hardening               |
| Author        | Daedalus                              |
| Created       | 2026-05-09                            |
| Source Spec   | tech-spec.md (v1, approved by Apollo) |
| Source PRD    | prd.md (v2.0, approved)               |
| Phases        | 4                                     |
| Total Tasks   | 25                                    |
| Critical Path | Phase 1 → Phase 2 → Phase 3 → Phase 4 |

---

## Overview

5 P0 security defects from PR #97 code review. All are application-layer (no DB schema changes). Decomposed into 4 phases:

1. **Foundation** — centralized authz helpers + sampled logger (no behavior change; blocks everything downstream)
2. **Backend Fixes** — WebSocket no-op replacement, server-function RBAC, batch pre-validate-then-write, superpassword removal
3. **Frontend Fixes** — session-expired modal wiring, column-form draft persistence, batch denial UX
4. **AST Guard + Verification** — ESLint inline plugin, self-tests, full lint + test run

---

## Dependency Map

```
Phase 1 (Foundation)
  └─► Phase 2 (Backend Fixes)       [hard: requireRole / requireServerFnRole must exist]
        └─► Phase 3 (Frontend Fixes) [soft: SEC-MODAL wiring is independent, but Phase 2 must
        │                              complete so lint passes when Phase 4 runs]
        └─► Phase 4 (AST Guard)      [hard: all JSDoc @requires tags + RBAC calls must exist
                                       before the ESLint rule runs against the full codebase]
  Phase 3 ──► Phase 4               [soft: column-form wiring must be done before final lint]
```

**Parallel opportunities:**

- Phase 3 frontend work (SEC-MODAL, SEC-BATCH UX) can begin after Phase 1 completes — it does not depend on Phase 2's server-side changes.
- Within Phase 2, the superpassword removal (SEC-SP) has no dependency on the authz helpers and can run in parallel with Wave 2 tasks.

---

## Phase 1: Foundation

**Purpose:** Create the two centralized authz primitives and the sampled logger. No existing behavior changes — pure new modules. All Phase 2 + Phase 3 backend tasks import from these.

**Depends on:** nothing
**Blocks:** Phase 2 (hard), Phase 4 (transitively)

**In scope:**

- `src/lib/auth/log-sample.ts` — `logSampledError` with 60s dedup window
- `src/lib/auth/require-role.ts` — `requireRole` (WS), `requireServerFnRole` (HTTP), `ForbiddenError`, `BatchDeniedError`, `WSAuthErrorPayload`, `getDenialCount`
- Unit tests for both modules

**Out of scope:** Wiring helpers into any call sites (Phase 2). UI changes (Phase 3). ESLint rule (Phase 4).

### Tasks

#### Wave 1 — No intra-phase dependencies

| ID      | Task                                                                                                                                                              | Target File                             | Effort | Verify                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| P1-W1-1 | Create `logSampledError` with 60s TTL dedup keyed by `${userId}:${errorClass}`                                                                                    | `src/lib/auth/log-sample.ts` (create)   | XS     | `bunx tsc --noEmit` passes; `rg "logSampledError" src/lib/auth/log-sample.ts` returns match       |
| P1-W1-2 | Create `requireRole`, `requireServerFnRole`, `ForbiddenError`, `BatchDeniedError`, `WSAuthErrorPayload`, `getDenialCount` — import `logSampledError` from P1-W1-1 | `src/lib/auth/require-role.ts` (create) | S      | `bunx tsc --noEmit` passes; `rg "requireServerFnRole" src/lib/auth/require-role.ts` returns match |

#### Wave 2 — Requires Wave 1 output

| ID      | Task                                                                                                                                                                                      | Target File                                                        | Effort | Verify                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| P1-W2-1 | Unit tests for `logSampledError`: assert dedup (two calls within 60s → one log), assert reset after window                                                                                | `src/lib/auth/log-sample.test.ts` (create)                         | XS     | `bun run test src/lib/auth/log-sample.test.ts` passes                                   |
| P1-W2-2 | Unit tests for `requireRole`: mock `findEffectiveRole` → (null, VIEWER, EDITOR); assert deny/allow/throw paths, assert `emitAuthDenied` payload shape, assert `getDenialCount` increments | `src/lib/auth/require-role.test.ts` (create)                       | S      | `bun run test src/lib/auth/require-role.test.ts` passes                                 |
| P1-W2-3 | Unit tests for `requireServerFnRole`: assert `ForbiddenError` on null projectId, on role-lookup throw (fail-closed), on insufficient role; assert pass-through on sufficient role         | `src/lib/auth/require-role.test.ts` (extend, same file as P1-W2-2) | S      | `bun run test src/lib/auth/require-role.test.ts` — all `requireServerFnRole` cases pass |

**Acceptance criteria:**

- [ ] `src/lib/auth/log-sample.ts` exists and exports `logSampledError`
- [ ] `src/lib/auth/require-role.ts` exists and exports `requireRole`, `requireServerFnRole`, `ForbiddenError`, `BatchDeniedError`, `WSAuthErrorPayload`, `getDenialCount`
- [ ] `bun run test src/lib/auth/` — all tests pass
- [ ] `bunx tsc --noEmit` — no new errors

---

## Phase 2: Backend Fixes

**Purpose:** Wire the Phase 1 helpers into every affected server-side call site. Covers SEC-WS, SEC-RBAC, SEC-BATCH, and SEC-SP (superpassword has no helper dependency but lands here with the other server fixes).

**Depends on:** Phase 1 (hard — helpers must exist)
**Blocks:** Phase 4 (hard — JSDoc tags + RBAC calls must be present before AST guard runs)

**In scope:**

- Replace `denyIfInsufficientPermission` no-op with real `requireRole` wrapper; add `eventName` to all 13 WS call sites
- Add `@requires <role>` JSDoc + `requireServerFnRole` calls to all 85 in-scope `createServerFn` exports across 9 files
- Replace `createColumnsFn` TODO with pre-validate-then-write batch RBAC (AD-3)
- Delete superpassword bypass from `src/routes/api/auth.ts`; add `console.warn` instrumentation first (AD-8)
- Regression tests: SEC-WS-04, SEC-RBAC-05, SEC-BATCH-04, SEC-SP-04

**Out of scope:** Frontend UX changes (Phase 3). ESLint rule (Phase 4). `onSessionExpired` wiring (Phase 3).

**Technical notes:**

- `denyIfInsufficientPermission` thin wrapper pattern per spec §3.3 — keep the existing function signature minus the no-op; all 13 call sites add the `eventName` string literal
- Server-function role tiers: read-only → `'VIEWER'`; write → `'EDITOR'`; permission/membership management → `'ADMIN'` or `'OWNER'`; `src/routes/api/auth.ts` login/register → `@requires unauthenticated`; logout/getCurrentUser → `@requires authenticated`
- `BatchDeniedError` is imported from `src/lib/auth/require-role.ts` (defined alongside `ForbiddenError`)
- Superpassword: AD-8 requires the `console.warn` line be added first, deployed to staging, verified for ≥24h before the removal commit — **two separate commits**

### Tasks

#### Wave 1 — Independent; no intra-phase dependencies between SEC-WS, SEC-RBAC, and SEC-SP

| ID       | Task                                                                                                                                                                                                                                                               | Target File                                    | Effort | Verify                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-W1-1  | Replace `denyIfInsufficientPermission` no-op (lines 257-273) with real `requireRole` wrapper; add `eventName` param to all 13 call sites; restore `findEffectiveRole` import (line 52); delete `eslint-disable` / `@ts-expect-error` / unused-variable annotations | `src/routes/api/collaboration.ts` (modify)     | M      | `rg "async \(\) => false" src/routes/api/collaboration.ts` returns no match; `rg "denyIfInsufficientPermission" src/routes/api/collaboration.ts \| wc -l` returns 14 (1 def + 13 calls) |
| P2-W1-2  | Add `@requires <role>` JSDoc and `await requireServerFnRole(user.id, projectId, ...)` to all 10 exports; replace generic `throw new Error('... not found')` permission denials with `throw new ForbiddenError()`                                                   | `src/lib/server-functions.ts` (modify)         | M      | `rg "TODO: restore permission check" src/lib/server-functions.ts` returns no match; `rg "@requires" src/lib/server-functions.ts \| wc -l` returns 10                                    |
| P2-W1-3  | Same treatment for 2 exports                                                                                                                                                                                                                                       | `src/lib/server-functions-project.ts` (modify) | XS     | `rg "TODO: restore permission check" src/lib/server-functions-project.ts` returns no match                                                                                              |
| P2-W1-4  | Add `@requires <role>` JSDoc + `requireServerFnRole` to 11 exports                                                                                                                                                                                                 | `src/routes/api/whiteboards.ts` (modify)       | M      | `rg "TODO: restore permission check" src/routes/api/whiteboards.ts` returns no match; `rg "@requires" src/routes/api/whiteboards.ts \| wc -l` returns 11                                |
| P2-W1-5  | Add `@requires <role>` JSDoc + `requireServerFnRole` to 8 exports                                                                                                                                                                                                  | `src/routes/api/projects.ts` (modify)          | M      | `rg "TODO: restore permission check" src/routes/api/projects.ts` returns no match                                                                                                       |
| P2-W1-6  | Add `@requires <role>` JSDoc + `requireServerFnRole` to 8 exports                                                                                                                                                                                                  | `src/routes/api/folders.ts` (modify)           | M      | `rg "TODO: restore permission check" src/routes/api/folders.ts` returns no match                                                                                                        |
| P2-W1-7  | Add `@requires <role>` JSDoc + `requireServerFnRole` to 9 exports                                                                                                                                                                                                  | `src/routes/api/tables.ts` (modify)            | M      | `rg "TODO: restore permission check" src/routes/api/tables.ts` returns no match                                                                                                         |
| P2-W1-8  | Add `@requires <role>` JSDoc + `requireServerFnRole` to 9 exports                                                                                                                                                                                                  | `src/routes/api/relationships.ts` (modify)     | M      | `rg "TODO: restore permission check" src/routes/api/relationships.ts` returns no match                                                                                                  |
| P2-W1-9  | Add `@requires <role>` JSDoc + `requireServerFnRole` to 5 exports                                                                                                                                                                                                  | `src/routes/api/permissions.ts` (modify)       | S      | `rg "TODO: restore permission check" src/routes/api/permissions.ts` returns no match                                                                                                    |
| P2-W1-10 | Add `@requires unauthenticated` to login/register; `@requires authenticated` to logout/getCurrentUser; delete superpassword bypass lines (`debugSuperPassword`, `isSuperpassword`, the OR-wrapping) — **preceded by AD-8 staging instrumentation**                 | `src/routes/api/auth.ts` (modify)              | S      | `rg "DEBUG_SUPER_PASSWORD\|isSuperpassword\|debugSuperPassword" src/routes/api/auth.ts` returns no match                                                                                |

#### Wave 2 — Requires Wave 1: columns.ts has batch RBAC that depends on helpers from Phase 1 + the ForbiddenError/BatchDeniedError types confirmed in Wave 1

| ID      | Task                                                                                                                                                                                                                                                                             | Target File                          | Effort | Verify                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-W2-1 | Add `@requires <role>` JSDoc + `requireServerFnRole` to 9 non-batch exports; implement `createColumnsFn` pre-validate-then-write per spec §3.5 (iterate unique tableIds, `requireServerFnRole` each, catch `ForbiddenError` → throw `BatchDeniedError`; write only on full pass) | `src/routes/api/columns.ts` (modify) | M      | `rg "TODO: restore permission check" src/routes/api/columns.ts` returns no match; `rg "BatchDeniedError" src/routes/api/columns.ts` returns match |

#### Wave 3 — Regression tests (require Wave 1 + Wave 2 call sites to be in place)

| ID      | Task                                                                                                                                                                                                                                                                             | Target File                                         | Effort | Verify                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| P2-W3-1 | Extend socket test: mock `findEffectiveRole` → null; emit `column:create`; assert no DB write + `error` event with `{ code: 'FORBIDDEN', event: 'column:create' }` (SEC-WS-04)                                                                                                   | `src/server/socket.test.ts` (extend)                | S      | `bun run test src/server/socket.test.ts` passes; test name contains "SEC-WS-04" or similar |
| P2-W3-2 | New test file: 4 tier-denial tests — VIEWER on VIEWER-required endpoint passes; VIEWER on EDITOR-required → ForbiddenError; VIEWER on ADMIN-required → ForbiddenError; EDITOR on OWNER-required → ForbiddenError (SEC-RBAC-05)                                                   | `src/lib/server-functions.test.ts` (create)         | S      | `bun run test src/lib/server-functions.test.ts` passes                                     |
| P2-W3-3 | New test file: (a) mixed batch → BatchDeniedError, zero rows written; (b) fully-authorized batch → succeeds; (c) fully-unauthorized batch → BatchDeniedError (SEC-BATCH-04)                                                                                                      | `src/routes/api/columns.test.ts` (create)           | S      | `bun run test src/routes/api/columns.test.ts` passes                                       |
| P2-W3-4 | Extend auth test: login with previously-hardcoded `DEBUG_SUPER_PASSWORD` value against user with different real password → fails with `error: 'AUTH_FAILED'` (SEC-SP-04); AST sub-assertion that `verifyPassword` body contains `bcrypt.compare` and no other truthy return path | `src/routes/api/auth.test.ts` (extend)              | S      | `bun run test src/routes/api/auth.test.ts` passes                                          |
| P2-W3-5 | New one-off AST assertion: Vitest test parses `src/lib/auth/password.ts` via `@typescript-eslint/parser`, finds `verifyPassword`, asserts every `ReturnStatement` traces to `bcrypt.compare` (SEC-SP-02)                                                                         | `src/lib/auth/password-ast-assert.test.ts` (create) | S      | `bun run test src/lib/auth/password-ast-assert.test.ts` passes                             |

**Acceptance criteria:**

- [ ] `rg "async () => false" src/routes/api/collaboration.ts` → no match (no-op replaced)
- [ ] `rg "TODO: restore permission check" src/` → no match (all stubs replaced)
- [ ] `rg "DEBUG_SUPER_PASSWORD|isSuperpassword|debugSuperPassword" src/` → no match
- [ ] All Phase 2 regression tests pass: `bun run test src/server/socket.test.ts src/lib/server-functions.test.ts src/routes/api/columns.test.ts src/routes/api/auth.test.ts src/lib/auth/password-ast-assert.test.ts`
- [ ] `bunx tsc --noEmit` — no new errors

---

## Phase 3: Frontend Fixes

**Purpose:** Client-side fixes — session-expired modal wiring, column-form sessionStorage draft persistence, and batch-denial UX. These are independent of Phase 2's server changes (mock data suffices for local testing), but must land before Phase 4's final lint pass.

**Depends on:** Phase 1 (soft — type imports); Phase 2 (soft — WS error shape needed to route `BATCH_DENIED` vs `FORBIDDEN` in the client)
**Blocks:** Phase 4 (soft — all wired call sites must exist before AST guard validates `session_expired` single-registration)

**In scope:**

- Make `onSessionExpired` mandatory in `useCollaboration`; update 4 call sites
- New `useColumnDraftPersistence` hook: debounce-write to `sessionStorage[draft:${whiteboardId}:${columnId}]`, restore on mount post re-auth
- Wire `useColumnDraftPersistence` into column-edit modal component; add Apply/Discard banner
- Client `error` event handler in `use-collaboration.ts`: distinguish `code === 'BATCH_DENIED'` (banner) vs `code === 'FORBIDDEN'` (toast); route using Appendix C message mapping
- Preserve batch form input on `BATCH_DENIED`; add SEC-BATCH-UX-02 banner with bisection affordance
- Regression tests: SEC-MODAL-04, SEC-MODAL-05, SEC-BATCH-UX-05

**Out of scope:** Server-side changes (Phase 2). ESLint rule (Phase 4). Any other unsaved-state persistence beyond column-edit modal.

**Technical notes:**

- Column-edit modal file: Ares resolves exact path via `rg "createColumnSchema|updateColumnSchema" src/components/` — most likely under `src/components/whiteboard/column/`
- Batch UI component: Ares resolves via `rg "createColumnsFn" src/components/` — likely `AddColumnRow.tsx` or a parent `TableNode*.tsx`
- `useAuthContext()` is at `src/components/auth/AuthContext.tsx` — confirmed by existing file
- Draft key: `draft:${whiteboardId}:${columnId}` — 200-byte budget per spec AD-4
- `sessionExpired` state transition watch: `useEffect` on `useAuthContext().sessionExpired` false → true → false transition triggers draft restore prompt on modal mount

### Tasks

#### Wave 1 — Independent (session wiring and batch UX do not share files)

| ID      | Task                                                                                                                                                                 | Target File                                                     | Effort | Verify                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| P3-W1-1 | Make `onSessionExpired` parameter mandatory (remove `?`); update the `?.()` call to a direct call                                                                    | `src/hooks/use-collaboration.ts` (modify)                       | XS     | `bunx tsc --noEmit` passes (would error if a call site forgot the argument)                                          |
| P3-W1-2 | Pass `triggerSessionExpired` from `useAuthContext()` as the third argument to `useCollaboration`                                                                     | `src/hooks/use-column-collaboration.ts` (modify)                | XS     | `bunx tsc --noEmit` passes                                                                                           |
| P3-W1-3 | Same — pass `triggerSessionExpired`                                                                                                                                  | `src/hooks/use-column-reorder-collaboration.ts` (modify)        | XS     | `bunx tsc --noEmit` passes                                                                                           |
| P3-W1-4 | Same — pass `triggerSessionExpired` from `useAuthContext()`                                                                                                          | `src/routes/whiteboard/$whiteboardId.tsx` (modify)              | XS     | `bunx tsc --noEmit` passes                                                                                           |
| P3-W1-5 | Same — pass `triggerSessionExpired` from `useAuthContext()`                                                                                                          | `src/routes/whiteboard/$whiteboardId.new.tsx` (modify)          | XS     | `bunx tsc --noEmit` passes                                                                                           |
| P3-W1-6 | Create `useColumnDraftPersistence(whiteboardId, columnId)` hook: debounce write to `sessionStorage`, read on mount, expose `draft`, `applyDraft()`, `discardDraft()` | `src/hooks/use-column-draft-persistence.ts` (create)            | S      | `bunx tsc --noEmit` passes; `rg "useColumnDraftPersistence" src/hooks/use-column-draft-persistence.ts` returns match |
| P3-W1-7 | Add `code === 'BATCH_DENIED'` branch to the `error` socket event handler; route BATCH_DENIED to banner state, FORBIDDEN to toast                                     | `src/hooks/use-collaboration.ts` (modify, same file as P3-W1-1) | S      | `bunx tsc --noEmit` passes; `rg "BATCH_DENIED" src/hooks/use-collaboration.ts` returns match                         |

#### Wave 2 — Requires Wave 1 hook outputs

| ID      | Task                                                                                                                                                                                                                                          | Target File                                                                                                           | Effort | Verify                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| P3-W2-1 | Wire `useColumnDraftPersistence` into column-edit modal: debounce-write on every form change; mount effect checks `sessionExpired` transition; render Apply/Discard banner when draft exists                                                  | Column-edit modal component (path resolved by Ares via `rg "createColumnSchema\|updateColumnSchema" src/components/`) | M      | `bunx tsc --noEmit` passes; `rg "useColumnDraftPersistence" src/components/` returns match |
| P3-W2-2 | Handle `BatchDeniedError` / `BATCH_DENIED` code in batch column UI: preserve form input on denial, render SEC-BATCH-UX-02 banner (`role="alert"`), add per-row "save this row only" or "save half" bisection affordance (keyboard accessible) | Column-batch UI component (path resolved by Ares via `rg "createColumnsFn" src/components/`)                          | M      | `bunx tsc --noEmit` passes; `rg "BATCH_DENIED\|BatchDenied" src/components/` returns match |

#### Wave 3 — Regression tests (require Wave 1 + Wave 2 to be wired)

| ID      | Task                                                                                                                                                                                                                       | Target File                                                                           | Effort | Verify                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| P3-W3-1 | Extend: emit `session_expired` → assert `triggerSessionExpired` called once + modal visible + focus on first focusable element (SEC-MODAL-04)                                                                              | `src/hooks/use-whiteboard-collaboration-auth.test.ts` (extend)                        | S      | `bun run test src/hooks/use-whiteboard-collaboration-auth.test.ts` passes |
| P3-W3-2 | New component test: mount column-edit modal, type changes → assert `sessionStorage` populated; trigger session-expired flow → re-mount → assert form prefilled + Apply/Discard banner visible (SEC-MODAL-05)               | `src/components/whiteboard/column/<column-edit>.test.tsx` (create, path TBD by Ares)  | S      | `bun run test` on that file passes                                        |
| P3-W3-3 | New component test: mount batch-column UI, simulate `BATCH_DENIED` response → assert (a) batch input still rendered, (b) SEC-BATCH-UX-02 message visible, (c) bisection affordance reachable via Tab key (SEC-BATCH-UX-05) | `src/components/whiteboard/column/<column-batch>.test.tsx` (create, path TBD by Ares) | S      | `bun run test` on that file passes                                        |

**Acceptance criteria:**

- [ ] `bunx tsc --noEmit` — no errors after Phase 3 changes
- [ ] `onSessionExpired` has no `?` in `useCollaboration` signature: `rg "onSessionExpired\?" src/hooks/use-collaboration.ts` → no match
- [ ] 4 call sites pass `triggerSessionExpired`: `rg "triggerSessionExpired" src/hooks/use-column-collaboration.ts src/hooks/use-column-reorder-collaboration.ts "src/routes/whiteboard/\$whiteboardId.tsx" "src/routes/whiteboard/\$whiteboardId.new.tsx"` → 4 matches
- [ ] Draft key written to sessionStorage: `rg "draft:\${" src/hooks/use-column-draft-persistence.ts` → match
- [ ] All Phase 3 regression tests pass

---

## Phase 4: AST Guard + Verification

**Purpose:** Define the ESLint inline plugin (SEC-RBAC-04 + SEC-MODAL-02), wire into `eslint.config.js`, run against the full codebase. Full test suite + lint run as final gate.

**Depends on:** Phase 2 (hard — all `@requires` tags + `requireServerFnRole` calls must exist); Phase 3 (soft — `session_expired` single-registration assertion needs Phase 3 call sites finalized)
**Blocks:** nothing (terminal phase)

**In scope:**

- `tools/eslint-rules/require-server-fn-authz.js` — rule body (per spec §3.9)
- `tools/eslint-rules/__fixtures__/{good,bad}-server-fn.ts` — rule self-test fixtures
- `tools/eslint-rules/require-server-fn-authz.test.js` — 8 self-test cases
- Register inline plugin in `eslint.config.js` (AD-2)
- Final `bun run lint` — must pass clean
- Final `bun run test` — all SEC-\* tests pass

**Out of scope:** Any new behavior changes. All code changes should be complete in Phases 1-3.

**Technical notes:**

- Rule walkthrough per spec §3.9: trigger on `createServerFn` CallExpression; walk `.handler()` arg; resolve `requireAuth()` wrapper; assert handler body calls `requireServerFnRole` or carries `@requires authenticated/unauthenticated` JSDoc escape hatch
- Allowlist for wrappers: `['requireAuth']` — any other wrapper name fails the rule
- `session_expired` single-registration: assert the string literal `'session_expired'` as first arg to `socket.on(...)` appears in exactly one file across `src/` (using `Program:exit` cross-file state or equivalent)
- Rule file uses CommonJS exports for ESLint 9 flat config compatibility
- Demo files and test files are excluded from rule scope (per spec §2.2 accepted-risk list)
- `tools/` directory does not yet exist — Ares creates it

### Tasks

#### Wave 1 — Create rule and fixtures (no dependencies within phase)

| ID      | Task                                                                                                                                                                                                                                                          | Target File                                                                                                                               | Effort | Verify                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| P4-W1-1 | Create ESLint rule: `createServerFn` trigger, `.handler()` walker, `requireAuth` allowlist, `requireServerFnRole` body assertion, `@requires` JSDoc escape hatch, `session_expired` single-registration check                                                 | `tools/eslint-rules/require-server-fn-authz.js` (create)                                                                                  | L      | `node -e "require('./tools/eslint-rules/require-server-fn-authz.js')"` exits 0 (module loads without error)                        |
| P4-W1-2 | Create good fixture: `createServerFn` with `requireServerFnRole` call; `createServerFn` with `@requires authenticated` tag                                                                                                                                    | `tools/eslint-rules/__fixtures__/good-server-fn.ts` (create)                                                                              | XS     | File exists; `rg "requireServerFnRole\|@requires authenticated" tools/eslint-rules/__fixtures__/good-server-fn.ts` returns matches |
| P4-W1-3 | Create bad fixtures: (a) `createServerFn` with no RBAC call and no escape hatch; (b) `@requires editor` tag but no `requireServerFnRole` call; (c) `withAuth(fn)` wrapper not in allowlist; (d) two files each containing `socket.on('session_expired', ...)` | `tools/eslint-rules/__fixtures__/bad-server-fn.ts` (create) + `tools/eslint-rules/__fixtures__/bad-session-expired-duplicate.ts` (create) | XS     | Files exist with the violation patterns                                                                                            |

#### Wave 2 — Self-tests + wiring (require Wave 1 rule to exist)

| ID      | Task                                                                                                                                                                                                                                                                                                                                                                                          | Target File                                                   | Effort | Verify                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| P4-W2-1 | Write 8 self-test cases against fixtures: (a) good fixture → passes; (b) no RBAC call → fails; (c) `@requires editor` tag only → fails; (d) `@requires authenticated` → passes (escape hatch); (e) non-allowlisted wrapper → fails; (f) two `session_expired` registrations → fails; (g) missing JSDoc entirely → fails; (h) `requireAuth` wrapper with `requireServerFnRole` inside → passes | `tools/eslint-rules/require-server-fn-authz.test.js` (create) | M      | `bun run test tools/eslint-rules/require-server-fn-authz.test.js` — all 8 cases pass     |
| P4-W2-2 | Register inline plugin in `eslint.config.js`: import rule from `tools/eslint-rules/require-server-fn-authz.js`, define inline plugin object, set rule as `error`, scope to `src/**/*.{ts,tsx}` excluding test files and demo paths                                                                                                                                                            | `eslint.config.js` (modify)                                   | S      | `bun run lint` completes without the plugin throwing a config error (rule is registered) |

#### Wave 3 — Full codebase validation (requires Wave 2 wiring)

| ID      | Task                                                                                                                                                           | Target File                        | Effort | Verify                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4-W3-1 | Run `bun run lint` against full codebase; fix any rule violations that surface (should be zero if Phases 2-3 are complete; this task is the confirmation gate) | Various (only if violations found) | S      | `bun run lint` exits 0 with no errors                                                                                                                                   |
| P4-W3-2 | Run full test suite; confirm all SEC-\* tests pass and no existing tests regressed                                                                             | —                                  | S      | `bun run test` — all SEC-SP-04, SEC-WS-04, SEC-BATCH-04, SEC-BATCH-UX-05, SEC-MODAL-04, SEC-MODAL-05, SEC-RBAC-05 tests pass; overall pass rate not lower than baseline |

**Acceptance criteria:**

- [ ] `bun run lint` exits 0 — AST guard passes against full codebase
- [ ] `bun run test` — all 8 ESLint rule self-tests pass
- [ ] `bun run test` — all 6 SEC-\* regression suites pass
- [ ] `rg "async () => false" src/routes/api/collaboration.ts` → no match (regression check)
- [ ] `rg "TODO: restore permission check" src/` → no match (regression check)
- [ ] `rg "DEBUG_SUPER_PASSWORD" src/` → no match (regression check)

---

## Risks

| Risk                                                                                                                       | Phase | Mitigation                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Column-edit modal file path unknown — may need to touch multiple `.tsx` files                                              | 3     | Ares resolves at start of Phase 3 via `rg "createColumnSchema\|updateColumnSchema" src/components/`; abort if result is ambiguous and report to Kratos |
| AST rule produces false positives against the existing codebase (Phase 2 annotations not quite matching rule expectations) | 4     | P4-W3-1 is an explicit fix-violations task; Phase 4 is the catch net, not a blocker                                                                    |
| `@typescript-eslint/parser` not available as a direct Vitest dep for SEC-SP-02 AST assertion                               | 2     | If missing: `bun add -d @typescript-eslint/parser`; it is already an indirect dependency of ESLint 9 toolchain                                         |
| Superpassword AD-8 staging window (≥7 days + 24h log clean) delays Phase 2 sign-off                                        | 2     | P2-W1-10 is split into two commits; the instrumentation commit can be deployed independently; other Phase 2 tasks are not blocked                      |
| Batch UI component wiring touches `AddColumnRow.tsx` which has existing tests                                              | 3     | P3-W2-2 must not break `src/components/whiteboard/column/AddColumnRow.test.tsx` — run that test as part of Phase 3 verify                              |

---

## Cross-Cutting Concerns

- **Error shapes coexist (AD-5):** only the 5 fix sites emit the canonical SEC-ERR-01 / SEC-ERR-02 shapes. All other existing `socket.emit('error', { event, error, message })` calls stay unchanged. Client error handler in `use-collaboration.ts` distinguishes by `code` field presence.
- **Fail-closed (AD-6):** any RBAC lookup throw in `requireRole` / `requireServerFnRole` denies and logs via `logSampledError`. Tests cover this path in Phase 1.
- **Anti-enumeration (SEC-ERR-03):** `requireRole` returns the same `FORBIDDEN` payload for "not found" and "unauthorized". `BatchDeniedError` never leaks item index.
- **Demo and test files:** excluded from the ESLint rule scope. Annotated `@requires authenticated` only (no `requireServerFnRole` needed). Rule allowlist paths: `src/data/demo.*`, `src/routes/demo/**`, `**/*.test.{ts,tsx}`.

---

## Effort Summary

| Phase                             | Tasks  | Wave Structure | Relative Effort |
| --------------------------------- | ------ | -------------- | --------------- |
| Phase 1: Foundation               | 5      | 2 waves        | S               |
| Phase 2: Backend Fixes            | 14     | 3 waves        | XL              |
| Phase 3: Frontend Fixes           | 10     | 3 waves        | L               |
| Phase 4: AST Guard + Verification | 6      | 3 waves        | M               |
| **Total**                         | **35** | —              | —               |

Effort scale: XS < S < M < L < XL
