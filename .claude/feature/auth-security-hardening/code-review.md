# Code Review: auth-security-hardening

| Field        | Value                                      |
| ------------ | ------------------------------------------ |
| Feature      | auth-security-hardening                    |
| Reviewer     | Hermes                                     |
| Stage        | 11-review                                  |
| Date         | 2026-05-09                                 |
| Verdict      | **Changes Required**                       |
| Test Results | 787 pass / 8 pre-existing fail (unchanged) |

---

## Summary

Reviewed 13+ files for the 5 P0 security fixes. The core SEC fixes (superpassword removal, WS RBAC enforcement, batch RBAC pre-validate-then-write, anti-enumeration message) are correctly implemented and well-tested. However the HTTP 401 → SessionExpiredModal path (AC-20 / SEC-MODAL-03) is broken in production code despite passing tests — the QueryClient interceptor cannot fire because `requireAuth` returns 401 as a _resolved value_, not a thrown error. Additionally, two unbounded in-process Maps create slow memory leaks, two newly-created components are dead code (no consumers), and the new `BatchColumnForm` uses inline styles instead of TailwindCSS/shadcn (project convention violation).

Tier checklist: 8/8 reviewed. Findings: **3 BLOCKER**, **5 WARNING**, **3 SUGGESTION**.

---

## Findings

### BLOCKER

**[BLOCKER] src/integrations/tanstack-query/root-provider.tsx:7-21 — HTTP 401 interceptor is unreachable from real code paths**
Tier: 1 — Correct
Rule: Logic must be reachable; tests must exercise the same surface as production.
Why: `requireAuth` in `src/lib/auth/middleware.ts:44` returns `{ error: 'UNAUTHORIZED', status: 401 }` as the **resolved value** of the server function — not as a thrown error. React Query's `QueryCache.onError` and `MutationCache.onError` only fire when a promise _rejects_. A successful resolution carrying an `{error: 'UNAUTHORIZED'}` payload never triggers `onError`, so `dispatchUnauthorized()` is never called and `triggerSessionExpired()` is never invoked. AC-20 is therefore unfulfilled in production despite TC-HTTP401-01/02 passing — those tests dispatch the event manually on `httpAuthEvents` and never exercise a real server-fn 401 round-trip. Existing client code at `ProjectTree.tsx:138`, `CreateWhiteboardDialog.tsx:44`, etc. confirms callers explicitly check `isUnauthorizedError(result)` after a _successful_ await, proving the resolved-value contract.
Fix: requires manual review. Two viable options:
(a) Make `requireAuth` _throw_ an `UnauthorizedError` instead of returning the error object, then update every existing call site that uses `isUnauthorizedError(result)` (≈8 sites). The QueryClient onError interceptor will then fire correctly.
(b) Add a `select`/`onSuccess` hook in QueryClient defaultOptions (or wrap `createServerFn` calls) that inspects resolved values for `isUnauthorizedError` and dispatches `HTTP_UNAUTHORIZED` from there.
Either way, add a test that performs a real `useQuery({ queryFn: () => Promise.resolve({error: 'UNAUTHORIZED', status: 401}) })` round-trip and asserts the listener fires — without that test the regression is undetectable.

**[BLOCKER] src/lib/auth/require-role.ts:59 — denialCounter Map grows unboundedly**
Tier: 8 — Maintainable (M10)
Rule: Unbounded data structures must have a TTL, LRU cap, or scheduled cleanup.
Why: `denialCounter` accumulates one entry per unique `${userId}:${eventName}` pair forever. Comment says "non-durable — resets on server restart" but on a long-running server with N users × 13 event names that's 13N permanent entries. The PRD calls denial counts "structured-log field, no metrics infra required" (per logSampledError.ts:15-16), implying it is **not** intended as durable state — yet it has no eviction. The same applies to `lastLogAt` in `src/lib/auth/log-sample.ts:6`. Both leak memory linearly with unique-user count over the server's uptime.
Fix: Either (a) cap each Map at N entries with an LRU eviction (one-line `lru-cache` dep or a small in-file LRU), or (b) wrap the Map in a periodic `setInterval` cleanup that prunes entries whose timestamp is older than the dedup window (`lastLogAt`) or older than 24h (`denialCounter`). Option (b) is simpler. Add a test that inserts N+1 entries and asserts the oldest is evicted.

**[BLOCKER] src/components/whiteboard/BatchColumnForm.tsx:172-365 — Inline styles instead of TailwindCSS/shadcn (project convention violation)**
Tier: 5 — Consistent
Rule: Project convention (CLAUDE.md): "This project uses ONLY shadcn/ui and TailwindCSS for UI" — inline `style={{ ... }}` props are explicitly forbidden ("DO NOT use any other UI libraries").
Why: Every `<button>`, `<input>`, `<select>`, `<form>`, banner div, and row container uses `style={{ ... }}` props with hardcoded colors (`#dc2626`, `#6366f1`, `#999`), pixel paddings, and ad-hoc borders. The component bypasses shadcn (`Button`, `Input`, `Alert`, `Form`) and Tailwind utilities entirely. This is the same anti-pattern the ER whiteboard codebase otherwise avoids — the rest of `src/components/whiteboard/` uses Tailwind classes (`className="..."`).
Fix: requires manual rewrite using shadcn primitives:

- `Button` (variants: `default`, `outline`, `ghost`, `destructive`) for all four button styles
- `Input` for the column-name field
- `Select` (or native `<select>` with Tailwind classes) for the dataType dropdown
- `Alert` with `variant="destructive"` for the BATCH_DENIED banner
- `Form` + `FormField` for the form layout
  Replace inline color literals with semantic Tailwind tokens (`text-destructive`, `border-destructive`, `bg-primary`). Drop all `style={{ ... }}` attributes. Remove `flex flex-col gap-2 p-3` literals into `className`.

### WARNING

**[WARNING] src/hooks/use-column-draft-persistence.ts:106-109 — `applyDraft` is a useless no-op**
Tier: 3 — Clear
Rule: API surface must do what its name says, or be removed.
Why: `applyDraft` is exposed in the return type and has only a comment ("The caller is responsible for applying draft values to form fields") with zero behavior. Callers receiving this function are misled into thinking they must call it. It also makes `discardDraft` and `clearDraft` indistinguishable in name vs. behavior.
Fix: Remove `applyDraft` from the return type and the function entirely. The `draft` value already exposes the persisted values; callers reset their form state from `draft` directly. Update tests TC-DRAFT-\* if they reference it.

**[WARNING] src/hooks/use-column-draft-persistence.ts:57-63 + 116-119 — `discardDraft` and `clearDraft` are byte-identical**
Tier: 4 — Minimal (M3)
Rule: No copy-paste variation across function definitions.
Why: Both functions execute `removeDraft(key); setDraft(null)`. Two names for the same operation. Even the JSDoc differentiation is artificial ("discard the draft" vs. "delete the draft key after a successful save" — these are the same action). One must go.
Fix: Delete `discardDraft`. Rename callers (none exist yet — hook is unwired) to use `clearDraft`. Update interface and tests.

**[WARNING] src/hooks/use-collaboration.ts:242 — useEffect missing `onSessionExpired` dep (stale-closure risk)**
Tier: 1 — Correct
Rule: useEffect must list all referenced values in its dependency array, or use a ref pattern.
Why: The effect closes over `onSessionExpired` (line 207) but its dep array is `[whiteboardId, userId]`. If a parent re-renders with a fresh callback that captures different state, the socket's `session_expired` listener still fires the old callback. The pattern is the kind of latent bug that surfaces months later when someone wraps the callback to capture additional state.
Fix: Either (a) add `onSessionExpired` to the dep array (will tear down/rebuild the socket on every callback identity change — needs `useCallback` discipline at every call site), or (b) stash `onSessionExpired` in a ref (`const cbRef = useRef(onSessionExpired); useEffect(() => { cbRef.current = onSessionExpired }); ... cbRef.current()`). Option (b) preserves socket continuity. Add an ESLint exception comment if option (a) is intentional.

**[WARNING] src/routes/api/collaboration.ts:251-257 — `denyIfInsufficientPermission` is a 1-line passthrough**
Tier: 4 — Minimal
Rule: Avoid trivial wrappers that add nothing.
Why: The function literally returns `requireRole(socket, whiteboardId, eventName)`. It exists only to preserve the legacy name at 13 call sites. Implementation-notes confirms the rename was intentional ("AD-1: replaces the no-op denyIfInsufficientPermission stub") yet kept the wrapper in place. Net effect: an extra function jump and one more name to grep through.
Fix: replace_all `denyIfInsufficientPermission(socket, whiteboardId,` → `requireRole(socket, whiteboardId,` in `src/routes/api/collaboration.ts`, then delete the wrapper. 13-call mechanical replace; no behavior change.

**[WARNING] src/integrations/tanstack-query/root-provider.tsx:7-21 — `isUnauthorizedError` is name-collision with `src/lib/auth/errors.ts`**
Tier: 5 — Consistent
Rule: Don't shadow project-wide identifiers.
Why: A function `isUnauthorizedError` already exists in `src/lib/auth/errors.ts` with a _different signature_ and _different semantics_ (it checks an object shape, not an Error message). Two functions with the same name and overlapping intent guarantee future confusion — a developer importing from the wrong module gets unexpected results. The local function also implements 401 detection by string-sniffing `error.message` for "unauthorized" or "401", which is brittle (misses i18n'd backend messages, false-positives on user input strings).
Fix: rename the local function to `isErrorWith401Status` (or inline it). Better: import the canonical `isUnauthorizedError` from `@/lib/auth/errors` and use it on `error.cause` / `error.data` if your error shape exposes status that way. Combined with the BLOCKER fix above, this becomes moot if you switch `requireAuth` to throw.

### SUGGESTION

**[SUGGESTION] src/routes/api/{whiteboards,tables,relationships}.ts — Mixed RBAC patterns reduce clarity**
Tier: 5 — Consistent
Why: Some handlers in these files use new `requireServerFnRole` (which throws `ForbiddenError`); others (in the same file) use legacy `findEffectiveRole + hasMinimumRole + return {error: 'FORBIDDEN', ...}`. Two error contracts coexist: thrown 403 vs. resolved-value 403. Implementation-notes calls this temporary. Tracked as debt; mention here for completeness — debt should not linger past 1 sprint.

**[SUGGESTION] src/components/whiteboard/BatchColumnForm.tsx + src/hooks/use-column-draft-persistence.ts — Both unwired, no consumer in src/**
Tier: 4 — Minimal
Why: `rg "BatchColumnForm" src/ --glob '!*.test.*'` returns only the file itself. Same for `useColumnDraftPersistence`. Implementation-notes acknowledges this and says "deferred". Dead code that ships in main accrues lint warnings, increases bundle, and rots silently. Either wire them now (per AC-13/14/15/17/22) or stub them behind a feature flag / move to a `__pending__/` directory until a follow-up PR.

**[SUGGESTION] src/lib/auth/require-role.ts:78-91 — `emitAuthDenied` builds the payload then `WSAuthErrorPayload` is re-typed inline**
Tier: 3 — Clear
Why: The payload object literal in `emitAuthDenied` (line 83-90) duplicates the message strings that callers might also build. Centralizing the error shape via `WSAuthErrorPayload` is good; centralizing the _message text_ in a single constant export would close the loop and prevent drift.

---

## Refactoring Recommended

The following structural issues were found that go beyond this review's scope:

- **Two RBAC patterns coexist** across 9 server-function files — eventual unification of legacy `findEffectiveRole+hasMinimumRole+return-error-object` into `requireServerFnRole+throw` would simplify the BLOCKER #1 fix and remove the AST rule's allowlist branch.
- **`isSessionExpired/emit('session_expired')/disconnect` is duplicated 13 times** in `src/routes/api/collaboration.ts` (M3). A `withAuth` higher-order handler that wraps every WS event listener would dedupe both the session-expired check and the `requireRole` call. Combined with the `denyIfInsufficientPermission` removal (WARNING above), this halves the visual noise in collaboration.ts.
- **`denialCounter` and `lastLogAt` share an unbounded-Map pattern**. A small shared `RotatingMap<K, V>` utility would solve both BLOCKER memory leaks with one abstraction.

Consider addressing these in a follow-up task via `/kratos:quick refactor src/routes/api/collaboration.ts`.

---

## Reuse Check

Checked new functions:

- `httpAuthEvents` / `HTTP_UNAUTHORIZED` — no existing event-bus pattern in src/. New addition is justified.
- `dispatchUnauthorized` (root-provider.tsx) — not duplicated, but has the name-collision with `src/lib/auth/errors.isUnauthorizedError` flagged as WARNING above.
- `BatchDeniedError` / `ForbiddenError` — no prior auth-error class hierarchy. Justified.
- `logSampledError` — no prior dedup-logger. Justified.
- `useColumnDraftPersistence` — no prior sessionStorage hook. Acceptable, but see SUGGESTION about being unwired.
- `getDenialCount` (require-role.ts:70) — exposed only for testing per its JSDoc. No production caller. Consider gating behind a `__test__` export or removing if redundant with test-file accessors.

---

## Auto-Fix Results

| Action              | Count                 |
| ------------------- | --------------------- |
| Auto-applied        | 0                     |
| Requires manual fix | 3 BLOCKER + 5 WARNING |

No mechanical fixes were applied — every BLOCKER requires architectural judgment (HTTP 401 contract) or design judgment (UI rewrite, eviction policy). WARNING items are mostly removals and small refactors that touch test code; defer to Ares.

---

## Rule Proposals

None this round. The patterns observed (M10 unbounded Map, dead-component-merged-to-main, inline-styles-vs-Tailwind) are already covered by existing rules; the issue is enforcement, not rule gaps.

---

## Gate Status

**Changes Required.** 3 BLOCKER findings must be resolved before merging:

1. HTTP 401 → SessionExpiredModal path (the central deliverable of AC-20) does not actually function in production.
2. Two unbounded Maps will leak memory on long-running servers.
3. `BatchColumnForm` violates the project's UI convention (TailwindCSS + shadcn only).

WARNING items 1-5 must also be resolved or explicitly overridden with rationale per Hermes Step 7.

---

## Tier Checklist

| Tier            | Status   | Notes                                                                                   |
| --------------- | -------- | --------------------------------------------------------------------------------------- |
| T1 Correct      | reviewed | 1 BLOCKER (unreachable interceptor), 1 WARNING (stale closure)                          |
| T2 Safe         | reviewed | Anti-enumeration confirmed; SEC-WS / SEC-RBAC / SEC-SP fixes correct                    |
| T3 Clear        | reviewed | 1 WARNING (no-op fn), 1 SUGGESTION (message constant)                                   |
| T4 Minimal      | reviewed | 1 WARNING (passthrough wrapper), 1 WARNING (dup fns), 1 SUGGESTION (dead code)          |
| T5 Consistent   | reviewed | 1 BLOCKER (inline styles), 1 WARNING (name collision), 1 SUGGESTION (mixed RBAC)        |
| T6 Resilient    | reviewed | requireRole/requireServerFnRole fail closed correctly; sessionStorage try/catch present |
| T7 Performant   | reviewed | column:reorder Promise.all is good; no other findings                                   |
| T8 Maintainable | reviewed | 1 BLOCKER (M10 unbounded Map x2)                                                        |
