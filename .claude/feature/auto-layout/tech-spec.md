# Technical Specification — Auto Layout

## Document Info

| Field | Value |
|-------|-------|
| **Feature** | Auto Layout |
| **Author** | Hephaestus (Tech Spec Agent) |
| **Status** | Draft (Revision 1 — addresses Apollo Stage 6 findings) |
| **Date** | 2026-05-01 |
| **PRD Version** | 1.2 |
| **Decomposition** | decomposition.md (4 phases, 18 tasks) |
| **Discuss Context** | context.md (4 locked decisions) |
| **Revision** | 1 — resolves Apollo verdict CONCERNS (1 HIGH + 4 MEDIUM); see Appendix C |

---

## 1. Overview

### Summary

Auto Layout adds a single toolbar button that, on click, repositions every table on the active whiteboard using a client-side **d3-force** simulation (FK edges as attractive links, repulsion + collision between every pair, RAF-chunked with a 500-tick hard cap). After the simulation completes, the client applies all positions in **one** `setNodes` call, persists them via a new `updateTablePositionsBulk` server function (single `prisma.$transaction`), and **after that resolves successfully** the client emits a single `table:move:bulk` Socket.IO event so collaborators converge in one render tick. (Emit-after-server-success matches the existing single-table `updateTablePosition` → `emit('table:move', …)` pattern in the route mutation handler — see Finding 3 resolution in Appendix C.) The viewport then auto-fits using `fitView({ padding: 0.2, duration: 300 })` after a 100 ms delay (matches the existing ELK pattern verbatim).

The feature **replaces** the existing ELK auto-layout integration in `ReactFlowWhiteboard.tsx` AND removes the parent route's auto-layout bridge (`onAutoLayoutReady` + `reactFlowAutoLayoutRef` + `handleAutoLayout` + the `layout:compute`/`layout:computed` socket round-trip in `$whiteboardId.tsx`). The new orchestrator hook owns the entire flow inside `ReactFlowWhiteboard.tsx`; the parent route is no longer involved in Auto Layout (resolves OQ-2). The legacy `useAutoLayout` (ELK) hook, the `extractPositionsForBatchUpdate` helper, and the four old toolbar props (`onAutoLayout`, `isAutoLayoutLoading`, `autoLayoutEnabled`, `onAutoLayoutEnabledChange`) plus the "Auto-arrange new tables" Switch are removed from the toolbar in Phase 3 (clean rename). The `computeAutoLayout` server function (server-side ELK) stays in `server-functions.ts` because it may have other callers (per decomposition.md note); it is not deleted.

### Goals

- One-click force-directed layout that satisfies the FR-004 16 px L∞-gap contract for every pair of tables, on every run **on the originator's screen** (see Finding 2 resolution: collaborators receive verbatim coordinates from the originator and may observe sub-16-px gaps if their locally-rendered table dimensions differ — the contract is the originator-side guarantee).
- 2 s p95 wall-clock budget on a 100-table fixture (reference benchmark hardware), no main-thread longtask ≥ 200 ms.
- Multi-user atomicity: collaborators apply all new positions in **one render tick** via a single client-emitted `table:move:bulk` event (emitted by the originator's orchestrator after the bulk server function resolves successfully).
- Optimistic client application: the local user sees their new layout immediately (before the network round-trip); persistence failure (including auth-error return values) shows a Retry toast without snapping back.
- > 50-table pre-run confirmation dialog with full WCAG-compatible a11y (role="alertdialog", focus trap, initial focus on Run Layout, Esc=Cancel, focus return on close).

### Non-Goals

- Selection-based / partial layout — every table on the whiteboard is repositioned.
- In-flight cancellation — once the simulation starts, it runs to completion or to the 500-tick hard cap (FR-011 v1 policy).
- Animated transitions from old to new positions (FR-030, P2 — out of scope).
- Tunable simulation parameters in the UI (out of scope).
- Alternative algorithms (ELK, hierarchical, grid) — v1 is force-directed only. The legacy server-side `computeAutoLayout` is left in place but not invoked.
- Web Worker offloading of the simulation — the RAF-chunked main-thread loop with 10-tick budget per frame already satisfies the longtask contract (see Performance Considerations).
- Undo control bespoke to Auto Layout — relies on whatever undo path the codebase has, none added here.

---

## 2. Architecture

### System Context

The feature plugs into three already-established subsystems:

1. **React Flow rendering** (`@xyflow/react` v12.9): nodes/edges live in React Flow state inside `ReactFlowWhiteboard.tsx`; `setNodes` applies positions; `fitView` recenters.
2. **TanStack Start server functions** (`createServerFn`): bulk persistence path. The new `updateTablePositionsBulk` server function is persistence-only — it does not import or call any Socket.IO helpers (resolves Apollo Finding 3).
3. **Socket.IO collaboration namespace** (`/whiteboard/:whiteboardId`): existing per-table `table:move` channel is preserved for manual drags; a new `table:move:bulk` event is added for Auto Layout. The originator's client emits the event after the server function resolves successfully; a new `socket.on('table:move:bulk', …)` handler on the server re-broadcasts via `broadcastToWhiteboard(whiteboardId, socket.id, …)` to every collaborator except the sender.

### Component Diagram

```
                ┌──────────────────────────────────────────────────────┐
                │ ReactFlowWhiteboard.tsx (host component)             │
                │                                                      │
                │   ┌────────────────────────────────────────────┐     │
                │   │ useAutoLayoutOrchestrator (Phase 4)        │     │
                │   │   - state: isRunning, showConfirmDialog,   │     │
                │   │     persistError, isMountedRef             │     │
                │   │   - handleAutoLayoutClick                  │     │
                │   │   - handleConfirm / handleCancel           │     │
                │   │   - handleRetry  (mount-guarded)           │     │
                │   └──┬──────────────────┬───────────────┬──────┘     │
                │      │                  │               │            │
                │      ▼                  ▼               ▼            │
                │  useD3ForceLayout   updateTable    fitView({         │
                │  (Phase 1)          PositionsBulk  padding:0.2,      │
                │                     (Phase 2)      duration:300})    │
                │                          │                           │
                │                          ▼                           │
                │              isUnauthorizedError(result) ?           │
                │              { yes → persist-failure UX (Retry) }   │
                │              { no  → emitBulkPositionUpdate(...)     │
                │                       (client-side after success) }  │
                │                                                      │
                │   ┌──────────────────────────────────────────────┐   │
                │   │ <Toolbar onAutoLayoutClick                   │   │
                │   │          isAutoLayoutRunning                 │   │
                │   │          tableCount /> (Phase 3)             │   │
                │   └──────────────────────────────────────────────┘   │
                │                                                      │
                │   ┌──────────────────────────────────────────────┐   │
                │   │ <AutoLayoutConfirmDialog open={...}/>        │   │
                │   │ (Phase 3 — AlertDialog, only > 50 tables)    │   │
                │   └──────────────────────────────────────────────┘   │
                │                                                      │
                │   ┌──────────────────────────────────────────────┐   │
                │   │ useWhiteboardCollaboration                   │   │
                │   │   onBulkPositionUpdate (Phase 4)             │   │
                │   │   emitBulkPositionUpdate({positions, userId})│   │
                │   │   ↓ on('table:move:bulk') → setNodes once    │   │
                │   │     (guard: data.userId === currentUserId)   │   │
                │   └──────────────────────────────────────────────┘   │
                └──────────────────────────────────────────────────────┘
                          │                          │
                          │ TanStack Start RPC       │ Socket.IO emit (client → server)
                          │ (POST, persist only)     │ event 'table:move:bulk'
                          ▼                          ▼
       ┌────────────────────────────────────┐   ┌────────────────────────────────────┐
       │ src/lib/server-functions.ts        │   │ src/routes/api/collaboration.ts    │
       │                                    │   │                                    │
       │ updateTablePositionsBulk           │   │ socket.on('table:move:bulk',       │
       │   1. requireAuth (returns          │   │   (data) => {                      │
       │      AuthErrorResponse on fail)    │   │     // Re-broadcast to every       │
       │   2. Zod parse                     │   │     // OTHER socket in namespace   │
       │   3. IDOR guard                    │   │     broadcastToWhiteboard(         │
       │   4. prisma.$transaction([...N])   │   │       whiteboardId,                │
       │   5. return { success: true,       │   │       socket.id,                   │
       │              count }               │   │       'table:move:bulk',           │
       │      OR { error: 'UNAUTHORIZED',   │   │       data)                        │
       │              status: 401 }         │   │   })                               │
       │   (NO Socket.IO emit here.)        │   │ — Phase 2 step 3                   │
       └────────────────────────────────────┘   └────────────────────────────────────┘
                                                              │
                                                              │ broadcast (excluding sender)
                                                              ▼
       ┌──────────────────────────────────────────────────────────────────┐
       │ Every OTHER connected socket on /whiteboard/:whiteboardId        │
       │ receives { positions, userId } and calls onBulkPositionUpdate.   │
       │ Defensive sender-guard (data.userId === currentUserId no-op) is  │
       │ retained for parity with the existing table:moved listener.      │
       │ Receivers apply all positions in ONE setNodes call (verbatim     │
       │ originator coordinates — no receiver-side post-pass; see §6).    │
       └──────────────────────────────────────────────────────────────────┘
```

**Key flow change vs. the original spec (Apollo Finding 3):**

The originally-specified flow had `updateTablePositionsBulk` call `emitToWhiteboard` server-side after committing the transaction. That introduced a new `server-functions.ts → @/routes/api/collaboration` import edge with no precedent in the codebase. The revised flow mirrors the existing single-table path (`route mutation onSuccess: emit('table:move', …)`): the server function only persists; the client orchestrator emits the socket event after the server function returns success. The server-side `socket.on('table:move:bulk', …)` handler (Phase 2 step 3) re-broadcasts the event to every OTHER socket in the namespace via `broadcastToWhiteboard(whiteboardId, socket.id, …)`, which is the broadcast-excluding-sender helper that already exists at `collaboration.ts:1040-1057`. This re-establishes a clean directional dependency (`server-functions.ts` knows nothing about Socket.IO) and reuses a well-understood pattern.

### Key Design Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|-------------------------|
| **Client-side d3-force** (not server-side ELK) | Per PRD/decomposition: re-uses already-installed `d3-force` v3, avoids a server round-trip during interactive layout, lets the user see optimistic positions before persistence completes. | Server-side ELK via existing `computeAutoLayout` (rejected: rebuild round-trip + can't be optimistic + ELK gives hierarchical not force-directed). Web Worker (rejected: RAF + 10-tick budget already meets the longtask contract; Worker adds dep + transferable-array overhead). |
| **Client-emitted bulk broadcast (originator emits `table:move:bulk` after server-function success)** + server-side `socket.on('table:move:bulk', …)` handler that calls `broadcastToWhiteboard(whiteboardId, socket.id, …)` to re-broadcast to OTHER sockets | Resolves Apollo Finding 3 (no `server-functions.ts → @/routes/api/collaboration` import). Mirrors the existing single-table path (`updateTablePosition` route mutation `onSuccess: emit('table:move', …)`). `broadcastToWhiteboard` excludes the sender, eliminating the `userId === currentUserId` no-op fan-out at receive time (a defensive guard is still kept for parity). The locked context.md decision said "use `emitToWhiteboard` so server emits to all"; the revision keeps the spirit of that decision (single broadcast, sender-guard pattern) while moving the trigger from the server function to the client to avoid the cross-module import. | (Original spec) `emitToWhiteboard()` from inside `updateTablePositionsBulk` (rejected post-Apollo: introduces unprecedented `server-functions.ts → @/routes/api/collaboration` import edge — see Finding 3). Raw `io.of(...)` (rejected: bypasses the helper). |
| **10 simulation ticks per RAF frame, 500-tick hard cap** | Locked in context.md. ~2–5 ms per chunk for 100 nodes → no longtask risk. 500-tick cap empirically converges for ER schemas with linkDistance proportional to table size. | 5 ticks/frame (over-conservative — 100 RAF frames = 1.6 s; misses 2 s budget on 100-table fixture). 20 ticks/frame (longtask risk on slower CPUs, ~10 ms per chunk). |
| **`fitView({ padding: 0.2, duration: 300 })` after `setTimeout(..., 100)`** | Locked in context.md. Verbatim copy of `use-auto-layout.ts:93-97`. The 100 ms delay lets React Flow re-measure after the bulk `setNodes`. | No delay (rejected: fitView fires on stale measurements, viewport mis-aligned). Different padding (rejected: deviation from existing visual norm). |
| **Toolbar prop surgery: clean remove + 2 new props** | Locked in context.md. The four removed props belonged to the legacy ELK + auto-arrange-new-tables UX, both of which Phase 4 deletes. Forcing a "deprecated" alias would leave dead code paths. | Backwards-compat alias (rejected: nothing else uses these props once Phase 4 lands). Deprecation warning (rejected: same). |
| **`AlertDialog` primitive (Radix) for the >50-tables dialog** | The shadcn `alert-dialog.tsx` already renders `role="alertdialog"`, focus trap, focus return on close, and Esc handling via Radix. All a11y ACs of FR-011 are met without manual `role` overrides. | Building from `Dialog` + manually setting `role="alertdialog"` (rejected: more code, easier to break the trap). Custom modal (rejected: re-implements Radix primitives). |
| **Optimistic local apply, then bulk persist, then server broadcast** | Local user gets snappy feedback; collaborators converge atomically after persistence succeeds; failure path shows Retry toast without snapping back (PRD NFR Persistence — failure UX). | Pessimistic (apply only after server confirms — rejected: feels laggy on 100-table layouts). |
| **Deterministic post-pass for 16 px gap enforcement** | `forceCollide` is approximate (radius-based on the bounding-box diagonal); the post-pass guarantees the L∞-gap floor for every pair. O(n²) is fine: n ≤ 100 → 10 000 iterations. | Tuning collision strength alone (rejected: never strictly enforces L∞ contract). |
| **L∞ post-pass is ORIGINATOR-SCREEN guarantee only** (FR-004 contract scope) — receivers apply verbatim coordinates without re-running the post-pass | Resolves Apollo Finding 2. The post-pass uses the originator's React Flow `node.measured?.width / height` values; broadcasting those dimensions and having receivers re-run the post-pass against their own measured dimensions would desync clients (each receiver computes a different layout, and the persisted server state matches only the originator). Documenting the limitation honestly is preferable: the originator's screen is correct at apply time; collaborators with materially different rendered table sizes (e.g., different visible-column counts due to per-user collapse state) may observe sub-16-px gaps until they re-trigger Auto Layout themselves. The PRD's FR-004 contract is hereby scoped as "guaranteed on the originator's screen." | Option (a) — broadcast `width/height` and have receivers re-run the post-pass (rejected: receivers compute different positions than the originator → on-screen state diverges from persisted state and from peer screens). Option (a′) — use canonical 250×150 dimensions for layout computation, ignoring measured (rejected: produces visually loose gaps around collapsed tables and tight gaps around tall tables; also creates a divergence between layout computation and on-screen reality). |

---

## 3. Data Model

### Database Schema

**No schema changes.** The feature uses the existing `DiagramTable.positionX` / `positionY` columns. Every position update is a `prisma.diagramTable.update` call on existing rows.

### Wire Schemas (Zod)

A single new schema is appended to `src/data/schema.ts`:

```ts
/**
 * Schema for bulk-updating table positions (used by Auto Layout)
 * - whiteboardId scopes the IDOR guard
 * - positions[] must contain ≥ 1 entry; each id must be a UUID
 * - 500-entry cap as a sanity bound (auto-layout supported size is ≤ 100;
 *   larger payloads suggest a bug or abuse and are rejected client-side)
 */
export const bulkUpdatePositionsSchema = z.object({
  whiteboardId: z.string().uuid(),
  positions: z
    .array(
      z.object({
        id: z.string().uuid(),
        positionX: z.number().finite(),
        positionY: z.number().finite(),
      }),
    )
    .min(1)
    .max(500),
})

export type BulkUpdatePositions = z.infer<typeof bulkUpdatePositionsSchema>
```

`z.string().uuid()` is the project standard (see Memory feedback `feedback_zod_uuid_not_cuid.md` — never `.cuid()`). `z.number().finite()` matches the existing `createTableSchema` style.

### Socket.IO Event Payload

```ts
// Originator client → server  (via emit on socket)
// Server → All OTHER clients on /whiteboard/:whiteboardId  (via broadcastToWhiteboard, excluding sender)
type TableMoveBulkEvent = {
  positions: Array<{
    tableId: string      // NOTE: tableId here, not id, matches the existing
                         // table:moved event shape in collaboration.ts:418-423
    positionX: number
    positionY: number
  }>
  userId: string         // userId of the originator — field-name parity with the
                         // existing PositionUpdateEvent at use-whiteboard-collaboration.ts:14-20
                         // (resolves Apollo Finding 5)
}
```

**Field naming — `userId` (not `updatedBy`):** The existing `table:moved` listener at `use-whiteboard-collaboration.ts:75-77` reads `data.userId === userId`. The new `table:move:bulk` listener lives in the same hook; using two different field names for the same semantic value (`userId` vs. `updatedBy`) for a sender-id field would be a maintenance trap (a future reader could write `data.userId` in either handler by muscle memory and the guard would silently fail). The original spec used `updatedBy` for parity with `table:updated` / `table:deleted` / `column:updated`; Apollo (Finding 5) flagged this as a same-hook field-name skew. The revision picks `userId` to match the immediate neighbour (`table:moved` listener in the same hook), accepting a slight divergence from the table-mutation event family which lives in different hooks. A code comment in `use-whiteboard-collaboration.ts` next to both listeners notes this convention and points at the legacy emit/listener mismatch (`collaboration.ts:418-423` emits `updatedBy` while the listener reads `data.userId`) as a pre-existing latent bug, out-of-scope for Auto Layout.

**`tableId` vs `id`:** The persistence layer uses `id` (matches Prisma); the Socket.IO layer uses `tableId` (matches existing `table:moved` payload shape). The orchestrator translates `id → tableId` when assembling the broadcast payload from the server-function response. See §4 below.

### Data Migration

None.

---

## 4. API Design

### Endpoint Summary

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | TanStack Start RPC: `updateTablePositionsBulk` | Persist N positions atomically. Returns `{success:true, count}` on success or `AuthErrorResponse` (`{error:'UNAUTHORIZED', status:401}`) on session expiry. **No Socket.IO emit from the server function** (resolves Apollo Finding 3). | Required (`requireAuth` middleware) |
| Socket.IO event (client → server) | `table:move:bulk` emitted by the originator's orchestrator after the server function resolves successfully | Trigger the server-side re-broadcast | Namespace-level auth (already enforced by `whiteboardNsp.use` in `collaboration.ts:119`) |
| Socket.IO event (server → other clients) | `table:move:bulk` re-broadcast by the server's `socket.on('table:move:bulk', …)` handler via `broadcastToWhiteboard(whiteboardId, socket.id, …)` | Notify collaborators of the bulk position change | Same namespace-level auth |

No HTTP-style REST endpoint is exposed; the persistence call is a TanStack Start server function consistent with `updateTablePosition` and the rest of `src/lib/server-functions.ts`.

**Auth-failure contract (Apollo Finding 1):** `requireAuth` (`src/lib/auth/middleware.ts:31-48`) does **not throw** on session expiry — it **returns** `{error:'UNAUTHORIZED', status:401}` (typed as `AuthErrorResponse`). Every consumer of `updateTablePositionsBulk` (notably the orchestrator's `runLayout` and `handleRetry` in §4 below) MUST use the type guard `isUnauthorizedError(result)` from `@/lib/auth/errors` after `await`-ing the call. Treating a resolved AuthErrorResponse as success would silently desync the local user from the server (toast says "Layout applied" but DB has no new positions and collaborators see nothing). Errors thrown from the handler (DB failure, IDOR, "Whiteboard not found") still take the catch path. See the §4 Detailed error table below for the full enumeration.

### Detailed: `updateTablePositionsBulk` (server function — persistence only)

**Purpose**: Atomically persist new positions for every table the client just laid out. Returns either a success body or an auth-error response. **Does not emit any Socket.IO event** — the originator's client emits the broadcast after this call resolves successfully (resolves Apollo Finding 3).

**Location**: `src/lib/server-functions.ts`, appended after the existing `updateTablePosition` (line 141). Mirrors the `requireAuth` + `getWhiteboardProjectId` IDOR pattern used by `createTable` (lines 86-108) and the `prisma.$transaction([array])` pattern used by `computeAutoLayout` (lines 241-251).

**Signature** (TanStack Start, matches existing exports):

```ts
export const updateTablePositionsBulk = createServerFn({ method: 'POST' })
  .inputValidator((data: BulkUpdatePositions) => bulkUpdatePositionsSchema.parse(data))
  .handler(
    // NOTE: `requireAuth` returns `AuthErrorResponse` on session expiry — it does NOT throw.
    // Callers of this server function must check the resolved value with `isUnauthorizedError`.
    requireAuth(async ({ user: _user }, data): Promise<{ success: true; count: number }> => {
      const { whiteboardId, positions } = data

      // Ownership / IDOR guard:
      // verify the whiteboard exists AND every supplied position.id belongs to it.
      const projectId = await getWhiteboardProjectId(whiteboardId)
      if (!projectId) throw new Error('Whiteboard not found')
      // TODO: restore permission check — temporarily disabled (matches the
      // codebase pattern in createTable / updateTablePosition)
      void projectId
      void _user  // user identity is not needed here; the orchestrator owns the
                  // sender-id field on the socket payload (see Phase 4)

      // Read all table IDs that belong to this whiteboard in ONE query.
      const owned = await prisma.diagramTable.findMany({
        where: { whiteboardId },
        select: { id: true },
      })
      const ownedIds = new Set(owned.map((t) => t.id))
      for (const p of positions) {
        if (!ownedIds.has(p.id)) {
          throw new Error('Table does not belong to this whiteboard')
        }
      }

      try {
        // Single transaction — all-or-nothing per NFR Reliability.
        await prisma.$transaction(
          positions.map((p) =>
            prisma.diagramTable.update({
              where: { id: p.id },
              data: { positionX: p.positionX, positionY: p.positionY },
            }),
          ),
        )
      } catch (error) {
        console.error('Error bulk-updating table positions:', error)
        throw error
      }

      return { success: true, count: positions.length }
    }),
  )
```

**Imports added to `server-functions.ts`** (Phase 2 step 2):
- `bulkUpdatePositionsSchema` from `@/data/schema`
- *(removed from the original spec)* `emitToWhiteboard` from `@/routes/api/collaboration` — **NOT imported** in the revised plan; the server function no longer emits.

**Request**:
```json
{
  "whiteboardId": "8f5c...uuid",
  "positions": [
    { "id": "11111111-...", "positionX": 120, "positionY": 80 },
    { "id": "22222222-...", "positionX": 380, "positionY": 80 }
  ]
}
```

**Resolved values** (the call ALWAYS resolves; `requireAuth` does not throw):

| Resolved value | Meaning |
|----------------|---------|
| `{ success: true, count: 2 }` | Persisted N positions; orchestrator may now emit `table:move:bulk` and run the success UX. |
| `{ error: 'UNAUTHORIZED', status: 401 }` (`AuthErrorResponse`) | Session expired or missing. Orchestrator must NOT emit, MUST run persistence-failure UX. Detect via `isUnauthorizedError(result)` from `@/lib/auth/errors`. |

**Thrown errors** (caught by orchestrator's `try/catch`):

| Cause | Throws |
|-------|--------|
| `whiteboardId` not a UUID | Zod validation error (TanStack Start non-2xx) |
| `positions` empty or > 500 | Zod validation error |
| `whiteboardId` not found | `Error('Whiteboard not found')` |
| Any `position.id` not in whiteboard (IDOR) | `Error('Table does not belong to this whiteboard')` |
| Prisma transaction failure | Re-thrown after `console.error` — full rollback (no partial writes) |

The orchestrator must handle BOTH the `isUnauthorizedError` resolved-value branch AND the `try/catch` thrown-error branch. Both lead to the **persistence-failure UX** (NFR Persistence): toast with Retry, local positions remain visible, no broadcast emitted. (The auth branch additionally calls `triggerSessionExpired()` from `AuthContext` so the user lands on the auth flow.) See §7 Phase 4 step 2 for the orchestrator code.

### Socket.IO event: `table:move:bulk` (originator client → server → other clients)

**Originator emit (orchestrator → server)**: After `updateTablePositionsBulk` resolves successfully, the orchestrator calls `emitBulkPositionUpdate({ positions, userId })` exposed by `useWhiteboardCollaboration`. Internally that calls `emit('table:move:bulk', { positions: [...{tableId, positionX, positionY}], userId })`. This mirrors the existing single-table client emit at the route's `updateTablePositionMutation.onSuccess` (`$whiteboardId.tsx:267-271`).

**Server re-broadcast (Phase 2 step 3)**: A new `socket.on('table:move:bulk', (data) => { … })` handler in `setupCollaborationEventHandlers` (added next to the existing `socket.on('table:move', …)` template at `collaboration.ts:389-431`) calls `broadcastToWhiteboard(whiteboardId, socket.id, 'table:move:bulk', data)`. This helper at `collaboration.ts:1040-1057` emits to every socket in the namespace **except** the originating socket — so the originator does not receive a copy of its own emit, and receivers see the verbatim payload the originator sent.

```ts
// New socket handler in src/routes/api/collaboration.ts inside setupCollaborationEventHandlers
socket.on('table:move:bulk', (data: {
  positions: Array<{ tableId: string; positionX: number; positionY: number }>
  userId: string
}) => {
  // Validate and re-broadcast. Persistence already happened via the
  // updateTablePositionsBulk server function; this handler only fans out the
  // event to other clients in the same whiteboard namespace.
  broadcastToWhiteboard(whiteboardId, socket.id, 'table:move:bulk', data)
})
```

**Why `broadcastToWhiteboard` (excludes sender) and not `emitToWhiteboard` (includes sender)?** The original spec used `emitToWhiteboard` because the server function had no `socket.id`. With the server function out of the broadcast path, the natural emit point is a `socket.on(…)` handler that has access to `socket.id`. Excluding the sender avoids the no-op fan-out cycle (originator's listener would otherwise have to drop its own event via `data.userId === currentUserId`). The defensive `data.userId === currentUserId` guard is still kept on the receiver side for parity with the existing `table:moved` listener and as a defense against any future change that might re-route the broadcast through `emitToWhiteboard`.

### Recommendation update: `socket.on('table:move:bulk', …)` is now REQUIRED, not deferred

The original spec recommended deferring the server-side `socket.on` handler as dead code (Open Question 1). With the revised broadcast plan (originator emits client-side; server re-broadcasts), the handler is on the critical path: without it, no other client receives the event. **Add the handler in Phase 2 step 3.** Open Question 1 is now resolved (build, do not defer).

---

## 5. Security Considerations

### Authentication

`updateTablePositionsBulk` wraps its handler in `requireAuth` (the same middleware used by every other server function in `server-functions.ts`). Unauthenticated requests are rejected before any DB or Socket.IO work.

The Socket.IO namespace `/whiteboard/:whiteboardId` already enforces session-token authentication via `whiteboardNsp.use(...)` (`collaboration.ts:119-140`). The server-emitted `table:move:bulk` therefore reaches only authenticated clients on that whiteboard.

### Authorization

Following the existing codebase pattern (every server function in `server-functions.ts` has the comment `// TODO: restore permission check — temporarily disabled`), this feature does **not** add new role-based gates. EDITOR-level role checks against the project are stubbed out across the codebase; this is a pre-existing condition recorded in the user's memory (account-auth feature has similar pending RBAC work) and not Auto Layout's scope.

### IDOR Prevention (P0)

The IDOR guard for `updateTablePositionsBulk` uses **two-step verification** matching the `table:move` socket handler (`collaboration.ts:389-408`):

1. `getWhiteboardProjectId(whiteboardId)` — confirms whiteboard exists.
2. Read all `diagramTable.id` rows for that `whiteboardId` once, then check every `positions[i].id` is in that set.

The single `findMany` → `Set` lookup is preferred over per-position `findUnique` calls so the guard runs in **one** DB round-trip regardless of N positions, preserving the FR-007 2 s budget.

### Data Protection

No new sensitive data is introduced. `positionX` / `positionY` are non-sensitive layout coordinates already returned by `getWhiteboardWithDiagram`.

### Input Validation

`bulkUpdatePositionsSchema` enforces:

- `whiteboardId` must be a UUID (rejects path traversal, SQL injection, etc.).
- Every `positions[i].id` must be a UUID.
- Every `positionX` / `positionY` must be a finite number (rejects `Infinity`, `NaN`, strings).
- `positions.length` ∈ [1, 500] (rejects empty payloads — they're meaningless — and absurdly large payloads).

Validation runs before any DB query, IDOR check, or Socket.IO emit.

---

## 6. Performance Considerations

### Expected Load

Per PRD: ≤ 100 tables per whiteboard for the supported budget; > 100 tables completes but does not bind to 2 s. Network calls per Auto Layout invocation: **1 HTTP RPC** (`updateTablePositionsBulk` → 1 transaction) + **1 Socket.IO emit** (orchestrator → server → broadcast). Both happen sequentially after the simulation; the socket emit fires only after the HTTP call resolves successfully. Compare with the rejected per-table path: 100 tables × 1 round-trip = 100 sequential calls, blowing the budget.

### Main-Thread Responsiveness (FR-007 longtask contract)

The d3-force simulation runs on the main thread, chunked through `requestAnimationFrame` with **10 ticks per frame** and a **500-tick hard cap**. Each chunk is estimated at 2–5 ms for 100 nodes (well below the 16 ms / 200 ms longtask thresholds). The structure:

```ts
function simulateChunked(simulation: ForceSimulation, maxTicks: number): Promise<void> {
  return new Promise((resolve) => {
    let ticksRun = 0
    const tickBudgetPerFrame = 10
    function frame() {
      const remaining = maxTicks - ticksRun
      const chunk = Math.min(tickBudgetPerFrame, remaining)
      for (let i = 0; i < chunk; i++) simulation.tick()
      ticksRun += chunk
      if (ticksRun >= maxTicks || simulation.alpha() < simulation.alphaMin()) {
        simulation.stop()
        resolve()
        return
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}
```

The simulation is started with `forceSimulation(...).stop()` to prevent d3 from auto-running its own internal loop, then `simulateChunked()` drives ticks manually. `setNodes` is **not** called during ticks (FR-005 atomicity); only after the chunked loop finishes and the post-pass nudge completes.

### Post-Pass for 16 px L∞ Gap (FR-004) — Originator-Screen Guarantee

After the simulation settles, a deterministic O(n²) pass iterates every pair (A, B) on the originator's machine and computes:

```
gapX = max(A.left - B.right, B.left - A.right)
gapY = max(A.top - B.bottom, B.top - A.bottom)
gap  = max(gapX, gapY)        // L∞ gap per FR-004
```

If `gap < 16`, the pair's smaller-`id` node (deterministic tie-breaker) is nudged along the axis whose component is smaller. The nudge distance is `(16 - gap) + 1px` (1 px slack so floating-point doesn't push back below 16). One sweep is usually enough; the post-pass repeats up to 5 times to absorb cascade effects on dense graphs, then bails. For n=100, max iterations = 100·99/2·5 ≈ 25 000; on a 2.5 GHz CPU this is < 5 ms — well within the longtask budget.

**Cross-client contract (resolves Apollo Finding 2):** The post-pass uses the originator's React Flow `node.measured?.width / height` values. The broadcast payload carries only `{tableId, positionX, positionY, userId}` — no dimensions. Receivers apply the verbatim coordinates without re-running the post-pass. Consequently:

- **FR-004 contract scope:** The 16 px L∞ gap is guaranteed on the **originator's screen** at apply time. This is the practically meaningful contract because (a) the originator triggered the layout and is the user expecting "my layout looks tidy now," and (b) the persisted database state matches the originator's screen exactly.
- **Collaborator-side reality:** A collaborator who has table B expanded (e.g., 320 px tall) while the originator has it collapsed (e.g., 240 px tall) will see B occupy more vertical space on their screen. If the originator's post-pass left a 20 px L∞ gap above B, the collaborator may see −60 px (overlap). This is unavoidable without one of the rejected alternatives:
  - Broadcasting dimensions and having receivers re-compute → desyncs visible state across clients.
  - Using canonical dimensions (e.g., 250 × 150) for layout → desyncs visible state from persisted state on all clients.
- **Mitigation:** A collaborator who finds the layout unacceptable can click Auto Layout themselves; the post-pass then runs against their measured dimensions and produces a layout correct on their screen.
- **Documentation:** The PRD's FR-004 wording uses "every pair (A, B)" without qualifying screen. Hephaestus is escalating this scoping note to PM via the spec-review feedback loop; the agreed scope for v1 is "originator-screen guarantee." If PM wants a stronger contract in v2, the natural path is to standardise rendered table dimensions across clients (no per-user collapse state), which is a much larger product change beyond Auto Layout.

The sender's post-pass and the FR-004 contract are otherwise identical to the original spec — only the cross-client guarantee shifts.

### Network / DB Cost

| Operation | Round-trips | DB queries |
|-----------|-------------|------------|
| Old path (per-table updateTablePosition × N) | N (sequential) | N writes |
| New path (updateTablePositionsBulk) | **1** | 1 SELECT (IDOR) + 1 transaction with N updates |

For N=100: from 100 round-trips down to 1. The IDOR `findMany` adds one read but cuts 99 round-trips.

### Caching

No caching. Positions are user-state and must always reflect the latest user action.

---

## 7. Implementation Plan

The plan maps **one-to-one** to decomposition.md's 4 phases. Each section restates the decomposition as concrete files + sequencing.

### Files to Create

| File | Purpose | Phase |
|------|---------|-------|
| `src/lib/auto-layout/d3-force-layout.ts` | `computeD3ForceLayout(nodes, edges)` — RAF-chunked simulation + 16 px post-pass. Pure function returning `Promise<Array<{ id, x, y }>>`. | 1 |
| `src/lib/auto-layout/d3-force-layout.test.ts` | Unit tests: 0/1/2-table cases, 16 px gap on every pair, FK-pair-distance ≤ 0.60 × non-FK-pair-distance, 500-tick termination. | 1 |
| `src/lib/auto-layout/index.ts` | Barrel re-export of `computeD3ForceLayout` and types. | 1 |
| `src/hooks/use-d3-force-layout.ts` | React wrapper for `computeD3ForceLayout`. Reads node dimensions from React Flow's `node.measured?.width ?? node.width ?? 250` / `height: 150` (verbatim copy from `elk-layout.ts:58-59`). Tracks `isRunning`, `error`. Returns `runLayout(nodes, edges) → Promise<positions[]>`. **Does not call `setNodes`** — orchestrator owns that. | 1 |
| `src/hooks/use-d3-force-layout.test.ts` | Unit tests for hook state transitions. | 1 |
| `src/components/whiteboard/AutoLayoutConfirmDialog.tsx` | Pre-run confirmation for > 50 tables. Built from shadcn `AlertDialog` primitives (Radix); already provides `role="alertdialog"`, focus trap, Esc handling. Initial focus on Run Layout button via `autoFocus`. Focus return on close handled by Radix automatically (returns to the trigger). | 3 |
| `src/components/whiteboard/AutoLayoutConfirmDialog.test.tsx` | A11y tests (role, aria-labelledby, aria-describedby, autoFocus, Esc → cancel). | 3 |
| `src/hooks/use-auto-layout-orchestrator.ts` | The hook `ReactFlowWhiteboard.tsx` calls. Wires d3-force run → optimistic `setNodes` → `updateTablePositionsBulk` → `fitView` → toast. Owns `showConfirmDialog`, `persistError`, `handleRetry`, `handleConfirm`, `handleCancel`. Holds `persistedPayloadRef` so Retry can re-submit without recomputing. | 4 |
| `src/hooks/use-auto-layout-orchestrator.test.ts` | Unit tests: success path, layout-error path, persist-error + retry path. | 4 |

### Files to Modify

| File | Changes | Phase |
|------|---------|-------|
| `src/data/schema.ts` | Append `bulkUpdatePositionsSchema` + `BulkUpdatePositions` type. | 2 |
| `src/lib/server-functions.ts` | Append `updateTablePositionsBulk` server function after `updateTablePosition` (after line 141). Add import for `bulkUpdatePositionsSchema` from `@/data/schema`. **Do NOT import `emitToWhiteboard`** — the server function does not emit (resolves Apollo Finding 3). | 2 |
| `src/routes/api/collaboration.ts` | Inside `setupCollaborationEventHandlers` (next to the existing `socket.on('table:move', …)` block at lines 389-431), add a new `socket.on('table:move:bulk', (data) => broadcastToWhiteboard(whiteboardId, socket.id, 'table:move:bulk', data))` handler. **This handler is now REQUIRED** (no longer deferred per the original Open Question 1). | 2 |
| `src/components/whiteboard/Toolbar.tsx` | (a) Remove props: `onAutoLayout`, `isAutoLayoutLoading`, `autoLayoutEnabled`, `onAutoLayoutEnabledChange`. (b) Remove the "Auto-arrange new tables" Switch JSX (lines 445-458). (c) Add props: `tableCount: number`, `onAutoLayoutClick?: () => void \| Promise<void>`, `isAutoLayoutRunning?: boolean`. (d) Add an "Auto Layout" `Button` next to "Add Relationship", disabled when `tableCount < 2 \|\| isAutoLayoutRunning`. Tooltip: "Add at least 2 tables to use Auto Layout" (when `< 2`); "Layout cannot be cancelled once started." (when `tableCount > 50`); otherwise "Automatically arrange tables based on FK relationships." (e) Loading indicator: `Loader2` from `lucide-react` (already used elsewhere) inside the button when `isAutoLayoutRunning`. | 3 |
| `src/components/whiteboard/Toolbar.test.tsx` | Update to remove old prop assertions; add cases for the new button (visible, disabled-when-<2, calls `onAutoLayoutClick`, shows spinner when running). | 3 |
| `src/hooks/use-whiteboard-collaboration.ts` | (a) Add `onBulkPositionUpdate` optional callback param. (b) Add `useEffect` listener for `table:move:bulk` with **`data.userId === userId` guard** (matches the existing `table:moved` listener at lines 73-92 verbatim — resolves Apollo Finding 5). (c) Receiver applies all positions in **one** `setNodes` callback invocation. (d) Add `emitBulkPositionUpdate({positions, userId})` callback returned alongside the existing `emitPositionUpdate`. (e) Add a code comment next to both `table:moved` and `table:move:bulk` listeners noting the same-hook field-name parity (`data.userId`) and pointing at the legacy `collaboration.ts:418-423` emit/listener mismatch as an out-of-scope pre-existing issue. | 4 |
| `src/components/whiteboard/ReactFlowWhiteboard.tsx` | (a) Remove imports `useAutoLayout` (line 50) and `extractPositionsForBatchUpdate` (line 51). (b) Remove the `useAutoLayout({...})` block at lines 992-1012. (c) **Remove** the `onAutoLayoutReady` exposure at lines 1014-1020 entirely (the new orchestrator owns the click flow inside this component; no parent bridge needed — see Open Question 2 resolution). Drop `onAutoLayoutReady` from `ReactFlowWhiteboardProps`. (d) Add `useAutoLayoutOrchestrator(...)` call. (e) Pass the new toolbar props (`tableCount`, `onAutoLayoutClick`, `isAutoLayoutRunning`); remove the four old props from the `<Toolbar>` JSX. (f) Render `<AutoLayoutConfirmDialog />` controlled by the orchestrator. (g) Pass `onBulkPositionUpdate` to `useWhiteboardCollaboration`. | 4 |
| `src/components/whiteboard/ReactFlowWhiteboard.test.tsx` | Add integration cases: 2-tables success, 1-table button disabled, > 50 tables → dialog, persist failure → toast with Retry, retry success, **auth-error (`AuthErrorResponse`) → persist-failure UX (no false success)**, retry-after-unmount suppressed. | 4 |
| `src/routes/whiteboard/$whiteboardId.tsx` | **Removal of legacy auto-layout bridge** (resolves Open Question 2 — DELETE, do not preserve). The new orchestrator lives entirely inside `ReactFlowWhiteboard.tsx`; the parent route's involvement in auto-layout becomes dead code. Specifically remove: (a) the `reactFlowAutoLayoutRef` ref (line 86); (b) `isAutoLayoutComputing` state (line 83); (c) the `useAutoLayoutPreference` hook usage (line 105) and the `autoLayoutEnabled`/`onAutoLayoutEnabledChange` props passed to `<Toolbar>` (lines 692-693); (d) the `handleAutoLayout` callback (lines 407-456) including the entire Konva-fallback branch and `computeAutoLayout` call; (e) the `handleAutoLayoutReady` callback (lines 461-467); (f) the `onAutoLayoutReady={handleAutoLayoutReady}` prop on `<ReactFlowWhiteboard>` (line 716); (g) the four legacy `<Toolbar>` props `onAutoLayout` / `isAutoLayoutLoading` / `autoLayoutEnabled` / `onAutoLayoutEnabledChange` (lines 690-693); (h) the `layout:compute` and `layout:computed` socket emits (line 414, 440-443) and the corresponding `on('layout:compute', …)` / `on('layout:computed', …)` listeners (lines 584-603, 609-610, 617-618). Also remove the `computeAutoLayout` import (line 28). The `useAutoLayoutPreference` hook becomes unused; flag for follow-up cleanup but do not delete the hook file in this feature. | 4 |
| `src/routes/whiteboard/$whiteboardId.test.tsx` (if present) | Update / remove tests that exercise the deleted callbacks. | 4 |

### What is NOT Modified

- `src/lib/react-flow/use-auto-layout.ts` — legacy ELK hook; left in place (unused after Phase 4).
- `src/lib/react-flow/elk-layout.ts` — legacy ELK helpers; left in place. `extractPositionsForBatchUpdate` becomes unused but the file stays.
- `src/lib/canvas/layout-engine.ts` — older Konva-era d3-force; not touched.
- `src/lib/server-functions.ts::computeAutoLayout` — legacy server-side ELK; per decomposition.md note, leave in place.
- `src/hooks/use-auto-layout-preference.ts` — becomes unused after the route's `autoLayoutEnabled` toggle is deleted (per Files to Modify above). Left in place for follow-up cleanup; deleting it is non-blocking and not in scope for this feature.
- `prisma/schema.prisma` — no schema changes.

### Sequence of Changes

Mapped 1-to-1 to decomposition.md phases. Phase 1 and Phase 2 can run in parallel (no shared files). Phase 3 starts after Phase 1 and Phase 2 are merged. Phase 4 wires everything.

#### Phase 1 — Force-Directed Layout Engine (no UI, no network)

1. Create `src/lib/auto-layout/d3-force-layout.ts` with:
   - `forceSimulation` configured with `forceManyBody({ strength: −800 })`, `forceLink(links).distance(d => avgTableSize × 1.5).strength(0.5)`, `forceCollide(d => Math.hypot(d.width, d.height) / 2 + 8)`, `forceCenter(0, 0)`.
   - `simulation.stop()` immediately, then drive ticks via the `simulateChunked` helper above with `tickBudgetPerFrame = 10`, `maxTicks = 500`.
   - Deterministic post-pass: 5-iteration sweep enforcing 16 px L∞ gap; smaller-`id` node nudges.
   - 0-edge case: build the simulation with no `forceLink` (just repulsion + collision). Returns `Promise<Array<{ id, x, y }>>`.
2. Create `src/lib/auto-layout/d3-force-layout.test.ts` — 6+ cases per decomposition.
3. Create `src/lib/auto-layout/index.ts` barrel.
4. Create `src/hooks/use-d3-force-layout.ts` — wraps the engine, reads `node.measured?.width ?? node.width ?? 250` / `height ?? 150`, sets `isRunning` / `error`, returns `runLayout`.
5. Create `src/hooks/use-d3-force-layout.test.ts`.

Verify: `bun run test -- --testPathPattern=d3-force` and `bunx tsc --noEmit`.

#### Phase 2 — Bulk Persistence + Socket.IO (no UI)

1. Append `bulkUpdatePositionsSchema` + `BulkUpdatePositions` type to `src/data/schema.ts`.
2. Append `updateTablePositionsBulk` server function to `src/lib/server-functions.ts` (full code in §4 above). Imports: `bulkUpdatePositionsSchema` from `@/data/schema` only. **Do NOT import `emitToWhiteboard`** — the server function does not emit (Apollo Finding 3).
3. **REQUIRED** (no longer optional — Apollo Finding 3 resolution): Add `socket.on('table:move:bulk', (data) => broadcastToWhiteboard(whiteboardId, socket.id, 'table:move:bulk', data))` to `setupCollaborationEventHandlers` in `src/routes/api/collaboration.ts`, next to the existing `socket.on('table:move', …)` handler at lines 389-431. The handler validates the payload shape (`positions: Array<{tableId, positionX, positionY}>; userId: string`) and re-broadcasts. No DB writes (persistence already happened in step 2).
4. Add server-function tests (`server-functions.test.ts` or `server-functions-bulk.test.ts`): happy path (returns `{success:true, count}`), IDOR (throws), empty array (Zod throws), transaction rollback (re-throws), **auth-failure path (returns `{error:'UNAUTHORIZED', status:401}` instead of throwing — verifies the resolved-value contract Apollo Finding 1 depends on)**.
5. Add a Socket.IO handler test in `collaboration.test.ts` (or equivalent): emit `table:move:bulk` from one socket, assert the other sockets in the namespace receive the event verbatim and the originator does not.

Verify: `bun run test -- --testPathPattern=server-functions|collaboration` and `bunx tsc --noEmit`.

#### Phase 3 — Toolbar Button + Confirmation Dialog

1. Modify `src/components/whiteboard/Toolbar.tsx`:
   - Remove the four old props from `ToolbarProps` and the destructuring at line 158-:.
   - Remove the "Auto-arrange new tables" Switch JSX (lines 446-458).
   - Add the three new props.
   - Add the "Auto Layout" `<Button>` adjacent to "Add Relationship". Use `Loader2` from `lucide-react` for the running state (already used in the codebase).
   - Use a `<span>` wrapper for disabled-button tooltip targeting (per decomposition.md technical note).
2. Update `Toolbar.test.tsx` to remove old prop tests and add the new four cases.
3. Create `src/components/whiteboard/AutoLayoutConfirmDialog.tsx`:
   - Compose `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogAction`, `AlertDialogCancel` from `@/components/ui/alert-dialog`.
   - Title: "Apply Auto Layout?"
   - Description: `This whiteboard has {tableCount} tables. Auto Layout may take several seconds and cannot be cancelled once started. Existing positions will be overwritten. Continue?`
   - `<AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>` (variant="outline" default).
   - `<AlertDialogAction autoFocus onClick={onConfirm}>Run Layout</AlertDialogAction>` — the `autoFocus` provides FR-011 initial-focus AC.
   - Esc handling: `AlertDialog.Root onOpenChange={(open) => !open && onCancel()}` — Radix calls this on Esc.
   - Focus return on close: provided automatically by Radix `AlertDialog`, returns focus to the element that had focus before open (the toolbar Auto Layout button).
4. Create `AutoLayoutConfirmDialog.test.tsx` (a11y assertions per FR-011).

Verify: `bun run test -- --testPathPattern=Toolbar|AutoLayoutConfirmDialog`.

#### Phase 4 — Orchestration, Viewport Fit, Error Handling

1. Modify `src/hooks/use-whiteboard-collaboration.ts`:
   - Add optional 8th param `onBulkPositionUpdate?: (positions: Array<{ tableId: string; positionX: number; positionY: number }>) => void`.
   - Add `useEffect` listener for `'table:move:bulk'` with this body (note: `data.userId`, **not** `data.updatedBy` — Apollo Finding 5):
     ```ts
     // NOTE on field names — both this listener and the existing table:moved listener
     // use `data.userId` for the sender-id field. The mutation-event family
     // (table:updated / table:deleted / column:updated) uses `updatedBy`; that's a
     // different convention in different hooks. Picking userId here keeps both
     // listeners in this hook consistent and avoids the muscle-memory bug where a
     // future reader writes data.userId in a handler that should read data.updatedBy
     // (or vice versa) and the guard silently fails.
     // Pre-existing latent bug (out of scope for Auto Layout): collaboration.ts:418-423
     // emits the legacy table:moved event with `updatedBy` while the listener at
     // lines 75-77 reads `data.userId`. The emit and listener disagree. Auto Layout
     // does NOT touch that legacy emit; new code uses `userId` end-to-end.
     useEffect(() => {
       if (!onBulkPositionUpdate) return
       const handler = (data: {
         positions: Array<{ tableId: string; positionX: number; positionY: number }>
         userId: string
       }) => {
         if (data.userId === userId) return    // defensive sender-guard (broadcastToWhiteboard already excludes sender on the server)
         onBulkPositionUpdate(data.positions)
       }
       on('table:move:bulk', handler)
       return () => off('table:move:bulk', handler)
     }, [on, off, userId, onBulkPositionUpdate])
     ```
   - The receiver's callback (in `ReactFlowWhiteboard.tsx`) applies all positions in **one** `setNodes(nds => ...)` call, satisfying the "one render tick" contract.
   - Add a new emit helper alongside `emitPositionUpdate`:
     ```ts
     const emitBulkPositionUpdate = useCallback(
       (positions: Array<{ tableId: string; positionX: number; positionY: number }>) => {
         emit('table:move:bulk', { positions, userId })
       },
       [emit, userId],
     )
     ```
     and add it to the returned object.

2. Create `src/hooks/use-auto-layout-orchestrator.ts`. The orchestrator must handle THREE result branches: thrown error, resolved auth-error value, resolved success. Sketch:

   ```ts
   import { useCallback, useEffect, useRef, useState } from 'react'
   import { useReactFlow } from '@xyflow/react'
   import { toast } from 'sonner'
   import { isUnauthorizedError } from '@/lib/auth/errors'
   import { useAuthContext } from '@/components/auth/AuthContext'
   import { updateTablePositionsBulk } from '@/lib/server-functions'

   type BulkPayload = {
     whiteboardId: string
     positions: Array<{ id: string; positionX: number; positionY: number }>
   }

   export function useAutoLayoutOrchestrator(args: {
     whiteboardId: string
     runD3ForceLayout: (nodes: Node[], edges: Edge[]) => Promise<Array<{id:string;x:number;y:number}>>
     emitBulkPositionUpdate: (positions: Array<{tableId:string;positionX:number;positionY:number}>) => void
   }) {
     const { whiteboardId, runD3ForceLayout, emitBulkPositionUpdate } = args
     const { setNodes, getNodes, getEdges, fitView } = useReactFlow()
     const { triggerSessionExpired } = useAuthContext()

     const [isRunning, setIsRunning] = useState(false)
     const [showConfirmDialog, setShowConfirmDialog] = useState(false)
     const [persistError, setPersistError] = useState<unknown>(null)
     const lastPayloadRef = useRef<BulkPayload | null>(null)
     const isMountedRef = useRef(true)

     // Mount tracking — Retry must no-op after unmount (Apollo Finding 4).
     useEffect(() => {
       isMountedRef.current = true
       return () => { isMountedRef.current = false }
     }, [])

     const handlePersistResult = useCallback(
       (result: unknown, positionsCount: number) => {
         // 1) Auth error (returned as a value, NOT thrown — Apollo Finding 1)
         if (isUnauthorizedError(result)) {
           setPersistError(result)
           triggerSessionExpired()  // routes the user to the auth flow
           toast.error(
             'Your session expired before Auto Layout could be saved. Please sign in to retry.',
             {
               action: {
                 label: 'Retry',
                 onClick: () => {
                   if (!isMountedRef.current) return
                   if (!lastPayloadRef.current) return
                   void runRetry()
                 },
               },
             },
           )
           return false
         }
         // 2) Success
         setTimeout(() => {
           if (!isMountedRef.current) return
           fitView({ padding: 0.2, duration: 300 })
         }, 100)
         toast.success(`Layout applied to ${positionsCount} tables`)
         return true
       },
       [fitView, triggerSessionExpired],
     )

     const runRetry = useCallback(async () => {
       // Mount-guard at the entry of the action (Apollo Finding 4).
       if (!isMountedRef.current) return
       if (!lastPayloadRef.current) return
       try {
         const result = await updateTablePositionsBulk({ data: lastPayloadRef.current })
         if (!isMountedRef.current) return  // re-check after await
         const ok = handlePersistResult(result, lastPayloadRef.current.positions.length)
         if (ok) {
           // Re-emit the broadcast on successful retry.
           emitBulkPositionUpdate(
             lastPayloadRef.current.positions.map((p) => ({
               tableId: p.id,
               positionX: p.positionX,
               positionY: p.positionY,
             })),
           )
           setPersistError(null)
         }
       } catch (err) {
         if (!isMountedRef.current) return
         setPersistError(err)
         toast.error('Auto Layout could not be saved on retry. Please try again.')
       }
     }, [emitBulkPositionUpdate, handlePersistResult])

     const runLayout = useCallback(async () => {
       setIsRunning(true)
       setPersistError(null)
       try {
         // 1) Compute layout (may throw)
         let positions: Array<{id:string;x:number;y:number}>
         try {
           positions = await runD3ForceLayout(getNodes(), getEdges())
         } catch (layoutErr) {
           console.error('Auto Layout simulation failed:', layoutErr)
           toast.error('Auto Layout failed — please try again.')
           return
         }
         if (!isMountedRef.current) return

         // 2) Optimistic local apply
         setNodes((prev) => prev.map((n) => {
           const p = positions.find((pp) => pp.id === n.id)
           return p ? { ...n, position: { x: p.x, y: p.y } } : n
         }))

         // 3) Stash payload BEFORE the await so Retry can re-submit
         const payload: BulkPayload = {
           whiteboardId,
           positions: positions.map((p) => ({ id: p.id, positionX: p.x, positionY: p.y })),
         }
         lastPayloadRef.current = payload

         // 4) Persist
         try {
           const result = await updateTablePositionsBulk({ data: payload })
           if (!isMountedRef.current) return
           const ok = handlePersistResult(result, positions.length)
           if (ok) {
             // 5) Emit broadcast AFTER server-function success — mirrors the
             //    single-table updateTablePositionMutation.onSuccess pattern.
             emitBulkPositionUpdate(
               positions.map((p) => ({ tableId: p.id, positionX: p.x, positionY: p.y })),
             )
           }
         } catch (persistErr) {
           if (!isMountedRef.current) return
           console.error('Auto Layout persist failed:', persistErr)
           setPersistError(persistErr)
           toast.error(
             'Auto Layout could not be saved — your changes are visible locally but not persisted.',
             {
               action: {
                 label: 'Retry',
                 onClick: () => {
                   if (!isMountedRef.current) return
                   if (!lastPayloadRef.current) return
                   void runRetry()
                 },
               },
             },
           )
           // No fitView on persist failure (PRD NFR Persistence — failure UX).
         }
       } finally {
         if (isMountedRef.current) setIsRunning(false)
       }
     }, [
       whiteboardId, runD3ForceLayout, getNodes, getEdges, setNodes,
       handlePersistResult, emitBulkPositionUpdate, runRetry,
     ])

     const handleAutoLayoutClick = useCallback((tableCount: number) => {
       if (tableCount > 50) setShowConfirmDialog(true)
       else void runLayout()
     }, [runLayout])

     const handleConfirm = useCallback(() => {
       setShowConfirmDialog(false)
       void runLayout()
     }, [runLayout])

     const handleCancel = useCallback(() => setShowConfirmDialog(false), [])

     return {
       isRunning,
       showConfirmDialog,
       persistError,
       handleAutoLayoutClick,
       handleConfirm,
       handleCancel,
       handleRetry: runRetry,
     }
   }
   ```

   **Key correctness points (mapped to Apollo findings):**
   - `isUnauthorizedError(result)` after every `await updateTablePositionsBulk(...)` — covers Finding 1. Auth-failure resolved values do NOT take the success branch. The orchestrator additionally calls `triggerSessionExpired()` so the user lands on the auth flow without a confusing toast.
   - `isMountedRef` is set true on mount, false on unmount, and checked on entry of `runRetry` AND after every `await` in both `runLayout` and `runRetry` — covers Finding 4. The toast Retry handler also short-circuits if the component unmounted before the click.
   - The orchestrator (not the server function) calls `emitBulkPositionUpdate` after the persist resolves successfully — covers Finding 3.
   - The emit payload uses `userId` (the `useWhiteboardCollaboration` hook reads its own `userId` parameter and inserts it into the payload) — covers Finding 5.

3. Wire orchestrator into `ReactFlowWhiteboard.tsx`:
   - Replace the legacy `useAutoLayout` block (lines 992-1012) and the `onAutoLayoutReady` exposure (lines 1014-1020) with a single `useAutoLayoutOrchestrator({...})` call. Drop `onAutoLayoutReady` from the component's props (Open Question 2 — DELETE; do not preserve the bridge).
   - Get the new emit helper from `useWhiteboardCollaboration`: `const { emitPositionUpdate, emitBulkPositionUpdate, ... } = useWhiteboardCollaboration(...)`.
   - Pass `whiteboardId`, `runD3ForceLayout` (from `useD3ForceLayout`), and `emitBulkPositionUpdate` to the orchestrator.
   - Pass `tableCount={nodes.length}`, `onAutoLayoutClick={() => handleAutoLayoutClick(nodes.length)}`, `isAutoLayoutRunning={isRunning}` to `<Toolbar>`. Remove the four legacy props.
   - Render `<AutoLayoutConfirmDialog open={showConfirmDialog} tableCount={nodes.length} onConfirm={handleConfirm} onCancel={handleCancel} />`.
   - Pass `onBulkPositionUpdate={(positions) => setNodes(nds => nds.map(n => { const p = positions.find(p => p.tableId === n.id); return p ? { ...n, position: { x: p.positionX, y: p.positionY } } : n }))}` to `useWhiteboardCollaboration`.

4. Modify `src/routes/whiteboard/$whiteboardId.tsx` to remove the legacy auto-layout bridge per the Files-to-Modify table above (Open Question 2 — DELETE the bridge: drop `reactFlowAutoLayoutRef`, `isAutoLayoutComputing`, `handleAutoLayout`, `handleAutoLayoutReady`, the four legacy `<Toolbar>` props, the `useAutoLayoutPreference` usage, the `computeAutoLayout` import, and the `layout:compute`/`layout:computed` socket emits + listeners). The new orchestrator owns the entire flow inside `ReactFlowWhiteboard.tsx`; the parent route is no longer involved in Auto Layout.

5. Add integration tests to `ReactFlowWhiteboard.test.tsx`:
   - 2-table success: button enabled → click → `setNodes` called once → `updateTablePositionsBulk` called → success toast + `fitView` called.
   - 1-table button disabled.
   - > 50-table dialog flow: click → dialog opens → confirm → `runLayout` called.
   - Persist throws (DB error): error toast with Retry, `setNodes` retained, no fitView.
   - **Persist returns `AuthErrorResponse`: error toast with Retry, `setNodes` retained, no fitView, `triggerSessionExpired` called, no false `toast.success` (covers Apollo Finding 1).**
   - Retry success: clears `persistError` + emits `table:move:bulk`.
   - **Retry after unmount: simulate the toast Retry click after the component unmounts — `updateTablePositionsBulk` must NOT be called (covers Apollo Finding 4).**

Verify: full suite — `bun run test`, `bun run lint`, `bunx tsc --noEmit`.

### Definition of Done

- All four phases' acceptance criteria met (per decomposition.md).
- 100-table fixture: p95 < 2 s on reference benchmark hardware, no `PerformanceObserver` longtask entries ≥ 200 ms.
- 16 px L∞ gap holds on every pair across 3 consecutive runs of the 10-table fixture **on the originator's screen** (cross-client gap drift is documented as out-of-contract per Finding 2 resolution).
- Two-tab manual test: tab A clicks Auto Layout → tab B applies all positions in one render tick (no piecewise rearrangement observable). Tab A does NOT receive the broadcast (server's `broadcastToWhiteboard` excludes the sender); the defensive `data.userId === userId` guard remains as belt-and-braces.
- Persistence-failure path (thrown error): forced 500 from server → toast with Retry → click Retry → success.
- **Auth-failure path (resolved AuthErrorResponse): forced session expiry → no false success toast → persist-failure UX with Retry → `triggerSessionExpired()` invoked.**
- **Stale-Retry suppression: navigate away during the failure-toast lifetime → click Retry on the toast → no `updateTablePositionsBulk` call (mounted-ref short-circuit).**
- > 50-table dialog: opens with focus on Run Layout, Tab cycles between Cancel ↔ Run Layout, Esc closes (no layout), focus returns to toolbar button. Screen-reader announces title + description on open.
- Parent route `$whiteboardId.tsx` carries no auto-layout state, callbacks, or socket listeners (Open Question 2 resolution).
- `bun run lint` and `bunx tsc --noEmit` clean.

---

## 8. Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| 1 | Decomposition Task 2.2 calls for adding `socket.on('table:move:bulk', ...)` to `collaboration.ts`. Original spec recommended deferral. | **Resolved (revision 1) — REQUIRED, not deferred.** | Apollo Finding 3 reframed the broadcast plan: the originator's client (not the server function) emits `table:move:bulk`, and the server-side `socket.on(...)` handler re-broadcasts via `broadcastToWhiteboard`. The handler is on the critical path; without it, no other client receives the event. Build it in Phase 2 step 3 alongside the existing `socket.on('table:move', …)` template. |
| 2 | After removing the legacy ELK auto-layout from `ReactFlowWhiteboard.tsx`, is the `onAutoLayoutReady` callback prop still consumed by the parent route `src/routes/whiteboard/$whiteboardId.tsx`? | **Resolved (revision 1) — DELETE the bridge.** | Audit result: `onAutoLayoutReady` IS currently consumed (`$whiteboardId.tsx:461-467` stores the React Flow auto-layout function in `reactFlowAutoLayoutRef`, invoked from `handleAutoLayout` at lines 407-456). However, the new orchestrator owns the entire flow internally inside `ReactFlowWhiteboard.tsx` — the toolbar button, dialog, persist call, broadcast emit, and fit-view all live in that component now. The parent route's involvement (`reactFlowAutoLayoutRef`, `handleAutoLayout`, `handleAutoLayoutReady`, `useAutoLayoutPreference`, the four `<Toolbar>` legacy props, and the `layout:compute`/`layout:computed` socket emits + listeners) becomes dead code. Delete all of it (see §7 Files to Modify and Phase 4 step 4 for the explicit list). The `useAutoLayoutPreference` hook file itself is left in place for follow-up cleanup; not in scope. |
| 3 | FR-007 reference benchmark says "no longtask ≥ 200 ms". Should the orchestrator install a `PerformanceObserver` itself to surface a console warning if a longtask occurs, or is that a test-time-only contract? | **Test-time only.** | Performance tests in Cassandra's stage already cover this via `PerformanceObserver`. No production observer needed; would just spam console logs and waste cycles. |
| 4 | Should the success toast from `handleConfirm` show on the local user's screen even when persistence later fails (in which case the failure toast also fires)? | **Resolved.** | The success toast fires only **after** persistence succeeds (immediately before fit-view). If persistence fails (whether via thrown error OR returned `AuthErrorResponse`), only the error-with-Retry toast appears. This avoids contradictory toasts. |
| 5 | The new bulk schema caps `positions.length` at 500. Is 500 the right ceiling? | **Resolved.** | Yes — the PRD's supported size is ≤ 100, the > 50 dialog warns the user, and 500 leaves a 5× safety margin for unforeseen growth without enabling abuse. Sanity check: 500 `prisma.diagramTable.update` operations in one transaction stays well within Postgres / Prisma transaction limits (no explicit cap, practical limit is in the tens of thousands), and a 500-row JSON payload is roughly 25 KB — well under the ~1 MB typical body limit. |
| 6 | If `setNodes` is called optimistically but then persistence fails, does a subsequent collaborator's manual table:move overwrite the local user's optimistic positions? | **Acceptable per PRD.** | Yes — last-write-wins per node. The error toast tells the local user "your changes are visible locally but not persisted"; if a collaborator drags a table during this window, that table's position is overwritten by the manual drag. Documented in PRD Error Flow #6 (mid-drag conflict resolution). |

---

## Appendix A — Locked Decisions Compliance Checklist

Verifies every decision in `context.md` is reflected in this spec:

- [x] **Socket.IO**: single broadcast per Auto Layout, sender-guard pattern. The revision deviates from the *literal* `emitToWhiteboard` mechanism but preserves the *intent* (one broadcast per layout, sender-guarded receive). The mechanism shifts to `broadcastToWhiteboard` invoked from a `socket.on('table:move:bulk', …)` handler triggered by the originator's client emit. Rationale: avoid the unprecedented `server-functions.ts → @/routes/api/collaboration` import edge that the literal `emitToWhiteboard` from inside the server function would create (Apollo Finding 3). The locked decision was made before this implementation detail surfaced; Hephaestus's revised approach matches the existing single-table `emit('table:move', …)` pattern in the codebase. **If Themis or PM wants the literal `emitToWhiteboard` mechanism preserved, the alternative is to extract `emitToWhiteboard` and `broadcastToWhiteboard` to `src/lib/socket/emit.ts` first; this spec does not include that extraction in scope.**
- [x] **d3-force tick budget**: 10 ticks per RAF frame, 500-tick hard cap (§6 + Phase 1 step 1).
- [x] **fitView**: `{ padding: 0.2, duration: 300 }` after `setTimeout(..., 100)` (Phase 4 orchestrator `runLayout`).
- [x] **Toolbar prop surgery**: clean removal of `onAutoLayout` / `isAutoLayoutLoading` / `autoLayoutEnabled` / `onAutoLayoutEnabledChange` + Switch; clean addition of `onAutoLayoutClick` + `isAutoLayoutRunning` + `tableCount` (Phase 3 step 1).

## Appendix B — Codebase Facts Cross-Check

Verifies every fact Themis surfaced and every concrete API used:

| Themis claim | Confirmed? | Where |
|--------------|------------|-------|
| `node.measured?.width ?? node.width ?? 250` / `height ?? 150` | Yes | `elk-layout.ts:58-59` |
| AlertDialog (Radix) carries `role="alertdialog"`, focus trap, focus return | Yes | `alert-dialog.tsx:1-64` (Radix `AlertDialog.Root` + `AlertDialog.Content`) |
| Zod uses `.uuid()`, never `.cuid()` | Yes | `schema.ts:131, 152, 170, 194, 213, 243-247, 269` |
| Toast: `sonner` with `toast.success` / `toast.error` | Yes | `use-whiteboard-collaboration.ts:6, 188` |
| `emitToWhiteboard(whiteboardId, event, data)` | Yes | `collaboration.ts:1019-1031` |
| `broadcastToWhiteboard(whiteboardId, socketId, event, data)` | Yes | `collaboration.ts:1040-1057` |
| `prisma.$transaction([array])` pattern for bulk DB writes | Yes | `server-functions.ts:241-251` (in `computeAutoLayout`) |
| `requireAuth` + `getWhiteboardProjectId` IDOR pattern | Yes | `server-functions.ts:91-93, 120-122, 152-159` |
| `table:moved` listener guards via `data.userId === userId` | Yes | `use-whiteboard-collaboration.ts:75-77`. The existing listener reads `data.userId`. The new `table:move:bulk` listener also reads `data.userId` to maintain field-name parity within the same hook (resolves Apollo Finding 5 — the original spec had `updatedBy` here, which created a same-hook field-name skew). The wider mutation-event family (`table:updated`/`table:deleted`/`column:updated`) uses `updatedBy`, but those listeners live in different hooks; co-locating two different field names for the same semantic value in `use-whiteboard-collaboration.ts` is the maintenance trap Apollo flagged. **Pre-existing latent bug (out of scope):** the legacy `table:moved` server-side emit at `collaboration.ts:418-423` populates `updatedBy` while the listener reads `data.userId`; they never agree. Auto Layout does not touch this legacy emit; new code uses `userId` end-to-end on the new `table:move:bulk` event. |
| `requireAuth` returns `AuthErrorResponse` (does NOT throw) on session expiry | Yes | `src/lib/auth/middleware.ts:31-48`. Contract: `requireAuth<TInput, TResult>(handler) → ({data}) => Promise<TResult \| AuthErrorResponse>`. The `AuthErrorResponse` shape is `{error:'UNAUTHORIZED', status:401}` defined in `src/lib/auth/errors.ts:5-8`, with type guard `isUnauthorizedError(value)` at lines 16-25. The orchestrator must check `isUnauthorizedError(result)` after every `await updateTablePositionsBulk(…)` and route auth failures into the persist-failure UX (Apollo Finding 1). |
| `broadcastToWhiteboard(whiteboardId, socketId, event, data)` — emits to all sockets EXCEPT the given socketId | Yes | `collaboration.ts:1040-1057`. Used by the new `socket.on('table:move:bulk', …)` handler in Phase 2 step 3 to re-broadcast the bulk event to every collaborator except the originator. |
| Existing single-table flow: client emits socket event after server function `onSuccess` (not from inside the server function) | Yes | `src/routes/whiteboard/$whiteboardId.tsx:265-271` — `updateTablePositionMutation.onSuccess` calls `emit('table:move', {…})`. The new bulk flow follows the same pattern (orchestrator emits `table:move:bulk` after `updateTablePositionsBulk` resolves successfully), eliminating the cross-module import Apollo Finding 3 flagged. |

---

## Appendix C — Revision 1 Change Log (Apollo Stage 6 Findings)

This revision resolves the verdict CONCERNS returned by Apollo (1 HIGH + 4 MEDIUM). The original spec is preserved in git history at the commit before this revision.

| Apollo finding | Severity | Resolution in this revision |
|----------------|----------|----------------------------|
| **#1** Auth-failure handling: orchestrator's `try/catch` misses `AuthErrorResponse` resolved values; success branch fires on 401 | HIGH | Orchestrator's `runLayout` and `runRetry` now check `isUnauthorizedError(result)` after every `await updateTablePositionsBulk(…)`. Auth-error path runs the persist-failure UX (toast + Retry, optimistic state retained, no broadcast emit, no fitView), and additionally calls `triggerSessionExpired()`. §4 error table updated to distinguish thrown errors from resolved auth-error values. §7 Phase 4 includes the explicit code sketch and a regression test. |
| **#2** L∞ post-pass uses originator dimensions; collaborators with different rendered sizes break FR-004 remotely | MEDIUM | Spec adopts option (b) from Apollo's choice list: documents the post-pass as "originator-screen guarantee only." The broadcast payload carries no dimensions. Receivers apply verbatim coordinates; if their rendered table sizes differ they may observe sub-16-px gaps and can re-trigger Auto Layout themselves. §6 has the explicit cross-client contract section; §1 Goals updated to reflect the originator-screen scoping. Option (a) — broadcasting dims and re-running on the receiver — was rejected because each receiver would compute different positions, desyncing the on-screen state from the persisted state. (Apollo's preferred option of canonical 250×150 dimensions was outside the user-provided choice list.) |
| **#3** `server-functions.ts` importing from `@/routes/api/collaboration` introduces an unprecedented directional dependency | MEDIUM | The server function no longer emits any Socket.IO event. The originator's orchestrator emits `table:move:bulk` client-side after the server function resolves successfully (mirrors the existing single-table `emit('table:move', …)` in `updateTablePositionMutation.onSuccess`). A new server-side `socket.on('table:move:bulk', …)` handler in `collaboration.ts` re-broadcasts via `broadcastToWhiteboard(whiteboardId, socket.id, …)`, which excludes the sender. §2 component diagram, §4 (server function and event flow), and §7 Phase 2 step 2 + step 3 all updated. The previously-deferred `socket.on` handler is now REQUIRED and on the critical path. |
| **#4** `lastPayloadRef` Retry across unmount / navigation | MEDIUM | Orchestrator gains an `isMountedRef` set true on mount, false on unmount. The toast Retry handler short-circuits if `!isMountedRef.current`. `runRetry` re-checks the ref on entry and after every `await`. State setters (`setIsRunning`, `setPersistError`) only fire when the ref is true. New regression test in §7 Phase 4 step 5 covers retry-after-unmount suppression. |
| **#5** Same-hook field-name skew (`data.userId` vs `data.updatedBy`) in `use-whiteboard-collaboration.ts` | MEDIUM | New `table:move:bulk` event uses `userId` (matches the existing `table:moved` listener at `use-whiteboard-collaboration.ts:75-77`). §3 Socket.IO Event Payload, §4 server-function payload translation, and §7 Phase 4 step 1 all updated. A code comment is added next to both listeners noting the parity decision and pointing at the legacy `collaboration.ts:418-423` emit/listener mismatch as out-of-scope. |
| **#6** (LOW, not in user's directive) `_user` rename + `_user.id` access mismatch | LOW (informational) | The server function no longer needs the user identity at all (the orchestrator owns the sender-id field on the broadcast). `_user` remains in the destructure with a `void _user` line, matching the pattern at `createTable` / `updateTablePosition`. |
| **#7** (LOW, not in user's directive) 500-cap stress note | LOW (informational) | Sanity note added to Open Question 5: 500 `prisma.diagramTable.update` operations in one transaction stays well within Postgres / Prisma transaction limits; 500-row JSON payload is ~25 KB, well under typical body limits. |
| **OQ-2** Audit `onAutoLayoutReady` consumer | Process | Audit complete (in this document). The route file does currently consume the prop (`$whiteboardId.tsx:461-467` + `:716`), but the new orchestrator owns the entire flow inside `ReactFlowWhiteboard.tsx`, so the bridge becomes dead code. **Decision: DELETE the bridge** — `onAutoLayoutReady`, `reactFlowAutoLayoutRef`, `isAutoLayoutComputing`, `handleAutoLayout`, `handleAutoLayoutReady`, the four legacy `<Toolbar>` props, the `useAutoLayoutPreference` usage, the `computeAutoLayout` import, and the `layout:compute`/`layout:computed` socket emits + listeners are all removed in Phase 4 step 4. Open Question 2 is now resolved. |
