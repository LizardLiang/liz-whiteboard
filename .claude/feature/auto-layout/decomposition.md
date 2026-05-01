# Feature Decomposition: Auto Layout

## Document Info

| Field | Value |
|-------|-------|
| **Feature** | Auto Layout |
| **Author** | Daedalus (Decomposition Agent) |
| **PRD Version** | 1.2 |
| **Date** | 2026-05-01 |
| **Phases** | 4 |
| **Total Tasks** | 18 |

---

## Overview

Auto Layout adds a one-click button to the whiteboard toolbar that repositions every table using a d3-force simulation (FK edges as attractive links, repulsion between all tables, collision-detection sized to real table bounding boxes). After the simulation settles, positions are persisted atomically via a new `updateTablePositionsBulk` server function, the server broadcasts a single `table:move:bulk` Socket.IO event so collaborators converge in one render tick, and the React Flow viewport auto-fits to show the full diagram.

The feature replaces the existing `computeAutoLayout` server-side ELK path with a client-side d3-force path. The existing `useAutoLayout` hook (ELK) and `elk-layout.worker.ts` are **not** used by this feature; the new hook is written from scratch around d3-force.

---

## Dependency Map

```
Phase 1: Layout Engine (d3-force)
    |
    v
Phase 2: Bulk Persistence + Socket.IO Broadcast
    |
    v
Phase 3: UI — Toolbar Button + Confirmation Dialog
    |
    v
Phase 4: Orchestration Hook + Error Handling + Viewport Fit
```

Phase 3 depends on Phase 1 (calls the layout engine) and Phase 2 (calls the bulk persist function). Phase 4 wires all prior phases together and cannot start until all three are complete. Phases 1 and 2 have no dependency on each other and can run in parallel once Phase 0 context is absorbed.

---

## Phase Summary

| # | Phase | Tasks | Key Output | Blocks |
|---|-------|-------|------------|--------|
| 1 | Force-Directed Layout Engine | 5 | `useD3ForceLayout` hook | Phase 3, Phase 4 |
| 2 | Bulk Persistence + Collaboration | 4 | `updateTablePositionsBulk` + `table:move:bulk` | Phase 4 |
| 3 | Toolbar Button + Confirmation Dialog | 5 | Updated `Toolbar.tsx` + `AutoLayoutConfirmDialog` | Phase 4 |
| 4 | Orchestration, Viewport Fit + Error Handling | 4 | Wired `ReactFlowWhiteboard.tsx` | — |

**Critical Path:** Phase 1 → Phase 3 → Phase 4

**Parallel Opportunity:** Phase 1 and Phase 2 can run in parallel (no shared files, no cross-dependency at the code level).

---

## Phase 1: Force-Directed Layout Engine

### Scope

Everything needed to compute new table positions using d3-force — from extracting nodes/edges out of React Flow state, to running the simulation in `requestAnimationFrame` chunks (no longtask ≥ 200ms), to applying a deterministic post-pass that guarantees the 16px L∞ gap contract.

This phase produces a single React hook (`useD3ForceLayout`) that the orchestration layer (Phase 4) calls. It has no UI and no network calls.

### NOT in this phase

- The button that triggers the hook (Phase 3)
- Persisting positions to the server (Phase 2)
- Viewport fit after layout (Phase 4)
- Toast / error UI (Phase 4)
- The existing ELK layout hook (`use-auto-layout.ts`) — left unchanged

### Tasks

#### Wave 1 (no intra-phase dependencies — can start immediately)

**Task 1.1 — Create `src/lib/auto-layout/d3-force-layout.ts`**

Implement the core d3-force simulation function:

```
computeD3ForceLayout(
  nodes: Array<{ id: string; width: number; height: number }>,
  edges: Array<{ source: string; target: string }>
): Promise<Array<{ id: string; x: number; y: number }>>
```

- Build a `forceSimulation` with `forceManyBody` (repulsion), `forceLink` (FK edges as links, distance proportional to average table size), `forceCollide` (radius = half the diagonal of each table's bounding box + 8px buffer for the gap contract), and `forceCenter`.
- Run the simulation using `requestAnimationFrame` ticks; cap at 500 ticks total. Each RAF callback runs a fixed number of ticks (e.g., 10) then yields to the browser.
- After the simulation, apply a deterministic post-pass: iterate over all pairs, compute L∞ gap; if any pair has gap < 16px nudge the smaller-`id` node away until the gap is exactly 16px.
- For whiteboards with 0 FK edges, the simulation runs with repulsion + collision only (no `forceLink`), which satisfies FR-010.
- Returns a Promise that resolves with the final `{ id, x, y }` array.

Target file: `src/lib/auto-layout/d3-force-layout.ts`
Effort: M (3–4h)
Verify: `bun run test -- --testPathPattern=d3-force-layout` — unit tests for (a) 0-edge case, (b) 2-table layout satisfies 16px gap, (c) FK-pairs closer than non-FK-pairs on a 10-table fixture, (d) no longtask (single-tick sync calls complete in < 16ms each)

**Task 1.2 — Create `src/lib/auto-layout/d3-force-layout.test.ts`**

Unit tests for `computeD3ForceLayout`:
- 0 tables → rejects with "No nodes to layout"
- 1 table → resolves, returns original position
- 2 tables, no FK → gap ≥ 16px for every pair
- 10-table fixture with FK edges → `median(FK-pair distance) ≤ 0.60 × median(non-FK-pair distance)`
- 10-table fixture repeated 3× → gap contract holds on every run
- 500-tick hard cap → simulation always terminates (never hangs)

Target file: `src/lib/auto-layout/d3-force-layout.test.ts`
Effort: S (1–2h)
Verify: `bun run test -- --testPathPattern=d3-force-layout` passes all cases

#### Wave 2 (depends on Task 1.1 being done)

**Task 1.3 — Create `src/hooks/use-d3-force-layout.ts`**

React hook that wraps `computeD3ForceLayout` and exposes the layout result in React state:

```ts
function useD3ForceLayout(options?: {
  onLayoutComplete?: (positions: Array<{ id: string; x: number; y: number }>) => void
  onLayoutError?: (error: Error) => void
}): {
  runLayout: (
    nodes: Array<TableNodeType>,
    edges: Array<RelationshipEdgeType>
  ) => Promise<Array<{ id: string; x: number; y: number }>>
  isRunning: boolean
  error: Error | null
}
```

- Derives node dimensions from `node.measured` (React Flow sets this after first render) with a fallback of `{ width: 200, height: 100 }` when unmeasured.
- Extracts edge source/target from `RelationshipEdgeType` `source`/`target` fields.
- Sets `isRunning = true` before calling, `false` after.
- If `computeD3ForceLayout` throws, sets `error` and calls `onLayoutError`; does NOT call `setNodes` — leaves diagram at pre-click positions (satisfies the "Layout simulation throws" error flow).
- Does NOT call `setNodes` itself — returns positions array; the orchestration hook (Phase 4) applies them.

Target file: `src/hooks/use-d3-force-layout.ts`
Effort: S (1–2h)
Verify: `bun run test -- --testPathPattern=use-d3-force-layout` — tests that `isRunning` transitions correctly and that errors are surfaced without mutating nodes

**Task 1.4 — Create `src/hooks/use-d3-force-layout.test.ts`**

Unit tests for the hook:
- `isRunning` is true during `runLayout`, false before and after
- On successful layout, returns positions array
- On `computeD3ForceLayout` error, sets `error`, returns null, does not throw

Target file: `src/hooks/use-d3-force-layout.test.ts`
Effort: S (1h)
Verify: `bun run test -- --testPathPattern=use-d3-force-layout` passes

**Task 1.5 — Add `src/lib/auto-layout/index.ts` (barrel export)**

Re-export `computeD3ForceLayout` and related types. Keeps import paths clean for Phase 4.

Target file: `src/lib/auto-layout/index.ts`
Effort: XS (15min)
Verify: `bunx tsc --noEmit` — no new TypeScript errors

### Technical Notes

- `d3-force` v3 is already in `package.json` — no new dependency.
- Node dimensions: read from `node.measured.width` / `node.measured.height` (React Flow 12 API). Add a comment noting the fallback strategy.
- The post-pass for gap enforcement runs synchronously after the simulation finishes (it is O(n²) but n ≤ 100, so < 10K iterations; acceptable on the main thread after RAF loop completes).
- Do not import anything from `elk-layout.ts` or `use-auto-layout.ts` — those are the existing ELK path and must not be disturbed.
- The `requestAnimationFrame` tick loop means `computeD3ForceLayout` returns a `Promise`; the hook awaits it.

### Acceptance Criteria

- [ ] `bun run test -- --testPathPattern=d3-force` passes, ≥ 6 test cases
- [ ] For a 10-table FK fixture: `median(FK-pair distance) ≤ 0.60 × median(non-FK-pair distance)`
- [ ] For any fixture with ≥ 2 tables: every pair has L∞ gap ≥ 16px
- [ ] No single synchronous call in `computeD3ForceLayout` takes ≥ 16ms (each RAF tick processes ≤ 10 simulation ticks)
- [ ] `bunx tsc --noEmit` passes with zero errors

---

## Phase 2: Bulk Persistence + Socket.IO Collaboration Broadcast

### Scope

Add the new `updateTablePositionsBulk` TanStack Start server function and wire the new `table:move:bulk` Socket.IO event into the collaboration server. This is the persistence + collaboration backbone that Phase 4 (orchestration) calls after layout completes.

### NOT in this phase

- Client-side layout computation (Phase 1)
- The button or dialog that triggers persistence (Phase 3)
- Optimistic state application on the calling client (Phase 4)
- Handling `table:move:bulk` on the receiving collaborator client (Phase 4)

### Tasks

#### Wave 1 (no intra-phase dependencies)

**Task 2.1 — Add `updateTablePositionsBulk` server function to `src/lib/server-functions.ts`**

```ts
export const updateTablePositionsBulk = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    whiteboardId: string
    positions: Array<{ id: string; positionX: number; positionY: number }>
  }) => data)
  .handler(requireAuth(async ({ user: _user }, data) => { ... }))
```

- Validate `whiteboardId` (UUID) and each position entry with Zod (`z.uuid()`, `z.number()`).
- Ownership check: verify all table IDs belong to `whiteboardId` (IDOR prevention, matching the pattern of `table:move` in `collaboration.ts`).
- Single `prisma.$transaction` wrapping N `prisma.diagramTable.update` calls for all positions.
- On success, emit `table:move:bulk` on the Socket.IO namespace `/whiteboard/${whiteboardId}` via `getSocketIO()` — this is the **server-emitted** broadcast to collaborators. Import `getSocketIO` from `@/routes/api/collaboration`.
- Returns `{ success: true, count: N }` on success.
- On any error (not found, forbidden, DB error), throw; TanStack Start will return a non-2xx to the client.

Target file: `src/lib/server-functions.ts` (append after existing `updateTablePosition`)
Effort: M (2–3h)
Verify: `bun run test -- --testPathPattern=server-functions` passes; manual: POST to the server function with a valid payload and check DB rows updated + Socket.IO event emitted in server logs

**Task 2.2 — Add `table:move:bulk` handler in `src/routes/api/collaboration.ts`**

Add a Socket.IO server event handler for `table:move:bulk` **emitted by the client** (this is for future use; the v1 PRD requires server-emitted broadcast only, but the server needs to handle the incoming client event that triggers the server function). In v1, Auto Layout uses the TanStack Start server function path (`updateTablePositionsBulk`) — the server function internally emits the server-side `table:move:bulk` broadcast. Add the corresponding `socket.on('table:move:bulk', ...)` handler that validates auth/session, validates input schema, performs bulk DB update via `prisma.$transaction`, and broadcasts `table:move:bulk` to other clients via `socket.broadcast.emit`. This dual path (server function + socket event handler) is consistent with how per-table `table:move` / `updateTablePosition` are structured today.

Payload schema (incoming from client):
```ts
{ positions: Array<{ tableId: string; positionX: number; positionY: number }> }
```

Payload schema (outgoing broadcast):
```ts
{ positions: Array<{ tableId: string; positionX: number; positionY: number }>; updatedBy: string }
```

Target file: `src/routes/api/collaboration.ts` (add to `setupCollaborationEventHandlers`)
Effort: M (2h)
Verify: `bun run test -- --testPathPattern=collaboration` passes; Zod schema validates and rejects malformed payloads

#### Wave 2 (depends on Task 2.1 completing)

**Task 2.3 — Add Zod schema for bulk positions in `src/data/schema.ts`**

```ts
export const bulkUpdatePositionsSchema = z.object({
  whiteboardId: z.string().uuid(),
  positions: z.array(z.object({
    id: z.string().uuid(),
    positionX: z.number(),
    positionY: z.number(),
  })).min(1),
})
export type BulkUpdatePositions = z.infer<typeof bulkUpdatePositionsSchema>
```

Target file: `src/data/schema.ts`
Effort: XS (30min)
Verify: `bunx tsc --noEmit` — no errors; `bun run test -- --testPathPattern=schema` passes

**Task 2.4 — Unit tests for `updateTablePositionsBulk`**

- Happy path: 3 tables updated, all rows changed in DB
- IDOR: table ID from a different whiteboard → throws "Table does not belong to this whiteboard"
- Empty positions array → Zod rejects before DB call
- Transaction failure → full rollback (no partial writes)

Target file: `src/lib/server-functions.test.ts` (add to existing test file or create `src/lib/server-functions-bulk.test.ts`)
Effort: S (1–2h)
Verify: `bun run test -- --testPathPattern=server-functions` all passing

### Technical Notes

- `getSocketIO()` is already exported from `src/routes/api/collaboration.ts`. Import it in `server-functions.ts` to emit the broadcast after the transaction.
- The Socket.IO namespace for the whiteboard is `/whiteboard/${whiteboardId}` — use `io.of(\`/whiteboard/${whiteboardId}\`)` and call `.emit('table:move:bulk', payload)` to reach all connected sockets in that namespace (including the sender, since sender has already applied positions locally). Alternatively, track the sender's socket ID and use `socket.broadcast.emit` in the socket handler; in the server-function path, emit to the namespace with `io.of(ns).emit(...)`.
- The `table:move:bulk` event name must be consistent between the server broadcast and the client listener added in Phase 4.
- No Prisma schema changes are needed; bulk update uses existing `diagramTable` model.

### Acceptance Criteria

- [ ] `bun run test -- --testPathPattern=server-functions|bulk` passes
- [ ] Bulk update of 100 tables completes in a single transaction (verify with `prisma.$transaction`)
- [ ] IDOR guard rejects tables not belonging to the target whiteboard
- [ ] Server emits `table:move:bulk` to the namespace after successful transaction
- [ ] `bunx tsc --noEmit` passes

---

## Phase 3: Toolbar Button + Confirmation Dialog

### Scope

All UI changes required for the Auto Layout entry point: the "Auto Layout" button in `Toolbar.tsx` with correct disabled/loading states, and a new `AutoLayoutConfirmDialog` component for the > 50 table pre-run warning that satisfies all accessibility requirements from FR-011.

### NOT in this phase

- The hook that runs the layout (Phase 1)
- The server function that persists positions (Phase 2)
- Wiring the button click to the actual layout computation (Phase 4)
- Toast notifications (Phase 4)

### Tasks

#### Wave 1 (no intra-phase dependencies)

**Task 3.1 — Add Auto Layout button to `src/components/whiteboard/Toolbar.tsx`**

Add props to `ToolbarProps`:
```ts
tableCount: number           // total tables in whiteboard (for disable guard)
onAutoLayoutClick?: () => void | Promise<void>
isAutoLayoutRunning?: boolean
```

Remove the existing `onAutoLayout`, `isAutoLayoutLoading`, `autoLayoutEnabled`, and `onAutoLayoutEnabledChange` props — those drove the old ELK preference toggle; they are replaced by the explicit `onAutoLayoutClick` / `isAutoLayoutRunning` props.

Button behaviour:
- Disabled when `tableCount < 2`; tooltip: "Add at least 2 tables to use Auto Layout"
- Disabled when `isAutoLayoutRunning === true`; shows spinner (shadcn `Button` with `disabled` + Lucide `Loader2` spinning icon or equivalent SVG)
- Label: "Auto Layout" with a tooltip "Automatically arrange tables based on FK relationships. Layout cannot be cancelled once started." when `tableCount > 50`; otherwise "Automatically arrange tables based on FK relationships."
- On click: calls `onAutoLayoutClick?.()` — Phase 4 decides whether to show the dialog (> 50 tables) or run immediately

Remove the existing "Auto-arrange new tables" Switch toggle from the toolbar (it controlled the old auto-layout preference and is replaced by the explicit button).

Target file: `src/components/whiteboard/Toolbar.tsx`
Effort: S (1–2h)
Verify: `bun run test -- --testPathPattern=Toolbar` passes; visual check: button visible in toolbar, disabled when < 2 tables

**Task 3.2 — Create `src/components/whiteboard/AutoLayoutConfirmDialog.tsx`**

A standalone dialog for the > 50 table pre-run warning. Must satisfy all FR-011 accessibility requirements:

Props:
```ts
interface AutoLayoutConfirmDialogProps {
  open: boolean
  tableCount: number
  onConfirm: () => void
  onCancel: () => void
}
```

Requirements:
- Use shadcn `Dialog` primitive but override `role` to `alertdialog` via `DialogContent` props (shadcn's `Dialog` uses `role="dialog"` by default; set `role="alertdialog"` explicitly on the content element)
- `aria-labelledby` pointing to dialog title element ID
- `aria-describedby` pointing to description paragraph ID
- Focus trap is provided by shadcn's `Dialog` (Radix UI) — verify it is active
- Initial focus: manually move focus to the "Run Layout" button on open (use `autoFocus` on the Run Layout button or a `useEffect` with a ref)
- Esc key: shadcn Dialog already calls `onOpenChange(false)` on Esc; wire `onCancel` to `onOpenChange`
- On dialog close (Cancel, Esc, or Run Layout): return focus to the toolbar Auto Layout button — pass a `triggerRef` prop or use the `onOpenChange` pattern to re-focus the trigger

Dialog content:
- Title: "Apply Auto Layout?"
- Body: "This whiteboard has {tableCount} tables. Auto Layout may take several seconds and cannot be cancelled once started. Existing positions will be overwritten. Continue?"
- Buttons: "Cancel" (outline) and "Run Layout" (default/primary)

Target file: `src/components/whiteboard/AutoLayoutConfirmDialog.tsx`
Effort: M (2–3h)
Verify: `bun run test -- --testPathPattern=AutoLayoutConfirmDialog` passes a11y assertions; manual keyboard check: Tab cycles only between Cancel and Run Layout; Esc closes; screen reader announces title on open

**Task 3.3 — Unit tests for Toolbar Auto Layout button**

Add to / update `src/components/whiteboard/Toolbar.test.tsx`:
- Button is visible with label "Auto Layout"
- Button is disabled when `tableCount < 2`
- Button is disabled when `isAutoLayoutRunning === true` and shows loading indicator
- Button calls `onAutoLayoutClick` when clicked with `tableCount >= 2`

Target file: `src/components/whiteboard/Toolbar.test.tsx`
Effort: S (1h)
Verify: `bun run test -- --testPathPattern=Toolbar` all passing

#### Wave 2 (depends on Task 3.2)

**Task 3.4 — Unit tests for `AutoLayoutConfirmDialog`**

Create `src/components/whiteboard/AutoLayoutConfirmDialog.test.tsx`:
- Renders with `role="alertdialog"`
- `aria-labelledby` and `aria-describedby` attributes are present and point to valid elements
- "Run Layout" button has `autoFocus` or receives focus on open
- Clicking "Cancel" calls `onCancel`
- Pressing Esc calls `onCancel`
- Clicking "Run Layout" calls `onConfirm`
- Table count is displayed in the body text

Target file: `src/components/whiteboard/AutoLayoutConfirmDialog.test.tsx`
Effort: S (1–2h)
Verify: `bun run test -- --testPathPattern=AutoLayoutConfirmDialog` all passing

**Task 3.5 — Export `AutoLayoutConfirmDialog` from whiteboard component index (if one exists)**

If `src/components/whiteboard/index.ts` exists, add the export. Otherwise skip.

Target file: `src/components/whiteboard/index.ts` (if exists)
Effort: XS (5min)
Verify: `bunx tsc --noEmit`

### Technical Notes

- shadcn `alert-dialog.tsx` is already in `src/components/ui/` — consider whether to use it directly (`AlertDialog`, `AlertDialogContent`, etc.) which already sets `role="alertdialog"`. If so, `AutoLayoutConfirmDialog` can wrap these primitives instead of overriding `Dialog`. This is the recommended approach; Hephaestus should confirm in the tech spec.
- The old `autoLayoutEnabled` toggle (Switch) is removed from Toolbar — coordinate with Ares that callers (`ReactFlowWhiteboard.tsx`) must remove the prop too (handled in Phase 4).
- Tooltip for disabled button: use shadcn `Tooltip` wrapping the `Button`. A `disabled` button does not fire mouse events in all browsers; wrap in a `<span>` for tooltip targeting.

### Acceptance Criteria

- [ ] Auto Layout button visible in toolbar
- [ ] Button disabled (with tooltip) when `tableCount < 2`
- [ ] Button shows loading state when `isAutoLayoutRunning === true`
- [ ] Dialog shown only when `tableCount > 50`; layout runs immediately otherwise
- [ ] Dialog: `role="alertdialog"`, `aria-labelledby`, `aria-describedby` present
- [ ] Initial focus on "Run Layout" button
- [ ] Tab/Shift+Tab trapped within dialog
- [ ] Esc closes dialog and cancels (no layout runs)
- [ ] Focus returns to toolbar Auto Layout button on close
- [ ] `bun run test -- --testPathPattern=Toolbar|AutoLayoutConfirmDialog` passes

---

## Phase 4: Orchestration, Viewport Fit, and Error Handling

### Scope

Wire together all prior phases inside `ReactFlowWhiteboard.tsx`. This phase owns the full user-facing flow: button click → optional confirmation dialog → layout computation → optimistic position application → bulk persist call → viewport fit → success toast. It also owns all error-handling branches: layout error, persistence error with Retry, and the re-entry / loading-state guard.

### NOT in this phase

- The d3-force simulation itself (Phase 1)
- The server function implementation (Phase 2)
- The button and dialog JSX (Phase 3)

### Tasks

#### Wave 1 (all prior phases must be complete before any Phase 4 task)

**Task 4.1 — Add `table:move:bulk` collaboration listener in `src/hooks/use-whiteboard-collaboration.ts`**

Add a new `emitBulkPositionUpdate` function (for future direct socket use) and, more critically, register a `table:move:bulk` incoming event listener that:
- Receives `{ positions: Array<{ tableId, positionX, positionY }>, updatedBy }` from the server
- Calls a `onBulkPositionUpdate` callback prop (same pattern as existing per-table callbacks)
- Applies all positions in one `setNodes` call inside the callback — enforcing the "one render tick" contract

Extend return type of `useWhiteboardCollaboration`:
```ts
emitBulkPositionUpdate: (positions: Array<{ tableId: string; positionX: number; positionY: number }>) => void
```

And add a new hook option:
```ts
onBulkPositionUpdate?: (positions: Array<{ tableId: string; positionX: number; positionY: number }>) => void
```

Target file: `src/hooks/use-whiteboard-collaboration.ts`
Effort: S (1–2h)
Verify: `bun run test -- --testPathPattern=use-whiteboard-collaboration` passes; manually: two browser tabs → trigger layout in tab A → tab B applies all positions at once without piecewise updates

**Task 4.2 — Create `src/hooks/use-auto-layout-orchestrator.ts`**

The central hook that `ReactFlowWhiteboard.tsx` calls. Encapsulates:

1. State: `isRunning`, `persistError: Error | null`, `showConfirmDialog: boolean`
2. On `handleAutoLayoutClick`:
   - If `tableCount > 50`, set `showConfirmDialog = true` and return
   - Otherwise, call `runLayout` immediately (see step 3)
3. On `handleConfirm` (from dialog):
   - Hide dialog
   - Call `useD3ForceLayout().runLayout(nodes, edges)`
   - On success: call `setNodes` to apply new positions (optimistic), call `updateTablePositionsBulk`, call `fitView({ padding: 0.2 })`, show success toast ("Layout applied to N tables")
   - On layout error: do NOT call setNodes; show error toast "Auto Layout failed — please try again."; re-enable button
   - On persistence error: keep new positions in React Flow state (optimistic); set `persistError`; show error toast with Retry action
4. On `handleRetry`: re-invoke `updateTablePositionsBulk` with the same payload held in a ref; on success clear `persistError` and show success toast; on failure re-show error toast
5. Returns: `{ isRunning, showConfirmDialog, handleAutoLayoutClick, handleConfirm, handleCancel, persistError, handleRetry }`

Target file: `src/hooks/use-auto-layout-orchestrator.ts`
Effort: M (3–4h)
Verify: `bun run test -- --testPathPattern=use-auto-layout-orchestrator` — unit tests covering success, layout error, persist error + retry

#### Wave 2 (depends on Task 4.1 and 4.2)

**Task 4.3 — Wire orchestrator into `src/components/whiteboard/ReactFlowWhiteboard.tsx`**

- Replace the existing `useAutoLayout` (ELK) call with `useAutoLayoutOrchestrator`
- Pass `tableCount={nodes.length}` to `<Toolbar>`
- Pass `isAutoLayoutRunning={isRunning}` to `<Toolbar>`
- Pass `onAutoLayoutClick={handleAutoLayoutClick}` to `<Toolbar>`
- Render `<AutoLayoutConfirmDialog open={showConfirmDialog} tableCount={nodes.length} onConfirm={handleConfirm} onCancel={handleCancel} />`
- Register `onBulkPositionUpdate` in `useWhiteboardCollaboration` — apply received positions via a single `setNodes` call
- Remove the now-unused `autoLayoutEnabled` / `onAutoLayoutEnabledChange` / `onAutoLayout` / `isAutoLayoutLoading` props from `<Toolbar>`
- Do NOT remove the old `computeAutoLayout` server function import if it is used elsewhere; only remove it from ReactFlowWhiteboard if it was only used there

Target file: `src/components/whiteboard/ReactFlowWhiteboard.tsx`
Effort: M (2–3h)
Verify: `bun run test -- --testPathPattern=ReactFlowWhiteboard` passes; manual end-to-end: click Auto Layout on a 5-table whiteboard → tables rearrange + positions persist + fitView fires

**Task 4.4 — Integration and regression tests**

Add to / extend `src/components/whiteboard/ReactFlowWhiteboard.test.tsx`:
- Clicking Auto Layout with 2 tables: triggers layout, calls `updateTablePositionsBulk`, calls `fitView`
- Clicking Auto Layout with 1 table: button is disabled, no layout runs
- Clicking Auto Layout with 51 tables: dialog appears, clicking Cancel aborts, clicking Run Layout proceeds
- Persistence failure: toast appears with Retry button, positions remain visible locally
- Retry success: toast dismissed

Target file: `src/components/whiteboard/ReactFlowWhiteboard.test.tsx`
Effort: M (2–3h)
Verify: `bun run test -- --testPathPattern=ReactFlowWhiteboard` all passing

### Technical Notes

- `fitView` must be called after `setNodes` has caused a re-render; use `setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100)` matching the existing pattern in `use-auto-layout.ts`, or use a `useEffect` triggered by a "layout just applied" flag.
- Toast system: use `sonner` (already in `src/components/ui/sonner.tsx`). Success: `toast.success(...)`. Error with action: `toast.error('Auto Layout could not be saved...', { action: { label: 'Retry', onClick: handleRetry } })`.
- The `persistedPayloadRef` (a `useRef`) stores the last computed positions array so `handleRetry` can re-submit without recomputing the layout.
- Removing the old ELK auto-layout integration: `useAutoLayout` (ELK) is still imported in `ReactFlowWhiteboard.tsx` (line 50) and `extractPositionsForBatchUpdate` from `elk-layout.ts` (line 51). Remove these imports if they are only used in ReactFlowWhiteboard. Verify no other component imports them before removing.
- The `computeAutoLayout` server function at `src/lib/server-functions.ts` lines 204–259 is NOT called by this feature. Leave it in place (it may be used by other code paths); do not delete it.

### Acceptance Criteria

- [ ] Clicking Auto Layout on ≥ 2 tables runs layout, persists, and fits view
- [ ] Clicking Auto Layout on < 2 tables: button is disabled, no action
- [ ] Clicking Auto Layout on > 50 tables: confirmation dialog appears; Cancel aborts; Run Layout proceeds
- [ ] Collaborator tab receives `table:move:bulk` and applies all positions in one render tick
- [ ] Persistence failure shows error toast with Retry; local positions remain visible
- [ ] Retry re-calls `updateTablePositionsBulk` and clears the error on success
- [ ] Button remains disabled during layout run; re-enables after completion or failure
- [ ] `bun run test -- --testPathPattern=ReactFlowWhiteboard|use-auto-layout-orchestrator` all passing
- [ ] `bun run lint` passes (no new lint errors)
- [ ] `bunx tsc --noEmit` passes

---

## Cross-Cutting Concerns

### Error Handling Strategy

All error boundaries follow the same pattern established in the codebase:
- `console.error(...)` for server-side errors
- Sonner toast for client-facing errors
- Never throw to the React error boundary for recoverable user-action errors

### Performance Constraints

- No single synchronous call in the layout engine may take ≥ 16ms (longtask ≥ 200ms = violation)
- RAF tick loop must yield to the browser between batches of simulation ticks
- `setNodes` is called exactly once after the simulation completes — not during ticks
- `updateTablePositionsBulk` makes one DB round-trip (single `prisma.$transaction`) regardless of N

### Auth / Permissions

- Server function follows the existing `requireAuth` + project-level permission pattern (currently bypassed with TODO comments matching the codebase; maintain that pattern)
- IDOR guard is mandatory: verify all `tableId` values belong to the target `whiteboardId` before the transaction

### Accessibility

- All a11y requirements for the confirmation dialog are in Phase 3 and must be treated as P0
- Toolbar button disabled state must be communicated to screen readers via `aria-disabled` or native `disabled`

### Internationalisation

- All user-visible strings (button label, tooltip, dialog text, toast messages) are string literals for now — same approach as the existing codebase (no i18n library in use)

---

## Risks and Mitigations

| Risk | Phase | Mitigation |
|------|-------|------------|
| d3-force produces overlapping tables on dense graphs despite collision force | 1 | Deterministic post-pass in `computeD3ForceLayout` guarantees 16px L∞ gap; tested in Phase 1 unit tests |
| 100-table layout exceeds 2s budget | 1 | 500-tick hard cap + RAF chunking; benchmark in Phase 1 tests with 100-node fixture |
| `table:move:bulk` Socket.IO broadcast emitted from inside server function (cross-module dependency) | 2 | `getSocketIO()` is already exported from `collaboration.ts`; import path is clean |
| shadcn `Dialog` does not set `role="alertdialog"` | 3 | Use shadcn `alert-dialog` primitives (`AlertDialog`, `AlertDialogContent`) which already carry `role="alertdialog"`; fallback: override via HTML attribute |
| Focus management for dialog initial focus on "Run Layout" | 3 | `autoFocus` attribute on Run Layout button; test in `AutoLayoutConfirmDialog.test.tsx` |
| `fitView` fires before React Flow has measured new node sizes | 4 | 100ms `setTimeout` delay before `fitView` — matches existing pattern in `use-auto-layout.ts` |
| Two users clicking Auto Layout simultaneously | 4 | Last-write-wins per whiteboard at DB level; both transactions are atomic; second commit wins |

---

## Implementation Order Recommendation

The two recommended parallel streams:

**Stream A** (layout engine): Phase 1 tasks in wave order → Phase 3 after Phase 1 complete → Phase 4

**Stream B** (persistence): Phase 2 tasks in wave order → Phase 4 (unblocked once Phase 2 and Phase 3 done)

Minimum sequential path: Phase 1 → Phase 3 → Phase 4 (Phase 2 can complete in parallel with Phases 1–3).
