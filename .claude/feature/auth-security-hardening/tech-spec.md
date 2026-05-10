# Tech Spec: Auth Security Hardening

| Field             | Value                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feature           | auth-security-hardening                                                                                                                                                                                |
| Author            | Hephaestus                                                                                                                                                                                             |
| Status            | Draft (v1)                                                                                                                                                                                             |
| Created           | 2026-05-09                                                                                                                                                                                             |
| Source PRD        | `.claude/feature/auth-security-hardening/prd.md` v2.0                                                                                                                                                  |
| Approved Approach | A — Centralized Authz Middleware                                                                                                                                                                       |
| Locked Decisions  | GA-RBAC-BATCH-SHORT-CIRCUIT (PRE_VALIDATE_THEN_WRITE), GA-MODAL-RECOVERY-SCOPE (COLUMN_FORM_ONLY), GA-ESLINT-RULE-PACKAGING (INLINE_PLUGIN_IN_FLAT_CONFIG), GA-ERROR-SHAPE-MIGRATION (FIVE_FIXES_ONLY) |

---

## 1. Architecture Decisions

### AD-1: Centralized Authz Middleware (chosen approach)

- **Decision:** Replace the no-op `denyIfInsufficientPermission()` stub with a real implementation that wraps `getWhiteboardProjectId()` → `findEffectiveRole()` → `hasMinimumRole()`. Provide one `requireRole(socket, whiteboardId, minRole)` helper for WebSocket handlers and one `requireServerFnRole(ctx, whiteboardId, minRole)` helper for server functions. All five fixes funnel permission checks through these two helpers.
- **Why:** The codebase already has the building blocks (`findEffectiveRole`, `hasMinimumRole`, `getWhiteboardProjectId`, `getTableProjectId`, `getColumnProjectId`, `getRelationshipProjectId`). The only gap is the no-op stub and missing call sites. Centralizing into two helpers preserves "single source of truth" (PRD SEC-WS-02) and makes the AST guard tractable (the rule looks for one of two function calls in handler bodies).
- **Trade-off:** Two helpers must be kept in sync. Acceptable because both delegate to the same `findEffectiveRole` + `hasMinimumRole` primitives.

### AD-2: Inline ESLint plugin in `eslint.config.js` (locked: GA-ESLINT-RULE-PACKAGING)

- **Decision:** Define the SEC-RBAC-04 ESLint rule as an inline plugin object directly inside `eslint.config.js`, using ESLint 9 flat-config inline plugin syntax. No separate npm package, no build step, no `eslint-plugin-*` directory.
- **Why:** Project uses ESLint 9 flat config (already imports `tanstackConfig`). Inline plugins are the simplest packaging that survives `bun install` (no extra dependency to publish/version) and keeps the rule version-controlled with the config. The rule body itself runs in the same process as ESLint with full TypeScript-ESLint AST access.
- **Trade-off:** `eslint.config.js` grows by ~150-200 lines. Mitigation: the rule body lives in a separate `.js` file (`tools/eslint-rules/require-server-fn-authz.js`) imported into the inline plugin, keeping the config readable.

### AD-3: All-or-nothing batch via pre-validate-then-write (locked: GA-RBAC-BATCH-SHORT-CIRCUIT)

- **Decision:** For `createColumnsFn` (HTTP) and any future batch handler, iterate over every item performing both ownership and RBAC checks **first**. If any single item fails, reject the entire batch with `BATCH_DENIED` (no item index leaked). Only on full pass do we invoke the data-layer write (`createColumns`, `reorderColumns`, etc.).
- **Why:** Matches PRD SEC-BATCH-01 / SEC-BATCH-02 / SEC-BATCH-03 exactly. Avoids partial writes, anti-enumeration preserved, and the database transaction is only entered when the request is known good.
- **Trade-off:** N permission queries serialized before write. Acceptable for column batches (typical size ≤ 20). If batch sizes ever grow into the hundreds, optimize later via parallel `Promise.all()` over the per-item checks; not needed for v1.

### AD-4: Column-form-only recovery store (locked: GA-MODAL-RECOVERY-SCOPE)

- **Decision:** SEC-MODAL-05 unsaved-state persistence covers only the in-flight column-edit modal form values. Persist to `sessionStorage` keyed by `draft:${whiteboardId}:${columnId}`. Restore when the column-edit modal mounts after re-authentication.
- **Why:** The PRD allows engineering to pick the persistence layer and explicitly accepts "the minimum viable persistence" as sufficient. Whiteboard-wide draft persistence is out of scope; the column-edit modal is the realistic mid-edit surface that loses work today.
- **Trade-off:** Drafted-but-unsaved table positions, drafted relationships, etc. are not preserved. Documented limitation; broader recovery deferred to a future PRD.

### AD-5: Two error shapes coexist temporarily (locked: GA-ERROR-SHAPE-MIGRATION)

- **Decision:** Only the five patched defect sites adopt the canonical SEC-ERR-01 (HTTP 403 `{error, message}`) and SEC-ERR-02 (WebSocket `error` event with `{code, event, message}`) shapes. All other existing handlers keep their current ad-hoc shapes (e.g., the `socket.emit('error', { event, error: 'NOT_FOUND', message })` pattern in `collaboration.ts` table/relationship handlers).
- **Why:** Explicit decision lock. PRD allows two shapes coexisting temporarily; full migration is out of scope. Bounded scope keeps the diff small and reviewable.
- **Trade-off:** The client error handler must understand both shapes during the migration window. Documented in §4.5 below.

### AD-6: Fail-closed on RBAC throw with sampled ERROR logs

- **Decision:** Wrap the role lookup in `requireRole` / `requireServerFnRole` with a try/catch. On throw, deny (return `false`/throw 403) and log at ERROR level via a sampled logger keyed by `(userId, errorClass)` per 60-second window.
- **Why:** PRD §7 row 4 requires fail-closed and dedup. The codebase has no logger framework — implement the dedup as a tiny in-process Map keyed by `${userId}:${errorClass}` with a 60s TTL. Matches PRD's "as simple as a structured-log field; no new metrics infra is required" intent.
- **Trade-off:** In-process dedup is not durable across restarts. Acceptable per PRD SEC-WS-03 ("structured-log field is durable" applies to the counter; this is the dedup).

### AD-7: Single-source `session_expired` registration via existing `useCollaboration` hook

- **Decision:** Tighten `useCollaboration` so the `onSessionExpired` callback is **mandatory** (TypeScript-required, not optional). Update three call sites (`use-column-collaboration.ts`, `use-column-reorder-collaboration.ts`, both route files) to pass `triggerSessionExpired` from `useAuthContext()`. The single `socket.on('session_expired', ...)` registration in `useCollaboration` (line 203) is the single source of truth.
- **Why:** SEC-MODAL-02 requires exactly one registration site. The existing hook already owns it; the gap is that callers don't pass the callback, so the trigger fires `?.()` against undefined. Making the callback mandatory at the type system level closes this.
- **Trade-off:** Breaking signature change to `useCollaboration`. All four call sites are within scope to update.

### AD-8: Promote staging "superpassword used" instrumentation before merge (resolves v2 re-review MINOR-1)

- **Decision:** Before deleting the superpassword branch, add a one-line `console.warn('[auth] DEBUG_SUPER_PASSWORD bypass used', { userId: user.id })` in the branch. Run this in staging for the §13.2 communication window. The merge PR removes both the warn and the bypass in one commit.
- **Why:** Closes v2 re-review MINOR-1 ("staging logs distinguish superpassword from real-password success"). Trivial to add; gives the §13.5 verification checklist a real signal.

---

## 2. Defect Enumeration Appendix (PRD §9 row 1 mitigation — gating)

This appendix discharges the PRD requirement that Hephaestus's enumeration produce a written defect list, with each finding triaged as **in-scope / new-feature / accepted-risk** before Apollo (stage 7) can approve.

### 2.1 WebSocket handlers — `denyIfInsufficientPermission` no-op

`src/routes/api/collaboration.ts` defines `denyIfInsufficientPermission()` (line 258) as an `async () => false` no-op. Every mutation handler calls it as a guard, so **every** WebSocket mutation is currently affected, not just `column:create`. Affected handlers:

| Handler               | Line | Triage                                                                             |
| --------------------- | ---- | ---------------------------------------------------------------------------------- |
| `table:create`        | 341  | **In-scope** (covered transitively by AD-1 — fixing the helper fixes all of these) |
| `table:move`          | 380  | In-scope (same)                                                                    |
| `table:move:bulk`     | 446  | In-scope (same)                                                                    |
| `table:update`        | 482  | In-scope (same)                                                                    |
| `table:delete`        | 543  | In-scope (same)                                                                    |
| `column:create`       | 602  | In-scope (named in PRD SEC-WS-01)                                                  |
| `column:update`       | 658  | In-scope (same)                                                                    |
| `column:delete`       | 721  | In-scope (same)                                                                    |
| `column:reorder`      | 777  | In-scope (same)                                                                    |
| `column:duplicate`    | 883  | In-scope (same)                                                                    |
| `relationship:create` | 954  | In-scope (same)                                                                    |
| `relationship:update` | 993  | In-scope (same)                                                                    |
| `relationship:delete` | 1056 | In-scope (same)                                                                    |

**Triage:** All in-scope. Replacing the no-op stub with the real implementation closes all 13 handlers in one change, satisfying SEC-WS-01 (which named only `column:create`) plus the 12 others by transitive coverage. Zero new-feature, zero accepted-risk.

### 2.2 Server functions — RBAC stubs (TODO comments)

`rg "TODO: restore permission check"` against `src/lib/`, `src/routes/api/` shows the same pattern repeated across 28 server-function exports. Counts per file:

| File                                     | `createServerFn` exports | Triage                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server-functions.ts`            | 10                       | In-scope (PRD SEC-RBAC-01 names this file explicitly)                                                                                                                                                                                                                                                                           |
| `src/lib/server-functions-project.ts`    | 2                        | In-scope (extends SEC-RBAC-01 by AD-1's enumeration; aligns with the "every export across `src/lib/`" net cast by SEC-RBAC-04)                                                                                                                                                                                                  |
| `src/routes/api/columns.ts`              | 10                       | In-scope (server-function file under `src/routes/`; SEC-RBAC-04 requires the AST rule to detect `src/routes/api/*.ts` as well)                                                                                                                                                                                                  |
| `src/routes/api/whiteboards.ts`          | 11                       | In-scope                                                                                                                                                                                                                                                                                                                        |
| `src/routes/api/projects.ts`             | 8                        | In-scope                                                                                                                                                                                                                                                                                                                        |
| `src/routes/api/folders.ts`              | 8                        | In-scope                                                                                                                                                                                                                                                                                                                        |
| `src/routes/api/tables.ts`               | 9                        | In-scope                                                                                                                                                                                                                                                                                                                        |
| `src/routes/api/relationships.ts`        | 9                        | In-scope                                                                                                                                                                                                                                                                                                                        |
| `src/routes/api/permissions.ts`          | 5                        | In-scope                                                                                                                                                                                                                                                                                                                        |
| `src/routes/api/auth.ts`                 | 5                        | **Accepted-risk** for `loginUser`, `registerUser`, `logoutUser`, `getCurrentUser` — these are pre-auth or self-auth functions. They are annotated `@requires authenticated` (or are unauthenticated by design — login/register). The AST rule whitelists endpoints that have an explicit `@requires unauthenticated` JSDoc tag. |
| `src/data/demo.punk-songs.ts`            | 2                        | **Accepted-risk** — demo file, not a production code path. Annotated `@requires authenticated` because all routes require login per the auth PRD; no per-resource permission applies.                                                                                                                                           |
| `src/routes/demo/prisma.tsx`             | 3                        | **Accepted-risk** — demo route. Same disposition as above.                                                                                                                                                                                                                                                                      |
| `src/routes/demo/start.server-funcs.tsx` | 4                        | **Accepted-risk** — demo route. Same disposition.                                                                                                                                                                                                                                                                               |
| `src/routes/api/auth.test.ts`            | 2                        | Test fixture — outside lint scope (test files).                                                                                                                                                                                                                                                                                 |

**Total in-scope server-function exports: ~85.** All 85 receive either `requireServerFnRole(ctx, resourceId, minRole)` or an explicit `@requires authenticated` JSDoc tag. The auth-route exports get a new `@requires unauthenticated` tag handled as a special case by the AST rule.

### 2.3 Batch endpoints

| Endpoint                          | File / Line                                | Triage                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createColumnsFn` (HTTP)          | `src/routes/api/columns.ts` line 205       | In-scope. PRD SEC-BATCH-01..04 directly applies. Currently iterates per-tableId for permission checks but the check is a TODO no-op (lines 220-228). Fix per AD-3.                                              |
| `column:reorder` (WebSocket)      | `src/routes/api/collaboration.ts` line 777 | In-scope (same family). Already validates per-item ownership; needs RBAC bolted on per AD-1. Not a "batch RBAC gap" today (it operates on a single tableId), but the handler is part of the broader AD-1 sweep. |
| `table:move:bulk` (WebSocket)     | `src/routes/api/collaboration.ts` line 446 | In-scope. Already operates against the namespace-level `whiteboardId` (one project), so per-item RBAC isn't a concern for this endpoint — the standard auth prelude (AD-1) is sufficient.                       |
| `updateTablePositionsBulk` (HTTP) | `src/lib/server-functions.ts` line 157     | In-scope. Single-whiteboard scope, same disposition as `table:move:bulk`. RBAC via AD-1's `requireServerFnRole`.                                                                                                |

### 2.4 New defects discovered during enumeration

None beyond the five named in the PRD (and their transitive coverage above). The "no-op stub" defect class is the same root cause behind PRD's "WebSocket `column:create` IDOR" + "batch column RBAC gap" + "missing RBAC on server functions" — they are three symptoms of one underlying issue (the RBAC bypass code that was committed during PR #97 development, marked TODO, never restored). Triage outcome: **all in-scope** under AD-1.

### 2.5 Apollo gate sign-off line

> Hephaestus enumeration complete. 13 WebSocket handlers + 85 server-function exports affected. All triaged as in-scope under AD-1 (centralized middleware). Zero new-feature defects; ~16 accepted-risk demo/test files documented above. No additional defects discovered beyond the PRD's named five.

---

## 3. Component Design

### 3.1 New module: `src/lib/auth/require-role.ts`

Two exports — the centralized authz primitives that AD-1 introduces.

```ts
// src/lib/auth/require-role.ts
import type { Socket } from 'socket.io'
import { findEffectiveRole, type EffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { logSampledError } from '@/lib/auth/log-sample'

const EDITOR_OR_ABOVE: EffectiveRole = 'EDITOR'

export type WSAuthErrorPayload = {
  code: 'FORBIDDEN' | 'BATCH_DENIED'
  event: string
  message: string
}

/**
 * WebSocket handler RBAC guard.
 * Returns true if the request was denied (caller should `return`).
 * On denial, emits the canonical SEC-ERR-02 error event and increments the per-(user,event) counter.
 * On role-lookup throw, fails closed (denies) and logs ERROR via sampled logger.
 *
 * @param socket - Socket.IO server-side socket
 * @param whiteboardId - Whiteboard the request targets
 * @param eventName - Original event name (e.g., 'column:create') — for SEC-ERR-02 + log
 * @param minRole - Minimum effective role required (default: EDITOR)
 */
export async function requireRole(
  socket: { data: { userId: string }; emit: (e: string, p: any) => void },
  whiteboardId: string,
  eventName: string,
  minRole: EffectiveRole = EDITOR_OR_ABOVE,
): Promise<boolean> {
  const userId = socket.data.userId
  let role: EffectiveRole | null = null
  try {
    const { getWhiteboardProjectId } = await import('@/data/resolve-project')
    const projectId = await getWhiteboardProjectId(whiteboardId)
    if (!projectId) {
      // SEC-ERR-03: not-found is indistinguishable from unauthorized
      emitAuthDenied(socket, eventName, 'FORBIDDEN')
      incrementDenialCounter(userId, eventName)
      return true
    }
    role = await findEffectiveRole(userId, projectId)
  } catch (error) {
    logSampledError({
      userId,
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: error instanceof Error ? error.message : String(error),
      eventName,
    })
    emitAuthDenied(socket, eventName, 'FORBIDDEN')
    incrementDenialCounter(userId, eventName)
    return true
  }
  if (!hasMinimumRole(role, minRole)) {
    emitAuthDenied(socket, eventName, 'FORBIDDEN')
    incrementDenialCounter(userId, eventName)
    console.warn(
      `[auth] RBAC denied: user=${userId} event=${eventName} whiteboard=${whiteboardId} role=${role ?? 'none'} required=${minRole}`,
    )
    return true
  }
  return false
}

function emitAuthDenied(
  socket: { emit: (e: string, p: any) => void },
  eventName: string,
  code: 'FORBIDDEN' | 'BATCH_DENIED',
): void {
  socket.emit('error', {
    code,
    event: eventName,
    message:
      code === 'BATCH_DENIED'
        ? 'This batch could not be saved. One or more items target a resource you no longer have access to.'
        : 'You do not have access to perform this action.',
  } satisfies WSAuthErrorPayload)
}

// Per-(userId, event) denial counter. In-process, non-durable.
// PRD SEC-WS-03 accepts "structured-log field" — exposing this as a
// console.warn structured field is sufficient for v1.
const denialCounter = new Map<string, number>()
function incrementDenialCounter(userId: string, eventName: string): void {
  const key = `${userId}:${eventName}`
  denialCounter.set(key, (denialCounter.get(key) ?? 0) + 1)
}
export function getDenialCount(userId: string, eventName: string): number {
  return denialCounter.get(`${userId}:${eventName}`) ?? 0
}

/**
 * Server function RBAC guard.
 * Throws ForbiddenError on denial (caller should not catch).
 * Throw shape matches SEC-ERR-01: HTTP 403 with { error: 'FORBIDDEN', message }.
 *
 * @param userId - Authenticated user id (from requireAuth ctx)
 * @param resourceProjectId - Project id resolved from the resource (whiteboard, table, column, etc.)
 * @param minRole - Minimum effective role required
 */
export class ForbiddenError extends Error {
  readonly status = 403 as const
  readonly errorCode = 'FORBIDDEN' as const
  constructor(message = 'You do not have access to this resource.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export async function requireServerFnRole(
  userId: string,
  resourceProjectId: string | null,
  minRole: EffectiveRole = EDITOR_OR_ABOVE,
): Promise<void> {
  if (!resourceProjectId) {
    throw new ForbiddenError() // SEC-ERR-03: not-found ≡ forbidden
  }
  let role: EffectiveRole | null = null
  try {
    role = await findEffectiveRole(userId, resourceProjectId)
  } catch (error) {
    logSampledError({
      userId,
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })
    throw new ForbiddenError()
  }
  if (!hasMinimumRole(role, minRole)) {
    throw new ForbiddenError()
  }
}
```

### 3.2 New module: `src/lib/auth/log-sample.ts`

Sampled logger for AD-6 (PRD §7 row 4).

```ts
// src/lib/auth/log-sample.ts
const WINDOW_MS = 60_000
const lastLogAt = new Map<string, number>() // key: `${userId}:${errorClass}`

export function logSampledError(args: {
  userId: string
  errorClass: string
  message: string
  eventName?: string
}): void {
  const key = `${args.userId}:${args.errorClass}`
  const now = Date.now()
  const last = lastLogAt.get(key) ?? 0
  if (now - last < WINDOW_MS) return
  lastLogAt.set(key, now)
  console.error(
    `[auth] ${args.errorClass}: user=${args.userId} event=${args.eventName ?? 'n/a'} message="${args.message}"`,
  )
}
```

### 3.3 Modified: `src/routes/api/collaboration.ts` — `denyIfInsufficientPermission`

Replace the no-op (lines 257-273) with a thin wrapper around `requireRole`:

```ts
async function denyIfInsufficientPermission(
  socket: any,
  whiteboardId: string,
  eventName: string, // NEW parameter
): Promise<boolean> {
  const { requireRole } = await import('@/lib/auth/require-role')
  return requireRole(socket, whiteboardId, eventName)
}
```

Each of the 13 call sites (table:create, table:move, etc.) gets the eventName passed:

```ts
// Before:
if (await denyIfInsufficientPermission(socket, whiteboardId)) return
// After:
if (await denyIfInsufficientPermission(socket, whiteboardId, 'column:create'))
  return
```

Restore the `findEffectiveRole` import (line 52) and delete the eslint-disable + ts-expect-error comments.

### 3.4 Modified: `src/lib/server-functions.ts` and other server-function files

Pattern for each handler that resolves a `projectId`:

```ts
// Before:
.handler(
  requireAuth(async ({ user: _user }, data) => {
    const projectId = await getWhiteboardProjectId(data.whiteboardId)
    if (!projectId) throw new Error('Whiteboard not found')
    // TODO: restore permission check — temporarily disabled
    void projectId
    ...
  }),
)

// After:
/**
 * @requires editor
 */
.handler(
  requireAuth(async ({ user }, data) => {
    const projectId = await getWhiteboardProjectId(data.whiteboardId)
    await requireServerFnRole(user.id, projectId, 'EDITOR')
    ...
  }),
)
```

Read-only handlers use `'VIEWER'` as the minimum role. Server functions in `src/routes/api/auth.ts` carry `@requires unauthenticated` (login, register) or `@requires authenticated` (logout, getCurrentUser).

### 3.5 New module: `src/routes/api/columns.ts` — `createColumnsFn` batch RBAC

Per AD-3:

```ts
/**
 * @requires editor
 */
export const createColumnsFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.array(createColumnSchema).parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      if (data.length === 0) return []

      // Step 1: PRE-VALIDATE — every item's RBAC + ownership, before any write.
      // Per AD-3 (GA-RBAC-BATCH-SHORT-CIRCUIT): if any item fails, reject the entire batch.
      const uniqueTableIds = [...new Set(data.map((c) => c.tableId))]
      for (const tableId of uniqueTableIds) {
        const projectId = await getTableProjectId(tableId)
        try {
          await requireServerFnRole(user.id, projectId, 'EDITOR')
        } catch (error) {
          if (error instanceof ForbiddenError) {
            // SEC-BATCH-03: do NOT leak which tableId failed.
            throw new BatchDeniedError()
          }
          throw error
        }
      }

      // Step 2: WRITE — only reached when every item passed.
      try {
        return await createColumns(data)
      } catch (error) {
        throw new Error(
          `Failed to create columns: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

// New error class — sibling of ForbiddenError, for batch-denial UX routing.
export class BatchDeniedError extends Error {
  readonly status = 403 as const
  readonly errorCode = 'BATCH_DENIED' as const
  constructor() {
    super(
      'This batch could not be saved. One or more items target a resource you no longer have access to. Try removing items added in the last few minutes, or save items individually to find which one is blocked.',
    )
    this.name = 'BatchDeniedError'
  }
}
```

`BatchDeniedError` lives in `src/lib/auth/require-role.ts` next to `ForbiddenError`.

### 3.6 Modified: `src/lib/auth/password.ts` — superpassword removal

The superpassword bypass currently lives in `src/routes/api/auth.ts` lines 129-138 (a `process.env.DEBUG_SUPER_PASSWORD` branch ORed into the password verification). Per AD-8:

1. **Pre-merge (instrumentation phase):** add `console.warn('[auth] DEBUG_SUPER_PASSWORD bypass used', { userId: user.id, env: process.env.NODE_ENV })` inside the `isSuperpassword` branch when truthy. Ship this to staging, observe for ≥24h per PRD §13.5.
2. **Merge commit (removal phase):** delete the entire `debugSuperPassword`, `isSuperpassword`, and the OR (`isSuperpassword ||`) wrapping `verifyPassword`. The line collapses to:

```ts
const valid = await verifyPassword(data.password, user.passwordHash)
```

The `verifyPassword` function in `src/lib/auth/password.ts` is already clean (single-branch, returns `bcrypt.compare(...)` result). The SEC-SP-02 AST assertion runs against this function and passes by inspection — no code change needed in `password.ts` itself.

### 3.7 Modified: `src/hooks/use-collaboration.ts`

Make `onSessionExpired` mandatory (AD-7):

```ts
export function useCollaboration(
  whiteboardId: string,
  userId: string,
  onSessionExpired: () => void, // was optional, now required
): UseCollaborationReturn { ... }
```

Update three call sites:

- `src/hooks/use-column-collaboration.ts` line 84
- `src/hooks/use-column-reorder-collaboration.ts` line 49
- `src/routes/whiteboard/$whiteboardId.tsx` line 144
- `src/routes/whiteboard/$whiteboardId.new.tsx` line 158

Each adds:

```ts
const { triggerSessionExpired } = useAuthContext()
const { emit, on, off, ... } = useCollaboration(whiteboardId, userId, triggerSessionExpired)
```

### 3.8 Modified: `src/components/whiteboard/<column-edit-modal>.tsx` (file TBD by Ares)

Per AD-4 (GA-MODAL-RECOVERY-SCOPE), the column-edit modal:

1. **On every form change:** debounce-write `{ name, dataType, isPrimaryKey, ... }` to `sessionStorage[draft:${whiteboardId}:${columnId}]`.
2. **On modal mount after re-auth:** check `sessionStorage` for the draft key; if present, prefill the form and surface an "Apply / Discard draft" prompt (small banner above the form fields). Discard removes the key.
3. **On successful save:** delete the draft key.
4. **Triggered specifically by:** modal mount AFTER a `sessionExpired === true` → `false` transition in `AuthContext` (i.e., user just re-authenticated). Implemented via a `useEffect` watching `useAuthContext().sessionExpired`.

Key shape: `draft:${whiteboardId}:${columnId}` so concurrent modals on different columns or whiteboards don't collide. Storage budget: ~200 bytes per draft, well within sessionStorage limits.

Ares confirms the exact file path during implementation; the codebase has multiple column-edit components (search: `bunx rg "createColumnSchema|updateColumnSchema" src/components`).

### 3.9 New: ESLint rule `tools/eslint-rules/require-server-fn-authz.js`

Per AD-2, the rule body lives in a separate file imported by `eslint.config.js`. Rule contract:

- **Trigger:** any `CallExpression` whose callee is `createServerFn`.
- **Walk:** the chained `.handler(...)` argument is the handler. Resolve the handler argument:
  - Direct `async (ctx, data) => { ... }` → walk the body.
  - Wrapped `requireAuth(async (ctx, data) => { ... })` → walk the inner arrow body.
  - Other wrapper → fail the rule unless the wrapper is in the **allowlist** (`requireAuth`).
- **Body assertion:** the handler body must contain at least one `CallExpression` matching one of:
  - `requireServerFnRole(...)`
  - `findEffectiveRole(...)` followed by `hasMinimumRole(...)` (legacy pattern, for resilience)
  - `await requireServerFnRole(...)` inside a `try { ... } catch (error) { if (error instanceof ForbiddenError) throw new BatchDeniedError() ... }` for batch endpoints
- **Annotation escape hatch:** if the export's leading JSDoc contains `@requires authenticated` or `@requires unauthenticated`, the body assertion is skipped.
- **JSDoc validation:** every `createServerFn` export must have a JSDoc block with one of `@requires {authenticated,unauthenticated,viewer,editor,admin,owner}`. Missing or malformed → fail.
- **Scope:** runs against `src/**/*.{ts,tsx}` excluding test files and the demo files documented in §2.2.

The rule **also** asserts that `socket.on('session_expired', ...)` (string literal `'session_expired'`) appears in exactly one file (SEC-MODAL-02). Implemented as an "after all files" hook (using ESLint's `Program:exit` plus a shared module-level Set), or as a separate test file if the post-pass is awkward in flat config — Ares chooses.

### 3.10 Test files

| Test                              | File                                                                                                                                       | Asserts                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-SP-04 (superpassword removed) | `src/routes/api/auth.test.ts` (extend)                                                                                                     | Login with the previously-hardcoded `DEBUG_SUPER_PASSWORD` value fails with `error: 'AUTH_FAILED'`. AST sub-assertion: `verifyPassword` body contains `bcrypt.compare` and no other truthy return path.                                                                                                                                                                   |
| SEC-WS-04 (column:create authz)   | `src/server/socket.test.ts` (extend)                                                                                                       | Mock `findEffectiveRole` to return `null`; emit `column:create`; assert no DB write + assert `error` event with `code: 'FORBIDDEN', event: 'column:create'`.                                                                                                                                                                                                              |
| SEC-BATCH-04 + SEC-BATCH-UX-05    | `src/routes/api/columns.test.ts` (new) + `src/components/whiteboard/<column-batch>.test.tsx` (new)                                         | (a) HTTP: mixed batch → throws BatchDeniedError, zero rows written. (b) UI: simulate BatchDeniedError → form input retained, banner visible, bisection affordance reachable via Tab key.                                                                                                                                                                                  |
| SEC-MODAL-04 + SEC-MODAL-05       | `src/hooks/use-whiteboard-collaboration-auth.test.ts` (extend) + `src/components/whiteboard/<column-edit>.test.tsx` (new for SEC-MODAL-05) | (a) Emit `session_expired` → `triggerSessionExpired` called once; focus moves to modal. (b) Open column-edit modal, type changes → sessionStorage populated. Trigger session-expired flow → re-mount modal → form prefilled with draft + Apply/Discard banner visible.                                                                                                    |
| SEC-RBAC-05 (per-tier denial)     | `src/lib/server-functions.test.ts` (new) — 4 tests                                                                                         | Viewer-required: getWhiteboardWithDiagram with no membership → ForbiddenError. Editor-required: createTable with VIEWER role → ForbiddenError. Admin-required: a representative permissions endpoint with EDITOR role → ForbiddenError. Owner-required: project-delete with ADMIN role → ForbiddenError. (Specific endpoints picked during implementation per role tier.) |
| AST guard self-test               | `tools/eslint-rules/require-server-fn-authz.test.js` (new)                                                                                 | Lints fixture files: (a) `createServerFn` without RBAC call → fail. (b) `createServerFn` with `@requires editor` JSDoc but no `requireServerFnRole` call → fail. (c) `createServerFn` with `@requires authenticated` JSDoc → pass (escape hatch). (d) `withAuth(fn)` wrapper not in allowlist → fail. (e) Two files with `socket.on('session_expired', ...)` → fail.      |

---

## 4. Implementation Plan (Sequence of Changes)

The 5-tech-spec stage has no `decomposition.md` (stage 3 was skipped per `status.json: 3-decomposition.skipped`). Phases below are organized by natural module boundaries and dependencies.

### Phase 1: Foundation (no behavior change yet)

1.1. Create `src/lib/auth/log-sample.ts` (AD-6).  
1.2. Create `src/lib/auth/require-role.ts` with `requireRole`, `requireServerFnRole`, `ForbiddenError`, `BatchDeniedError`, `getDenialCount`, `WSAuthErrorPayload` (§3.1).  
1.3. Add unit tests for both helpers (mock `findEffectiveRole`, assert deny / allow / throw paths).

### Phase 2: WebSocket fix (covers SEC-WS-01..04)

2.1. Modify `src/routes/api/collaboration.ts` `denyIfInsufficientPermission` to delegate to `requireRole` (§3.3).  
2.2. Add the `eventName` parameter to all 13 call sites.  
2.3. Restore the `findEffectiveRole` import (line 52); delete the `eslint-disable`, `@ts-expect-error`, and unused-variable comments.  
2.4. Extend `src/server/socket.test.ts` for SEC-WS-04 regression.

### Phase 3: Server-function fix (covers SEC-RBAC-01..05)

3.1. Add JSDoc `@requires <role>` to every export across `src/lib/server-functions.ts`, `src/lib/server-functions-project.ts`, `src/routes/api/{columns,whiteboards,projects,folders,tables,relationships,permissions,auth}.ts`. Use the lowercase set `{authenticated, unauthenticated, viewer, editor, admin, owner}` per PRD SEC-RBAC-03.  
3.2. Replace each `// TODO: restore permission check` block with `await requireServerFnRole(user.id, projectId, 'EDITOR' | 'VIEWER' | ...)`.  
3.3. Read-only functions (`getWhiteboardWithDiagram`, `getWhiteboardRelationships`, `getAllProjects`, etc.) use `'VIEWER'`. Write functions use `'EDITOR'`. Permission/membership-management functions use `'ADMIN'` or `'OWNER'` per the original auth PRD's role contract.  
3.4. Migrate the rejection shape on these specific endpoints to throw `ForbiddenError`. The existing throw-on-`requireAuth` returns `{ error: 'UNAUTHORIZED', status: 401 }` — that path stays unchanged. Only the post-auth permission denial uses the new shape.  
3.5. Add SEC-RBAC-05 regression tests in a new `src/lib/server-functions.test.ts`.

### Phase 4: Batch fix (covers SEC-BATCH-01..04)

4.1. Modify `createColumnsFn` per §3.5 (pre-validate-then-write, `BatchDeniedError`).  
4.2. Add SEC-BATCH-04 HTTP test in new `src/routes/api/columns.test.ts`.  
4.3. Find the column-batch UI component (Ares: `bunx rg "createColumnsFn"`); implement SEC-BATCH-UX-01..04 (preserve form input, show banner with the canonical message, expose per-row "save individually" button, route on `code === 'BATCH_DENIED'`).  
4.4. Add SEC-BATCH-UX-05 component test.

### Phase 5: Session-expired modal fix (covers SEC-MODAL-01..05)

5.1. Modify `src/hooks/use-collaboration.ts`: tighten `onSessionExpired` to required (§3.7).  
5.2. Update four call sites to pass `triggerSessionExpired` from `useAuthContext()`.  
5.3. Implement column-form recovery store (AD-4 / §3.8):

- Add `useColumnDraftPersistence(whiteboardId, columnId)` hook in `src/hooks/use-column-draft-persistence.ts`.
- Wire into the column-edit modal component (Ares confirms file path).
- Add Apply/Discard banner shown on modal mount when a draft exists.
  5.4. Extend SEC-MODAL-04 test (focus assertion). Add SEC-MODAL-05 component test for draft restore.

### Phase 6: Superpassword removal + pre-merge migration (covers SEC-SP-01..04, §13)

6.1. **Pre-merge instrumentation (AD-8):** add the `console.warn('[auth] DEBUG_SUPER_PASSWORD bypass used', ...)` log line. Deploy to staging. Wait ≥7 calendar days per PRD §13.2; verify §13.5 checklist (zero superpassword warns in 24h, all dev passwords reset).  
6.2. **Merge commit:** delete `debugSuperPassword`, `isSuperpassword`, and the OR-wrapping in `src/routes/api/auth.ts`. Single line becomes `const valid = await verifyPassword(data.password, user.passwordHash)`.  
6.3. Add SEC-SP-04 regression test in `src/routes/api/auth.test.ts`.  
6.4. Add SEC-SP-02 AST assertion: a small Vitest test that uses `@typescript-eslint/parser` to parse `src/lib/auth/password.ts`, find `verifyPassword`, and assert every `ReturnStatement` traces back to `bcrypt.compare(...)`. (This is a one-off — does not need the full ESLint plugin treatment.)

### Phase 7: AST guards (covers SEC-RBAC-04, SEC-MODAL-02)

7.1. Create `tools/eslint-rules/require-server-fn-authz.js` per §3.9.  
7.2. Inline-register the plugin in `eslint.config.js` per AD-2.  
7.3. Run `bun run lint` — should pass (Phases 3-5 already added the JSDoc tags + helper calls).  
7.4. Add the rule's self-test fixtures in `tools/eslint-rules/__fixtures__/` and the test runner in `tools/eslint-rules/require-server-fn-authz.test.js`.  
7.5. Confirm the rule fires on a deliberate negative-case fixture (a `createServerFn` without RBAC) and passes the codebase as-is.

### Phase 8: Verification

8.1. `bun run lint` — clean (AST guard happy).  
8.2. `bun run test` — all SEC-\* regression tests pass.  
8.3. Manual: try login with the (deleted) DEBUG_SUPER_PASSWORD value → fails. Try `column:create` against a whiteboard you have no role on → receives `error` event with `code: 'FORBIDDEN'`. Submit a mixed batch → `BatchDeniedError`. Trigger a forced session-expiry → modal appears, column-edit draft restored after re-auth.  
8.4. Update §13.5 PR checklist boxes.

---

## 5. Files: Create / Modify

### Create

- `src/lib/auth/require-role.ts` — `requireRole`, `requireServerFnRole`, `ForbiddenError`, `BatchDeniedError`, `WSAuthErrorPayload`, `getDenialCount`. (§3.1)
- `src/lib/auth/log-sample.ts` — `logSampledError`. (§3.2)
- `src/hooks/use-column-draft-persistence.ts` — sessionStorage draft hook for AD-4 / §3.8.
- `tools/eslint-rules/require-server-fn-authz.js` — AST guard rule body. (§3.9)
- `tools/eslint-rules/require-server-fn-authz.test.js` — rule self-tests.
- `tools/eslint-rules/__fixtures__/{good,bad}-server-fn.ts` — fixture files for the rule self-test.
- `src/routes/api/columns.test.ts` — SEC-BATCH-04 HTTP regression.
- `src/lib/server-functions.test.ts` — SEC-RBAC-05 four-tier regression.
- `src/components/whiteboard/<column-batch>.test.tsx` — SEC-BATCH-UX-05 (path TBD by Ares).
- `src/components/whiteboard/<column-edit-draft>.test.tsx` — SEC-MODAL-05 (path TBD by Ares).
- `src/lib/auth/require-role.test.ts` — Phase 1.3 unit tests.
- `src/lib/auth/log-sample.test.ts` — log dedup unit tests.
- `src/lib/auth/password-ast-assert.test.ts` — SEC-SP-02 one-off AST assertion (Phase 6.4).

### Modify

- `src/routes/api/collaboration.ts` — replace `denyIfInsufficientPermission` no-op with real wrapper; add `eventName` to 13 call sites; restore `findEffectiveRole` import; delete TODO/eslint-disable/ts-expect-error annotations.
- `src/lib/server-functions.ts` — add JSDoc `@requires <role>` + `requireServerFnRole` to all 10 exports; throw `ForbiddenError` instead of generic `Error('Whiteboard not found')` for permission denials.
- `src/lib/server-functions-project.ts` — same treatment for 2 exports.
- `src/routes/api/columns.ts` — same treatment for 10 exports; modify `createColumnsFn` per §3.5 (pre-validate-then-write).
- `src/routes/api/whiteboards.ts` — same treatment for 11 exports.
- `src/routes/api/projects.ts` — same treatment for 8 exports.
- `src/routes/api/folders.ts` — same treatment for 8 exports.
- `src/routes/api/tables.ts` — same treatment for 9 exports.
- `src/routes/api/relationships.ts` — same treatment for 9 exports.
- `src/routes/api/permissions.ts` — same treatment for 5 exports.
- `src/routes/api/auth.ts` — Phase 6.2 (delete superpassword bypass); add `@requires unauthenticated` to login/register and `@requires authenticated` to logout/getCurrentUser.
- `src/hooks/use-collaboration.ts` — make `onSessionExpired` mandatory (AD-7).
- `src/hooks/use-column-collaboration.ts` — pass `triggerSessionExpired` to `useCollaboration`.
- `src/hooks/use-column-reorder-collaboration.ts` — same.
- `src/routes/whiteboard/$whiteboardId.tsx` — same.
- `src/routes/whiteboard/$whiteboardId.new.tsx` — same.
- `src/components/whiteboard/<column-edit-modal>.tsx` — wire `useColumnDraftPersistence` (path TBD).
- `src/components/whiteboard/<column-batch-form>.tsx` — handle `BatchDeniedError` per SEC-BATCH-UX-01..04 (path TBD).
- `eslint.config.js` — register inline plugin per AD-2.
- `src/server/socket.test.ts` — extend with SEC-WS-04 regression.
- `src/routes/api/auth.test.ts` — extend with SEC-SP-04 regression.
- `src/hooks/use-whiteboard-collaboration-auth.test.ts` — extend with SEC-MODAL-04 focus assertion.

**Counts:** ~13 files to create, ~21 files to modify.

### Out of scope (explicitly NOT touched)

- `src/data/demo.punk-songs.ts`, `src/routes/demo/*` — annotated `@requires authenticated` only; no `requireServerFnRole` (no per-resource permission applies). The AST rule whitelists demo paths via the `@requires authenticated` escape hatch.
- The 13 ad-hoc `socket.emit('error', { event, error: 'NOT_FOUND' | 'VALIDATION_ERROR' | ... })` shapes elsewhere in `collaboration.ts` — keep current shape per AD-5. Only the auth-denial emit (centralized in `requireRole`) uses the canonical SEC-ERR-02 shape.

---

## 6. Database / Schema Changes

None. All five fixes are application-layer.

---

## 7. API Contracts

### 7.1 HTTP error shape (canonical, SEC-ERR-01)

Status: `403`. Body: `{ "error": "FORBIDDEN", "message": "You do not have access to this resource." }` for single-resource denials, or `{ "error": "BATCH_DENIED", "message": "This batch could not be saved..." }` for batch denials. Implemented by throwing `ForbiddenError` / `BatchDeniedError`, which TanStack Start's server-function pipeline serializes via the existing error path.

### 7.2 WebSocket error event shape (canonical, SEC-ERR-02)

Event name: `error`. Payload:

```ts
{
  code: 'FORBIDDEN' | 'BATCH_DENIED',
  event: string,    // original event name, e.g. 'column:create'
  message: string   // user-facing string per Appendix C of PRD
}
```

Coexistence note (per AD-5): the existing `socket.emit('error', { event, error, message })` pattern remains for non-auth errors (NOT_FOUND, VALIDATION_ERROR, UPDATE_FAILED, etc.). The client error handler distinguishes the two by checking `code` (canonical) vs `error` (legacy). The existing handler in `use-collaboration.ts` line 211 already logs the legacy shape; add a new branch for the canonical shape that surfaces a toast / banner per `code`.

### 7.3 JSDoc `@requires` tag contract (SEC-RBAC-03)

```
/**
 * @requires editor
 */
export const fn = createServerFn(...)
```

Allowed values, lowercase: `authenticated`, `unauthenticated`, `viewer`, `editor`, `admin`, `owner`. The tag must be inside a JSDoc block (`/** ... */`) on its own line. Other comment forms not accepted by the AST guard.

---

## 8. Risks & Mitigations

| Risk                                                                                  | Likelihood | Mitigation                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| AST rule produces false positives on existing valid code                              | Medium     | Phase 7 runs the rule against the full codebase before declaring done. Phases 3-5 add the markers; Phase 7 turns on enforcement.                                                                          |
| `requireRole` adds DB round-trip per WS event → latency regression                    | Low        | `findEffectiveRole` is a 2-row lookup against indexed columns. p99 < 5ms expected. If observed regression, add an in-process LRU cache keyed by `(userId, projectId)` with 30s TTL — out of scope for v1. |
| Coexisting error shapes confuse client-side error routing                             | Medium     | The client already treats unknown `error` payloads as logs only (use-collaboration.ts line 211). New canonical shape is additive — old behavior preserved. AD-5 documents the temporary state.            |
| Inline ESLint plugin breaks `bun run lint` startup                                    | Low        | Plugin file uses CommonJS-compatible export. Tested standalone before wiring into config. ESLint 9 flat config supports inline plugin objects natively.                                                   |
| sessionStorage column draft survives across tabs / users                              | Low        | Draft key includes `whiteboardId` + `columnId` — a different user's column won't collide. Discard prompt lets the user reject if confused. Out of scope: cross-tab isolation.                             |
| Pre-merge superpassword instrumentation (AD-8) leaks the bypass exists in code review | Low        | The branch already exists in PR #97 — instrumentation just adds a log line. Reviewers reading this spec know the bypass is being removed; no new information.                                             |
| Column-edit modal file path unknown at spec time                                      | Low        | §3.8 / Phase 5.3 instructs Ares to `bunx rg "createColumnSchema                                                                                                                                           | updateColumnSchema" src/components`. The repo convention places these under `src/components/whiteboard/` — confirmed by file listing. |

---

## 9. Open Questions for Ares

1. Exact path of the column-edit modal component for AD-4 wiring (search expression in §3.8).
2. Exact path of the column-batch UI for SEC-BATCH-UX-01..04 wiring.
3. Whether the SEC-MODAL-02 single-registration assertion is implemented as part of the inline ESLint plugin (preferred) or as a separate Vitest meta-test (acceptable fallback if `Program:exit` cross-file state proves awkward in flat config).

These are implementation-detail questions, not design decisions — Ares resolves during Phase 5 / Phase 7.

---

## 10. Done Criteria

- [ ] All five PRD requirements (SEC-SP, SEC-WS, SEC-BATCH, SEC-MODAL, SEC-RBAC) have a regression test that fails before the fix and passes after.
- [ ] AST guard runs in `bun run lint` and passes against the full codebase.
- [ ] `denyIfInsufficientPermission` no-op is gone; the no-op stub is replaced everywhere.
- [ ] Superpassword bypass branch is deleted from `src/routes/api/auth.ts`; SEC-SP-02 AST assertion passes.
- [ ] All 85 in-scope `createServerFn` exports carry a structured `@requires <role>` JSDoc tag and either invoke `requireServerFnRole` or are explicitly annotated `@requires authenticated`/`@requires unauthenticated`.
- [ ] §13.5 pre-merge checklist boxes are checked in the merge PR description.
- [ ] Defect Enumeration Appendix (§2) reviewed and signed off by Apollo (stage 7).
