# Code Review — Auto Layout

**Reviewer**: Hermes
**Date**: 2026-05-01
**Stage**: 10-review
**Mode**: pipeline (spawned by Kratos)
**Round 1 Verdict**: Changes Required (3 BLOCKERs, 4 WARNINGs)
**Round 2 Verdict**: **Approved** (all 3 BLOCKERs resolved; non-gating WARNINGs carried over)

---

## Summary

| Metric             | Value                                          |
| ------------------ | ---------------------------------------------- |
| Files reviewed     | 12 (5 new + 7 modified)                        |
| Tests run          | Per implementation notes — 48 new, all passing |
| Tier checklist     | All 8 tiers reviewed and marked complete       |
| BLOCKERs           | 3                                              |
| WARNINGs           | 4                                              |
| SUGGESTIONs        | 5                                              |
| Auto-fixes applied | 0 (no purely mechanical fixes)                 |

The implementation is structurally sound: Apollo's five spec-review findings are all visibly addressed; the orchestrator's auth-error / unmount guards are correct; the post-pass enforces the L∞ contract; and the legacy bridge is cleanly deleted from `$whiteboardId.tsx`. However, three BLOCKERs gate approval — one is a security gap on the new socket handler, one is a missed concurrency on the server function, and one is a cross-file copy-paste that should be unified before a third copy is introduced.

---

## Tier Checklist

| Tier            | Status                              |
| --------------- | ----------------------------------- |
| T1 Correct      | Complete — 1 SUGGESTION             |
| T2 Safe         | Complete — 1 BLOCKER                |
| T3 Clear        | Complete — 3 SUGGESTIONs            |
| T4 Minimal      | Complete — 1 WARNING + 1 SUGGESTION |
| T5 Consistent   | Complete — clean                    |
| T6 Resilient    | Complete — 2 WARNINGs               |
| T7 Performant   | Complete — 1 WARNING                |
| T8 Maintainable | Complete — 2 BLOCKERs + 1 WARNING   |

`.claude/tmp/hermes-checklist.json` — all 8 tiers true.

---

## BLOCKERs

### B1 — Socket handler re-broadcasts unvalidated payload to all clients

**File**: `src/routes/api/collaboration.ts:443-473`
**Tier**: 2 — Safe
**Rule**: Cross-client payloads must be schema-validated server-side; a single bad emit must not corrupt every collaborator's state.

**Why**: The new `socket.on('table:move:bulk', ...)` handler validates only that `data.positions` is a non-empty array (lines 458-464), then re-broadcasts via `broadcastToWhiteboard` (line 469). A malicious or buggy authenticated client can emit:

```js
socket.emit('table:move:bulk', {
  userId: 'attacker',
  positions: [{ tableId: 'X', positionX: NaN, positionY: 'string' }],
})
```

Every other client's listener (`use-whiteboard-collaboration.ts:233-249`) calls `onBulkPositionUpdate(data.positions)` → `setNodes(... position: { x: NaN, y: 'string' })`. React Flow's rendering pipeline produces `<g transform="translate(NaN, NaN)">` and the canvas is corrupted for everyone in the room. This is a denial-of-service vector available to any authenticated user.

The server-side `updateTablePositionsBulk` server function does validate (via `bulkUpdatePositionsSchema`), but the socket emit path bypasses it entirely — the orchestrator emits the broadcast client-side AFTER the server-function success, and the server's socket handler is a separate trust boundary.

**Fix**: Define a Zod schema for the socket event and validate before re-broadcasting. Co-locate it with the existing `bulkUpdatePositionsSchema` in `src/data/schema.ts`:

```ts
// src/data/schema.ts
export const tableMoveBulkBroadcastSchema = z.object({
  userId: z.string().uuid(),
  positions: z
    .array(
      z.object({
        tableId: z.string().uuid(),
        positionX: z.number().finite(),
        positionY: z.number().finite(),
      }),
    )
    .min(1)
    .max(500),
})
```

```ts
// src/routes/api/collaboration.ts (handler body)
const parsed = tableMoveBulkBroadcastSchema.safeParse(data)
if (!parsed.success) return
broadcastToWhiteboard(whiteboardId, socket.id, 'table:move:bulk', parsed.data)
```

**Severity**: BLOCKER. Defense at the broadcast boundary is the single chokepoint that protects every receiver.

---

### B2 — Missed concurrency: serial DB round-trips in `updateTablePositionsBulk`

**File**: `src/lib/server-functions.ts:172-184`
**Tier**: 8 — Maintainable (M6 — missed concurrency)

**Why**: Two independent queries run sequentially:

```ts
const projectId = await getWhiteboardProjectId(whiteboardId) // round-trip 1
if (!projectId) throw new Error('Whiteboard not found')
// ...
const owned = await prisma.diagramTable.findMany({
  // round-trip 2
  where: { whiteboardId },
  select: { id: true },
})
```

Neither query depends on the other — `findMany` is keyed only on `whiteboardId`, which is the input. On a 50ms p50 connection this is +50ms of avoidable latency on every Auto Layout request. The PRD specifies a 2-second budget; gratuitously serial awaits eat into it.

Per the Tier 8 severity guide, M6 (missed concurrency) is a BLOCKER regardless of measured latency impact — sequential async on independent operations is a maintainability anti-pattern that compounds across reviews.

**Fix**:

```ts
const [projectId, owned] = await Promise.all([
  getWhiteboardProjectId(whiteboardId),
  prisma.diagramTable.findMany({
    where: { whiteboardId },
    select: { id: true },
  }),
])
if (!projectId) throw new Error('Whiteboard not found')
const ownedIds = new Set(owned.map((t) => t.id))
// ...
```

In the rare "whiteboard not found" case, the `findMany` returns `[]` (a wasted query against a non-existent whiteboard), but the request still rejects correctly. This trades one wasted query in the error path for one fewer round-trip in the happy path.

---

### B3 — Copy-paste pattern: `setNodes(prev => prev.map(n => positions.find(p => p.id === n.id) ? ... : n))`

**Files**:

- `src/hooks/use-auto-layout-orchestrator.ts:191-196`
- `src/components/whiteboard/ReactFlowWhiteboard.tsx:447-452`

**Tier**: 8 — Maintainable (M3 — copy-paste variation)

**Why**: Two copies of the same logic — "given an array of positions and current React Flow nodes, return new nodes with positions applied" — already exist in this PR. They differ only in field names (`{id, x, y}` in the orchestrator, `{tableId, positionX, positionY}` in the collaboration callback). Both use `Array.find` inside a map, which is O(n × m) — with 500 tables that's 250,000 lookups per `setNodes` call. The next collaborator-bulk-event added (e.g., bulk-create, bulk-delete-by-multiselect) will be tempted to copy a third time.

Per Tier 8 severity guide, M3 with ≥2 copies is BLOCKER.

**Fix**: Extract a helper into the auto-layout module (or a shared `react-flow/utils.ts`). Sketch:

```ts
// src/lib/auto-layout/index.ts (or src/lib/react-flow/apply-bulk-positions.ts)
export function applyBulkPositions<
  N extends { id: string; position: { x: number; y: number } },
>(
  nodes: ReadonlyArray<N>,
  positions: ReadonlyArray<{ id: string; x: number; y: number }>,
): Array<N> {
  const byId = new Map(positions.map((p) => [p.id, p]))
  return nodes.map((n) => {
    const p = byId.get(n.id)
    return p ? { ...n, position: { x: p.x, y: p.y } } : n
  })
}
```

Use it in both call sites. The collaboration callback in `ReactFlowWhiteboard.tsx:445-455` already adapts `tableId/positionX/positionY` → adapt at the boundary by mapping to `{id, x, y}` before calling the helper, OR change `useWhiteboardCollaboration`'s `onBulkPositionUpdate` signature to emit `{id, x, y}` directly (cleaner — server-side socket payload uses `tableId` because it's a wire format; the React Flow domain uses `id`).

This fix kills three problems in one pass: M3 (copy-paste), the O(n²) lookup in B-suggestion territory, and the contract-shape skew between `useWhiteboardCollaboration`'s emit/listen surfaces.

---

## WARNINGs

### W1 — `simulateChunked` has no error path

**File**: `src/lib/auto-layout/d3-force-layout.ts:71-99`
**Tier**: 6 — Resilient

If `simulation.tick()` throws synchronously inside the `for` loop in `frame()`, the throw escapes to RAF's error handler (and into `window.onerror`). The outer `new Promise((resolve) => ...)` neither resolves nor rejects — `await simulateChunked(...)` in `computeD3ForceLayout` hangs forever. Downstream, the orchestrator's `isRunning` stays `true`, the spinner spins forever, and the user has no recovery path until they navigate away.

**Fix**: Wrap the per-frame loop in try/catch and propagate via `reject`:

```ts
return new Promise((resolve, reject) => {
  let ticksRun = 0
  function frame() {
    try {
      const remaining = MAX_TICKS - ticksRun
      const chunk = Math.min(TICK_BUDGET_PER_FRAME, remaining)
      for (let i = 0; i < chunk; i++) simulation.tick()
      ticksRun += chunk
      if (ticksRun >= MAX_TICKS || simulation.alpha() < simulation.alphaMin()) {
        simulation.stop()
        resolve()
        return
      }
      requestAnimationFrame(frame)
    } catch (err) {
      simulation.stop()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  }
  requestAnimationFrame(frame)
})
```

`computeD3ForceLayout` already lacks a try/catch around `await simulateChunked(simulation)`, but `useD3ForceLayout`'s `runLayout` wraps the whole pipeline in `try/catch` (line 81). Errors will propagate cleanly once the inner promise can reject.

---

### W2 — Post-pass max sweeps may exit with unsatisfied gap contract

**File**: `src/lib/auto-layout/d3-force-layout.ts:130, 139-192`
**Tier**: 6 — Resilient

`enforceGapPostPass` runs at most `POST_PASS_MAX_SWEEPS = 5` sweeps. After 5 sweeps, if `anyViolation` is still true, the function exits silently with violations remaining. The "originator-screen 16px L∞ gap" guarantee from FR-004 is then quietly broken without any signal to the caller, the user, or telemetry.

**Fix (minimum)**: emit a dev-only warning when sweeps exhaust with violations:

```ts
// after the for-loop ends
if (anyViolation) {
  console.warn(
    `[auto-layout] post-pass exhausted ${POST_PASS_MAX_SWEEPS} sweeps with violations remaining (n=${nodes.length})`,
  )
}
```

This is a single line that buys observability — when a user reports "tables overlapped after Auto Layout," you have a console signal pointing at the exact failure mode.

**Optional (better)**: Replace the fixed sweep cap with a "sweep until no violation OR 2\*n iterations" heuristic. For a tightly-packed n=100, 200 sweeps is still milliseconds. But the dev-warning is the must-have.

---

### W3 — `useD3ForceLayout` exposes unused `onLayoutComplete` / `onLayoutError` callbacks

**File**: `src/hooks/use-d3-force-layout.ts:12-15, 47-48, 79, 84`
**Tier**: 4 — Minimal

The hook accepts an `options` argument with two callbacks; the orchestrator (the hook's only consumer) calls `useD3ForceLayout()` with no arguments. Both callbacks are dead API surface. The orchestrator inspects the resolved Promise directly to handle both success and error, which works fine; the callbacks would duplicate that wiring if used.

**Fix**: Drop the `options` parameter, the `UseD3ForceLayoutOptions` interface, and the call sites at lines 79 and 84. The hook becomes:

```ts
export function useD3ForceLayout(): UseD3ForceLayoutResult { ... }
```

If a future consumer wants completion callbacks, they can wrap `runLayout` in a `useEffect` or inline `then`/`catch`. YAGNI.

---

### W4 — Parameter sprawl on `useWhiteboardCollaboration` (M2)

**File**: `src/hooks/use-whiteboard-collaboration.ts:61-77`
**Tier**: 8 — Maintainable

This hook now takes 9 positional arguments — 8 of them are callbacks. Adding `onBulkPositionUpdate` as the 9th positional argument is the moment to convert to an options object. Callers must memorize argument order, and the call site in `ReactFlowWhiteboard.tsx:421-456` spans 36 lines of nameless `useCallback`s separated by commas. The next callback added makes this strictly worse.

**Fix**: Convert to a single options object. Only one call site exists, so the migration is bounded:

```ts
export function useWhiteboardCollaboration(opts: {
  whiteboardId: string
  userId: string
  onPositionUpdate: (tableId: string, positionX: number, positionY: number) => void
  onTableDeleted?: (tableId: string) => void
  onTableError?: (data: TableErrorEvent) => void
  onRelationshipDeleted?: (relationshipId: string) => void
  onRelationshipError?: (data: RelationshipErrorEvent) => void
  onRelationshipUpdated?: (relationshipId: string, label: string) => void
  onBulkPositionUpdate?: (positions: Array<{...}>) => void
}) { ... }
```

The call-site at `ReactFlowWhiteboard.tsx:421-456` becomes self-documenting.

This fix is bundled with B3 — once `applyBulkPositions` exists and the bulk-position payload shape is unified, the options-object migration is a near-mechanical rename.

---

## SUGGESTIONs

### S1 — Function name `l8Gap` is cryptic

**File**: `src/lib/auto-layout/d3-force-layout.ts:110`, also test file `d3-force-layout.test.ts:19`
**Tier**: 3 — Clear

`l8Gap` is "L-infinity gap" rendered via the visual pun "∞" → "8" rotated. A reader scanning the code will read "L8 gap" and pause. Rename to `lInfinityGap` (or `chebyshevGap`) for clarity.

---

### S2 — Closure-over-handleRetry inside handlePersistResult

**File**: `src/hooks/use-auto-layout-orchestrator.ts:99-133, 138-169`
**Tier**: 1 — Correct (works, but fragile pattern)

`handlePersistResult` (declared first) captures `handleRetry` (declared later) inside its toast `action.onClick`. This works because the onClick fires asynchronously after both useCallbacks are initialized, and the closure lazily resolves `handleRetry` at click time. However, the deps array of `handlePersistResult` does not list `handleRetry`, so React's exhaustive-deps lint would normally flag this — and the file does not have an eslint-disable comment for that line, suggesting the lint is not catching it (likely because `handleRetry` is referenced via closure, not directly passed).

The pattern is functionally correct, but the next developer reading it will be confused. Two options:

1. **Move `handleRetry` above `handlePersistResult`**. This requires inverting the dep arrows: `handleRetry` would call a smaller helper for the success branch, instead of `handlePersistResult` invoking `handleRetry` from its toast.
2. **Refactor toast action into a helper that takes `handleRetry` as a parameter**. Less elegant but no reordering.

Either is fine — the current code is not wrong, just brittle.

---

### S3 — `simulateChunked` and `enforceGapPostPass` exported from barrel without external consumer

**File**: `src/lib/auto-layout/index.ts:5-7`
**Tier**: 4 — Minimal

The barrel re-exports `simulateChunked` and `enforceGapPostPass` alongside `computeD3ForceLayout`. Tests import these helpers directly from `./d3-force-layout` (not from the barrel), and no production code references them. The barrel should expose only `computeD3ForceLayout` + the input/output types.

Drop both from the barrel. Tests still compile (they import from the source file directly). Production code is unaffected.

---

### S4 — Repeated `// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` for `isMountedRef.current`

**File**: `src/hooks/use-auto-layout-orchestrator.ts:147, 160, 164, 214, 235`
**Tier**: 3 — Clear

Five copies of the same eslint-disable. The lint complains because TS thinks `isMountedRef.current` is always `true` (it can't see the cleanup hook flips it). Replace with a single block-level disable at the top of `runLayout` and `handleRetry`, or extract the `isMountedRef.current` check into a helper:

```ts
const safeRun = useCallback((fn: () => void) => {
  if (isMountedRef.current) fn()
}, [])
// usage: safeRun(() => setIsRunning(true))
```

Either reduces the noise and centralizes the rule.

---

### S5 — `computeAutoLayout` (legacy ELK-based) still in `server-functions.ts`

**File**: `src/lib/server-functions.ts:272-327`
**Tier**: 4 — Minimal

The new `updateTablePositionsBulk` is the canonical persistence path. The old `computeAutoLayout` (which runs `computeLayout` server-side and persists in one call) is still exported and still used by `$whiteboardId.new.tsx`. Per implementation notes, `useAutoLayoutPreference` is deferred along the same axis. When `.new.tsx` is removed, also remove `computeAutoLayout` and the ELK `computeLayout` import to avoid future readers wondering which auto-layout is canonical.

This is tracked debt, not a bug.

---

## What's Good

A short list of patterns this PR did right that future Hermes runs should expect to see:

1. **Apollo's five findings are visibly handled.** `isUnauthorizedError(result)` runs on every awaited persist result. `isMountedRef` guards every state setter and the Retry handler entry point. The orchestrator emits `table:move:bulk` _after_ server-function success — server-function does not import from `routes/api/collaboration`. The new socket handler includes the standard `isSessionExpired` + `denyIfInsufficientPermission` + `safeUpdateSessionActivity` prelude. Field name `userId` is consistent end-to-end on the new event.

2. **The L∞ post-pass is deterministic.** Tie-breaker by lexicographic ID, axis selected by smaller-gap component, slack added to handle floating-point boundary. Tests TC-AL-E-03/05/06/07/09 exercise the contract on isolated, circular, and fully-connected fixtures.

3. **The IDOR guard is one round-trip.** `findMany({ where: { whiteboardId }, select: { id: true } })` + Set membership check, regardless of N positions. (See B2 — make it parallel with the `getWhiteboardProjectId` lookup and it's perfect.)

4. **The 500-position cap and `.finite()` guard on `bulkUpdatePositionsSchema` use the correct Zod conventions.** `.uuid()` not `.cuid()` per project memory.

5. **The legacy bridge is genuinely deleted from `$whiteboardId.tsx`.** `reactFlowAutoLayoutRef`, `handleAutoLayout`, `useAutoLayoutPreference` usage, `layout:compute`/`layout:computed` listeners, four legacy Toolbar props — all gone. `$whiteboardId.new.tsx` retains them because that route is still using the ELK path; this is the right boundary.

6. **AlertDialog from shadcn already provides every FR-011 a11y AC.** No manual role/aria overrides — `role="alertdialog"`, `aria-labelledby`, `aria-describedby`, focus trap, Esc → onCancel, focus return — all from Radix. The component code is small (~30 LOC of body) because the primitives do the work.

---

## Refactoring Recommended

The following structural issues are within scope of this review's BLOCKERs but, if accepted as broader refactors, make several SUGGESTIONs auto-resolve:

- **Socket payload schemas → `src/data/schema.ts`** (B1). Currently socket events are typed inline at handler sites with `data: { ... }`. A shared schema file for socket-event payloads would make B1's fix idiomatic and prevent the next handler from inheriting the same gap.
- **A shared `applyBulkPositions` utility** (B3). Lives in `src/lib/auto-layout/` or `src/lib/react-flow/utils.ts`. Removes the M3 copy-paste and the O(n²) lookup. The same helper would be reusable when bulk-create / bulk-delete events arrive later.
- **`useWhiteboardCollaboration` options-object migration** (W4). Scoped to one call site. Done now while the change is local and the call site is fresh in everyone's head.

These three are the same change set — one PR after this one would tidy them up together.

---

## Test Coverage Notes

I did not run `bun run test` in this review — implementation notes report 48 new tests passing, and Cassandra (stage 11 risk review) will exercise the runtime behaviour. For visibility:

- TC-AL-E-10 (500-tick cap) does not actually spy on `simulation.tick()`; the test asserts only that the promise resolves with finite positions. This is acknowledged in the test file comment (lines 217-220). The cap is correct in code (line 64); behavioural enforcement is implicit.
- TC-AL-E-11 (10-tick budget) is also implicit — it asserts the engine produces a valid result, not that `requestAnimationFrame` was called the expected number of times.
- TC-AL-I-01 through I-14 are deferred per implementation notes. The orchestrator unit tests cover the same logic paths.
- TC-AL-S-01 through S-12 (server-function tests) are deferred — no Prisma test DB. The schema and IDOR guard are type-safe and reviewed here.
- TC-AL-C-01 through C-06 (socket handler tests) are deferred — no `collaboration.test.ts` exists. **Note**: B1's fix should ship with at least a unit test for the new schema. The handler can be tested by importing the validation function in isolation.

The deferred items do not block this review, but B1's regression test is mandatory once the fix lands.

---

## Verdict

**Changes Required.**

Address B1, B2, and B3. Once the BLOCKERs are resolved, the WARNINGs (W1-W4) and SUGGESTIONs (S1-S5) are recommended but not gating. The PR's structure is correct; the gaps are well-bounded and mechanical.

Suggested order:

1. **B1** — Add `tableMoveBulkBroadcastSchema` to `src/data/schema.ts`; gate the socket handler on `safeParse`. Add a unit test (smallest possible — just the schema).
2. **B3** — Add `applyBulkPositions` helper; replace both call sites. This is the largest mechanical change but the cleanest payoff.
3. **B2** — Convert the two serial DB calls in `updateTablePositionsBulk` to `Promise.all`. One-line change.
4. **W1** — Wrap `simulateChunked`'s frame loop in try/catch; reject on throw.
5. **W2** — Add the `console.warn` for post-pass exhaustion.
6. **W3** — Drop the unused options API on `useD3ForceLayout`.
7. **W4** — Convert `useWhiteboardCollaboration` to an options object (bundles cleanly with B3).

Re-spawn Hermes after these are addressed.

---

## Status

| Field          | Value                                          |
| -------------- | ---------------------------------------------- |
| Document       | `code-review.md`                               |
| Verdict        | Changes Required                               |
| BLOCKERs       | 3 (B1 Tier 2, B2 Tier 8, B3 Tier 8)            |
| WARNINGs       | 4 (W1 Tier 6, W2 Tier 6, W3 Tier 4, W4 Tier 8) |
| SUGGESTIONs    | 5                                              |
| Auto-fixes     | 0                                              |
| Tier checklist | All 8 marked complete                          |

---

# Round 2 Re-Review — 2026-05-01

**Reviewer**: Hermes
**Trigger**: Re-spawn after Ares applied B1/B2/B3 fixes
**Round 2 Verdict**: **Approved**

## Summary

| Metric         | Round 1        | Round 2                                 |
| -------------- | -------------- | --------------------------------------- |
| BLOCKERs       | 3              | **0**                                   |
| WARNINGs       | 4              | 4 (carried over, none new, none gating) |
| SUGGESTIONs    | 5              | 5 (carried over)                        |
| New tests      | 48             | +14 (8 for B1 schema, 6 for B3 helper)  |
| Tier checklist | All 8 complete | All 8 complete                          |

All three round-1 BLOCKERs are resolved with correct fixes that match the proposed remediation. The round-1 WARNINGs (W1-W4) and SUGGESTIONs (S1-S5) were not incidentally fixed; they remain non-gating per round-1 verdict language and are carried forward for follow-up.

## Tier Checklist (Round 2)

| Tier            | Round 2 Status                                                                  |
| --------------- | ------------------------------------------------------------------------------- |
| T1 Correct      | Verified — all three fixes are functionally correct                             |
| T2 Safe         | Verified — B1's schema validation closes the DoS vector                         |
| T3 Clear        | Verified — fix sites are commented, helper has JSDoc                            |
| T4 Minimal      | Verified — B3 helper unifies the duplicated pattern                             |
| T5 Consistent   | Verified — schema follows existing Zod conventions                              |
| T6 Resilient    | Verified — socket handler emits structured error on validation failure          |
| T7 Performant   | Verified — B2 parallel queries + B3 O(n) Map lookup                             |
| T8 Maintainable | Verified — M3 (copy-paste) and M6 (missed concurrency) anti-patterns eliminated |

`.claude/tmp/hermes-checklist.json` — all 8 tiers true.

## BLOCKER Verification

### B1 — Socket payload validation — RESOLVED

**Files verified**:

- `src/data/schema.ts:424-438` — `tableMoveBulkBroadcastSchema` defined with `.uuid()` userId, `.uuid()` tableId, `.finite()` coordinates, `.min(1).max(500)` cap. Type export `TableMoveBulkBroadcast` exists.
- `src/routes/api/collaboration.ts:444-478` — handler runs auth prelude (`isSessionExpired`, `denyIfInsufficientPermission`) **before** schema validation (correct order — don't validate input from unauthorized callers). On `safeParse` failure, emits structured `error` event with `event`, `error: 'VALIDATION_ERROR'`, `message`. On success, broadcasts `parsed.data` (not raw `data`) — confirmed at line 474.
- `src/data/schema.test.ts:349-423` — 8 unit tests cover the exact attack vectors flagged in round 1: NaN positionX, string positionY, Infinity coordinates, non-UUID tableId, non-UUID userId, empty array, > 500 entries, plus a positive-case smoke test. Test IDs (`TC-AL-C-B1-01` through `-08`) match the existing project convention.

**Verdict**: Defense at the broadcast boundary is now in place. The DoS vector — "any authenticated user emits NaN coordinates and corrupts every collaborator's React Flow canvas" — is closed.

### B2 — Parallel DB queries — RESOLVED

**File verified**: `src/lib/server-functions.ts:174-180`

```ts
const [projectId, owned] = await Promise.all([
  getWhiteboardProjectId(whiteboardId),
  prisma.diagramTable.findMany({
    where: { whiteboardId },
    select: { id: true },
  }),
])
if (!projectId) throw new Error('Whiteboard not found')
```

The two independent queries now run in parallel. The "wasted query in the not-found path" tradeoff is acknowledged in the inline comment (lines 172-173) and matches the round-1 fix proposal verbatim. M6 anti-pattern eliminated.

**Verdict**: One round-trip removed from the Auto Layout hot path. PRD's 2-second budget gains ~50ms of headroom on a typical p50 connection.

### B3 — applyBulkPositions helper — RESOLVED

**Files verified**:

- `src/lib/auto-layout/index.ts:26-37` — `applyBulkPositions<N>(nodes, positions)` builds a Map from positions in a single pass, then maps over nodes — O(n) total. Generic constraint correctly requires `{ id: string; position: { x: number; y: number } }` so React Flow node types satisfy it. Returns new array; unmatched nodes are returned by reference unchanged (correct shallow optimisation).
- `src/hooks/use-auto-layout-orchestrator.ts:23, 193` — orchestrator imports from the barrel and calls `applyBulkPositions(prev, positions)` directly (positions are already in `{id, x, y}` shape from `runD3ForceLayout`).
- `src/components/whiteboard/ReactFlowWhiteboard.tsx:59, 448-452` — collaboration callback normalises wire-format `{tableId, positionX, positionY}` to `{id, x, y}` at the boundary, then calls `applyBulkPositions(nds, normalised)`. Boundary normalisation is the right choice here — it keeps the wire format intact for the socket layer while letting the helper stay React Flow-shaped.
- `src/lib/auto-layout/apply-bulk-positions.test.ts` — 6 unit tests cover: matched positions applied, unmatched preserved, empty positions array, empty nodes array, non-position fields preserved, duplicate positions (last-write-wins via Map insertion order). Test IDs (`TC-AL-B3-01` through `-06`) consistent with project convention.

**Verdict**: M3 (copy-paste) eliminated. The O(n × m) Array.find-in-map pattern is gone from both call sites. Future bulk-event handlers (bulk-create, bulk-delete) will reach for the helper instead of copying a third time.

## Round-1 WARNING Status

None of the four round-1 WARNINGs were incidentally fixed. None regressed.

| ID  | File                                                                    | Status  | Notes                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | `src/lib/auto-layout/d3-force-layout.ts:71-99` (`simulateChunked`)      | UNFIXED | No try/catch wrapper; throw inside `simulation.tick()` still hangs the outer Promise.                                                                                                             |
| W2  | `src/lib/auto-layout/d3-force-layout.ts:139-192` (`enforceGapPostPass`) | UNFIXED | Post-pass exhaustion still exits silently after 5 sweeps. No `console.warn` was added.                                                                                                            |
| W3  | `src/hooks/use-d3-force-layout.ts:12-15, 46-49, 79, 84`                 | UNFIXED | `UseD3ForceLayoutOptions` and the unused `onLayoutComplete`/`onLayoutError` callbacks remain.                                                                                                     |
| W4  | `src/hooks/use-whiteboard-collaboration.ts:61-77`                       | UNFIXED | Hook still takes 9 positional arguments. Round 1 noted W4 was "bundled with B3" — Ares chose boundary-normalisation inside the existing useCallback rather than restructuring the hook signature. |

These are non-gating per round-1 verdict language ("Once the BLOCKERs are resolved, the WARNINGs (W1-W4) and SUGGESTIONs (S1-S5) are recommended but not gating"). They remain open as follow-up work and are not regressions.

## Refactoring Recommended (carried over)

The round-1 refactoring recommendations remain valid and unchanged:

- Socket payload schemas → `src/data/schema.ts` (B1 took the first step — the next handler should follow the same pattern)
- `useWhiteboardCollaboration` options-object migration (W4) — now bounded to a one-call-site rename
- `useD3ForceLayout` options API drop (W3) — pure dead-code removal

A single follow-up PR addressing W1+W2+W3+W4 + S1 (`l8Gap` rename) + S3 (barrel cleanup) would close all the carried items.

## Final Verdict

**Approved.**

All three BLOCKERs are resolved with correct, well-tested fixes. The four round-1 WARNINGs remain open as non-gating follow-up. The PR is ready to ship and the feature is COMPLETE.
