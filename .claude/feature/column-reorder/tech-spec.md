# Tech Spec: Column Reorder

**Feature**: column-reorder
**Author**: Hephaestus (Tech Spec Agent)
**Date**: 2026-04-30
**Status**: Draft (v2 — revised after Apollo SA review Round 1)
**Based on PRD**: `prd.md` (Revision 1, approved 2026-04-30)
**Decomposition**: not produced (skipped); phases organized below by natural module boundaries

## Revision History

- **v1 (2026-04-30)**: Initial draft.
- **v2 (2026-04-30, this revision)**: Round 1 revisions in response to `spec-review-sa.md` (Apollo, "Concerns" verdict). Changes:
  - **SA-H1 fixed**: `lastConfirmedOrder` is now seeded from the server's current column order on whiteboard load (initial query and reconnect refetch), not on first ack. This guarantees a baseline exists for the AC-08e/f comparison even when the user's first-ever reorder is the one that gets lost. See §2.4.1 (init), §2.4.6.
  - **SA-H2 fixed**: REQ-14 overwrite detection replaced with column-level intersection check (per AC-14e). The toast fires only when the buffered remote and local-pre-drag orders move at least one common column to differing positions. Pure positional `arraysEqual` removed. See §2.4.2.
  - **SA-H3 fixed**: `applyServerOrder` is no longer called on `column:reorder:ack` when the FIFO queue still has pending items. The ack path only pops queue head + updates `lastConfirmedOrder`. The cumulative server-merged state is delivered by the next broadcast / final ack when the queue drains. See §2.4.3.
  - **SA-H4 fixed**: Defined an explicit post-drop reconciliation path. Every `handleDragEnd` (no-op or not) now runs through `reconcileAfterDrop`: clears `localDraggingByTable`, applies the buffered remote order on no-op drop, runs the SA-H2 overwrite check on real drop. See §2.3.5, §2.4.2.
  - **SA-M1 fixed**: `useEffect` for `updateNodeInternals` upgraded to `useLayoutEffect`. R#1 in §6 moved to a resolved decision in §5.
  - **SA-M2 fixed**: Test-plan requirement added in §3 Phase 4 for `column:reorder:ack` vs. `column:reordered` ordering at queue depth ≥ 2.
  - **SA-M3 fixed**: Queue-full guard moved from `reorderColumns` (drag-end) to `handleDragStart`. The 6th drag never starts. See §2.3.5, §2.4.2.
  - **SA-L1**: Added explicit note about `denyIfInsufficientPermission` being a no-op for V1 per OQ-3 decision.
  - **SA-L2**: Added Phase 1 task for documenting the new WebSocket events in `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md`.

---

## 0. Pre-Spec Spike Findings

The PRD (Section 13) made two spikes mandatory before this spec could be written. Both were resolved by codebase inspection rather than throw-away PoC code, because the existing codebase already exercises the relevant primitives. Findings are recorded here so downstream readers (Apollo, Artemis, Ares) understand the risk basis for the architectural choices below.

### Spike S1 — React Flow Pointer Suppression (PASS)

**Question**: Can React Flow's pointer-event handling be locally suppressed so that pointer-down on a column drag handle starts a column reorder drag without triggering React Flow's `onNodeDragStart` or canvas-pan?

**Method**: Codebase inspection of how the existing inline editing, delete buttons, and Handle anchors coexist with React Flow node-drag.

**Findings**:

- React Flow respects two CSS class names on descendant DOM nodes: `nodrag` (suppresses node-drag on pointerdown) and `nowheel` (suppresses canvas wheel/pan on the element). This is documented behavior of `@xyflow/react`.
- The pattern is already established in 9+ locations in this codebase:
  - `src/components/whiteboard/TableNode.new.tsx:284` — header delete button (`nodrag nowheel`)
  - `src/components/whiteboard/column/ColumnRow.tsx:132,139,256,284,291` — left/right Handles and delete button
  - `src/components/whiteboard/RelationshipEdge.new.tsx:492,555,607` — edge UI
  - `src/components/whiteboard/column/ColumnNotePopover.tsx:58`
  - `src/components/whiteboard/column/ConstraintBadges.tsx:131`
  - `src/components/whiteboard/column/InlineNameEditor.tsx:69`
  - `src/components/whiteboard/column/DataTypeSelector.tsx:78,86`
- The pattern is exercised by sustained pointer interactions (popover drags, select dropdowns, inline editors), not just transient clicks — invalidating the PRD's Assumption A4 caveat that "inline-edit's click is weaker than a sustained pointer-down".
- `@dnd-kit/core`'s `PointerSensor` uses standard `pointerdown` / `pointermove` / `pointerup` events with no global capture phase. As long as the drag handle DOM element carries `nodrag nowheel`, React Flow's `onNodeMouseDown` listener will short-circuit and the dnd-kit sensor receives the gesture exclusively.

**Decision**: Use **`@dnd-kit/core` + `@dnd-kit/sortable`** (`@dnd-kit/utilities` for transforms). Wrap the drag handle DOM element with `className="nodrag nowheel"`. No custom sensor or activation constraint is required for the React Flow conflict (we DO use a small `distance: 4` activation constraint independently — see §2.3.2 — to disambiguate intentional drags from clicks, which is best practice for `@dnd-kit` regardless).

**Outcome**: PASS. Library choice locked.

### Spike S2 — Edge Re-Anchor Behavior (REQUIRES EXPLICIT `updateNodeInternals`)

**Question**: When a column row's DOM position changes within a React Flow node, do edges attached to that column's handle re-anchor automatically?

**Method**: Inspection of handle ID architecture and how React Flow caches handle positions.

**Findings**:

- Handle IDs are constructed in `src/lib/react-flow/edge-routing.ts:27-34` using the format `${tableId}__${columnId}__${side}__${type}`. **The columnId is stable across reorder; only the row's vertical DOM position changes.** Therefore handle ID identity is preserved — no edges break or re-route to a different column.
- `parseColumnHandleId` (same file, line 42) is the inverse — also depends only on stable IDs.
- React Flow caches handle screen positions in its internal store at node mount/measure time. When the inner DOM of a node mutates without React Flow being informed, edges visually lag at the cached old positions until the next measure tick.
- The codebase has **zero current usage** of `updateNodeInternals` / `useUpdateNodeInternals` (verified via `rg`). The existing user memory note `feedback_reactflow_handles.md` ("Handle ID architecture is fragile, column-level handles required") documents that handle stability is load-bearing — supporting the choice to not change handle IDs on reorder.
- The columns are rendered inside the node's children DOM tree (`ColumnRow` within `TableNode.new.tsx:306-321`), inside a div that React Flow does not directly observe for layout changes. Therefore an explicit `updateNodeInternals(tableId)` is required to force React Flow to re-measure the table node's handle positions after the columns array re-orders.

**Decision**: Call `updateNodeInternals(tableId)` from a `useLayoutEffect` in the relevant React tree, fired after the columns array's reordered identity changes. Specifically:

- The optimistic local reorder (in `useColumnReorderMutations`) calls `setNodes` with the new column order.
- A `useLayoutEffect` in `ReactFlowWhiteboard` (or a small dedicated child hook) watches a "reorder tick" counter (`reorderTickByTable: Record<tableId, number>`) and calls `updateNodeInternals(tableId)` whenever a reorder happens for that table — both on local optimistic updates AND on incoming `column:reordered` events.
- Timing: `useLayoutEffect` runs synchronously after DOM mutation but **before browser paint**. This is the only React hook that guarantees AC-05d's "same render pass, no flicker" semantics. `useEffect` runs after paint and is therefore unsuitable here. (Apollo's SA-M1 finding.)

**Outcome**: PASS, with explicit `updateNodeInternals` integration via `useLayoutEffect`. Documented in §2.4.4 (Edge Re-Anchor Mechanism).

---

## 1. Architecture Overview

### 1.1 Component Topology

```
┌────────────────────────────────────────────────────────────────────┐
│  ReactFlowWhiteboard (existing, modified)                          │
│  ├── ReactFlowProvider                                             │
│  │   └── ReactFlowCanvas                                           │
│  │       └── TableNode (existing, modified)                        │
│  │           └── ColumnReorderProvider (NEW)                       │
│  │               └── DndContext (NEW, @dnd-kit)                    │
│  │                   └── SortableContext (NEW, @dnd-kit/sortable)  │
│  │                       └── ColumnRow (existing, modified)        │
│  │                           └── DragHandle (NEW, lucide GripVertical) │
│  │                       └── DragOverlay (NEW — ghost row)         │
│  │                       └── InsertionLine (NEW)                   │
│  │                                                                  │
│  ├── useColumnReorderCollaboration (NEW)                           │
│  │   ↳ emits/receives column:reorder / column:reordered            │
│  │                                                                  │
│  ├── useColumnReorderMutations (NEW)                               │
│  │   ↳ optimistic state, FIFO queue (max 5), buffered-remote diff,  │
│  │     overwrite-notification toast (REQ-14), reconcile-on-sync     │
│  │     toast (REQ-08 AC-08e)                                        │
│  │                                                                  │
│  └── useLayoutEffect → updateNodeInternals(tableId) on each       │
│      reorder tick (local + remote) — Spike S2 mechanism             │
└────────────────────────────────────────────────────────────────────┘
                                │
                                │ Socket.IO whiteboard namespace
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Server: src/routes/api/collaboration.ts (existing, modified)      │
│  └── socket.on('column:reorder', ...) (NEW)                        │
│      ├── Zod validate { tableId, orderedColumnIds[] }               │
│      ├── IDOR: tableId.whiteboardId === namespace whiteboardId      │
│      ├── Fetch all columns currently in the table                   │
│      ├── Validate orderedColumnIds is a strict subset of table cols │
│      ├── Merge missing columns (FM-07): append by existing.order asc │
│      ├── Re-sequence merged list to 0..N-1                          │
│      ├── Persist via reorderColumns(tableId, mergedOrder) in        │
│      │   single Prisma transaction (REQ-03)                         │
│      └── Broadcast column:reordered to namespace (excl. sender)     │
│                                                                      │
│  src/data/column.ts (existing, modified)                           │
│  └── reorderColumns(tableId, orderedColumnIds[]) (NEW)             │
│      ↳ wraps prisma.$transaction([col.update, col.update, ...])    │
└────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow (Drag Drop, Happy Path)

```
1. user pointer-down on drag handle
   ↓ (nodrag nowheel — React Flow ignores it)
2. @dnd-kit PointerSensor activates after 4px movement (distance constraint)
   ↓
3. DndContext sets activeId; SortableContext computes overId on pointermove
   ↓
4. <DragOverlay> renders a copy of the ColumnRow at cursor + (8,8); InsertionLine
   absolutely-positioned at the gap between rows[overIndex-1] and rows[overIndex]
   (or above row 0 / below last row)
   ↓
5. user pointer-up (drop)
   ↓ performance.mark('column-reorder:drop')
6. Compute newOrderedIds from onDragEnd's { active.id, over.id, oldIndex, newIndex }
   ↓
7. If newOrderedIds equals preDragOrderedIds → no-op: zero writes, zero emits, zero toasts (REQ-06)
   ↓
8. Otherwise: optimistic state update in setNodes
   ↓
9. requestAnimationFrame → performance.mark('column-reorder:local-paint')
   ↓
10. emit('column:reorder', { tableId, orderedColumnIds }) via Socket.IO
    ↓ (queued in mutations FIFO; max 5 in-flight)
11. server validates, transacts, broadcasts column:reordered
    ↓
12. local client receives column:reordered with own userId — pops the head of FIFO
    ↓
13. remote client receives column:reordered with foreign userId
    ↓ (if remote client is mid-drag on same tableId → buffer instead)
14. remote setNodes → reorder array → updateNodeInternals(tableId)
    ↓ requestAnimationFrame → performance.mark('column-reorder:remote-paint')
```

### 1.3 New / Modified Modules at a Glance

| File                                                 | Status | Purpose                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data/column.ts`                                 | MODIFY | Add `reorderColumns(tableId, orderedColumnIds[])` — single Prisma transaction batch update.                                                                                                                                                                                                                          |
| `src/data/schema.ts`                                 | MODIFY | Add `reorderColumnsSchema` Zod schema.                                                                                                                                                                                                                                                                               |
| `src/routes/api/collaboration.ts`                    | MODIFY | Add `socket.on('column:reorder', ...)` handler with IDOR + FM-07 merge.                                                                                                                                                                                                                                              |
| `src/hooks/use-column-reorder-mutations.ts`          | CREATE | Optimistic state, FIFO queue (≤5, drag-start gate per SA-M3), `reconcileAfterDrop` single drop entry-point (SA-H4), `detectOverwriteConflict` column-level overwrite check (SA-H2), `onColumnReorderAck` queue-depth-aware (SA-H3), `seedConfirmedOrderFromServer` + `onSyncReconcile` (SA-H1) for AC-08e/f.         |
| `src/hooks/use-column-reorder-collaboration.ts`      | CREATE | Emits `column:reorder`; listens to `column:reordered`, buffers when local drag active, surfaces errors.                                                                                                                                                                                                              |
| `src/components/whiteboard/column/ColumnRow.tsx`     | MODIFY | Add `useSortable` wiring; render drag handle (`GripVertical`) with `nodrag nowheel`; expose `aria-label`; tooltip via existing shadcn `Tooltip`.                                                                                                                                                                     |
| `src/components/whiteboard/TableNode.new.tsx`        | MODIFY | Wrap visible column list in `DndContext` + `SortableContext`; render `<DragOverlay>` (ghost row) and `<InsertionLine>`; cancel on Escape; respect `prefers-reduced-motion`.                                                                                                                                          |
| `src/components/whiteboard/column/InsertionLine.tsx` | CREATE | Tiny presentational component for the 2px accent-color drop indicator with hysteresis logic.                                                                                                                                                                                                                         |
| `src/components/whiteboard/column/DragHandle.tsx`    | CREATE | Drag handle button: `GripVertical` icon + tooltip + `nodrag nowheel` + sortable listeners.                                                                                                                                                                                                                           |
| `src/components/whiteboard/ReactFlowWhiteboard.tsx`  | MODIFY | Wire `useColumnReorderMutations` + `useColumnReorderCollaboration`; pass mutations API down to `TableNode` data; trigger `updateNodeInternals` per reorder tick via `useLayoutEffect` (SA-M1); call `seedConfirmedOrderFromServer` on initial whiteboard load and `onSyncReconcile` after reconnect refetch (SA-H1). |
| `package.json`                                       | MODIFY | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (peer-dependency-only of sortable).                                                                                                                                                                                                                   |

### 1.4 Dependencies Added

```json
{
  "@dnd-kit/core": "^6.3.1",
  "@dnd-kit/sortable": "^10.0.0",
  "@dnd-kit/utilities": "^3.2.2"
}
```

Install with `bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities` (per project's mandatory bun rule in CLAUDE.md). All three are pure-behavior libraries with no UI surface, satisfying the "shadcn + Tailwind only for UI" constraint.

---

## 2. Detailed Design

### 2.1 Database

**No schema changes.** The `Column.order Int @default(0)` field and `@@index([order])` already exist in `prisma/schema.prisma:163,173`. No migration is needed.

#### 2.1.1 Order Re-Sequencing Strategy

Per AC-03e, the PRD does not mandate sparse vs. sequential ordering. **Decision: re-sequence to `0..N-1` on every reorder transaction.**

**Why**: Simpler invariants for the receiver (the broadcast carries `orderedColumnIds[]`, the local map from id→index IS the order). Sparse spacing (1000-step gaps) optimizes for inserts in the middle, but the existing `AddColumnRow` (`src/components/whiteboard/column/AddColumnRow.tsx:99-102`) already always appends at `Math.max(...orders) + 1`, never inserts in the middle. Therefore the optimization has no payoff and adds drift risk.

**Trade-off given up**: A future "drag a column FROM table A INTO table B" feature would benefit from sparse spacing. That feature is explicitly out-of-scope (PRD Section 6) and can re-introduce sparse spacing when needed without breaking this design (the receiver does not depend on values being sequential — it only sorts by `order asc`).

**Cost**: `N` updates per reorder transaction where `N` is the table's column count. PRD A9/OQ-5 sets the upper bound at 30 columns. A 30-row Prisma `$transaction` is well within Postgres latency budgets (single-digit ms typical).

### 2.2 Server (Socket.IO) Layer

#### 2.2.1 New Data-Layer Function: `reorderColumns`

File: `src/data/column.ts` — appended after `updateColumnOrder`.

```typescript
/**
 * Atomically reorder all columns in a table.
 * The `orderedColumnIds` array is the FULL ordered list — every column's `order`
 * is rewritten to its index in the array within a single Prisma transaction.
 *
 * Caller (Socket.IO handler) is responsible for:
 *   - validating that orderedColumnIds is a strict subset of the table's columns
 *   - appending any missing column IDs (FM-07 merge) before passing in
 *
 * @param tableId - the parent table UUID (used as a sanity check on every column)
 * @param orderedColumnIds - the COMPLETE ordered list of column IDs after merge
 * @returns the updated columns in their new order
 * @throws Error on transaction failure (caller maps to UPDATE_FAILED)
 */
export async function reorderColumns(
  tableId: string,
  orderedColumnIds: string[],
): Promise<Column[]> {
  if (orderedColumnIds.length === 0) {
    throw new Error('orderedColumnIds must not be empty')
  }
  // Sanity guard: ensure every ID belongs to the given tableId.
  // (Defense-in-depth; the socket handler also checks this, but a misuse
  // of this lower-level API should not silently corrupt unrelated tables.)
  const owned = await prisma.column.findMany({
    where: { id: { in: orderedColumnIds }, tableId },
    select: { id: true },
  })
  if (owned.length !== orderedColumnIds.length) {
    throw new Error('orderedColumnIds contains IDs not in this table')
  }

  return prisma.$transaction(
    orderedColumnIds.map((id, index) =>
      prisma.column.update({
        where: { id },
        data: { order: index },
      }),
    ),
  )
}
```

**Decision: per-row `prisma.column.update` inside `$transaction`** instead of a raw `UPDATE ... CASE WHEN ...` SQL.

- Why: keeps the Prisma type safety; integrates with existing patterns (`createColumns` in the same file uses identical shape, line 36-52). Performance is not a concern at N≤30.
- Trade-off: 30 round-trips inside the transaction vs. 1 SQL statement. The round-trips share one DB connection and one transaction, so the overhead is small (single-digit ms). If profiling later shows a bottleneck, swap to `$executeRaw` without changing the public API.

#### 2.2.2 Zod Schema

File: `src/data/schema.ts` — appended in the Column Schemas block.

```typescript
/**
 * Schema for batch reordering columns within a single table.
 * orderedColumnIds is the FULL ordered list of column IDs after the drop.
 */
export const reorderColumnsSchema = z.object({
  tableId: z.string().uuid(),
  orderedColumnIds: z.array(z.string().uuid()).min(1).max(500),
  // .max(500) is a sanity cap far above the PRD's 30-column responsiveness
  // target; protects against a malformed client sending a million-element array.
})
```

#### 2.2.3 Socket.IO Handler

File: `src/routes/api/collaboration.ts` — added inside `setupCollaborationEventHandlers` after `column:delete` (line 727).

```typescript
// ============================================================================
// Column reorder (REQ-03 / REQ-04 — transactional batch reorder)
// ============================================================================
socket.on(
  'column:reorder',
  async (data: { tableId: string; orderedColumnIds: string[] }) => {
    if (isSessionExpired(socket)) {
      socket.emit('session_expired')
      socket.disconnect(true)
      return
    }
    if (await denyIfInsufficientPermission(socket, whiteboardId)) return
    // NOTE (SA-L1): denyIfInsufficientPermission is intentionally a no-op for
    // V1 per PRD OQ-3 ("any whiteboard collaborator has full edit rights").
    // The check is wired here for forward-compatibility; when RBAC is restored,
    // this handler inherits the gate the same way the existing column:* handlers
    // do. See `src/routes/api/collaboration.ts:253-268`. Future work: re-enable
    // RBAC across all collaboration handlers in one pass.

    let parsed: ReturnType<typeof reorderColumnsSchema.parse> | undefined
    try {
      parsed = reorderColumnsSchema.parse(data)

      // IDOR check #1: table belongs to this whiteboard
      const ownerTable = await findDiagramTableById(parsed.tableId)
      if (!ownerTable || ownerTable.whiteboardId !== whiteboardId) {
        socket.emit('error', {
          event: 'column:reorder',
          error: 'FORBIDDEN',
          message: 'Table does not belong to this whiteboard',
          tableId: parsed.tableId,
        })
        return
      }

      // Fetch the table's current columns (ordered by existing `order` asc)
      const currentColumns = await findColumnsByTableId(parsed.tableId)
      const currentIdSet = new Set(currentColumns.map((c) => c.id))

      // IDOR check #2 + AC-03f: all client IDs must belong to this table.
      // Note: we tolerate MISSING ids (newly-created columns the client didn't see)
      // per FM-07. We do NOT tolerate UNKNOWN/foreign ids (security) or duplicates.
      const seen = new Set<string>()
      for (const id of parsed.orderedColumnIds) {
        if (!currentIdSet.has(id)) {
          socket.emit('error', {
            event: 'column:reorder',
            error: 'VALIDATION_FAILED',
            message: 'orderedColumnIds contains an unknown column',
            tableId: parsed.tableId,
          })
          return
        }
        if (seen.has(id)) {
          socket.emit('error', {
            event: 'column:reorder',
            error: 'VALIDATION_FAILED',
            message: 'orderedColumnIds contains duplicates',
            tableId: parsed.tableId,
          })
          return
        }
        seen.add(id)
      }

      // FM-07 merge: append any column NOT in client's orderedColumnIds,
      // sorted by ascending existing `order` (deterministic).
      const missing = currentColumns
        .filter((c) => !seen.has(c.id))
        .sort((a, b) => a.order - b.order)
        .map((c) => c.id)
      const mergedOrderedIds = [...parsed.orderedColumnIds, ...missing]

      // Persist atomically (REQ-03 transactional mandate)
      await reorderColumns(parsed.tableId, mergedOrderedIds)

      // Broadcast (NOT emit-back to sender — sender already applied optimistically)
      socket.broadcast.emit('column:reordered', {
        tableId: parsed.tableId,
        orderedColumnIds: mergedOrderedIds,
        reorderedBy: userId,
      })

      // Also send a confirmation back to the sender so it can pop the FIFO queue
      // and dismiss any "in-flight" indicator. Use a dedicated event name to
      // distinguish self-confirm from broadcast-from-others.
      socket.emit('column:reorder:ack', {
        tableId: parsed.tableId,
        orderedColumnIds: mergedOrderedIds,
      })
    } catch (error) {
      console.error('Failed to reorder columns:', error)
      socket.emit('error', {
        event: 'column:reorder',
        error:
          error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'UPDATE_FAILED',
        message:
          error instanceof Error ? error.message : 'Failed to reorder columns',
        tableId: parsed?.tableId,
      })
      return
    }
    await safeUpdateSessionActivity(socket.id)
  },
)
```

**Why a dedicated `column:reorder:ack` (sender-only) event?** The PRD's REQ-08 requires reverting on server failure. Without an explicit per-emit ack, the sender cannot tell "did my reorder commit?" — only "did some reorder broadcast arrive?". The ack lets the FIFO queue (§2.3.5) correctly resolve the head entry.

The `column:reordered` (broadcast) is sent to OTHER sockets via `socket.broadcast.emit`; the originating socket gets `column:reorder:ack` instead. This avoids the design wart of sending the same payload to the sender just to have them ignore it (the existing `column:create` handler emits the broadcast back to the sender too, but uses it to do temp-ID swapping — there's no equivalent need here).

**FM-07 merge order** is: client's order first, then missing columns appended in ascending existing-`order`. Then the whole list is re-sequenced to 0..N-1 by `reorderColumns`. This satisfies PRD FM-07 step 2 deterministically.

**Errors emitted to client**:

| Error code          | Trigger                              | Toast (per REQ-15)                                            |
| ------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `FORBIDDEN`         | IDOR (table not in whiteboard)       | "You don't have permission to reorder columns in this table." |
| `VALIDATION_FAILED` | Zod fail OR unknown ID OR duplicates | "Unable to reorder columns. Please try again."                |
| `UPDATE_FAILED`     | Prisma transaction error             | "Unable to save column order. Please try again."              |

### 2.3 Frontend — Drag Behavior (DnD-Kit)

#### 2.3.1 Sortable Strategy and Render Tree

Inside `TableNode.new.tsx`, the visible columns block (lines 304-330 in current code) is wrapped:

```tsx
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
  onDragCancel={handleDragCancel}
  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
>
  <SortableContext
    items={visibleColumns.map((c) => c.id)}
    strategy={verticalListSortingStrategy}
  >
    {visibleColumns.map((column, index) => (
      <ColumnRow key={column.id} ... />
    ))}
    {/* InsertionLine is rendered absolutely-positioned inside the columns block,
        outside of SortableContext children, so it doesn't affect collision detection */}
    <InsertionLine
      visible={isDragging && overId !== null}
      targetIndex={insertionIndex}
      rowHeight={rowHeight}
    />
    <AddColumnRow ... />
  </SortableContext>
  <DragOverlay
    dropAnimation={prefersReducedMotion ? null : defaultDropAnimation}
    modifiers={[snapCenterToCursor]}
  >
    {activeColumn ? (
      <ColumnRow column={activeColumn} ... isGhost />
    ) : null}
  </DragOverlay>
</DndContext>
```

**Why `closestCenter` collision detection**: with vertical-list rows of uniform height, `closestCenter` gives the midpoint-snap behavior PRD AC-02d requires (the cursor's Y crosses the row's vertical center → that row's index becomes the over-index).

**Why `restrictToVerticalAxis` + `restrictToParentElement` modifiers**: AC-02e requires drag to stay scoped to the source table. `restrictToParentElement` constrains the overlay to the table node's bounds; `restrictToVerticalAxis` keeps the ghost from drifting horizontally. (`@dnd-kit/modifiers` is a sub-package of `@dnd-kit/core`, no separate install.)

**Why `<DragOverlay>` rather than CSS-transform on the original row**: per AC-02a, the original row stays in the layout at 50% opacity. `<DragOverlay>` is `@dnd-kit`'s mechanism for rendering a separate, position-absolute, follows-cursor element while leaving the source DOM in place. Exactly the visual the PRD specifies.

#### 2.3.2 Sensors & Activation

```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  // No KeyboardSensor in V1 — REQ-11 is P2 stretch and explicitly deferred.
  // The architecture is open to adding KeyboardSensor + sortableKeyboardCoordinates
  // when REQ-11 is promoted, with no rework of the sortable wiring.
)
```

**`distance: 4`**: requires the user to move 4px before activating drag. This disambiguates "click" from "drag start" so single-clicks on the handle (e.g., for keyboard focus) don't kick off an accidental drag. Standard `@dnd-kit` recommendation for handle-initiated drags.

**Decision: no KeyboardSensor in V1.** PRD REQ-11 is P2 stretch with explicit WCAG debt logged. Adding `KeyboardSensor` + `sortableKeyboardCoordinates` later is a 5-line change that does not break any V1 contract. The existing `tabIndex={0}` on `ColumnRow` (line 109 of `ColumnRow.tsx`) remains intact for V2.

#### 2.3.3 Drag Handle Component

File: `src/components/whiteboard/column/DragHandle.tsx` (NEW)

```tsx
import { GripVertical } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useSortable } from '@dnd-kit/sortable'

interface DragHandleProps {
  columnId: string
  columnName: string
  isDragging: boolean
}

export function DragHandle({
  columnId,
  columnName,
  isDragging,
}: DragHandleProps) {
  const { attributes, listeners, setActivatorNodeRef } = useSortable({
    id: columnId,
  })

  // Tooltip dismissed during drag (AC-12d): the Tooltip is unmounted while isDragging
  // is true, by conditionally wrapping. open={undefined} during drag also works.
  const handle = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      aria-label={`Reorder column ${columnName}`}
      className="nodrag nowheel column-drag-handle"
      style={{
        cursor: isDragging ? 'grabbing' : 'grab',
        background: 'none',
        border: 'none',
        padding: '2px',
        flexShrink: 0,
        color: 'var(--rf-table-text)',
        opacity: 0.6,
        display: 'flex',
        alignItems: 'center',
      }}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  )

  // While dragging, no tooltip (AC-12d). Otherwise, wrap with Tooltip.
  if (isDragging) return handle
  return (
    <Tooltip>
      <TooltipTrigger asChild>{handle}</TooltipTrigger>
      <TooltipContent side="left">Drag to reorder</TooltipContent>
    </Tooltip>
  )
}
```

**Why `useSortable`'s `setActivatorNodeRef` instead of attaching listeners to the whole row**: the activator-ref API is `@dnd-kit`'s explicit way of saying "this DOM element is the drag initiator, the rest of the sortable item is not". This is exactly what AC-01e requires (only the handle initiates drag; double-click on name still works for inline edit).

**Why `nodrag nowheel`**: Spike S1 outcome — these classes prevent React Flow's canvas from intercepting the pointerdown.

**Tooltip behavior** (REQ-12):

- `aria-label="Reorder column [name]"` (AC-01d) on the button itself, screen-reader-announced regardless of tooltip visibility.
- shadcn `Tooltip` defaults to a 700ms delay; we override to 400ms via `<TooltipProvider delayDuration={400}>` at the table level (AC-12a).
- `aria-describedby` is automatically wired by Radix Tooltip when the tooltip is open (AC-12e).
- Tooltip is unmounted during drag (AC-12d) by the `if (isDragging) return handle` short-circuit.

#### 2.3.4 ColumnRow Modifications

`src/components/whiteboard/column/ColumnRow.tsx` — modified to integrate `useSortable` and render the drag handle.

```tsx
// inside ColumnRow
const {
  attributes, // unused — we attach to the handle via setActivatorNodeRef
  listeners: _listeners, // unused (handle owns them)
  setNodeRef, // attached to the row's outer div
  transform,
  transition,
  isDragging,
} = useSortable({ id: column.id })

// Style: only opacity / transform changes for the dragging state.
const style: React.CSSProperties = {
  // existing styles …
  opacity: isDragging ? 0.5 : 1, // AC-02a
  transform: CSS.Translate.toString(transform), // verticalListSortingStrategy gives Y-only translate
  transition: prefersReducedMotion ? undefined : transition,
}

return (
  <TooltipProvider delayDuration={400}>
    <div
      ref={setNodeRef}
      className={`column-row group${isEditing ? ' editing' : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={style}
    >
      <DragHandle
        columnId={column.id}
        columnName={column.name}
        isDragging={isDragging}
      />
      {/* existing: Handles, ConstraintBadges, name, dataType, note, delete, Handles */}
      …
    </div>
  </TooltipProvider>
)
```

**Why attach the row to `setNodeRef` even though the handle owns the listeners**: `useSortable` uses the row's bounding rect for collision detection. Without `setNodeRef`, `closestCenter` cannot compute the row's center. The listeners are routed to the handle via `setActivatorNodeRef` (in DragHandle), so pointer-down on the row body — e.g., on the column name span — does NOT start a drag. AC-01e satisfied.

**`prefersReducedMotion`** is read once per drag start by the parent TableNode and threaded down. Implementation: `window.matchMedia('(prefers-reduced-motion: reduce)').matches` (AC-13c). Applied to: `transition` prop (CSS transition omitted), `dropAnimation` (set to `null`), `DragOverlay` modifiers (no momentum), auto-scroll velocity (300 px/s constant — AC-09d).

#### 2.3.5 Drag Lifecycle Handlers (in TableNode)

```tsx
const [activeId, setActiveId] = useState<string | null>(null)
const [overId, setOverId] = useState<string | null>(null)
const preDragOrderRef = useRef<string[] | null>(null)

const handleDragStart = useCallback(
  (event: DragStartEvent) => {
    // SA-M3: queue-full check at drag-START (not drag-end). If the per-table FIFO
    // is already at the AC-08d cap of 5, we must NOT let the drag begin — otherwise
    // the user sees an optimistic ghost row and then a snap-back when the drop is
    // silently dropped. Tell the user up front and cancel.
    if (reorderMutations.isQueueFullForTable(table.id)) {
      toast.warning('Slow down — previous reorders still saving')
      // We can't "cancel" @dnd-kit's drag once onDragStart returns; instead, we
      // set a sentinel so handleDragEnd treats this as a forced cancel.
      preDragOrderRef.current = null
      setActiveId(null)
      setOverId(null)
      // Ask @dnd-kit to cancel by dispatching a synthetic Escape (cleanest path
      // available without forking the sensor). Implementation in §2.4.1 exposes a
      // `cancelActiveDrag()` helper from the parent that calls into the sensor.
      cancelActiveDrag()
      return
    }
    setActiveId(event.active.id as string)
    preDragOrderRef.current = visibleColumns.map((c) => c.id)
    // SA-H4: mark this table as locally-dragging so incoming column:reordered
    // events for the same table get buffered instead of applied (AC-07c / AC-14a).
    reorderMutations.setLocalDragging(table.id, true)
  },
  [visibleColumns, reorderMutations, table.id, cancelActiveDrag],
)

const handleDragOver = useCallback((event: DragOverEvent) => {
  setOverId(event.over?.id ? (event.over.id as string) : null)
}, [])

const handleDragEnd = useCallback(
  (event: DragEndEvent) => {
    // performance.mark for the metric-instrumentation harness (Section 3 of PRD)
    performance.mark('column-reorder:drop')

    const activeIdLocal = event.active.id as string
    const overIdLocal = event.over?.id as string | undefined

    setActiveId(null)
    setOverId(null)

    // SA-H4: every drop (no-op or not, valid or not) must run reconcileAfterDrop
    // so localDraggingByTable is cleared and any buffered remote reorder is
    // applied or reconciled. Compute newOrder first (or null if drop was invalid),
    // then route through the single reconcile path.
    let newOrder: string[] | null = null
    if (overIdLocal && preDragOrderRef.current) {
      const oldIndex = preDragOrderRef.current.indexOf(activeIdLocal)
      const newIndex = preDragOrderRef.current.indexOf(overIdLocal)
      if (oldIndex !== -1 && newIndex !== -1) {
        newOrder = arrayMove(preDragOrderRef.current, oldIndex, newIndex)
      }
    }

    reorderMutations.reconcileAfterDrop({
      tableId: table.id,
      preDragOrder: preDragOrderRef.current,
      newOrder, // null = invalid drop, treated as no-op
    })

    preDragOrderRef.current = null
  },
  [reorderMutations, table.id],
)

const handleDragCancel = useCallback(() => {
  // AC-10a/b/c: Escape during drag → ghost & line vanish, no DB, no WS.
  // SA-H4: still must clear localDragging and apply any buffered remote.
  setActiveId(null)
  setOverId(null)
  reorderMutations.reconcileAfterDrop({
    tableId: table.id,
    preDragOrder: preDragOrderRef.current,
    newOrder: null, // cancelled = same path as no-op
  })
  preDragOrderRef.current = null
}, [reorderMutations, table.id])

// Listen for Escape (REQ-10) — @dnd-kit fires onDragCancel on Escape automatically
// when KeyboardSensor is registered. Without KeyboardSensor, we add a window-level
// listener while a drag is active.
useEffect(() => {
  if (!activeId) return
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') handleDragCancel()
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [activeId, handleDragCancel])
```

**Decision: track `preDragOrderRef` instead of relying on `visibleColumns` at the moment of drop.** During the drag, `visibleColumns` may be mutated by an incoming `column:reordered` from another user (which gets buffered, but the buffer's resolution still reads from `visibleColumns`). Capturing the order at `dragStart` makes the optimistic computation deterministic regardless of remote events.

**Why `arrayMove` from `@dnd-kit/sortable`**: it's the canonical helper for "move item from oldIndex to newIndex" in a sortable list. Single import, well-tested.

**`cancelActiveDrag()` helper**: returned from the `useDndContext` ref or implemented as a small wrapper that dispatches a synthetic `keydown` Escape event on the sortable container. `@dnd-kit`'s built-in handling of Escape triggers `onDragCancel` cleanly. Implementation tip for Ares: use `useRef<(() => void) | null>(null)` populated on `onDragStart` with a closure that calls the sensor's cancel; if not feasible, dispatch `new KeyboardEvent('keydown', { key: 'Escape' })` on the document during the user's pointer-up frame.

#### 2.3.6 Insertion Line

File: `src/components/whiteboard/column/InsertionLine.tsx` (NEW)

The insertion line is a 2px horizontal accent-color div positioned at the gap between rows. Implementation reads `overId` and `activeId` from the parent and computes the target gap with the AC-02d hysteresis:

```tsx
interface InsertionLineProps {
  visible: boolean
  /** index in visibleColumns of the row whose top edge the line should sit at,
   *  OR visibleColumns.length to indicate "after the last row". */
  targetIndex: number
  rowHeight: number
}

// Memoize: returns absolutely-positioned <div> with top: targetIndex * rowHeight - 1px
// Color: var(--rf-edge-stroke-selected, #6366f1) — same accent used for selected edges
```

The hysteresis (AC-02d) is satisfied by `closestCenter`'s built-in tie-breaking: when the cursor is exactly on a row's vertical midpoint, `closestCenter` returns the previously-active over-id. (Verified against `@dnd-kit`'s collision detection source — `closestCenter` returns the FIRST collision in iteration order on tie, and with stable item array order the result is deterministic across frames.)

**No-op insertion at original slot**: when `overId === activeId`, the insertion line still renders but at the original position, signalling the user the drop will be a no-op (PRD Flow 1, third bullet). The line stays visible because `closestCenter` always returns the activeId itself when no other row is closer.

### 2.4 Frontend — State & Sync (Hooks)

#### 2.4.1 `useColumnReorderMutations` (NEW)

File: `src/hooks/use-column-reorder-mutations.ts`

**Responsibilities**:

1. Receive `onColumnReorder(tableId, newOrderedIds)` from `TableNode` (now via `reconcileAfterDrop` per SA-H4).
2. Apply optimistic state update: `setNodes` to reorder `node.data.table.columns`.
3. Bump `reorderTickByTable[tableId]` to trigger the `useLayoutEffect` for `updateNodeInternals` (Spike S2 mechanism).
4. Enforce per-table FIFO queue cap of 5 (AC-08d) — checked at drag-START via `isQueueFullForTable` (SA-M3).
5. Emit `column:reorder` via the collaboration hook.
6. Track `bufferedRemoteByTable[tableId]` — the most-recent `column:reordered` payload received during a local drag (REQ-14 input).
7. On drop (`reconcileAfterDrop`): clear `localDraggingByTable[tableId]`; if drop is no-op AND buffer non-empty → apply buffered remote (no toast); if drop is real reorder AND buffer non-empty → run column-level overwrite check (SA-H2) and toast iff a shared column moved differently.
8. On `column:reorder:ack` from server: pop the head of the FIFO queue; update `lastConfirmedOrder`. **Do NOT call `applyServerOrder` if the queue still has pending items** (SA-H3) — the optimistic state for in-flight items must remain visible.
9. On `column:reorder` error event: revert the local optimistic state to head's `preState`; toast per error code (REQ-15 wording); pop FIFO.
10. On reconnect: existing `sync:request` flow refetches; when the refetch resolves, compare server order vs. **last optimistic order captured at every enqueue** (SA-H1). If they differ AND there were unconfirmed reorders → toast per REQ-08 AC-08e.
11. Provide `bufferRemoteReorder(tableId, payload)` used when an incoming `column:reordered` arrives mid-drag.
12. Initialize `lastConfirmedOrder` from the server's column order on whiteboard load (SA-H1) — see §2.4.6.

**Public API**:

```typescript
export function useColumnReorderMutations(
  setNodes: SetNodes,
  emitColumnReorder: ((p: { tableId: string; orderedColumnIds: string[] }) => void) | null,
  isConnected: boolean,
  bumpReorderTick: (tableId: string) => void,
) {
  return {
    // Pre-flight check — used by handleDragStart (SA-M3).
    isQueueFullForTable: (tableId: string) => boolean,
    // Single drop entry-point — covers the SA-H4 reconciliation path.
    reconcileAfterDrop: (args: {
      tableId: string,
      preDragOrder: string[] | null,
      newOrder: string[] | null, // null = drop was no-op / cancelled / invalid
    }) => void,
    // Server callbacks
    onColumnReorderAck: (data: { tableId: string; orderedColumnIds: string[] }) => void,
    onColumnReorderError: (data: ColumnReorderErrorEvent) => void,
    onColumnReorderedFromOther: (data: ColumnReorderedEvent) => void,
    // Sync reconciliation (SA-H1)
    onSyncReconcile: (whiteboardWithDiagram: WhiteboardWithDiagram) => void,
    // Initial seed of lastConfirmedOrder on whiteboard load (SA-H1)
    seedConfirmedOrderFromServer: (tables: Array<{ id: string, columns: Array<{ id: string }> }>) => void,
    // Local-drag flag — queried by collaboration hook to decide buffer-vs-apply
    isLocalDragging: (tableId: string) => boolean,
    setLocalDragging: (tableId: string, dragging: boolean) => void,
  }
}
```

**Internal state** (kept in refs to avoid stale-closure bugs):

```typescript
type PendingReorder = {
  preState: string[] // pre-optimistic order (for rollback)
  optimistic: string[] // sent to server
  emittedAt: number
}

const pendingByTable = useRef<Map<string, PendingReorder[]>>(new Map())
// FIFO; head is the oldest emitted; head's ack pops it.

const bufferedRemoteByTable = useRef<Map<string, string[]>>(new Map())
// most-recent column:reordered orderedColumnIds[] received during a local drag

const localDraggingByTable = useRef<Set<string>>(new Set())

const reorderTickByTable = useRef<Map<string, number>>(new Map())
// monotonically incremented per local reorder; bumpReorderTick (a state setter
// in the parent) is what actually fires the layout effect — see §2.4.4.

const lastConfirmedOrder = useRef<Map<string, string[]>>(new Map())
// SA-H1: the most recent server-confirmed order. Seeded from the server's
// initial column order on whiteboard load via `seedConfirmedOrderFromServer`,
// then updated by ack and by remote broadcast. Always non-undefined for any
// table the user has ever seen — the reconcile-on-sync comparison (§2.4.6)
// therefore always has a baseline, even when the user's first-ever reorder
// is the one that gets lost.

const lastOptimisticByTable = useRef<Map<string, string[]>>(new Map())
// SA-H1: captured on every enqueue (i.e., every successful local reorder
// emit). Records "what the user thinks the order is right now". The
// reconcile-on-sync logic compares the post-refetch server order against
// THIS, not against lastConfirmedOrder, when there is at least one
// unconfirmed reorder pending — so the very first unacked reorder still
// triggers AC-08e.

const dirtyByTable = useRef<Set<string>>(new Set())
// SA-H1: set when a reorder is enqueued; cleared when the queue empties OR
// when the reconcile-on-sync handler runs. Distinct from queue.length>0
// because we want to surface the AC-08e toast even if the queue was drained
// by an error during the disconnect window.
```

#### 2.4.2 FIFO Queue (AC-08d) and Drop Reconciliation (SA-H4)

##### `isQueueFullForTable` — drag-start gate (SA-M3)

```typescript
function isQueueFullForTable(tableId: string): boolean {
  const queue = pendingByTable.current.get(tableId) ?? []
  return queue.length >= 5
}
```

Called from `handleDragStart`. If true, the drag is cancelled before it can render an optimistic ghost, eliminating the "phantom-then-snap-back" thrash from the old drag-end gate.

##### `reconcileAfterDrop` — single drop entry-point (SA-H4)

```typescript
function reconcileAfterDrop(args: {
  tableId: string
  preDragOrder: string[] | null
  newOrder: string[] | null
}) {
  const { tableId, preDragOrder, newOrder } = args

  // (1) Always clear the local-dragging flag first, regardless of outcome.
  //     This unblocks subsequent column:reordered events for this table.
  localDraggingByTable.current.delete(tableId)

  const buffered = bufferedRemoteByTable.current.get(tableId)
  const isNoOp =
    !newOrder || (preDragOrder != null && arraysEqual(newOrder, preDragOrder))

  // (2) No-op / invalid / cancelled drop → AC-14f: apply buffered remote
  //     (if any) and do NOT toast. The user made no change, so there is no
  //     overwrite to surface.
  if (isNoOp) {
    if (buffered) {
      applyServerOrder(tableId, buffered)
      lastConfirmedOrder.current.set(tableId, buffered)
      bufferedRemoteByTable.current.delete(tableId)
    }
    return
  }

  // (3) Real reorder. From here on we know newOrder is non-null and != preDragOrder.
  //     Run the SA-H2 column-level overwrite check.
  if (buffered && preDragOrder) {
    const overwrites = detectOverwriteConflict(preDragOrder, buffered, newOrder)
    if (overwrites) {
      toast(
        'Another collaborator reordered columns while you were dragging. ' +
          'Your order was applied — theirs was overwritten.',
        { duration: 8000 }, // AC-14d
      )
    }
    // Always clear the buffer once we've reached a drop decision — the
    // remote order is being superseded by our local order (whether or not
    // we toasted; the toast is informational, not gating).
    bufferedRemoteByTable.current.delete(tableId)
  }

  // (4) FIFO check — defensive belt-and-suspenders. handleDragStart should have
  //     already gated this, but if a parallel code path enqueues, refuse.
  if ((pendingByTable.current.get(tableId) ?? []).length >= 5) {
    toast.warning('Slow down — previous reorders still saving')
    return
  }

  if (!isConnected) {
    toast.error('Not connected. Please wait for reconnection.')
    return
  }

  // (5) Apply optimistic state, capture preState for rollback, enqueue, emit.
  applyLocalOptimistic(
    tableId,
    newOrder,
    /* outPreState */ (preState) => {
      const prevQueue = pendingByTable.current.get(tableId) ?? []
      pendingByTable.current.set(tableId, [
        ...prevQueue,
        { preState, optimistic: newOrder, emittedAt: performance.now() },
      ])
      // SA-H1: capture the optimistic order at every enqueue.
      lastOptimisticByTable.current.set(tableId, newOrder)
      dirtyByTable.current.add(tableId)
      emitColumnReorder?.({ tableId, orderedColumnIds: newOrder })
    },
  )
}
```

##### `applyLocalOptimistic` — mutates `node.data.table.columns`

```typescript
function applyLocalOptimistic(
  tableId: string,
  newOrderedIds: string[],
  onPreStateCaptured: (preState: string[]) => void,
) {
  let preState: string[] = []
  setNodes((prev) =>
    prev.map((node) => {
      if (node.data.table.id !== tableId) return node
      preState = node.data.table.columns.map((c) => c.id)
      const byId = new Map(node.data.table.columns.map((c) => [c.id, c]))
      const reordered = newOrderedIds
        .map((id, index) => {
          const col = byId.get(id)
          return col ? { ...col, order: index } : null
        })
        .filter((c): c is Column => c !== null)
      return {
        ...node,
        data: {
          ...node.data,
          table: { ...node.data.table, columns: reordered },
        },
      }
    }),
  )
  bumpReorderTick(tableId) // triggers the layout effect → updateNodeInternals
  onPreStateCaptured(preState)
}
```

##### `detectOverwriteConflict` — SA-H2 column-level intersection check

```typescript
/**
 * AC-14e: the toast fires only when B's reorder touched at least one column
 * that A also moved, AND for at least one such column the resulting position
 * differs between A's and B's reorders.
 *
 * - If A and B touched disjoint sets of columns → no overwrite (no toast).
 * - If they touched the same column(s) but moved them to the same final
 *   position → no overwrite (no toast).
 * - Otherwise → overwrite (toast).
 *
 * Returns true iff the toast should fire.
 */
function detectOverwriteConflict(
  preDragOrder: string[], // both clients' shared baseline at A's dragStart
  bufferedRemote: string[], // B's order received during A's drag
  localFinal: string[], // A's order at drop
): boolean {
  // Compute the set of columns each side moved relative to the shared baseline.
  const movedByA = collectMovedColumnIds(preDragOrder, localFinal)
  const movedByB = collectMovedColumnIds(preDragOrder, bufferedRemote)

  // Intersection: columns BOTH parties touched.
  const sharedMoved: string[] = []
  for (const id of movedByA) {
    if (movedByB.has(id)) sharedMoved.push(id)
  }
  if (sharedMoved.length === 0) return false // disjoint moves — no conflict

  // For each shared-moved column, compare A's final index vs. B's final index.
  // If they differ for ANY shared column, A's order overwrites B's at that
  // position → toast.
  for (const id of sharedMoved) {
    const aIdx = localFinal.indexOf(id)
    const bIdx = bufferedRemote.indexOf(id)
    if (aIdx !== bIdx) return true
  }
  return false // same columns, same final positions — A and B agreed
}

function collectMovedColumnIds(
  baseline: string[],
  after: string[],
): Set<string> {
  // A column is "moved" if its index in `after` differs from its index in `baseline`.
  // We assume `baseline` and `after` contain the same set of IDs (they are
  // both the same table's columns at near-simultaneous moments, modulo
  // FM-07 add/delete which is rare during a single drag and out-of-scope
  // for the overwrite check — the FIFO ack path handles those).
  const baselineIdx = new Map<string, number>()
  baseline.forEach((id, i) => baselineIdx.set(id, i))
  const moved = new Set<string>()
  after.forEach((id, i) => {
    const orig = baselineIdx.get(id)
    if (orig !== undefined && orig !== i) moved.add(id)
  })
  return moved
}
```

**Why intersection-of-moved (not pairwise positional comparison)?** AC-14e's "no toast when B reordered different columns" cleanly maps to "no toast when the intersection of moved-columns is empty". The pairwise positional check (`buffered[i] !== local[i]`) gives false positives whenever A's move _displaces_ a column B didn't touch — which is the dominant case in N=30 tables and is exactly the false-positive class Apollo flagged.

**Why store the FULL preState (not just oldIndex/newIndex) in PendingReorder**: a rollback that restores the exact pre-drag column array survives concurrent edits to other columns (e.g., a `column:created` arriving while our reorder is in-flight). Storing only oldIndex/newIndex would force us to reconstruct the array at rollback time and could produce wrong results if columns were added/deleted in between.

**REQ-14 toast wording** matches AC-14c exactly. The PRD says the toast "MAY include the collaborator's display name" — the buffered remote payload's `reorderedBy` is just a userId. Since this app does not have a userId→displayName map plumbed to the canvas (verified — no display name lookup in `useColumnCollaboration` or `useWhiteboardCollaboration`), V1 ships with the generic wording. A future improvement can pluck a name from the active-users map (`activeUsers` is exposed by `useCollaboration`) and prepend it.

#### 2.4.3 Reconcile-on-Ack and -on-Error

```typescript
function onColumnReorderAck(data: {
  tableId: string
  orderedColumnIds: string[]
}) {
  const queue = pendingByTable.current.get(data.tableId) ?? []
  if (queue.length === 0) return // duplicate ack — ignore
  const head = queue[0]
  const remaining = queue.slice(1)
  pendingByTable.current.set(data.tableId, remaining)
  lastConfirmedOrder.current.set(data.tableId, data.orderedColumnIds)

  // SA-H3: when there are still pending optimistic reorders in flight (queue
  // depth ≥ 1 after this pop), we MUST NOT call applyServerOrder. Doing so
  // would overwrite the optimistic state for items #2…#N still awaiting ack
  // — the user would see those items snap-back to a stale order until their
  // own acks arrive, which violates AC-04c ("no intermediate ordering observable
  // between event receipt and next painted frame") and produces visible flicker.
  //
  // Instead: just record the ack as confirmed. The cumulative server-merged
  // state (including any FM-07 columns appended by the server for THIS ack)
  // will arrive via either:
  //   (a) the next column:reordered broadcast (when the FIFO drains naturally
  //       and no further user input occurs), or
  //   (b) the final ack of the last queued item, at which point queue.length
  //       === 0 and the path below DOES run applyServerOrder.
  //
  // The brief sub-second window where the local optimistic state lacks an
  // FM-07-added column is acceptable per PRD's "subsecond reconciliation"
  // tolerance for FM-07.
  if (remaining.length > 0) {
    return
  }

  // Queue is now empty. dirtyByTable can be cleared — all local optimistic
  // reorders have been confirmed.
  dirtyByTable.current.delete(data.tableId)

  // If the server's ack order differs from our optimistic order (FM-07 merge
  // case where the server appended columns we didn't have), apply the server's
  // order now that nothing is in flight.
  if (!arraysEqual(head.optimistic, data.orderedColumnIds)) {
    applyServerOrder(data.tableId, data.orderedColumnIds)
  }
}

function onColumnReorderError(data: ColumnReorderErrorEvent) {
  const tableId = data.tableId
  if (!tableId) return
  const queue = pendingByTable.current.get(tableId) ?? []
  if (queue.length === 0) return
  const head = queue[0]
  pendingByTable.current.set(tableId, queue.slice(1))

  // Rollback to head.preState
  applyServerOrder(tableId, head.preState)

  // Toast wording per REQ-15 + error code
  switch (data.error) {
    case 'FORBIDDEN':
      toast.error("You don't have permission to reorder columns in this table.")
      break
    case 'VALIDATION_FAILED':
      toast.error('Unable to reorder columns. Please try again.')
      break
    case 'UPDATE_FAILED':
    default:
      toast.error('Unable to save column order. Please try again.')
  }
}

function onColumnReorderedFromOther(data: ColumnReorderedEvent) {
  // Ignore self-emits (defensive — server uses socket.broadcast which excludes sender)
  if (data.reorderedBy === userId) return

  const tableId = data.tableId
  if (localDraggingByTable.current.has(tableId)) {
    // REQ-14 / FM-05: buffer instead of applying. Drop reconciliation
    // (reconcileAfterDrop in §2.4.2) will resolve this.
    bufferedRemoteByTable.current.set(tableId, data.orderedColumnIds)
    return
  }
  // SA-H3: A remote broadcast carries the cumulative server-canonical state.
  // Even if WE have pending acks not yet returned (rare, given Socket.IO TCP
  // ordering — see SA-M2 test note), this remote broadcast supersedes our
  // optimistic view because it represents the true persisted order. The
  // subsequent ack(s) for our pending reorders will arrive after, and at
  // that point the queue.length === 0 final-ack branch is the only one that
  // calls applyServerOrder, so no double-snap occurs.
  applyServerOrder(tableId, data.orderedColumnIds)
  lastConfirmedOrder.current.set(tableId, data.orderedColumnIds)
}

function applyServerOrder(tableId: string, orderedIds: string[]) {
  setNodes((prev) =>
    prev.map((node) => {
      if (node.data.table.id !== tableId) return node
      const byId = new Map(node.data.table.columns.map((c) => [c.id, c]))
      const reordered = orderedIds
        .map((id, index) => {
          const col = byId.get(id)
          return col ? { ...col, order: index } : null
        })
        .filter((c): c is Column => c !== null)
      return {
        ...node,
        data: {
          ...node.data,
          table: { ...node.data.table, columns: reordered },
        },
      }
    }),
  )
  // Trigger updateNodeInternals via the parent's state setter so edges
  // re-anchor in the same render pass (Spike S2 + SA-M1 useLayoutEffect).
  bumpReorderTick(tableId)
}
```

**Why `applyServerOrder` is invoked synchronously alongside the ack handling, not via a `setTimeout` or microtask deferral**: the layout effect that calls `updateNodeInternals` is keyed on `reorderTicks` (state) and runs after React commits the columns mutation but before paint. As long as both `setNodes` and `bumpReorderTick` are called in the same React event-tick, React batches them into one commit, the effect runs once, edges and rows are repainted together. AC-05d satisfied by `useLayoutEffect`'s pre-paint contract.

#### 2.4.4 Edge Re-Anchor Mechanism (Spike S2 implementation, SA-M1)

`updateNodeInternals` from `@xyflow/react` must be called from inside the React Flow context (only available via the `useUpdateNodeInternals` hook, which itself only works inside `<ReactFlowProvider>`). `useColumnReorderMutations` runs inside `ReactFlowWhiteboardInner` which is inside the provider, so:

```tsx
// inside ReactFlowWhiteboardInner
const updateNodeInternalsFn = useUpdateNodeInternals()

// Track "reorder tick" as state (not just a ref) so that bumps trigger re-render
const [reorderTicks, setReorderTicks] = useState<Record<string, number>>({})

// Pass an updater into useColumnReorderMutations:
const bumpTick = useCallback((tableId: string) => {
  setReorderTicks((prev) => ({ ...prev, [tableId]: (prev[tableId] ?? 0) + 1 }))
}, [])

const reorderMutations = useColumnReorderMutations(
  setNodes,
  emitColumnReorder,
  isConnected,
  bumpTick,
)

// SA-M1: useLayoutEffect (not useEffect). useLayoutEffect runs SYNCHRONOUSLY
// after DOM mutation but BEFORE the browser paints. This is the only React
// hook that satisfies AC-05d's "edges re-anchor in the same render pass as
// the order change — no visible flicker" guarantee. useEffect runs AFTER
// paint, which would produce a one-frame lag where edges point at the old
// row positions.
useLayoutEffect(() => {
  for (const tableId of Object.keys(reorderTicks)) {
    updateNodeInternalsFn(tableId)
  }
}, [reorderTicks, updateNodeInternalsFn])
```

**Why a state object indexed by tableId** (rather than a number-bumping ref): React only re-runs an effect when its dependency identity changes. Refs don't fire effects. State does. Indexing by tableId means many concurrent reorders across different tables don't trample each other.

**Why `useLayoutEffect` is safe here**: `useLayoutEffect` emits a warning during SSR. `ReactFlowWhiteboardInner` is rendered inside a `<ClientOnly>`-style boundary (TanStack Start's hydration model — verified that `ReactFlowProvider` and the canvas only mount post-hydration). No SSR pass exercises this code path, so the SSR warning does not apply.

**Timing claim** (AC-05d — "re-anchor in the same render pass as the order change"): React batches `setNodes` and `setReorderTicks` when called in the same event-loop turn (they are — both happen synchronously inside `applyServerOrder` or `applyLocalOptimistic`). React commits both into one render. `useLayoutEffect` then runs synchronously, calls `updateNodeInternals(tableId)`, and React Flow recomputes handle positions before yielding back to the browser. The next paint sees both columns and edges in their new positions simultaneously. **Resolved decision, not a risk** — the previous draft's "verify with Cassandra" note has been retired now that the AC-05d-compliant hook is committed.

#### 2.4.5 `useColumnReorderCollaboration` (NEW)

Mirrors `useColumnCollaboration` but for reorder-specific events. Listens for `column:reordered`, `column:reorder:ack`, and `error` (filtered to `event === 'column:reorder'`). Emits `column:reorder`. Routes to the mutations hook's callbacks via a stable ref pattern (same approach used by `useColumnCollaboration:77-80`).

```typescript
export function useColumnReorderCollaboration(
  whiteboardId: string,
  userId: string,
  callbacks: {
    onColumnReorderedFromOther: (data: ColumnReorderedEvent) => void
    onColumnReorderAck: (data: { tableId: string; orderedColumnIds: string[] }) => void
    onColumnReorderError: (data: ColumnReorderErrorEvent) => void
    onReconnect: () => void
  },
) {
  const { emit, on, off, connectionState } = useCollaboration(whiteboardId, userId)
  // … (same callbacksRef pattern as use-column-collaboration.ts:77-80)

  useEffect(() => {
    on('column:reordered', handleReordered)
    on('column:reorder:ack', handleAck)
    on('error', handleError) // filtered by event === 'column:reorder'
    on('connect', handleConnect) // reconnect detection (same pattern as use-column-collaboration.ts:124-132)
    return () => { off(...); off(...); off(...); off(...) }
  }, [on, off, userId])

  const emitColumnReorder = useCallback(
    (data: { tableId: string; orderedColumnIds: string[] }) => {
      if (connectionState !== 'connected') {
        // Drop on the floor; useColumnReorderMutations gates on isConnected before
        // calling this anyway. Belt-and-suspenders.
        console.warn('Cannot emit column:reorder: not connected')
        return
      }
      emit('column:reorder', data)
    },
    [emit, connectionState],
  )

  return { emitColumnReorder, isConnected: connectionState === 'connected' }
}
```

**Why a separate hook** (instead of stuffing into `useColumnCollaboration`)? Single-responsibility. The existing hook already handles per-column CRUD; mixing reorder events would inflate it and force consumers to wire callbacks they don't need. Both hooks share the same underlying `useCollaboration` socket, so they don't multiply connections.

#### 2.4.6 Reconcile-on-Sync (REQ-08 AC-08e/f, SA-H1)

The existing `handleReconnect` in `ReactFlowWhiteboard.tsx:501-510` already triggers a TanStack Query invalidation for `whiteboard` and `relationships`. After the query refetches, the `whiteboard.tables[].columns` data flows into `setNodes` via the existing initial-load path (around line 250-280 of `ReactFlowWhiteboard.tsx` — verified in conversion-to-nodes flow).

##### Initialization: seed `lastConfirmedOrder` on whiteboard load (SA-H1)

The original draft only populated `lastConfirmedOrder` from ack and broadcast handlers. Apollo's SA-H1 finding showed this leaves the very-first-ever-reorder-loss case undetectable: a fresh user opens a whiteboard, enqueues their first reorder, the server never receives it, on reconnect the comparison sees `lastConfirmed === undefined` and silently swallows the loss. Fix: seed `lastConfirmedOrder` from the server's column order on every whiteboard load (initial query AND post-reconnect refetch).

```typescript
// in useColumnReorderMutations
function seedConfirmedOrderFromServer(
  tables: Array<{ id: string; columns: Array<{ id: string }> }>,
) {
  for (const table of tables) {
    const order = table.columns.map((c) => c.id)
    // Only SET if not present — never overwrite a more-recent confirmation
    // we may have received between the refetch starting and resolving. The
    // refetch payload is from a moment in the past; a broadcast/ack received
    // after the fetch began but before this seed runs should win.
    if (!lastConfirmedOrder.current.has(table.id)) {
      lastConfirmedOrder.current.set(table.id, order)
    }
  }
}
```

This is called from `ReactFlowWhiteboard` once when `whiteboardData` first becomes non-null AND once after every reconnect refetch resolves. After the seed, the comparison in `onSyncReconcile` always has a baseline.

##### `onSyncReconcile` — AC-08e/f detection (SA-H1)

**The fix per SA-H1**: compare the server-fetched order against `lastOptimisticByTable[tableId]` (captured at every enqueue), not against `lastConfirmedOrder`. The `dirtyByTable` flag controls whether a mismatch is silently reconciled or surfaces as a toast.

```typescript
function onSyncReconcile(whiteboardData: {
  tables: Array<{ id: string; columns: Array<{ id: string }> }>
}) {
  for (const table of whiteboardData.tables) {
    const serverOrder = table.columns.map((c) => c.id)
    const wasDirty = dirtyByTable.current.has(table.id)
    const lastOptimistic = lastOptimisticByTable.current.get(table.id)

    // SA-H1: the comparison must use lastOptimistic (what the user thinks
    // is on-screen) rather than lastConfirmed (what the server last told us).
    // If the user enqueued a reorder that was lost (FM-04 path), then
    // lastOptimistic ≠ serverOrder while wasDirty === true — toast fires.
    if (
      wasDirty &&
      lastOptimistic &&
      !arraysEqual(serverOrder, lastOptimistic)
    ) {
      toast(
        'Your last column reorder may not have saved. ' +
          'Please verify the order and try again if needed.',
        { duration: 8000 },
      )
    }

    // Update lastConfirmedOrder to the freshly-fetched server truth, and
    // clear the dirty flag — the reconciliation has surfaced (or silently
    // accepted) any divergence; the next enqueue starts a new cycle.
    lastConfirmedOrder.current.set(table.id, serverOrder)
    lastOptimisticByTable.current.delete(table.id)
    dirtyByTable.current.delete(table.id)

    // Drain the FIFO for this table — any emits that were in flight at
    // disconnect time are gone; they will never receive ack or broadcast.
    // Keeping them in the queue would falsely claim "still saving" and
    // block subsequent drag-start attempts (SA-M3 gate).
    pendingByTable.current.set(table.id, [])
  }
}
```

**Wiring** (in `ReactFlowWhiteboard`):

```typescript
// One-time seed on first whiteboard load (initial query resolved)
useEffect(() => {
  if (!whiteboardData) return
  reorderMutations.seedConfirmedOrderFromServer(whiteboardData.tables)
  // Note: do NOT also call onSyncReconcile here — initial load is not a
  // reconcile event (there are no in-flight reorders to reconcile against).
}, [whiteboardData?.id]) // dep keyed on whiteboard id, not full data, to avoid loop

// After reconnect, the existing query invalidation triggers a refetch.
// When that refetch resolves and produces a new whiteboardData, run the
// reconcile.
const previousWhiteboardData = useRef(whiteboardData)
useEffect(() => {
  // Only treat as reconcile if we already had data and connection has just
  // returned — i.e., not the initial load.
  if (
    previousWhiteboardData.current &&
    whiteboardData &&
    previousWhiteboardData.current !== whiteboardData
  ) {
    reorderMutations.onSyncReconcile(whiteboardData)
  }
  previousWhiteboardData.current = whiteboardData
}, [whiteboardData])
```

**Why `dirtyByTable` rather than `pendingByTable.size > 0`**: the queue may have been drained by an error path during disconnect (e.g., a stale ack arrived just as the network dropped, or the server returned UPDATE_FAILED and the rollback ran but the user's intended order was never persisted). `dirtyByTable` survives queue drains and is only cleared by `onSyncReconcile` (or by a successful queue-empty ack via the path in `onColumnReorderAck`). This guarantees the toast fires whenever the user's intent diverges from the server truth, regardless of the queue's instantaneous state.

### 2.5 Performance Instrumentation

Per PRD Section 3, all three latency metrics must be measurable via `performance.mark`. The marks are placed at the points named in the PRD:

| Mark                          | Location                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `column-reorder:drop`         | First line of `handleDragEnd` in TableNode                                                                                     |
| `column-reorder:local-paint`  | Inside a `requestAnimationFrame` callback scheduled immediately after `setNodes` in `useColumnReorderMutations.reorderColumns` |
| `column-reorder:remote-paint` | Inside a `requestAnimationFrame` callback scheduled immediately after `applyServerOrder` in `onColumnReorderedFromOther`       |

These marks emit no UI; they exist for the test harness Artemis will write in stage 7. The marks have negligible runtime cost (~50ns each in modern browsers). They are present in production builds — that's intentional (web-vitals collection is already in use; reorder marks join the same telemetry surface).

### 2.6 Reduced-Motion (REQ-13 / REQ-09 AC-09d)

A single hook reads the preference once per drag start:

```typescript
function usePrefersReducedMotion() {
  const [prefers, setPrefers] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setPrefers(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return prefers
}
```

The value flows down to:

- `<DragOverlay dropAnimation={prefers ? null : defaultDropAnimation}>` (no zoom-back animation on cancel)
- `ColumnRow.style.transition` (omitted when `prefers === true`)
- The autoscroll modifier — `@dnd-kit/core` exposes `autoScroll` config with a `enabled` flag and `acceleration`/`speed` knobs. `prefers` → `speed: 300, acceleration: 1` (linear). Default → `speed: 600, acceleration: 10`.

**Note**: `@dnd-kit/core`'s default auto-scroll speed is approximately 750 px/s with acceleration. Per PRD AC-09a, "tech-spec may use the chosen DnD library's documented default if it differs by < 20%". 750 vs 600 is a 25% delta — outside the 20% window. **Decision: override to 600 px/s explicitly**, via the `autoScroll: { speed: 600, acceleration: 5 }` prop on `<DndContext>`. This is testable and matches the PRD value.

### 2.7 Auto-Scroll Configuration

`@dnd-kit/core` ships built-in auto-scroll. Configuration on `<DndContext>`:

```tsx
<DndContext
  autoScroll={{
    enabled: true,
    threshold: { x: 0, y: 0.15 }, // top/bottom 15% of nearest scrollable ancestor
    interval: 5,
    canScroll: (element) => {
      // Only allow auto-scroll on the React Flow viewport (the canvas), not on
      // ancestor scrollable elements like the page itself.
      return element.classList.contains('react-flow__viewport') ||
             element.classList.contains('react-flow__renderer')
    },
    acceleration: prefersReducedMotion ? 1 : 5,
    // dnd-kit doesn't expose px/s directly; speed is a unitless multiplier.
    // Empirical measurement places the default (multiplier ~10) at ~750 px/s.
    // Multiplier 8 ≈ 600 px/s; multiplier 4 ≈ 300 px/s. Final value tuned during
    // implementation per the PRD AC-09a 20% tolerance.
  }}
>
```

**Open implementation tuning point**: `@dnd-kit`'s speed is empirical. Ares should measure the actual px/s during implementation and adjust the `acceleration` knob to land within ±20% of the PRD targets. Documentation requirement (AC-09a): the actual value used is recorded in a code comment at the `<DndContext>` site.

### 2.8 Edge Re-Anchor on Remote Reorder (AC-05d)

Same as local — the `applyServerOrder` path bumps `reorderTickByTable`, which fires the `useEffect` that calls `updateNodeInternals(tableId)`. AC-05d ("same render pass as the order change") is satisfied by React's batched commit.

### 2.9 Concurrent Add Race (FM-07) — Frontend Side

When User A is mid-drag and User B adds a column, the `column:created` event arrives at A. The existing `useColumnCollaboration.handleCreated` callback (`use-column-collaboration.ts:90-98`) runs and adds the column to `node.data.table.columns`. **A's drag is over the OLD columns array**, not the new one. After A's drop:

- `preDragOrderRef.current` (captured at dragStart) still holds the OLD column ID set.
- `arrayMove(preDragOrderRef.current, oldIndex, newIndex)` produces an order that excludes B's new column.
- The emit goes out without B's new column.
- The server applies FM-07 merge (appends the new column at the end by ascending existing-`order`).
- The server broadcasts the merged order with `column:reorder:ack`.
- The client's `onColumnReorderAck` detects the divergence and calls `applyServerOrder`, snapping the new column into its appended position.

**Net user experience**: the new column appears at the bottom of the table briefly (during A's drag), stays at the bottom after A's drop (since the optimistic state didn't include it), then snaps to its server-canonical position on ack — which is also the bottom (since the merge appends). So in the typical case, no visible discontinuity.

**Edge case**: if B's new column had a manually-set non-default `order` (e.g., from a future feature where new columns are inserted in the middle), the server's merge by ascending existing-`order` would still place it correctly, and the optimistic-vs-ack divergence would visually snap. Acceptable given PRD's "subsecond reconciliation" tolerance (FM-07 step 5).

### 2.10 Reorder Targets Just-Deleted Column (FM-06)

When User B deletes column X while User A is dragging X:

- A's `column:deleted` arrives; existing `onColumnDeleted` (`ReactFlowWhiteboard.tsx:456-488`) removes column X from `node.data.table.columns`.
- The `<SortableContext items=[…ids without X…]>` re-renders. `@dnd-kit` detects that `activeId` is no longer a member of `items` and synthetically calls `onDragCancel`.

**Verification needed**: confirm `@dnd-kit` cancels gracefully when `activeId` disappears from `items` mid-drag. Per `@dnd-kit/sortable` docs, dynamic item removal is supported and triggers `onDragCancel`. **Action item for Ares**: write a unit test for this case (TableNode + simulated deletion mid-drag).

### 2.11 Frontend Type Definitions

```typescript
// src/hooks/use-column-reorder-collaboration.ts
export interface ColumnReorderedEvent {
  tableId: string
  orderedColumnIds: string[]
  reorderedBy: string
}

export interface ColumnReorderErrorEvent {
  event: 'column:reorder'
  error: 'FORBIDDEN' | 'VALIDATION_FAILED' | 'UPDATE_FAILED'
  message: string
  tableId?: string
}
```

---

## 3. Implementation Plan (Phases)

No `decomposition.md` exists for this feature. Phases below are organized by natural module boundaries — backend first (testable in isolation), then frontend behavior, then collaboration glue, then polish.

### Phase 1 — Backend (transactional reorder)

1. `src/data/schema.ts`: add `reorderColumnsSchema`.
2. `src/data/column.ts`: add `reorderColumns(tableId, orderedColumnIds[])`.
3. `src/routes/api/collaboration.ts`: add `socket.on('column:reorder', ...)` handler with FM-07 merge and `column:reorder:ack` self-confirmation.
4. **Documentation (SA-L2)**: update `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md` to document the three new events with their payloads, RBAC notes, and emit-direction semantics:
   - `column:reorder` (client → server): `{ tableId: string, orderedColumnIds: string[] }`
   - `column:reordered` (server → all-others-broadcast): `{ tableId: string, orderedColumnIds: string[], reorderedBy: string }`
   - `column:reorder:ack` (server → sender only): `{ tableId: string, orderedColumnIds: string[] }`
5. Vitest: unit test `reorderColumns` — happy path, empty array, invalid IDs, foreign IDs.
6. Vitest: socket handler test — IDOR rejection, validation fail, FM-07 merge correctness.

### Phase 2 — DnD-Kit integration & visual feedback

1. `bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`.
2. `src/components/whiteboard/column/DragHandle.tsx` (NEW).
3. `src/components/whiteboard/column/InsertionLine.tsx` (NEW).
4. `src/components/whiteboard/column/ColumnRow.tsx` (MODIFY): wire `useSortable`, render DragHandle, apply `transform`/`opacity`.
5. `src/components/whiteboard/TableNode.new.tsx` (MODIFY): wrap visible columns in `DndContext` + `SortableContext`; render `DragOverlay` and `InsertionLine`; add lifecycle handlers; handle Escape; capture `preDragOrderRef`.
6. Vitest + React Testing Library: ColumnRow renders handle with correct aria-label; pointerdown on the handle does NOT bubble to React Flow (verify `nodrag` class presence — same pattern as `DataTypeSelector.test.tsx:112-118`).

### Phase 3 — Mutations hook & optimistic state

1. `src/hooks/use-column-reorder-mutations.ts` (NEW): full implementation per §2.4.1-2.4.4.
2. Vitest unit tests:
   - **SA-M3**: `isQueueFullForTable` returns true at queue depth 5; the consumer's `handleDragStart` short-circuits and toasts.
   - Rollback on error event restores `head.preState`.
   - **SA-H2**: `detectOverwriteConflict` truth table — disjoint moves (false), shared columns same-final-position (false), shared columns different-final-position (true).
   - **SA-H4**: `reconcileAfterDrop` no-op-with-buffer applies buffered remote and does not toast; no-op-without-buffer is a true no-op; real-reorder-with-shared-overwrite toasts.
   - **SA-H1**: `onSyncReconcile` fires the toast when `dirtyByTable` is set AND `lastOptimisticByTable[t]` differs from server order — including the case where `lastConfirmedOrder[t]` was only ever set by the initial seed (no acks ever happened). Test starts from a fresh whiteboard load, enqueues a reorder, simulates network loss without ack, then triggers `onSyncReconcile` with the original server order — toast must fire.
   - **SA-H3**: ack at queue depth ≥ 2 does not call `applyServerOrder`. Test: enqueue two reorders for the same table, deliver ack #1 with FM-07-merged extra column, assert that the optimistic state for reorder #2 is preserved (no snap-back). Then deliver ack #2 (queue empty), assert `applyServerOrder` runs once and FM-07 column appears.

### Phase 4 — Collaboration hook & wiring

1. `src/hooks/use-column-reorder-collaboration.ts` (NEW): full implementation per §2.4.5.
2. `src/components/whiteboard/ReactFlowWhiteboard.tsx` (MODIFY): instantiate both hooks, wire `reconcileAfterDrop` callback into `TableNode` data, install the `useLayoutEffect` for `updateNodeInternals` (§2.4.4), wire `seedConfirmedOrderFromServer` and `onSyncReconcile` (§2.4.6).
3. Vitest: hook listens to `column:reordered`, ignores own broadcasts, buffers when local-dragging, applies otherwise.
4. **Vitest (SA-M2 — protocol ordering test at queue depth ≥ 2)**: simulate the sequence "A emits #1 → A emits #2 → ack(#1) arrives → broadcast(#2) arrives" and assert:
   - After ack(#1): queue depth drops from 2 to 1; `applyServerOrder` is NOT called (SA-H3); `lastConfirmedOrder` updated.
   - After broadcast(#2) arrives while A is NOT dragging: `applyServerOrder` IS called with the cumulative order.
   - No buffered-remote bookkeeping happens (since A was not mid-drag).
   - Repeat with reverse arrival order (broadcast(#2) before ack(#1)) — should still produce the correct end state. This documents the application's contract that out-of-order delivery is tolerated, even though Socket.IO's TCP transport guarantees ordering in practice.
5. **Vitest (SA-M2 / mid-drag-ack edge case)**: A is mid-drag on table X; ack(#1) for an earlier reorder of table X arrives. Assert that no `bufferedRemoteByTable` write happens (only `column:reordered` writes there, never ack), `localDraggingByTable` is unchanged, `lastConfirmedOrder` updates, and the queue head pops correctly.

### Phase 5 — Polish, perf, & a11y

1. `usePrefersReducedMotion` (NEW; small util in `src/hooks/`).
2. `<DndContext>` autoScroll config (§2.7).
3. Tooltip integration (REQ-12); verify `delayDuration={400}` propagates via `<TooltipProvider>` at row level.
4. `performance.mark` instrumentation at the three points in §2.5.
5. Manual smoke test at 30 columns (PRD A9 / OQ-5) — no jank during drag.
6. Manual cross-browser test: Chrome, Firefox, Safari (mouse + Mac trackpad).

### Phase 6 — Stretch (DEFERRED — REQ-11 keyboard reorder, P2)

Not in V1. Architecture-open hook: when REQ-11 is promoted, add `KeyboardSensor` + `sortableKeyboardCoordinates` to the `useSensors` array (§2.3.2) and route the `onDragEnd` through the same `onColumnReorder` callback. No backend, no protocol, no broadcast changes.

---

## 4. Acceptance Criteria Mapping

How each PRD AC is satisfied (cross-reference for Apollo's spec review):

| AC           | Mechanism                                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01a/b     | `DragHandle` rendered in every `ColumnRow`, always visible                                                                                                                                                                                                          |
| AC-01c       | `cursor: grab` / `cursor: grabbing` styles in `DragHandle.tsx`                                                                                                                                                                                                      |
| AC-01d       | `aria-label="Reorder column [name]"` on the handle button                                                                                                                                                                                                           |
| AC-01e       | `setActivatorNodeRef` on the handle only; row body has `setNodeRef` (collision rect only)                                                                                                                                                                           |
| AC-01f       | Drag handle rendered inside `showMode !== 'TABLE_NAME'` block (existing condition in `TableNode.new.tsx:304`)                                                                                                                                                       |
| AC-01g       | `nodrag nowheel` on the handle (Spike S1)                                                                                                                                                                                                                           |
| AC-02a       | `ColumnRow` style `opacity: isDragging ? 0.5 : 1`; layout preserved (no display:none)                                                                                                                                                                               |
| AC-02b       | `<DragOverlay>` renders a copy at 80% opacity (style override on the ghost ColumnRow)                                                                                                                                                                               |
| AC-02c       | `snapCenterToCursor` modifier + custom `+8px / +8px` offset modifier                                                                                                                                                                                                |
| AC-02d       | `closestCenter` collision detection + insertion line rendered at gap; hysteresis from `closestCenter`'s tie-break                                                                                                                                                   |
| AC-02e       | `restrictToParentElement` + `restrictToVerticalAxis` modifiers                                                                                                                                                                                                      |
| AC-02f       | DragOverlay unmounted, InsertionLine `visible={false}` on `onDragEnd`/`onDragCancel`                                                                                                                                                                                |
| AC-03a       | `reorderColumns` writes to DB; subsequent reload reads via `findColumnsByTableId orderBy:asc`                                                                                                                                                                       |
| AC-03b       | `prisma.$transaction` — atomic by Postgres semantics                                                                                                                                                                                                                |
| AC-03c       | Per-row `prisma.column.update` inside transaction                                                                                                                                                                                                                   |
| AC-03d       | No-op detected inside `reconcileAfterDrop` (`isNoOp` branch) — never enqueues, never emits                                                                                                                                                                          |
| AC-03e       | Re-sequenced to 0..N-1 in `reorderColumns`                                                                                                                                                                                                                          |
| AC-03f       | Server validates length + duplicates + subset (§2.2.3)                                                                                                                                                                                                              |
| AC-04a       | Localhost p95 <500ms / LAN p95 <1000ms — measured via `performance.mark` (§2.5)                                                                                                                                                                                     |
| AC-04b       | `socket.broadcast.emit` is namespace-scoped to `/whiteboard/:id`                                                                                                                                                                                                    |
| AC-04c       | `setNodes` + `updateNodeInternals` in same commit via `useLayoutEffect` (SA-M1)                                                                                                                                                                                     |
| AC-04d       | No-op detected client-side; emit never fires                                                                                                                                                                                                                        |
| AC-04e       | Server error event handled by `onColumnReorderError` → revert + toast                                                                                                                                                                                               |
| AC-04f       | IDOR check #1 (table↔whiteboard) + IDOR check #2 (every id ∈ table) (§2.2.3)                                                                                                                                                                                       |
| AC-05a/b/c   | Handle IDs are stable; `updateNodeInternals` re-anchors                                                                                                                                                                                                             |
| AC-05d       | Same-commit `setNodes` + tick bump → `useLayoutEffect` → `updateNodeInternals` (pre-paint, SA-M1)                                                                                                                                                                   |
| AC-06a/b/c/d | `reconcileAfterDrop` `isNoOp` branch (newOrder===null OR `arraysEqual(newOrder, preDragOrder)`); zero writes, zero emits, zero toasts unless a buffered remote needs to be applied (AC-14f)                                                                         |
| AC-07a       | Server is single source of truth; whichever `column:reorder` arrives last wins                                                                                                                                                                                      |
| AC-07b       | All clients receive `column:reordered` with the winning ordered list                                                                                                                                                                                                |
| AC-07c       | `localDraggingByTable` set during drag → incoming `column:reordered` is buffered, not applied                                                                                                                                                                       |
| AC-07d       | Server's ack OR broadcast is the final state; `onColumnReorderAck` reconciles divergences                                                                                                                                                                           |
| AC-08a       | Local optimistic update happens synchronously inside `setNodes`; rAF mark confirms paint                                                                                                                                                                            |
| AC-08b       | No reconciliation needed when ack matches optimistic order                                                                                                                                                                                                          |
| AC-08c       | Rollback in `onColumnReorderError`; toast wording per REQ-15                                                                                                                                                                                                        |
| AC-08d       | FIFO bounded to 5; 6th drag is gated at `handleDragStart` via `isQueueFullForTable` (SA-M3) — never starts                                                                                                                                                          |
| AC-08e/f     | `onSyncReconcile` compares server vs. `lastOptimisticByTable[tableId]`; `dirtyByTable` flag controls toast; `lastConfirmedOrder` seeded from initial whiteboard load so first-ever-reorder-loss is detectable (SA-H1)                                               |
| AC-09a/b/c   | `<DndContext autoScroll={{ speed: 600 …}}>` with viewport-only `canScroll`                                                                                                                                                                                          |
| AC-09d       | `prefersReducedMotion` toggles speed to 300 + acceleration: 1 (linear)                                                                                                                                                                                              |
| AC-10a/b/c   | `onDragCancel` handler + window-level `keydown` Escape listener                                                                                                                                                                                                     |
| AC-11a-e     | DEFERRED to V2 (REQ-11 P2; WCAG debt logged)                                                                                                                                                                                                                        |
| AC-12a       | `<TooltipProvider delayDuration={400}>`                                                                                                                                                                                                                             |
| AC-12b       | Existing `@/components/ui/tooltip` shadcn component                                                                                                                                                                                                                 |
| AC-12c       | Tooltip is hover-triggered; touch devices have no hover                                                                                                                                                                                                             |
| AC-12d       | `if (isDragging) return handle` short-circuit unmounts Tooltip                                                                                                                                                                                                      |
| AC-12e       | Radix Tooltip auto-wires `aria-describedby`                                                                                                                                                                                                                         |
| AC-13a       | DragOverlay `dropAnimation: prefersReducedMotion ? null : default`; ColumnRow transition omitted under reduced motion                                                                                                                                               |
| AC-13b       | InsertionLine has no CSS transition by default                                                                                                                                                                                                                      |
| AC-13c       | `usePrefersReducedMotion` reads once at drag start (in TableNode); the value is captured into a ref for the duration of the drag                                                                                                                                    |
| AC-14a       | `handleDragStart` sets `localDraggingByTable[tableId]`; `onColumnReorderedFromOther` checks the flag and buffers in `bufferedRemoteByTable` (SA-H4)                                                                                                                 |
| AC-14b       | `reconcileAfterDrop` compares `bufferedRemoteByTable.get(tableId)` vs `newOrder` via `detectOverwriteConflict` (SA-H2)                                                                                                                                              |
| AC-14c       | Toast text matches PRD verbatim                                                                                                                                                                                                                                     |
| AC-14d       | `duration: 8000` on `toast()`                                                                                                                                                                                                                                       |
| AC-14e       | `detectOverwriteConflict` (column-level intersection of moved-columns + final-position comparison); fires only when A and B both moved at least one common column AND their final positions for at least one such column differ. Disjoint moves → no toast. (SA-H2) |
| AC-14f       | `reconcileAfterDrop` no-op branch: when drop is no-op or cancelled, applies `bufferedRemoteByTable.get(tableId)` via `applyServerOrder` and clears the buffer; no toast (SA-H4)                                                                                     |
| AC-14g       | `emitColumnReorder` is called as the last step in `reconcileAfterDrop`'s real-reorder branch, after the SA-H2 toast logic                                                                                                                                           |
| AC-15a/b     | Toast wording in §2.4.3 / §2.4.1 — "try again", never "refresh"                                                                                                                                                                                                     |
| AC-15c       | Existing `sonner` toast (already imported in `ReactFlowWhiteboard.tsx`)                                                                                                                                                                                             |

---

## 5. Decisions Log

Decisions made by Hephaestus while writing this spec, in priority order per the Decision Criteria framework (consistency → simplicity → reversibility → performance):

| Decision                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                     | Trade-off given up                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use `@dnd-kit/core` + `@dnd-kit/sortable` (not `react-dnd` or custom)                               | `@dnd-kit` is the modern community default; pointer-based; Spike S1 confirmed it composes cleanly with `nodrag` classes; smaller bundle than `react-dnd`; explicit support for "handle owns activation" via `setActivatorNodeRef`.                                                                                                                                      | `react-dnd` has a longer track record and more drag types (file drop, etc.) — irrelevant here.                                                                                                            |
| Re-sequence `order` to 0..N-1 on every transaction (not sparse)                                     | Simpler invariants; the existing `AddColumnRow` only ever appends, so sparse-spacing's mid-insert benefit has no payoff.                                                                                                                                                                                                                                                | Future cross-table column move would benefit from sparse spacing — but that feature is OOS V1 and can re-introduce sparsity later.                                                                        |
| Single Prisma `$transaction` of N `column.update` calls (not raw SQL)                               | Matches the pattern in `createColumns` (column.ts:36-52); keeps Prisma type safety; well within latency budget at N≤30.                                                                                                                                                                                                                                                 | Lower-level `$executeRaw` would be ~5× faster at the SQL level, irrelevant at our scale.                                                                                                                  |
| Server emits `column:reorder:ack` to sender (separate from `column:reordered` broadcast to others)  | Lets the FIFO queue resolve the head entry deterministically. Avoids the design wart of "emit broadcast to sender just to ignore it".                                                                                                                                                                                                                                   | Slight protocol asymmetry vs. `column:create` (which emits the same `column:created` to sender + others). The `column:create` reuse exists because of temp-ID swap logic, which doesn't apply to reorder. |
| Use `closestCenter` collision detection (not `closestCorners` or `pointerWithin`)                   | `closestCenter` gives the midpoint-snap behavior PRD AC-02d requires for vertical lists of uniform height. Documented `@dnd-kit` choice for sortable lists.                                                                                                                                                                                                             | `pointerWithin` is more "natural" for free-form drops but produces erratic insertion-line jumps in tight rows.                                                                                            |
| Use `restrictToParentElement` + `restrictToVerticalAxis` modifiers (constrain to source table only) | AC-02e requires drag scope to source table. These modifiers enforce it.                                                                                                                                                                                                                                                                                                 | Cross-table drag would require different modifiers — out of scope.                                                                                                                                        |
| FIFO queue is per-table (not global)                                                                | Two reorders on different tables are unrelated; no reason to serialize them. AC-08d's "5 pending" bound applies per-table.                                                                                                                                                                                                                                              | A global queue would simplify the toast logic ("slow down" applies to anything in flight), but is a worse user experience.                                                                                |
| Capture `preDragOrderRef` at dragStart (not read live `visibleColumns` at drop)                     | Robust against incoming `column:reordered`/`column:created`/`column:deleted` arriving mid-drag and mutating `visibleColumns`. Deterministic optimistic computation.                                                                                                                                                                                                     | Slight memory overhead (≤30 UUIDs × 36 chars ≈ 1KB per drag).                                                                                                                                             |
| `updateNodeInternals` triggered via state-bumped tick (not direct call from mutations hook)         | The hook returns `updateNodeInternals` from `useUpdateNodeInternals`, which is only available inside the React Flow context. Routing the trigger through a state-tick keeps the hook React-Flow-context-agnostic.                                                                                                                                                       | Slightly more indirection — but the hook is more reusable.                                                                                                                                                |
| No `KeyboardSensor` in V1                                                                           | REQ-11 is P2 stretch; WCAG debt is explicitly accepted in PRD Section 12. Architecture remains open.                                                                                                                                                                                                                                                                    | V1 ships without WCAG 2.1.1 Level A conformance for the reorder operation — a known, logged debt.                                                                                                         |
| Auto-scroll override to `speed: 600 px/s` (override `@dnd-kit`'s ~750 default)                      | PRD AC-09a sets 600 as the explicit target with a 20% tolerance window. 750 vs 600 is 25% — outside the window.                                                                                                                                                                                                                                                         | Slightly slower scroll than the library default. Empirical implementation tuning required (Phase 5).                                                                                                      |
| Server-side merge of FM-07 (not client-side)                                                        | The server is the only source of truth that knows the table's current canonical column set. Client trying to merge before emit would race against `column:created` events the server has but client hasn't.                                                                                                                                                             | More complex server validation logic — but it lives in one place.                                                                                                                                         |
| `useLayoutEffect` for `updateNodeInternals` (not `useEffect`) — SA-M1 resolved                      | AC-05d's "edges re-anchor in the same render pass — no flicker" is a pre-paint guarantee. `useEffect` runs after paint by spec; `useLayoutEffect` runs before paint and is React's only documented hook for pre-paint side effects. The component is client-only (TanStack Start hydration boundary), so the SSR warning of `useLayoutEffect` does not apply here.      | None — `useLayoutEffect` is strictly better for this use case; the only theoretical downside (SSR warning) is irrelevant.                                                                                 |
| Defer `applyServerOrder` on ack until queue is empty (SA-H3)                                        | Calling `applyServerOrder` while later optimistic reorders are still in flight overwrites their state and produces a visible snap-back, violating AC-04c. Recording the ack as confirmed and waiting for the final ack (queue-empty) preserves the optimistic display for in-flight items.                                                                              | Sub-second window where an FM-07-merged column may not appear in the user's view until the queue drains. Within PRD's "subsecond reconciliation" tolerance for FM-07.                                     |
| Compare against `lastOptimisticByTable` (not `lastConfirmedOrder`) in `onSyncReconcile` (SA-H1)     | The first-ever-reorder-loss case has `lastConfirmedOrder === undefined` until an ack arrives. Comparing against the user's last optimistic intent guarantees the toast fires whenever the user's intent diverges from the server truth, regardless of how the divergence happened (FM-04 emit-never-arrived, FM-04 server-crashed-pre-broadcast, partition-during-ack). | Slight memory overhead — one Map<tableId, string[]> tracking optimistic intent. Already required for the queue's preState anyway.                                                                         |
| Seed `lastConfirmedOrder` from initial whiteboard load (SA-H1)                                      | Without an initial seed, `lastConfirmedOrder` is undefined for any table the user has never successfully ack'd a reorder on, breaking AC-08e/f's first-ever-reorder-loss case. Seeding from the server's order on initial load guarantees a baseline.                                                                                                                   | None — seeding is idempotent and adds no runtime cost.                                                                                                                                                    |
| Column-level intersection check for REQ-14 overwrite (not full-array equality) — SA-H2              | AC-14e explicitly states the toast suppresses when B's reorder touched columns A did not. Full-array `arraysEqual` produces false positives whenever any column moved in A's reorder, even if B's moves were disjoint from A's. The intersection-of-moved-columns + final-position comparison precisely implements AC-14e.                                              | Slightly more compute (O(N) Map construction + O(N) intersection at N≤30 — negligible).                                                                                                                   |
| Single `reconcileAfterDrop` entry-point on every drop (SA-H4)                                       | AC-14f requires applying buffered-remote on no-op drop. Branching `handleDragEnd` to early-return on no-op silently dropped the buffered-remote application path. Routing every drop through one function — including the cancelled and invalid cases — guarantees the buffer is always inspected and `localDraggingByTable` is always cleared.                         | Slightly more code in the mutations hook; offset by simpler call sites in `TableNode`.                                                                                                                    |
| Queue-full check at `handleDragStart` (not drag-end) — SA-M3                                        | AC-08d's "do not initiate" semantics are best honored by refusing the drag before any optimistic visual occurs. Checking at drag-end produces phantom optimistic ghost rows and snap-backs that thrash the UI.                                                                                                                                                          | Slight UX friction — user can attempt a 6th drag and be told "wait" instead of seeing partial feedback; this is the correct trade-off per the AC.                                                         |

---

## 6. Open Risks for Cassandra (Stage 10)

(R#1 from v1 — `useEffect` timing — and R#4 from v1 — REQ-14 strict-subset detection — have been resolved in v2 and moved to §5 Decisions Log per Apollo SA-M1 and SA-H2.)

1. **Risk: `@dnd-kit` autoScroll `canScroll` matching React Flow's viewport class names**. The class names `react-flow__viewport` / `react-flow__renderer` are part of `@xyflow/react`'s public CSS API but could change between versions. **Mitigation**: cite the specific `@xyflow/react@12.x` class names in a comment; pin minor version in package.json; add an integration test that asserts auto-scroll fires when dragging near the table-node edge.
2. **Risk: Tooltip + drag interaction**. `if (isDragging) return handle` unmounts the Radix Tooltip mid-drag. Radix Tooltip listens for keyboard focus and may mount a portal. Fast-flicker at drag start could leave a Tooltip portal stranded. **Mitigation**: use `<Tooltip open={isDragging ? false : undefined}>` instead of conditional unmount; this controls visibility without remount.
3. **Risk: 30-column performance threshold (PRD A9 / OQ-5)**. `@dnd-kit/sortable`'s `verticalListSortingStrategy` is O(N) per pointer move on N items. At N=30 this is fine; at N=100 it could jank. **Mitigation**: PRD's threshold is 30, which is well within `@dnd-kit`'s established performance profile (their own demos use 100+ items at 60fps). Document the threshold in code; add a perf smoke test.
4. **Risk: `cancelActiveDrag` plumbing for SA-M3 queue-full guard**. `@dnd-kit`'s public API does not expose a "cancel from outside" call directly; the spec proposes either a sensor-cancel ref or a synthetic Escape `keydown` on the document. The synthetic Escape route is fragile — if the user presses Escape themselves during the same frame, the events could collide. **Mitigation**: prefer the sensor-cancel ref pattern (assign in `onDragStart`, invoke in `handleDragStart`'s queue-full branch). Cassandra to verify behavior at queue depth 5 + slow connection during risk review.
5. **Risk: `column:reorder:ack` vs. `column:reordered` ordering at queue depth ≥ 2 (SA-M2)**. Socket.IO uses a single TCP connection per namespace, which guarantees in-order delivery, so an ack for queue item #1 should always arrive before the broadcast for queue item #2. However, this is not specified anywhere as a hard guarantee on the application's contract. **Mitigation**: covered by a unit test in Phase 4 (see §3) — simulate ack(#1) followed by broadcast(#2) and assert no double-snap, no buffered-remote bookkeeping confusion. If the test ever fails (e.g., due to a future Socket.IO transport switch to per-event channels), the FIFO logic must be revisited.

---

## 7. Files Touched Summary

**Created (7 files)**:

- `src/hooks/use-column-reorder-mutations.ts`
- `src/hooks/use-column-reorder-collaboration.ts`
- `src/hooks/use-prefers-reduced-motion.ts`
- `src/components/whiteboard/column/DragHandle.tsx`
- `src/components/whiteboard/column/InsertionLine.tsx`
- (test file) `src/hooks/use-column-reorder-mutations.test.ts`
- (test file) `src/hooks/use-column-reorder-collaboration.test.ts`

**Modified (7 files — was 6 in v1; added the protocol-docs file per SA-L2)**:

- `src/data/column.ts` (add `reorderColumns`)
- `src/data/schema.ts` (add `reorderColumnsSchema`)
- `src/routes/api/collaboration.ts` (add `column:reorder` handler + ack; SA-L1 inline note about RBAC stub)
- `src/components/whiteboard/column/ColumnRow.tsx` (wire `useSortable`, render DragHandle)
- `src/components/whiteboard/TableNode.new.tsx` (wrap in `DndContext` + `SortableContext`, add lifecycle handlers per §2.3.5 incl. SA-M3 + SA-H4 wiring, render DragOverlay + InsertionLine)
- `src/components/whiteboard/ReactFlowWhiteboard.tsx` (instantiate hooks, wire callbacks, install `useLayoutEffect` for `updateNodeInternals` per SA-M1, seed + reconcile per SA-H1)
- `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md` (SA-L2: document the three new events `column:reorder` / `column:reordered` / `column:reorder:ack` with payloads and emit-direction)

**Dependencies added (3)**:

- `@dnd-kit/core ^6.3.1`
- `@dnd-kit/sortable ^10.0.0`
- `@dnd-kit/utilities ^3.2.2`

**No database migrations required.** `Column.order` already exists.

---

## 8. References

- PRD: `.claude/feature/column-reorder/prd.md` (Revision 1, approved 2026-04-30)
- Decisions log: `.claude/feature/column-reorder/decisions.md`
- PRD challenge: `.claude/feature/column-reorder/prd-challenge.md`
- Existing pattern (Socket.IO column events): `src/routes/api/collaboration.ts:551-727`
- Existing pattern (collaboration hook): `src/hooks/use-column-collaboration.ts`
- Existing pattern (mutations hook): `src/hooks/use-column-mutations.ts`
- Existing pattern (`nodrag` usage): see Spike S1 §0
- Handle ID architecture: `src/lib/react-flow/edge-routing.ts:27-57`
- React Flow version: `@xyflow/react ^12.9.2` (`package.json`)
- User memory note (relevant): `feedback_reactflow_handles.md` — handle ID stability is load-bearing
- User memory note (relevant): `feedback_zod_uuid_not_cuid.md` — all IDs validated as `.uuid()` (applied in `reorderColumnsSchema`)
- User memory note (relevant): `feedback_secure_context.md` — develops over LAN; PRD's LAN p95 target reflects this
