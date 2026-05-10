# Decomposition: Column Reorder

**Feature**: column-reorder
**Author**: Daedalus (Decomposition Agent)
**Date**: 2026-04-30
**Status**: Complete
**Based on**: PRD Revision 1 (approved), Tech Spec v2 (sound), Test Plan v1

---

## Summary

| Property               | Value                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Total Phases           | 4                                                                                         |
| Total Tasks            | 22                                                                                        |
| Critical Path          | Phase 1 → Phase 2 → Phase 3 → Phase 4                                                     |
| Parallel Opportunities | Phase 1 waves run in parallel; Phase 2 Task 2.1 unblocks all Phase 3 tasks simultaneously |
| No DB Migration        | Column.order field already exists in schema                                               |

---

## Dependency Map

```
Phase 1 (Foundation)
  ├── 1.1 Install @dnd-kit packages          [Wave 1 — no deps]
  ├── 1.2 Add reorderColumnsSchema to schema.ts  [Wave 1 — no deps]
  ├── 1.3 Add reorderColumns() to column.ts   [Wave 1 — no deps]
  └── 1.4 Document WebSocket events           [Wave 1 — no deps]
        │
        ▼
Phase 2 (Server Layer)
  └── 2.1 Add column:reorder socket handler  [Wave 1 — needs 1.2 + 1.3]
        │
        ▼ (all Phase 3 tasks unblock simultaneously)
Phase 3 (Client Hooks)
  ├── 3.1 Create use-prefers-reduced-motion.ts  [Wave 1 — needs 1.1]
  ├── 3.2 Create use-column-reorder-mutations.ts  [Wave 1 — needs 1.1 + 2.1]
  └── 3.3 Create use-column-reorder-collaboration.ts  [Wave 1 — needs 3.2]
        │
        ▼ (all Phase 4 tasks unblock simultaneously)
Phase 4 (UI + Integration)
  ├── 4.1 Create DragHandle.tsx               [Wave 1 — needs 1.1]
  ├── 4.2 Create InsertionLine.tsx            [Wave 1 — no runtime deps]
  ├── 4.3 Modify ColumnRow.tsx                [Wave 2 — needs 4.1]
  ├── 4.4 Modify TableNode.new.tsx            [Wave 2 — needs 4.1 + 4.2 + 4.3 + 3.2]
  ├── 4.5 Modify ReactFlowWhiteboard.tsx      [Wave 3 — needs 4.4 + 3.2 + 3.3]
  └── 4.6 Write tests                         [Wave 3 — needs all prior tasks]
```

---

## Phase 1: Foundation (Data Layer + Dependencies)

**Goal**: Install the DnD library, add the batch Prisma function, add the Zod schema, and document the new WebSocket events. All of these are leaf-level tasks with no intra-feature dependencies. They unblock everything downstream.

### Scope (what IS in this phase)

- Install `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` via `bun add`
- Add `reorderColumnsSchema` to `src/data/schema.ts`
- Add `reorderColumns(tableId, orderedColumnIds[])` to `src/data/column.ts` (single Prisma `$transaction`)
- Add `findColumnsByTableId` helper to `src/data/column.ts` if not already present (needed by the socket handler for FM-07 merge)
- Document new WebSocket events in `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md`

### Boundaries (what is NOT in this phase)

- The socket handler lives in Phase 2 (it consumes Phase 1's exports)
- All frontend components live in Phases 3 and 4
- No DB migration — `Column.order` already exists

### Tasks

| #   | Task                                         | File                                                                  | Wave | Effort | Verify                                                                                                                                                                                 |
| --- | -------------------------------------------- | --------------------------------------------------------------------- | ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Install @dnd-kit packages                    | `package.json`                                                        | 1    | XS     | `bun pm ls \| grep @dnd-kit \| wc -l` should output `3`                                                                                                                                |
| 1.2 | Add `reorderColumnsSchema` to schema.ts      | `src/data/schema.ts`                                                  | 1    | XS     | `bun run tsc --noEmit` passes; `grep -n "reorderColumnsSchema" src/data/schema.ts` returns a match                                                                                     |
| 1.3 | Add `reorderColumns()` function to column.ts | `src/data/column.ts`                                                  | 1    | S      | `bun run tsc --noEmit` passes; `grep -n "reorderColumns" src/data/column.ts` returns a match                                                                                           |
| 1.4 | Document new WebSocket events                | `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md` | 1    | XS     | `grep -n "column:reorder" specs/001-collaborative-er-whiteboard/contracts/websocket-events.md` returns at least 3 matches (`column:reorder`, `column:reordered`, `column:reorder:ack`) |

**Technical Notes**:

- `reorderColumns` must call `prisma.column.findMany` first (sanity-check all IDs belong to `tableId`), then `prisma.$transaction([...updates])`. See tech-spec §2.2.1 for exact implementation.
- Zod schema: `z.object({ tableId: z.string().uuid(), orderedColumnIds: z.array(z.string().uuid()).min(1).max(500) })`. Must use `.uuid()` per project convention (never `.cuid()`).
- `@dnd-kit/modifiers` is a sub-package bundled with `@dnd-kit/core` — do not install separately.
- `findColumnsByTableId` may already exist in `src/data/column.ts`. Check before adding.

**Acceptance Criteria**:

- [ ] `bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities` completes without error
- [ ] `reorderColumnsSchema` is exported from `src/data/schema.ts` and includes `tableId` (UUID) and `orderedColumnIds` (UUID array, min 1, max 500)
- [ ] `reorderColumns(tableId, orderedColumnIds)` is exported from `src/data/column.ts`, wraps all updates in `prisma.$transaction`, and throws if any ID is not owned by `tableId`
- [ ] `bun run tsc --noEmit` passes with no new errors after Phase 1

---

## Phase 2: Server Layer (Socket.IO Handler)

**Goal**: Add the `column:reorder` socket handler with IDOR validation, FM-07 merge, transactional persistence, and broadcast. This is the single server-side task and is the gate for all client-side collaboration work.

### Dependencies

- Requires Phase 1 complete (needs `reorderColumnsSchema`, `reorderColumns`, `findColumnsByTableId`)

### Scope (what IS in this phase)

- Add `socket.on('column:reorder', ...)` handler inside `setupCollaborationEventHandlers` in `src/routes/api/collaboration.ts`
- Handler logic: session check → RBAC stub → Zod parse → IDOR check → fetch current columns → validate all client IDs belong to table → FM-07 merge (append missing by ascending `order`) → `reorderColumns()` → `socket.broadcast.emit('column:reordered', ...)` → `socket.emit('column:reorder:ack', ...)`
- Three error codes: `FORBIDDEN`, `VALIDATION_FAILED`, `UPDATE_FAILED`

### Boundaries (what is NOT in this phase)

- Frontend consumption of `column:reordered` and `column:reorder:ack` lives in Phase 3
- No new data-layer functions (all created in Phase 1)

### Tasks

| #   | Task                                | File                              | Wave | Effort | Verify                                                                                                                                           |
| --- | ----------------------------------- | --------------------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | Add `column:reorder` socket handler | `src/routes/api/collaboration.ts` | 1    | M      | `grep -n "column:reorder" src/routes/api/collaboration.ts` returns matches for both `socket.on` and `socket.emit`; `bun run tsc --noEmit` passes |

**Technical Notes**:

- Insert the handler after the `column:delete` handler (line ~727 in current code) to preserve logical grouping.
- `denyIfInsufficientPermission` is a no-op for V1 per PRD OQ-3 — wire it for forward-compatibility but add the SA-L1 comment explaining this.
- FM-07 merge: `currentColumns.filter(c => !seen.has(c.id)).sort((a, b) => a.order - b.order).map(c => c.id)` appended to client's ordered list.
- `socket.broadcast.emit('column:reordered', { tableId, orderedColumnIds: mergedOrderedIds, reorderedBy: userId })` — note `reorderedBy` field is required (consumed by REQ-14 on receiving clients).
- Separate `socket.emit('column:reorder:ack', { tableId, orderedColumnIds: mergedOrderedIds })` to originating socket — NOT via broadcast.
- See tech-spec §2.2.3 for the full handler implementation.

**Acceptance Criteria**:

- [ ] Handler fires on `column:reorder` event within the whiteboard namespace
- [ ] IDOR: handler emits `FORBIDDEN` when `tableId` belongs to a different whiteboard
- [ ] Validation: handler emits `VALIDATION_FAILED` when `orderedColumnIds` contains an unknown/duplicate ID or fails Zod
- [ ] FM-07: when client omits newly-added columns, handler appends them in ascending existing-`order` before persisting
- [ ] Persistence: `reorderColumns()` is called with the fully-merged list; no partial writes on failure
- [ ] Broadcast: `column:reordered` goes to all sockets in whiteboard namespace except sender
- [ ] Ack: `column:reorder:ack` goes only to sender with the merged+re-sequenced `orderedColumnIds`
- [ ] `bun run tsc --noEmit` passes

---

## Phase 3: Client Hooks

**Goal**: Build the three new React hooks that manage optimistic state, the FIFO queue, collaboration sync, and reduced-motion detection. These are pure logic — no UI rendering.

### Dependencies

- Requires Phase 1 complete (for `@dnd-kit` types and `reorderColumnsSchema` types)
- Requires Phase 2 complete (socket handler must exist for collaboration hook to target correct events)

### Scope (what IS in this phase)

- Create `src/hooks/use-prefers-reduced-motion.ts` — `window.matchMedia('(prefers-reduced-motion: reduce)')` once per drag start
- Create `src/hooks/use-column-reorder-mutations.ts` — optimistic state, FIFO queue (max 5), `reconcileAfterDrop` single entry-point, `detectOverwriteConflict` column-level check, `onColumnReorderAck` queue-depth-aware, `seedConfirmedOrderFromServer`, `onSyncReconcile`
- Create `src/hooks/use-column-reorder-collaboration.ts` — emits `column:reorder`, listens to `column:reordered` (buffers when dragging), routes `column:reorder:ack` and error events

### Boundaries (what is NOT in this phase)

- No React components, no JSX rendering
- `ReactFlowWhiteboard.tsx` wiring lives in Phase 4 (Task 4.5)
- Toast invocations live inside these hooks (using the existing `sonner` toast), but the actual shadcn Toast component is not added here

### Tasks

| #   | Task                                         | File                                            | Wave | Effort | Verify                                                                                                                                                                              |
| --- | -------------------------------------------- | ----------------------------------------------- | ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | Create `use-prefers-reduced-motion.ts`       | `src/hooks/use-prefers-reduced-motion.ts`       | 1    | XS     | `bun run tsc --noEmit` passes; `grep -n "matchMedia" src/hooks/use-prefers-reduced-motion.ts` returns a match                                                                       |
| 3.2 | Create `use-column-reorder-mutations.ts`     | `src/hooks/use-column-reorder-mutations.ts`     | 1    | L      | `bun run tsc --noEmit` passes; `grep -n "detectOverwriteConflict\|reconcileAfterDrop\|seedConfirmedOrderFromServer" src/hooks/use-column-reorder-mutations.ts \| wc -l` output >= 3 |
| 3.3 | Create `use-column-reorder-collaboration.ts` | `src/hooks/use-column-reorder-collaboration.ts` | 2    | M      | `bun run tsc --noEmit` passes; `grep -n "column:reorder:ack\|column:reordered" src/hooks/use-column-reorder-collaboration.ts \| wc -l` output >= 2                                  |

**Technical Notes for 3.2 (`use-column-reorder-mutations`)**:

- State: `queueByTable: Map<tableId, QueueEntry[]>` (max 5), `lastOptimisticByTable: Map<tableId, string[]>`, `lastConfirmedOrderByTable: Map<tableId, string[]>`, `dirtyByTable: Set<tableId>`, `bufferedRemoteByTable: Map<tableId, BufferedRemoteReorder>`, `localDraggingByTable: Set<tableId>`
- `isQueueFullForTable(tableId)`: returns `queue.length >= 5` — called at drag-start (SA-M3 gate)
- `reconcileAfterDrop({ tableId, preDragOrder, newOrder, emitColumnReorder, setNodes, bumpReorderTick })`: single entry-point for all post-drop paths (SA-H4). Checks no-op, runs `detectOverwriteConflict`, handles buffered remote on cancel/no-op (AC-14f)
- `detectOverwriteConflict(preDragOrder, localFinal, bufferedRemote)`: must be exportable as a pure function for test Suite S3. Returns `true` when at least one column appears in both A's moved-set and B's moved-set AND their final positions differ (SA-H2 column-level check, not positional array equality)
- `onColumnReorderAck`: defers `applyServerOrder` until queue depth reaches 0 (SA-H3 — prevents in-flight snap-back)
- `onColumnReorderAck` reverse-arrival: ack for #2 arriving before #1 must NOT corrupt state — use correlation via sequential enqueue IDs or simple queue-head matching
- `seedConfirmedOrderFromServer(tableId, serverOrder)`: idempotent — only sets baseline if not already present for that table (SA-H1)
- `onSyncReconcile(tableId, serverOrder)`: fires AC-08e toast only when `dirtyByTable.has(tableId)` AND `serverOrder !== lastOptimisticByTable.get(tableId)`
- `dirtyByTable` remains set after error rollback (UT-14 pins this behavior — do not clear on error)
- Toast text strings must exactly match PRD/test-plan: see test-plan Section 8

**Technical Notes for 3.3 (`use-column-reorder-collaboration`)**:

- Listens to `column:reordered`: if `localDraggingByTable.has(event.tableId)` → call `bufferRemoteReorder`, else call `onColumnReorderedFromOther` + `bumpReorderTick`
- Listens to `column:reorder:ack`: route to `mutations.onColumnReorderAck`
- Listens to error event with `event === 'column:reorder'`: route to `mutations.onColumnReorderError`
- `emitColumnReorder(tableId, orderedColumnIds)`: wraps `socket.emit('column:reorder', { tableId, orderedColumnIds })`
- Must handle `reorderedBy` being `undefined` gracefully (malformed server — no crash, no `undefined` in toast text)

**Acceptance Criteria**:

- [ ] `use-prefers-reduced-motion.ts` reads `window.matchMedia('(prefers-reduced-motion: reduce)')` and returns a boolean
- [ ] `detectOverwriteConflict` is exported as a standalone function (not just as a closure inside the hook)
- [ ] `reconcileAfterDrop` is the single drop entry-point — no other code path triggers reorder state changes on drop
- [ ] FIFO queue is bounded at 5; `isQueueFullForTable` correctly gates `handleDragStart` via the queue-full check (SA-M3)
- [ ] `onColumnReorderAck` at queue depth > 1 does NOT call `applyServerOrder` (SA-H3)
- [ ] `seedConfirmedOrderFromServer` is idempotent — calling it twice for the same table with different orders leaves the first-call value unchanged
- [ ] `column:reordered` buffered when `localDraggingByTable` is set; applied directly otherwise
- [ ] `bun run tsc --noEmit` passes

---

## Phase 4: UI Components + Integration

**Goal**: Build the two new presentational components, wire `useSortable` into `ColumnRow`, wrap `TableNode.new.tsx` with `DndContext`/`SortableContext`, connect everything in `ReactFlowWhiteboard.tsx`, and write all tests.

### Dependencies

- Requires Phase 1 complete (`@dnd-kit` packages installed)
- Requires Phase 2 complete (socket handler)
- Requires Phase 3 complete (hooks consumed by `TableNode` and `ReactFlowWhiteboard`)

### Scope (what IS in this phase)

- Create `src/components/whiteboard/column/DragHandle.tsx` — `GripVertical` icon + shadcn `Tooltip` + `nodrag nowheel` + `useSortable` activator ref
- Create `src/components/whiteboard/column/InsertionLine.tsx` — 2px horizontal accent-color line, absolutely-positioned, with hysteresis and instant-on for reduced-motion
- Modify `src/components/whiteboard/column/ColumnRow.tsx` — integrate `useSortable` transform/transition style, render `<DragHandle>`, add `nodrag nowheel` to prevent React Flow conflicts, set `opacity: 0.5` while dragging source row
- Modify `src/components/whiteboard/TableNode.new.tsx` — wrap column list in `DndContext` + `SortableContext`, add `<DragOverlay>` (ghost row at 80% opacity, 8/8px offset), add `<InsertionLine>`, wire `handleDragStart`/`handleDragEnd`/`handleDragCancel`, queue-full gate at `handleDragStart` (SA-M3), Escape handler, reduced-motion-aware sensors
- Modify `src/components/whiteboard/ReactFlowWhiteboard.tsx` — mount `useColumnReorderMutations` and `useColumnReorderCollaboration`, add `useLayoutEffect` watching `reorderTickByTable` to call `updateNodeInternals(tableId)` (SA-M1/Spike S2), call `seedConfirmedOrderFromServer` on initial whiteboard load, call `onSyncReconcile` after reconnect refetch (SA-H1)
- Write all tests: suites S1–S10 per test-plan (see test file locations in test-plan Section 11)

### Boundaries (what is NOT in this phase)

- No new Prisma schema changes
- No new socket events beyond what Phase 2 established
- REQ-11 keyboard reorder is explicitly out of V1 — no `KeyboardSensor`
- Touch/mobile drag is out of scope

### Tasks

| #    | Task                                                                 | File                                                                                                              | Wave | Effort | Verify                                                                                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | Create `DragHandle.tsx`                                              | `src/components/whiteboard/column/DragHandle.tsx`                                                                 | 1    | S      | `bun run tsc --noEmit` passes; `grep -n "nodrag nowheel\|setActivatorNodeRef\|GripVertical" src/components/whiteboard/column/DragHandle.tsx \| wc -l` output >= 3                                                                              |
| 4.2  | Create `InsertionLine.tsx`                                           | `src/components/whiteboard/column/InsertionLine.tsx`                                                              | 1    | S      | `bun run tsc --noEmit` passes; `grep -n "InsertionLine" src/components/whiteboard/column/InsertionLine.tsx` returns a match                                                                                                                    |
| 4.3  | Modify `ColumnRow.tsx` to integrate useSortable + DragHandle         | `src/components/whiteboard/column/ColumnRow.tsx`                                                                  | 2    | M      | `grep -n "useSortable\|DragHandle\|nodrag nowheel" src/components/whiteboard/column/ColumnRow.tsx \| wc -l` output >= 3; `bun run tsc --noEmit` passes                                                                                         |
| 4.4  | Modify `TableNode.new.tsx` to add DndContext + SortableContext       | `src/components/whiteboard/TableNode.new.tsx`                                                                     | 2    | L      | `grep -n "DndContext\|SortableContext\|DragOverlay\|InsertionLine\|handleDragEnd\|handleDragCancel" src/components/whiteboard/TableNode.new.tsx \| wc -l` output >= 6; `bun run tsc --noEmit` passes                                           |
| 4.5  | Modify `ReactFlowWhiteboard.tsx` to wire hooks + updateNodeInternals | `src/components/whiteboard/ReactFlowWhiteboard.tsx`                                                               | 3    | M      | `grep -n "useColumnReorderMutations\|useColumnReorderCollaboration\|useLayoutEffect\|updateNodeInternals\|seedConfirmedOrderFromServer" src/components/whiteboard/ReactFlowWhiteboard.tsx \| wc -l` output >= 5; `bun run tsc --noEmit` passes |
| 4.6  | Write test suite S1 (`reorderColumnsSchema`)                         | `src/data/schema.test.ts`                                                                                         | 3    | S      | `bun run test -- --testPathPattern=schema` passes with 6 new passing tests                                                                                                                                                                     |
| 4.7  | Write test suite S2 (`reorderColumns` data layer)                    | `src/data/column.test.ts`                                                                                         | 3    | S      | `bun run test -- --testPathPattern=column` passes with 5 new passing tests                                                                                                                                                                     |
| 4.8  | Write test suites S3 + S4 + S9 (mutations hook)                      | `src/hooks/use-column-reorder-mutations.test.ts`                                                                  | 3    | L      | `bun run test -- --testPathPattern=use-column-reorder-mutations` passes with 25 new passing tests (9+10+6)                                                                                                                                     |
| 4.9  | Write test suite S5 (socket handler)                                 | `src/routes/api/collaboration.test.ts`                                                                            | 3    | M      | `bun run test -- --testPathPattern=collaboration` passes with 12 new tests, no existing test regressions                                                                                                                                       |
| 4.10 | Write test suite S6 (drag behavior — TableNode)                      | `src/components/whiteboard/TableNode.test.tsx`                                                                    | 3    | M      | `bun run test -- --testPathPattern=TableNode` passes with 10 new passing tests                                                                                                                                                                 |
| 4.11 | Write test suites S7 + S8 (collaboration hook + edge re-anchor)      | `src/hooks/use-column-reorder-collaboration.test.ts` and `src/components/whiteboard/ReactFlowWhiteboard.test.tsx` | 3    | M      | `bun run test -- --testPathPattern=use-column-reorder-collaboration\|ReactFlowWhiteboard` passes with 10 new tests (6+4)                                                                                                                       |
| 4.12 | Write test fixtures                                                  | `src/test/fixtures.ts`                                                                                            | 3    | XS     | `grep -n "mockOrderedColumns\|mockTableNodeWithEdge" src/test/fixtures.ts \| wc -l` output >= 2                                                                                                                                                |

**Technical Notes for 4.1 (DragHandle)**:

- `className="nodrag nowheel column-drag-handle"` is mandatory — Spike S1 proves this is the correct React Flow suppression pattern
- `cursor: isDragging ? 'grabbing' : 'grab'` via inline style (or Tailwind `cursor-grab`/`cursor-grabbing`)
- shadcn `Tooltip` with `delayDuration={400}` for AC-12a; dismissed on `pointerdown` (mount/unmount or `open={!isDragging}`)
- `aria-label={`Reorder column ${columnName}`}` required (AC-01d)

**Technical Notes for 4.2 (InsertionLine)**:

- Absolutely-positioned `<div>` inside the column list container, 2px height, accent color
- Props: `visible: boolean`, `targetIndex: number`, `rowHeight: number`
- Position computed as `top: targetIndex * rowHeight` (or equivalent)
- When `prefersReducedMotion`, no CSS transition — position changes are instant (AC-13b)
- Hysteresis: the `targetIndex` value comes from the parent's drag-over logic; `InsertionLine` itself is purely presentational

**Technical Notes for 4.3 (ColumnRow modification)**:

- Existing `ColumnRow` has `nodrag nowheel` on Handles and delete button at lines 132, 139, 256, 284, 291 — confirmed by Spike S1 findings. Do not remove these.
- Add `useSortable({ id: column.id })` at top of component; apply `transform` and `transition` (CSS) from the hook to the row's root element. Use `CSS.Transform.toString(transform)` from `@dnd-kit/utilities`
- Set `opacity: 0.5` on the root element when `isDragging` (the source row); `opacity: 1` otherwise (AC-02a)
- Render `<DragHandle>` inside the row on its left edge, only when `showMode === 'ALL_FIELDS'` (AC-01f)
- Do not add `nodrag nowheel` to the entire row — only the DragHandle needs it (clicking on name/type must not start drag per AC-01e)

**Technical Notes for 4.4 (TableNode modification)**:

- `sensors` via `useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))` — no `KeyboardSensor` in V1
- Queue-full gate in `handleDragStart`: call `isQueueFullForTable(tableId)` FIRST; if full, show toast "Slow down — previous reorders still saving" and return without setting `activeId` (SA-M3)
- `preDragOrderRef.current` captured at drag-start (not during drag) for no-op detection and cancel revert
- `handleDragEnd` calls `reconcileAfterDrop` — this is the ONLY call site for that function
- `handleDragCancel` (Escape key): calls `reconcileAfterDrop` with `newOrder: null` (cancel path)
- `<DragOverlay>` renders a ghost `<ColumnRow>` with `opacity: 0.8` (AC-02b); use `modifiers={[restrictToVerticalAxis, restrictToParentElement]}`; respect `prefersReducedMotion` for `dropAnimation`
- Ghost offset: `snapCenterToCursor` modifier applies the 8/8px offset from cursor hotspot (AC-02c)
- `performance.mark('column-reorder:drop')` at the first line of `handleDragEnd` (before computing new order) per PRD Section 3

**Technical Notes for 4.5 (ReactFlowWhiteboard modification)**:

- `reorderTickByTable` state: `Record<tableId, number>` — incremented by both optimistic updates and incoming `column:reordered` events
- `useLayoutEffect(() => { Object.entries(reorderTickByTable).forEach(([tableId]) => updateNodeInternals(tableId)) }, [reorderTickByTable])` — must be `useLayoutEffect` NOT `useEffect` (SA-M1/Spike S2 finding; `useEffect` runs after paint and causes edge flicker)
- `seedConfirmedOrderFromServer(tableId, columns)` called for each table on initial whiteboard query result
- `onSyncReconcile(tableId, serverOrder)` called for each table after reconnect `sync:request` refetch completes
- Pass `bumpReorderTick` down to `TableNode` (or via context) so the hook can trigger `updateNodeInternals` from either optimistic update or remote event

**Technical Notes for tests**:

- `detectOverwriteConflict` must be a named export for Suite S3 pure-function tests
- All toast text assertions in suites S3, S4, S9 must use exact string matching (not `toContain` or partial) per test-plan Section 8
- REQ-15 assertion: every error toast test must also assert toast text does NOT contain "refresh"
- E2E suite S10 requires Playwright; if not set up, Ares should note each E2E test as deferred-to-manual-QA in a comment rather than skipping silently
- Shared fixtures go in `src/test/fixtures.ts`: `mockOrderedColumns` (5-element array) and `mockTableNodeWithEdge`

**Acceptance Criteria**:

- [ ] All 3 drag visual behaviors correct: dimmed source row (50% opacity, space preserved), ghost at 80% opacity + 8/8px offset, insertion line at midpoint-snap position (AC-02a, AC-02b, AC-02c, AC-02d)
- [ ] `nodrag nowheel` present on `DragHandle` button — React Flow canvas pan does not engage during column drag
- [ ] Escape key cancels drag: ghost disappears, columns return to pre-drag order, zero DB writes, zero WS events (AC-10a-c)
- [ ] Queue-full: 6th drag attempt at drag-start is blocked with toast; no ghost row visible (AC-08d, SA-M3)
- [ ] `updateNodeInternals(tableId)` called via `useLayoutEffect` after every local and remote reorder (Spike S2, AC-05d)
- [ ] `seedConfirmedOrderFromServer` called on initial whiteboard load per table; `onSyncReconcile` called after reconnect refetch (SA-H1)
- [ ] Drag handle hidden when `showMode !== 'ALL_FIELDS'` (AC-01f)
- [ ] `bun run test` passes all 58 unit + integration tests with no regressions in existing suites
- [ ] `bun run tsc --noEmit` passes

---

## Cross-Cutting Concerns

### Error Toasts

All toasts use the existing `sonner` toast library (no new toast UI). Exact text strings are load-bearing — see test-plan Section 8. None may include the word "refresh" (REQ-15 AC-15a).

| Trigger                         | Text                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| VALIDATION_FAILED / FORBIDDEN   | "Unable to reorder columns. Please try again."                                                                     |
| UPDATE_FAILED                   | "Unable to save column order. Please try again."                                                                   |
| Overwrite notification (REQ-14) | "Another collaborator reordered columns while you were dragging. Your order was applied — theirs was overwritten." |
| Reconnect reconcile (AC-08e)    | "Your last column reorder may not have saved. Please verify the order and try again if needed."                    |
| Queue full (AC-08d)             | "Slow down — previous reorders still saving"                                                                       |

### Reduced-Motion

`use-prefers-reduced-motion.ts` is the single source of truth. Consumed by:

- `TableNode.new.tsx` — controls `DragOverlay` `dropAnimation` and sensor easing
- `InsertionLine.tsx` — controls CSS transition on position change
- Auto-scroll velocity: 300 px/s when reduced-motion, 600 px/s otherwise (per REQ-09 AC-09a/AC-09d)

### IDOR / Security

The socket handler's IDOR check mirrors the existing `column:update` pattern at `collaboration.ts:625-644`. Any future RBAC restoration should update all `column:*` handlers in a single pass — the V1 `denyIfInsufficientPermission` stub is intentionally a no-op per PRD OQ-3.

### Performance Marks

Per PRD Section 3 measurement methodology — these must be placed exactly:

- `performance.mark('column-reorder:drop')` — first line of `handleDragEnd`, before any computation
- `performance.mark('column-reorder:local-paint')` — inside `requestAnimationFrame` callback after DOM read confirms new order
- `performance.mark('column-reorder:remote-paint')` — on remote client, in rAF after `column:reordered` handler confirms new DOM order

---

## Risk Register

| Risk                                                                                                            | Phase | Likelihood | Impact | Mitigation                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ----- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useLayoutEffect` fires before React Flow internal layout is ready, causing `updateNodeInternals` to be a no-op | 4     | Low        | High   | Spike S2 confirmed `useLayoutEffect` is correct timing. If edges still lag, add a fallback 0ms `setTimeout` inside the `useLayoutEffect` body.                                   |
| `@dnd-kit` `PointerSensor` conflicts with React Flow on non-standard input (trackpad momentum, stylus)          | 4     | Low        | Medium | Spike S1 confirmed the `nodrag nowheel` pattern suppresses React Flow. If edge cases emerge, increase `distance` activation constraint from 4 to 8.                              |
| `detectOverwriteConflict` false positives (fires toast when no real conflict)                                   | 3     | Medium     | Low    | Suite S3 covers 9 boundary cases. If false positives appear in testing, adjust the column-level intersection check (not the positional array equality).                          |
| FM-07 merge produces non-deterministic order when multiple columns have the same existing `order` value         | 2     | Low        | Medium | Sort by `(order, id)` as a tiebreaker if `order` values are not unique (can happen if the add-column path ever assigns duplicate `order` values).                                |
| `dirtyByTable` remaining set after error rollback causes a redundant reconcile toast                            | 3     | Medium     | Low    | Documented and pinned in UT-14 (test-plan §6.1). This is expected V1 behavior per current spec; if judged too noisy, clear `dirtyByTable` on error and update UT-14 consciously. |
| Zod `.uuid()` vs `.cuid()` — project has historical `.cuid()` usage that caused bugs                            | 1     | Low        | Medium | `reorderColumnsSchema` must use `.uuid()` for all ID fields per project convention. Ares must verify this before merging.                                                        |

---

## Implementation Order (Recommended for Ares)

1. **Phase 1** — All four tasks can run in one session (all Wave 1, no dependencies). Commit as "feat(column-reorder): foundation — @dnd-kit packages, reorderColumns data layer, Zod schema".
2. **Phase 2** — Single task. Commit as "feat(column-reorder): server — column:reorder socket handler with FM-07 merge".
3. **Phase 3** — Tasks 3.1 and 3.2 can run in parallel (Wave 1). Task 3.3 follows (Wave 2). Commit hooks together as "feat(column-reorder): hooks — mutations, collaboration, reduced-motion".
4. **Phase 4** — Tasks 4.1 and 4.2 in parallel (Wave 1), then 4.3 and 4.4 in parallel (Wave 2), then 4.5 + all test tasks (Wave 3). Commit UI as "feat(column-reorder): UI — DragHandle, InsertionLine, ColumnRow, TableNode, ReactFlowWhiteboard integration" and tests separately as "test(column-reorder): add unit + integration tests".

---

## Effort Summary

| Phase                     | Tasks  | Effort                                        |
| ------------------------- | ------ | --------------------------------------------- |
| Phase 1: Foundation       | 4      | 3 × XS + 1 × S = ~3h                          |
| Phase 2: Server Layer     | 1      | 1 × M = ~2h                                   |
| Phase 3: Client Hooks     | 3      | 1 × XS + 1 × L + 1 × M = ~5h                  |
| Phase 4: UI + Integration | 14     | 2 × S + 2 × M + 2 × L + 5 × M + 1 × XS = ~14h |
| **Total**                 | **22** | **~24h**                                      |

Effort key: XS = ~30min, S = ~1h, M = ~2h, L = ~4h
