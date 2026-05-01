# Context — auto-layout

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Scope Boundary
Auto Layout adds a single "Auto Layout" button to the whiteboard toolbar. On click it runs a client-side d3-force simulation (FK edges as attractive links, repulsion + collision between all tables, 500-tick hard cap, RAF-chunked ticks), applies all resulting positions atomically to React Flow state, persists them via a new updateTablePositionsBulk server function (single prisma.$transaction), triggers a server-emitted table:move:bulk Socket.IO broadcast so collaborators converge in one render tick, and fits the viewport. The feature replaces the existing ELK-based auto-layout path in ReactFlowWhiteboard.tsx. No partial layout, no undo button, no animated transitions (P2), no user-tunable parameters, and no alternative layout algorithms ship in v1.
</domain>

<decisions>
## Implementation Decisions

### Socket.IO Broadcast Strategy
- Use emitToWhiteboard() — broadcast to all sockets including the sender.
- Client-side table:move:bulk listener must guard against re-applying positions the sender just set, using `updatedBy === currentUserId` check, matching the existing table:moved pattern.

### d3-force Simulation Tick Budget per RAF Frame
- Run 10 ticks per requestAnimationFrame frame (conservative budget).
- Estimated cost: ~2-5ms per chunk for 100 nodes, virtually no longtask risk.
- Hard cap remains at 500 ticks total; stop and apply whatever positions are reached.

### fitView Options After Layout Completes
- Call fitView({ padding: 0.2, duration: 300 }) after setTimeout(..., 100).
- This exactly matches the existing ELK pattern in use-auto-layout.ts lines 93-97 — do not deviate.

### Toolbar Prop Surgery
- Phase 3 clean rename + remove: delete onAutoLayout, isAutoLayoutLoading, autoLayoutEnabled, onAutoLayoutEnabledChange, and the Switch toggle from Toolbar.tsx.
- Add onAutoLayoutClick (callback) and isAutoLayoutRunning (boolean loading state).
- Update ReactFlowWhiteboard.tsx and all affected tests in Phase 4 to match.

### Themis's Discretion
- None — all four gray areas received explicit user decisions above.
</decisions>

<canonical_refs>
## Canonical References
- `src/components/whiteboard/ReactFlowWhiteboard.tsx` — Primary integration site; currently uses ELK useAutoLayout at line 992; Phase 4 replaces this with the new useAutoLayoutOrchestrator hook
- `src/components/whiteboard/Toolbar.tsx` — Toolbar component with existing auto-layout props to be replaced in Phase 3
- `src/lib/react-flow/use-auto-layout.ts` — Existing ELK hook; pattern to follow for fitView delay and hook structure; NOT used by the new feature
- `src/lib/react-flow/elk-layout.ts` — Node dimension reading pattern: `node.measured?.width ?? node.width ?? 250` / height: 150; reuse this fallback in the d3-force path
- `src/lib/server-functions.ts` — Existing updateTablePosition and computeAutoLayout patterns; append updateTablePositionsBulk after line 141
- `src/routes/api/collaboration.ts` — Socket.IO event handlers; defines emitToWhiteboard() and broadcastToWhiteboard() helpers; add table:move:bulk handler here
- `src/hooks/use-whiteboard-collaboration.ts` — Per-table table:moved listener pattern; new table:move:bulk listener follows the same structure
- `src/data/schema.ts` — Zod schema location; bulkUpdatePositionsSchema appended here; use z.string().uuid() for all ID fields
- `src/components/ui/alert-dialog.tsx` — AlertDialog primitives (Radix-based, already includes role="alertdialog") for the >50 tables pre-run confirmation dialog
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `emitToWhiteboard(whiteboardId, event, data)` from `src/routes/api/collaboration.ts` — use for the table:move:bulk broadcast
- AlertDialog primitives from `src/components/ui/alert-dialog.tsx` — use for the >50 tables pre-run warning dialog; already carries role="alertdialog", focus-trap, and aria attributes
- Zod patterns from `src/data/schema.ts` — use z.string().uuid() (never .cuid()) and z.number() for bulkUpdatePositionsSchema

### Established Patterns
- fitView({ padding: 0.2, duration: 300 }) after setTimeout(..., 100): use-auto-layout.ts lines 93-97
- toast.success() / toast.error() from 'sonner': settled toast pattern for all user-visible feedback
- prisma.$transaction([array of operations]): computeAutoLayout in server-functions.ts lines 241-251
- node.measured?.width ?? node.width ?? 250 (height: 150): elk-layout.ts lines 58-59
- requireAuth + getWhiteboardProjectId ownership check: server-functions.ts lines 91-93, 120-122
- table:moved listener guard using updatedBy === currentUserId: use-whiteboard-collaboration.ts

### Integration Points
- `src/components/whiteboard/ReactFlowWhiteboard.tsx` lines 50-51: Remove useAutoLayout (ELK) + extractPositionsForBatchUpdate imports; add useAutoLayoutOrchestrator
- `src/components/whiteboard/ReactFlowWhiteboard.tsx` line 992: Replace useAutoLayout call with useAutoLayoutOrchestrator
- `src/components/whiteboard/Toolbar.tsx`: Replace 4 existing auto-layout props (onAutoLayout, isAutoLayoutLoading, autoLayoutEnabled, onAutoLayoutEnabledChange) with 2 new ones (onAutoLayoutClick, isAutoLayoutRunning); remove Switch toggle
- `src/lib/server-functions.ts` (after line 141): Append updateTablePositionsBulk server function
- `src/routes/api/collaboration.ts`: Add socket.on('table:move:bulk', ...) handler
- `src/hooks/use-whiteboard-collaboration.ts`: Add on('table:move:bulk', ...) listener with updatedBy guard
</code_context>

<specifics>
## Specific Ideas
- The sender-guard on table:move:bulk must use `updatedBy === currentUserId` (not a timestamp or sequence check) — consistent with the existing table:moved pattern.
- The tick budget is explicitly 10 ticks per RAF frame (not 5, not 20) — this was the user's chosen conservative value.
- The fitView call must match exactly: padding: 0.2, duration: 300, wrapped in setTimeout(..., 100) — no experimentation with alternatives.
- Toolbar surgery is a clean removal (not deprecation): the four old props and the Switch toggle are deleted in Phase 3, tests updated in Phase 4.
</specifics>

<deferred>
## Deferred Ideas
- None captured — user answers stayed within the PRD's defined scope.
</deferred>
