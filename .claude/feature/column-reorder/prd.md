# PRD: Column Reorder

**Feature**: column-reorder
**Author**: Athena (PM Agent)
**Date**: 2026-04-30
**Status**: Draft (Revision 1 — addressing Nemesis review)
**Priority**: P1 - High

---

## 1. Problem Statement

Users of the ER diagram whiteboard can add, edit, and delete columns inline within table nodes (delivered in `dynamic-field-management`), but they cannot change the order of columns once they exist. The visual order of columns inside a table is meaningful for ER design — primary keys and identifiers conventionally appear at the top, foreign keys are grouped, and audit fields (`createdAt`, `updatedAt`) are usually pinned at the bottom. Today, if a user adds a column late, it lands at the bottom regardless of its logical position. Their only recourse is to delete and recreate columns in sequence, which destroys foreign-key relationships referencing those columns (cascade deletes) and breaks collaborator views during the rebuild.

The backend is already partially ready for reorder:

- The `Column.order` field exists in the Prisma schema (`@@index([order])`).
- The data-layer function `updateColumnOrder(id, order)` exists in `src/data/column.ts`.
- The HTTP server function `updateColumnOrderFn` exists in `src/routes/api/columns.ts`.

The gap is on the frontend (no drag-handle UI, no DnD logic, no reorder broadcast handler) and on the WebSocket server (no `column:reorder` event for cross-collaborator sync — `column:update` is per-column and not designed to carry batch order changes atomically).

---

## 2. Users

### Primary User: Database Designer

A developer or database architect refining a schema on the whiteboard. They expect to grab any column, drag it up or down, drop it in a new position, and have the table immediately reflect that order — locally, persistently, and for anyone else watching the same whiteboard.

### Secondary User: Collaborating Viewer

A teammate viewing the same whiteboard. They are not initiating the reorder but must see column order changes appear within seconds of the originating user's drop, without refresh, with foreign-key edges still anchored to the correct columns.

### Returning User (Existing User First Encountering This Feature)

A user who used the whiteboard before this feature shipped. They have a pre-existing mental model of the column row that does NOT include a drag handle. They must discover the new affordance without a tutorial — via a visible drag handle, an on-hover tooltip ("Drag to reorder"), and a `cursor: grab` / `cursor: grabbing` change.

### First-Time User

A user opening the whiteboard for the first time after this feature ships. They see the drag handle as a normal part of the UI from day one. The same on-hover tooltip ("Drag to reorder") gives them a textual cue.

### Persona Scope Decisions (explicit in/out)

| Persona                                    | In V1?                    | Justification                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database Designer (mouse / trackpad)       | **In**                    | Primary user.                                                                                                                                                                                                                                                                                                                                                                               |
| Collaborating Viewer                       | **In**                    | Secondary user.                                                                                                                                                                                                                                                                                                                                                                             |
| Returning User (existing user post-deploy) | **In**                    | Discovery vector: visible handle + on-hover tooltip (REQ-12).                                                                                                                                                                                                                                                                                                                               |
| First-Time User (new install post-deploy)  | **In**                    | Same discovery vector — handle + tooltip works regardless of install age.                                                                                                                                                                                                                                                                                                                   |
| Mac trackpad user                          | **In**                    | Pointer events normalize trackpad and mouse. `cursor: grab/grabbing` works on Mac. No special treatment.                                                                                                                                                                                                                                                                                    |
| Screen-reader user                         | **Out of V1 (with debt)** | Drag-and-drop alone fails WCAG 2.1.1 (Keyboard, Level A). Keyboard reorder (REQ-11) is P2 stretch in V1. The team **explicitly accepts the WCAG 2.1.1 Level A non-conformance for V1** and tracks it as compliance debt (see Section 12 — WCAG Debt). Tech-spec must verify there is no contractual or regulatory obligation that forbids this for the project's user base before V1 ships. |
| User with reduced-motion preference        | **Partially in V1**       | Auto-scroll during drag and ghost-row rendering must respect `prefers-reduced-motion: reduce`. When set, ghost-row animation is reduced to instant snap (no smoothing) and auto-scroll uses a constant low velocity (no easing). See REQ-09 / REQ-13.                                                                                                                                       |
| Touch / mobile user                        | **Out of V1**             | Whiteboard is desktop-focused (consistent with `dynamic-field-management`).                                                                                                                                                                                                                                                                                                                 |

---

## 3. Goals and Success Metrics

| Goal                                             | Metric                                                                                                                                                                                                                                                                                     | Baseline | Target                                                   | Owner     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------- | --------- |
| Users can reorder columns without leaving canvas | % of column-order changes accomplished via drag (vs. delete-and-recreate)                                                                                                                                                                                                                  | 0%       | 100%                                                     | Frontend  |
| Reorder persists across reload                   | Page-refresh test: dragged order matches DB order on reload                                                                                                                                                                                                                                | N/A      | 100% pass                                                | Backend   |
| Reorder syncs to collaborators (localhost)       | p95 latency from User A's `pointerup` (drop) timestamp to User B's first repainted frame containing the new column order. Measured via `performance.mark` on A and B; sample size ≥ 30 reorders; warm cache.                                                                               | N/A      | **p95 < 500ms (localhost-to-localhost on same machine)** | WebSocket |
| Reorder syncs to collaborators (LAN)             | Same metric on two machines on the same Wi-Fi LAN, typical home-WiFi RTT ≤ 30ms. Sample size ≥ 30. Warm cache.                                                                                                                                                                             | N/A      | **p95 < 1000ms (LAN at typical home Wi-Fi)**             | WebSocket |
| Drag interaction feels responsive (optimistic)   | Time from User A's `pointerup` event timestamp to the next browser frame painted with the new column order in DOM. Measured via `performance.mark('drop')` at `pointerup` and `performance.measure` to `requestAnimationFrame` callback that observes the new DOM order. Sample size ≥ 30. | N/A      | **p95 < 100ms**                                          | Frontend  |
| Reorder does not orphan or break edges           | FK edges visually re-anchor to dragged column after reorder; no dangling edges                                                                                                                                                                                                             | N/A      | 0 dangling edges per 100 reorders                        | Frontend  |
| No unnecessary writes                            | Drag-and-drop in original slot                                                                                                                                                                                                                                                             | N/A      | 0 DB writes, 0 WS events emitted                         | Frontend  |
| User is never silently overwritten               | When User A overrides another user's reorder mid-drag, A receives a passive notification (REQ-14). Test: simulate concurrent drag → 100% of overwrites surface a toast.                                                                                                                    | N/A      | 100%                                                     | Frontend  |
| User is never silently rolled back               | When a post-reconnect sync contradicts a pending optimistic reorder, A receives a passive notification (REQ-08 AC-08e). Test: simulate disconnected drop → 100% of lost reorders surface a toast.                                                                                          | N/A      | 100%                                                     | Frontend  |

### Measurement Methodology Reference (cited by metric definitions above)

- **Drop timestamp**: the `Performance.now()` value captured during the `pointerup` (DOM) event handler that ends the drag. The handler MUST capture this mark before computing the new order or issuing the WebSocket emit. Implementation: `performance.mark('column-reorder:drop')` at the first line of the `pointerup` handler.
- **Local repaint timestamp**: the first `requestAnimationFrame` callback after `pointerup` whose DOM read confirms the new column order is visible in the table-node DOM. Implementation: `performance.mark('column-reorder:local-paint')` inside that rAF callback after a DOM-read assertion.
- **Remote repaint timestamp**: on User B's client, the first `requestAnimationFrame` after the `column:reordered` socket event handler returns whose DOM read confirms the new order. Implementation: `performance.mark('column-reorder:remote-paint')` mirroring the local-paint pattern.
- **Latency calculation**: B's `remote-paint` minus A's `drop` (clocks aligned via WebSocket round-trip subtraction OR via NTP-equivalent server timestamp echo — tech-spec to choose).
- **Sample size**: minimum 30 reorders per condition (localhost, LAN). Warm cache (initial whiteboard load complete, no cold-start penalty).

---

## 4. Requirements

### P0 - Must Have

#### REQ-01: Drag Handle on Each Column Row

**Description**: Every column row inside a table node must display a drag handle. Pressing on the handle and moving the cursor initiates a column-reorder drag.

**User Flow**:

1. User hovers over a column row.
2. A drag handle (grip icon, e.g. `lucide-react`'s `GripVertical`) is visible on the left edge of the row.
3. Cursor over the handle is `grab`.
4. User presses pointer down on the handle. Cursor switches to `grabbing`. The reorder drag begins.
5. The handle is the only initiator — pressing on the column name, type, or constraint badges does NOT start a drag.

**Acceptance Criteria**:

- AC-01a: Each column row displays a drag handle on its left edge.
- AC-01b: The handle is visible whenever the column row is rendered (not hover-only) so users can discover the affordance without exploration.
- AC-01c: Hovering the handle shows `cursor: grab`; pressing shows `cursor: grabbing`.
- AC-01d: The handle has `aria-label="Reorder column [name]"` for screen reader users.
- AC-01e: Pressing pointer-down anywhere outside the handle (e.g., on the name, type, or constraint badge) does NOT start a reorder drag — those existing interactions (double-click to edit, single-click to toggle) continue to work unchanged.
- AC-01f: The drag handle and reorder UI are only visible when the table node display mode shows columns (i.e., not in `TABLE_NAME` mode).
- AC-01g: While a column is being dragged, React Flow's canvas-level pan and node-drag MUST NOT also engage. The column drag must visually claim the pointer until drop.

#### REQ-02: Drag Visual Feedback

**Description**: While the user is dragging a column, the UI must show two pieces of feedback simultaneously: (1) a ghost row that follows the cursor, and (2) an insertion line between rows showing where the column will land on drop.

**User Flow**:

1. User starts dragging a column row.
2. The original row in the list dims (50% opacity, exact) so the user can still see context.
3. A ghost row — a semi-transparent copy of the dragged column row at 80% opacity (exact) — follows the cursor, offset 8px right and 8px down from the cursor's hot-spot.
4. An insertion line (a horizontal line 2px thick, accent color) appears between two rows indicating the drop target. It updates as the cursor moves above/below other rows.
5. If the cursor returns to the original slot, the insertion line appears at the original position, signalling a no-op drop.

**Acceptance Criteria**:

- AC-02a: While dragging, the original row's opacity is exactly 50% (`opacity: 0.5`). Its space in the layout is preserved so the table does not visually collapse.
- AC-02b: A ghost row renders at the cursor position. It is a visual copy of the dragged column row at exactly 80% opacity (`opacity: 0.8`).
- AC-02c: The ghost row is positioned at-cursor and is offset by exactly 8px to the right and 8px down from the cursor hot-spot, so it does not sit directly on top of and obscure the insertion line.
- AC-02d: An insertion line is drawn between rows at the prospective drop position. The drop position is computed as: when the cursor's Y-coordinate crosses the vertical midpoint of row N (going down), the insertion line snaps to the gap between row N and row N+1. When going up, the insertion line snaps to the gap between row N-1 and row N when the cursor crosses row N's vertical midpoint going up. The transition is not interpolated — the line jumps to the new gap at the midpoint crossing. If the cursor is exactly on the midpoint, the insertion line stays at its previous position (hysteresis: no flicker on exact midpoint). If the cursor leaves the source table's column-list bounds, the insertion line disappears (drop will be a no-op cancel).
- AC-02e: The ghost and insertion line are scoped to the source table — dragging cannot suggest a drop outside the table containing the original column.
- AC-02f: On drop or cancel (Escape), the ghost row and insertion line disappear immediately.

#### REQ-03: Persist Reordered Position (Transactional)

**Description**: When the user drops a column in a new position, the new order must be persisted to the database in a single atomic transaction and survive page reload.

**Persistence Approach (mandatory)**:

- On drop, the frontend computes the new ordering of all affected columns within the table.
- The frontend issues a **single batch reorder request** that updates the `order` value of every column whose order changed within **one database transaction**.
- A new batch endpoint (`reorderColumnsFn(tableId, orderedColumnIds[])` or its WebSocket equivalent) MUST be added that wraps the per-column updates in a single Prisma transaction (`prisma.$transaction`).
- **Non-transactional implementation paths are forbidden by this PRD.** Specifically: issuing N parallel `updateColumnOrderFn` calls from the frontend (one per changed column) is not permitted, because partial failure would leave the database in an intermediate ordering state — directly violating AC-03b. The choice of HTTP vs. WebSocket transport is still a tech-spec decision; the transactional requirement is not.

**Acceptance Criteria**:

- AC-03a: After dropping a column in a new position, refreshing the page shows the columns in the dropped order.
- AC-03b: The reorder operation is atomic — if persistence fails for ANY of the changed columns, NO column's `order` is updated in the database, the local optimistic order reverts, and an error toast shows. There is no observable partial-reorder intermediate state at the database level or the UI level.
- AC-03c: The `Column.order` field of every column whose position changed is updated in the database within a single Prisma transaction. Columns whose absolute index did not change are not re-written.
- AC-03d: No-op drop (column dropped in its original slot): zero DB writes, zero WebSocket emits, zero error toasts. The UI returns to its pre-drag state without flicker.
- AC-03e: Order values are non-negative integers. The exact spacing scheme (sequential `0..N-1`, or sparse spacing for future inserts) is a tech-spec decision; what this PRD requires is that `ORDER BY order ASC` reads them in the user's intended order.
- AC-03f: The batch endpoint MUST reject the request if any `orderedColumnIds` entry is not a member of the table's current column set OR if there are duplicates OR if the array length is zero. Validation failure → no DB write, error event to caller.

#### REQ-04: Real-Time Sync to Collaborators

**Description**: When User A reorders columns in a table, User B (viewing the same whiteboard) sees the new order on their canvas within 500ms (localhost) / 1000ms (LAN) of the drop, without refreshing.

**WebSocket Event** (new — does not exist server-side today):

- `column:reorder` (client → server): `{ tableId: uuid, orderedColumnIds: uuid[] }` — the full ordered list of column IDs after the drop, scoped to one table.
- `column:reordered` (server → other clients): `{ tableId: uuid, orderedColumnIds: uuid[], reorderedBy: userId }`. The `reorderedBy` field is reserved for the in-flight overwrite notification (REQ-14) — receiving clients use it to know which collaborator's reorder may have been overridden by their own pending drop. (This justifies its presence in the payload — it is not a vestigial field.)

**Why a new event (and not `column:update` per column)**:

- A reorder is a single user action. Broadcasting N separate `column:updated` events causes collaborators to render N intermediate states (e.g., briefly two columns at order=3) before convergence.
- A single `column:reorder` event lets the receiving client apply the entire new order in one render pass — no flicker, no intermediate states.
- Per-column `column:update` would also force collaborators to recompute order for columns that didn't actually change properties, conflating two different concerns.

**Acceptance Criteria**:

- AC-04a: When User A drops a column in a new position, User B sees the new order within 500ms (p95, localhost-to-localhost) and within 1000ms (p95, LAN). Measurement methodology per Section 3.
- AC-04b: The broadcast is scoped to the whiteboard namespace — only collaborators in the same whiteboard receive it.
- AC-04c: The receiving client applies the order change in a single render pass. Specifically: between the receipt of the `column:reordered` event and the next painted frame, no intermediate ordering (e.g., two columns sharing the same order value) is observable in the React Flow node DOM.
- AC-04d: A no-op reorder (REQ-03 AC-03d) emits NO `column:reorder` event.
- AC-04e: If the reorder fails server-side validation (e.g., `orderedColumnIds` does not match the table's column set), the originating client receives an error event, the local UI reverts to the pre-drag order, and no `column:reordered` is broadcast. The toast message is "Unable to reorder columns. Please try again." (Refresh is NOT recommended in this toast — see REQ-15 toast guidance.)
- AC-04f: The server validates that all `orderedColumnIds` belong to `tableId` and that `tableId` belongs to the calling user's whiteboard (IDOR prevention, matching the existing `column:update` ownership check at `collaboration.ts:625-644`).

#### REQ-05: Edges Re-Anchor on Reorder

**Description**: Foreign-key edges (relationships) drawn between columns must visually follow their endpoint columns when those columns reorder. After a reorder, no edge should appear dangling, point at empty space, or attach to a different column than before.

**Why this requirement is explicit**:

- React Flow edges in this codebase attach to column-level handles whose IDs encode the column ID (see `feedback_reactflow_handles.md` in user memory: "Handle ID architecture is fragile, column-level handles required").
- A reorder changes the visual position of a column row inside its table node. The edge's anchor point (the React Flow handle position) must update to follow.

**Acceptance Criteria**:

- AC-05a: After reordering a column that is a relationship source or target, the edge attached to that column visually re-anchors to the column's new row position within the table.
- AC-05b: No edge is broken, removed, or re-routed to a different column as a side effect of reorder.
- AC-05c: The edge endpoint identity is preserved — the relationship's `sourceColumnId` and `targetColumnId` in the database remain unchanged. Reorder only changes `order`, never relationship FKs.
- AC-05d: For collaborators receiving a `column:reordered` event, edges re-anchor in the same render pass as the order change — no visible flicker of edges pointing at wrong rows.

#### REQ-06: No-Op Drop is a True No-Op

**Description**: If the user drops a column at its original index (i.e., the order array is unchanged), the system MUST NOT issue any database write or WebSocket event.

**Acceptance Criteria**:

- AC-06a: Dropping a column in its original slot performs zero DB writes.
- AC-06b: Dropping a column in its original slot emits zero WebSocket events.
- AC-06c: Dropping a column in its original slot triggers zero error toasts and zero UI flicker.
- AC-06d: The check is "did the ordered ID array change?", not "did the cursor move during the drag?". A user who picks up a column, hovers over multiple rows, then returns to the start, has produced a no-op.

#### REQ-07: Concurrent Reorder Resolution (Last-Write-Wins, with Notification)

**Description**: If two collaborators reorder columns in the same table at nearly the same time, the system applies last-write-wins — whichever `column:reorder` arrives at the server last sets the final order. **However, last-write-wins must never be silent for the user whose pending drag will overwrite a teammate's already-applied change.** The originating client of the overwriting reorder receives a passive notification (REQ-14).

**Why an explicit decision (not "matching existing patterns" alone)**:

- Column edits in `dynamic-field-management` are single-field updates where last-write-wins is non-controversial — the user is editing one cell, not a collection.
- Reorder is a batch operation: a single user action affects N columns and overwrites the entire ordering. The user impact of a silent overwrite is materially larger.
- This PRD therefore keeps last-write-wins for backend behavior (matching the existing pattern) but adds a UX requirement (REQ-14) that the user be informed when their drop overrode another user's already-applied reorder.

**Acceptance Criteria**:

- AC-07a: When User A and User B both reorder the same table concurrently, the database state after both events have been processed reflects the last-arriving event's `orderedColumnIds`.
- AC-07b: All collaborators (including A and B) converge to the same final order via the server's broadcast of the winning event. No conflict-resolution UI is shown.
- AC-07c: An incoming `column:reordered` event from another user, received while the local user is mid-drag, does NOT cancel the local drag. The local drag completes; on drop, the local change becomes the new last-write — AND REQ-14's notification is triggered.
- AC-07d: If a `column:reordered` arrives between local drop and server ack, the server's authoritative order (broadcast) wins. The originating client reconciles to whatever the server returns.

### P1 - Should Have

#### REQ-08: Optimistic UI (with Reconciliation Notification)

**Description**: On drop, the column list locally re-orders before waiting for the server response. On server failure, the list reverts. **If a post-reconnect sync (FM-04) reconciles the table to a state that contradicts a pending optimistic reorder, the user is notified — never silently rolled back.**

**Acceptance Criteria**:

- AC-08a: The visible column order updates within 100ms (p95) of drop, before server confirmation. Measurement methodology per Section 3.
- AC-08b: On server success, no visible change occurs (already updated).
- AC-08c: On server failure, the list reverts to the pre-drag order and an error toast shows: "Unable to reorder columns. Please try again." (No "refresh" guidance — see REQ-15.)
- AC-08d: While the server response is pending, the UI does not block additional reorders — but a second reorder issued before the first acks queues serially (no out-of-order writes). The queue is FIFO and bounded to 5 pending reorders; over the limit, the 6th drop's `pointerdown` shows a toast "Slow down — previous reorders still saving" and does not initiate a new drag.
- AC-08e: When a `sync:request` reconciliation (post-reconnect) is processed and the resulting column order for the table differs from the local table's optimistic order, AND the local client had at least one optimistic reorder that has not been confirmed by a `column:reordered` broadcast, the client surfaces a toast: "Your last column reorder may not have saved. Please verify the order and try again if needed." The local state is then reconciled to the server state.
- AC-08f: AC-08e applies regardless of how the optimistic reorder was lost (server never received it, server crashed before broadcast, network partition during ack). The detection is purely: "after reconnect-sync, does the server's order differ from my optimistic order?"

#### REQ-09: Auto-Scroll During Drag (Reduced-Motion Aware)

**Description**: When dragging near the top or bottom edge of a tall table node (one with many columns where not all rows fit on screen), the React Flow canvas should auto-scroll so the drop target stays reachable. _Note_: most table nodes will fit fully on screen; this requirement applies only to tables with enough columns to extend beyond the visible viewport.

**Acceptance Criteria**:

- AC-09a: When the cursor is within 40px of the top or bottom edge of the table node during a drag, the React Flow canvas auto-pans toward that edge at a rate of **600 px/s** (default; tech-spec may use the chosen DnD library's documented default value if it differs by < 20%, e.g., `@dnd-kit/auto-scroll`'s default; the value used MUST be documented in the tech spec).
- AC-09b: Auto-scroll stops when the cursor moves away from the edge zone or when the drag ends.
- AC-09c: The drag remains active while auto-scroll is occurring — the user does not have to release and re-grab.
- AC-09d: When the user has `prefers-reduced-motion: reduce` set, auto-scroll uses a fixed velocity of **300 px/s** with no easing curve (linear), and ghost-row position transitions are instant (no smoothing). The intent is to avoid any easing/momentum effect for users who have explicitly opted out.

#### REQ-10: Cancel Drag with Escape

**Description**: Pressing the Escape key during a drag aborts the reorder — the dragged column returns to its original position, no DB write, no broadcast.

**Acceptance Criteria**:

- AC-10a: Pressing Escape during an active drag immediately ends the drag.
- AC-10b: After Escape, the column list shows the pre-drag order. The ghost row and insertion line disappear.
- AC-10c: Escape during drag emits zero DB writes and zero WebSocket events (it is functionally a no-op cancel).

#### REQ-12: Drag Handle Tooltip ("Drag to reorder")

**Description**: The drag handle on each column row displays a tooltip on hover with the text "Drag to reorder". This is the primary discovery vector for the new affordance — both for existing users (who have a pre-existing mental model of column rows without a handle) and for first-time users.

**Acceptance Criteria**:

- AC-12a: When the user hovers the drag handle for ≥ 400ms (standard tooltip delay), a tooltip appears with the text "Drag to reorder".
- AC-12b: The tooltip uses the project's existing shadcn/ui `Tooltip` component (no new UI component is introduced).
- AC-12c: The tooltip does not appear on touch devices (where there is no hover state) — touch is out of scope for V1 anyway.
- AC-12d: The tooltip is dismissed immediately when the user begins dragging (`pointerdown` on the handle).
- AC-12e: The tooltip text is announced to screen readers (the `aria-describedby` association exists per shadcn `Tooltip` defaults), in addition to the existing `aria-label="Reorder column [name]"` from AC-01d.

#### REQ-13: Reduced-Motion Compliance

**Description**: When the user has `prefers-reduced-motion: reduce` set in their OS or browser, the reorder UI suppresses non-essential motion effects. This is in addition to REQ-09 AC-09d (auto-scroll).

**Acceptance Criteria**:

- AC-13a: Ghost-row position transitions follow the cursor with no easing/lerp/momentum when reduced-motion is set; the ghost is rendered exactly at cursor position each frame.
- AC-13b: Insertion-line position transitions are instant (no fade/slide).
- AC-13c: The reduced-motion check is performed via `window.matchMedia('(prefers-reduced-motion: reduce)')` once per drag start; the check result applies for the duration of that drag.

### P2 - Stretch (Must Not Block Ship; explicit WCAG debt — see Section 12)

#### REQ-11: Keyboard Reorder

**Description**: When a column row has keyboard focus, `Alt+ArrowUp` moves the column up by one slot; `Alt+ArrowDown` moves it down by one slot. Each keystroke is its own atomic reorder.

**Acceptance Criteria**:

- AC-11a: Column rows are keyboard-focusable (`tabindex="0"` or equivalent).
- AC-11b: When a column row is focused, `Alt+ArrowUp` and `Alt+ArrowDown` reorder the column.
- AC-11c: Each Alt+Arrow keystroke goes through the same reorder path as drag-and-drop (same persistence, same broadcast).
- AC-11d: At the top or bottom of the list, the corresponding Alt+Arrow is a no-op.
- AC-11e: This requirement is **stretch**. Implementation may defer to a follow-up if column rows are not yet keyboard-focusable in the existing `ColumnRow` component. **If deferred, the team accepts that V1 ships without WCAG 2.1.1 (Keyboard, Level A) conformance for the reorder operation. See Section 12 — WCAG Debt.**

### P0 - Must Have (continued)

#### REQ-14: In-Flight Overwrite Notification

**Description**: When a buffered remote `column:reordered` event is overridden by the local user's own drop (FM-05), the local user is informed via a passive notification. This prevents silent collaborative-edit data loss.

**User Flow**:

1. User A is mid-drag.
2. User B's `column:reordered` event arrives at A's client and is buffered (not applied to the table during A's active drag, to avoid yanking rows out from under A's cursor).
3. A drops. A's optimistic order is computed from A's pre-drag snapshot, NOT from B's buffered order.
4. A's reorder is sent to the server. The server applies it on top of B's already-persisted order, effectively overwriting B's reorder for any positions where the two orderings disagree.
5. A's client compares the buffered remote order against A's about-to-send local order. If they differ, AND A's local order will overwrite at least one position from the buffered remote order, a passive toast is shown to A: "Another collaborator reordered columns while you were dragging. Your order was applied — theirs was overwritten."
6. The toast is NOT a blocking dialog; A's reorder still goes through (last-write-wins is preserved).

**Acceptance Criteria**:

- AC-14a: While A is mid-drag, incoming `column:reordered` events for the same `tableId` are buffered, NOT applied to the live DOM.
- AC-14b: On A's drop, before sending A's reorder, the client compares the buffered remote `orderedColumnIds` (if any) against A's local `orderedColumnIds`. If they are not equal AND the difference involves at least one position that B had moved (i.e., B's change is not a strict subset of A's change), the toast specified above is shown.
- AC-14c: The toast text is exactly: **"Another collaborator reordered columns while you were dragging. Your order was applied — theirs was overwritten."** (Tech-spec may include the collaborator's display name if available from the buffered event's `reorderedBy` field — this justifies `reorderedBy`'s presence in the payload.)
- AC-14d: The toast is dismissable by the user; auto-dismisses after 8 seconds (longer than a standard toast, since the user needs to read the full message).
- AC-14e: If the buffered remote order is a strict subset / no-op relative to A's local order (e.g., B reordered a different table, or B's reorder happens to match A's), no toast is shown — there was no overwrite.
- AC-14f: If A's drop is a no-op (REQ-06), no toast is shown (A did not actually reorder anything to overwrite B's change with — the buffered remote order is then applied to A's view in the post-drop reconciliation).
- AC-14g: After the toast, A's reorder proceeds normally — the server applies it last-write-wins, broadcasts, and all clients converge.

#### REQ-15: Toast Guidance Policy

**Description**: Error toasts and notifications shown by this feature follow a standardized guidance policy to avoid recommending actions that could destroy unsaved user state.

**Acceptance Criteria**:

- AC-15a: Toasts shown for **operation-failed** cases (FM-01 validation, FM-02 IDOR, FM-03 DB write failure) recommend "try again" — never "refresh". Refresh would discard the user's other in-flight optimistic edits in the whiteboard, which could include unrelated column edits, table renames, etc.
- AC-15b: Toasts shown for **connection-degraded** cases (FM-04 disconnect, REQ-08 AC-08e reconnect mismatch) MAY recommend "try again" but MUST NOT recommend "refresh" as the primary action. The connection-status indicator (existing from `dynamic-field-management` REQ-06) is the user's primary signal that the page may be out-of-sync.
- AC-15c: All toasts in this feature use the existing shadcn/ui toast component — no new toast UI is introduced.

---

## 5. User Flows

### Flow 1: Reorder a Column via Drag

```
[Table node with multiple columns visible]
    |
    v
[User hovers a column row -- drag handle visible on left edge]
    |
    v
[After ~400ms hover on handle, tooltip "Drag to reorder" appears]
    |
    v
[User presses pointer-down on handle -- cursor changes to grabbing; tooltip dismissed]
    |
    v
[Original row dims to 50% opacity; ghost row at 80% opacity appears at cursor + 8/8px offset; insertion line appears at original slot]
    |
    v
[User drags -- ghost follows cursor, insertion line jumps between rows as cursor crosses midpoints]
    |
    +--- [User drops in NEW slot] -----------> [New order applied locally (optimistic, < 100ms)]
    |                                              |
    |                                              v
    |                                          [Frontend issues batch reorder (transactional); emits column:reorder]
    |                                              |
    |                                              +--- [Success] --> [Server broadcasts column:reordered to others]
    |                                              |                       [FK edges re-anchor on all clients]
    |                                              |                       [If buffered remote reorder was overridden, show REQ-14 toast]
    |                                              |
    |                                              +--- [Failure] --> [Local order reverts; error toast (no "refresh" guidance)]
    |
    +--- [User drops in ORIGINAL slot] -------> [No-op: no DB write, no WS event, UI returns to pre-drag state]
    |
    +--- [User presses Escape mid-drag] ------> [Cancel: revert to pre-drag, no DB, no WS]
```

### Flow 2: Receive a Reorder from Another Collaborator (User B is the receiver)

```
[User A drops column in new position on their canvas]
    |
    v
[User A's client emits column:reorder { tableId, orderedColumnIds }]
    |
    v
[Server validates: all IDs in table, table in caller's whiteboard]
    |
    +--- [Validation passes] --> [Server batch-updates Column.order in single transaction]
    |                                |
    |                                v
    |                            [Server broadcasts column:reordered to other clients in whiteboard namespace]
    |                                |
    |                                v
    |                            [User B's client applies new order in single render pass]
    |                            [FK edges re-anchor in the same pass]
    |                            [If User B is mid-drag on the same table, event is buffered (REQ-14)]
    |
    +--- [Validation fails] --> [Server emits error to caller; no broadcast; A's client reverts]
```

### Flow 3: Concurrent Reorder by Two Users (with overwrite notification)

```
[User A drags column 'email' from slot 2 to slot 0 on whiteboard W]
[User B (simultaneously) drags column 'createdAt' from slot 5 to slot 3 on whiteboard W]
    |
    v
[Both drops occur at near-identical times]
    |
    v
[B drops first (~10ms earlier); B's column:reorder reaches server first]
    |
    v
[Server applies B's order; broadcasts column:reordered to all]
    |
    v
[A's client receives the column:reordered event WHILE A is still mid-drag on the same table]
    |
    v
[A's client BUFFERS the event -- does NOT apply it to A's view (would yank rows out from under A's cursor)]
    |
    v
[A drops (~10ms after B); A's client compares buffered remote order vs. A's local order]
    |
    v
[They differ -- A's local order will overwrite B's change at slot 5/3]
    |
    v
[Toast shown to A: "Another collaborator reordered columns while you were dragging. Your order was applied -- theirs was overwritten."]
    |
    v
[A's reorder is sent to server; server applies on top of B's, broadcasts]
    |
    v
[All clients converge to A's order (last-write-wins, but A is informed of the overwrite -- per REQ-14)]
```

### Flow 4: Drag Then Cancel with Escape

```
[User starts dragging column]
    |
    v
[Ghost row + insertion line appear; cursor is grabbing]
    |
    v
[User presses Escape]
    |
    v
[Drag ends immediately; ghost row + insertion line disappear]
[Original column row returns to full opacity in original slot]
[No DB write, no WS event, no error toast]
```

### Flow 5: Disconnect Mid-Drag, Reconnect, Reorder Was Lost (REQ-08 AC-08e)

```
[User A is connected; drags column to new slot]
    |
    v
[Network drops just before A's drop fires]
    |
    v
[A's drop applies optimistically locally; column:reorder is queued by Socket.IO -- but never delivered]
    |
    v
[Connection-status indicator turns red/orange (existing UX from dynamic-field-management REQ-06)]
    |
    v
[After several seconds, connection restored; sync:request fires automatically]
    |
    v
[Server returns the table's order from the database -- A's reorder was never persisted]
    |
    v
[A's client compares server order vs. A's optimistic order; they differ]
    |
    v
[Toast to A: "Your last column reorder may not have saved. Please verify the order and try again if needed."]
    |
    v
[A's local state reconciles to server state; A re-attempts the reorder if needed]
```

---

## 6. Scope

### In Scope (V1)

- Drag-and-drop reordering of columns within a single table node, via a per-row drag handle.
- Visual feedback during drag: dimmed source row (50% opacity), ghost row at cursor + 8/8px offset (80% opacity), insertion line at drop target with midpoint-snap behavior and hysteresis at exact midpoint.
- Drag handle tooltip ("Drag to reorder") on hover (REQ-12) — primary discovery vector.
- Persistence of new order to PostgreSQL via **transactional** batch update of `Column.order` values (REQ-03 — Option A is mandatory).
- Real-time sync to collaborators via a new `column:reorder` / `column:reordered` WebSocket event pair.
- IDOR-style ownership validation on the server (matching the existing `column:update` pattern).
- Last-write-wins for concurrent reorders, with **passive overwrite notification** to the overwriting user (REQ-14).
- Detect-and-notify when a post-reconnect sync silently rolls back an optimistic reorder (REQ-08 AC-08e).
- No-op detection (drop in original slot triggers nothing).
- Optimistic UI with revert on server failure.
- Escape-to-cancel during drag.
- FK edges re-anchor automatically when their endpoint columns reorder.
- Auto-scroll during drag for tables that overflow the viewport (P1 — should-have), with reduced-motion compliance.
- Reduced-motion compliance for ghost-row and insertion-line transitions (REQ-13).
- Drag handle has accessible `aria-label` and tooltip (`aria-describedby`).
- Toast guidance policy: never recommend "refresh" for operation-failed cases (REQ-15).

### Stretch (V2 candidates — must not block V1 ship)

- Keyboard reorder via `Alt+ArrowUp` / `Alt+ArrowDown` on focused column rows (REQ-11). **Note: deferring this means V1 ships without WCAG 2.1.1 (Keyboard, Level A) conformance for the reorder operation. See Section 12 — WCAG Debt.**

### Out of Scope (V1)

- **Cross-table column drag.** Reorder is strictly within a single table.
- **Undo/redo for reorder.** Consistent with `dynamic-field-management`.
- **Touch / mobile drag.** Desktop-focused; consistent with `dynamic-field-management`.
- **Reorder via context menu** (e.g., "Move up", "Move to top"). Drag handle is the only V1 input method; keyboard reorder is the only stretch goal.
- **Bulk reorder** (multi-select then drag). One column at a time.
- **Dragging into a collapsed / `TABLE_NAME`-mode table.** When the table's display mode hides columns, the drag handles are hidden and reorder is not possible.
- **Reordering across whiteboards.**
- **Conflict resolution UI** (CRDTs, OT, manual conflict resolution prompts). V1 uses last-write-wins **with overwrite notification** (REQ-14).
- **Custom order spacing strategies** (gap-based, fractional indexing). The exact integer scheme is a tech-spec decision.
- **Screen-reader-only reorder path.** Until REQ-11 ships, screen-reader users cannot reorder columns. This is documented WCAG debt (Section 12).
- **Reorder-specific audit log UI.** The `reorderedBy` field is in the WebSocket payload (used by REQ-14) but is NOT surfaced in any persistent audit log or activity feed.

---

## 7. Failure Modes

### FM-01: Server Rejects Reorder (Validation Failure)

**Trigger**: Server-side Zod validation fails — e.g., `orderedColumnIds` contains an ID not belonging to `tableId`, contains duplicates, omits an existing column, or is empty.

**User Impact**: Local optimistic order applied on drop reverts after server response.

**Handling**:

1. Server emits an `error` event with `event: 'column:reorder'`, `error: 'VALIDATION_FAILED'`, and a message.
2. No `column:reordered` is broadcast to other clients.
3. The originating client reverts to the pre-drag order.
4. An error toast shows: **"Unable to reorder columns. Please try again."** (No "refresh" guidance — REQ-15 AC-15a.)

### FM-02: Server Rejects Reorder (IDOR / Wrong Whiteboard)

**Trigger**: The calling user's session is on whiteboard X but the request specifies a `tableId` that belongs to whiteboard Y.

**User Impact**: Local optimistic order reverts.

**Handling**: Same as FM-01 with `error: 'FORBIDDEN'` and a different toast message: **"You don't have permission to reorder columns in this table."**

### FM-03: Database Write Failure

**Trigger**: PostgreSQL transaction fails (connection lost, deadlock, etc.). Because REQ-03 mandates transactional batch update, partial-success states are impossible — the transaction either commits in full or rolls back in full.

**User Impact**: Local optimistic order reverts.

**Handling**:

1. Server emits `error` event with `error: 'UPDATE_FAILED'`.
2. No broadcast.
3. Originating client reverts.
4. Error toast: **"Unable to save column order. Please try again."** (No "refresh" guidance — REQ-15 AC-15a.)

### FM-04: WebSocket Disconnection During Drag

**Trigger**: Network interrupted while user is dragging (drag started while connected, drop happens after disconnect).

**User Impact**: The user can complete the drag locally. The drop will fire the reorder — but the WebSocket emit will be queued or lost depending on Socket.IO's state.

**Handling**:

1. The drop applies locally (optimistic).
2. The reorder request goes via WebSocket; if delivered after reconnect, the server processes it as normal.
3. If the WebSocket connection is lost permanently, the queued event is dropped. On reconnection, `sync:request` (existing event) fires automatically and the client reconciles to whatever the server has — which may be the pre-drag order if the disconnected reorder never arrived.
4. **REQ-08 AC-08e applies**: if the post-reconnect server state contradicts the local optimistic order, a toast notifies the user — they are NOT silently rolled back.
5. The connection-status indicator (existing from `dynamic-field-management` REQ-06) warns the user that collaborators may not see their changes during disconnection.
6. The user may then re-do the reorder.

### FM-05: Concurrent Reorder by Another User Mid-Drag (with Notification)

**Trigger**: User A is mid-drag on a column. User B reorders the same table and the broadcast arrives at User A's client before A drops.

**User Impact**: A is dragging based on a now-stale view of the column order. **Without intervention, A's drop would silently overwrite B's change. This is the silent-data-loss bug Nemesis flagged.**

**Handling** (revised — adds REQ-14 notification):

1. The incoming `column:reordered` event is buffered — it does NOT immediately re-render the table during A's active drag (which would yank rows out from under A's cursor and is disorienting).
2. When A drops, A's local "new order" is computed from A's pre-drag snapshot of column IDs (not from B's just-arrived order).
3. **Before sending A's reorder, A's client checks: does A's local order overwrite at least one position from the buffered remote order? If yes, the REQ-14 toast is shown to A: "Another collaborator reordered columns while you were dragging. Your order was applied — theirs was overwritten."**
4. A's reorder is sent to the server. The server applies it on top of B's already-persisted order, which may visually undo B's change. This is intentional per last-write-wins.
5. After A's drop completes, all clients (including A) converge to A's order.
6. **The user is no longer silently overwriting their teammate.**

### FM-06: Reorder Targets a Column That Was Just Deleted

**Trigger**: User A starts dragging column X. User B deletes column X. The `column:deleted` arrives at A mid-drag.

**User Impact**: A is dragging a ghost of a column that no longer exists.

**Handling**:

1. On receipt of `column:deleted` for the column currently being dragged, A's client cancels the active drag immediately (same effect as Escape).
2. The ghost row and insertion line disappear.
3. The deleted column is removed from the table.
4. No error toast — the deletion was intentional by another user, mirroring `dynamic-field-management` FM-06's pattern.

### FM-07: Reorder Race with Column Add (server-merge with re-sequencing)

**Trigger**: User A is mid-reorder. User B adds a new column. The `column:created` arrives at the server before A's `column:reorder`.

**User Impact**: A's `orderedColumnIds` does not include B's new column.

**Handling** (tightened — addresses Nemesis MAJOR):

1. Server-side validation accepts A's reorder if `orderedColumnIds` is a strict subset of the table's current columns (i.e., contains only valid column IDs in the table; missing newly-added columns is OK; extras and unknowns are rejected per AC-03f).
2. The server constructs the merged order as follows: A's `orderedColumnIds` are placed first in the order specified by A. **Any column in the table NOT present in A's `orderedColumnIds` (i.e., the newly-added columns) is appended in ascending order of its existing `Column.order` value.** This produces a deterministic full ordering.
3. The server then re-sequences the merged ordering to `0..N-1` (or the project's chosen integer scheme — tech-spec decision per AC-03e) within the same transaction and persists.
4. The server broadcasts `column:reordered` with the full merged & re-sequenced `orderedColumnIds`.
5. All clients (including A) converge to the merged order. A's view briefly diverges from the server's full order until the broadcast arrives — this is acceptable for V1 (subsecond reconciliation).
6. **The previous PRD's "leaves missing columns at their existing order value (typically the largest)" wording is replaced — the merged-and-re-sequenced rule above is deterministic and does not rely on assumptions about how new columns were appended.**

---

## 8. Assumptions

| #   | Assumption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Risk if Wrong                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The existing `Column.order` field and `updateColumnOrder()` data-layer function are functional and correct. Verified via `prisma/schema.prisma` (line 163: `order Int @default(0)`, line 173: `@@index([order])`) and `src/data/column.ts` lines 120-141.                                                                                                                                                                                                                                                          | Low — verified.                                                                                                                                                                                             |
| A2  | The Socket.IO server pattern (Zod validation, IDOR ownership check, broadcast-on-success, error event on failure) for a new `column:reorder` event can mirror the existing `column:update` handler at `src/routes/api/collaboration.ts` lines 611-671 with no architectural changes.                                                                                                                                                                                                                               | Low — the pattern is well-established in this codebase.                                                                                                                                                     |
| A3  | A drag-and-drop library (e.g., `@dnd-kit/core` + `@dnd-kit/sortable`) needs to be added as a dependency. No DnD library is currently installed (verified `package.json` — no `@dnd-kit/*`, no `react-dnd`, no `react-beautiful-dnd`). The project mandates shadcn + Tailwind for UI; DnD is a behavior library, not a UI library, and is permitted.                                                                                                                                                                | Medium — adding a dependency requires Hephaestus to choose the library in tech-spec. If `@dnd-kit` proves incompatible with React Flow's pointer events, an alternative or a custom solution may be needed. |
| A4  | **(ELEVATED — see Section 13 Required Spikes)** React Flow's pointer-event handling can be locally suppressed during a column drag (e.g., via `nodrag` class or by stopping propagation on the column's pointer events) so that React Flow does not start a node-drag or canvas-pan when the user grabs a column. The previously-cited precedent (inline-edit double-click) is materially weaker than a sustained pointer-down with movement, which is what column reorder requires from React Flow's perspective. | **Medium-to-High — this assumption MUST be validated by a pre-tech-spec spike (see Section 13). Failure here is the difference between "use `@dnd-kit`" and "build custom pointer handling".**              |
| A5  | Last-write-wins is acceptable for concurrent reorder, **provided REQ-14 prevents silent overwrite**. The "matching existing patterns" rationale is insufficient on its own for a batch operation — REQ-14's notification requirement is the load-bearing user-protection mechanism here, and the rationale is now based on user-impact analysis (see REQ-07's "Why an explicit decision" section), not on pattern-matching alone.                                                                                  | Low (with REQ-14 in scope) — without REQ-14, this would be Medium-High due to silent-data-loss risk.                                                                                                        |
| A6  | FK edges in React Flow re-anchor automatically when the column row's DOM position changes within the table node, because the React Flow handles are positioned relative to the column row's offset. (To verify in tech-spec.)                                                                                                                                                                                                                                                                                      | Medium — if edge anchors are computed from cached positions rather than live DOM, edges may visibly lag behind reorder. Mitigation: tech-spec must verify and add `updateNodeInternals` calls if needed.    |
| A7  | The existing `connectionState` indicator and reconnect/`sync:request` flow from `dynamic-field-management` REQ-06 are sufficient for reorder's degraded-mode UX, **complemented by REQ-08 AC-08e's reconcile-and-toast detection.**                                                                                                                                                                                                                                                                                | Low — reuses existing infrastructure plus the new AC.                                                                                                                                                       |
| A8  | The drag handle iconography (`GripVertical` from `lucide-react`) is acceptable. `lucide-react` is already a dependency.                                                                                                                                                                                                                                                                                                                                                                                            | Low — verified.                                                                                                                                                                                             |
| A9  | Tables with up to 30 columns remain responsive during a reorder drag with no perceptible jank (target: 60fps during drag, ≥ 50fps allowed). The previous PRD listed conflicting numbers (40+ in A9 / 30 in OQ-5); this is now resolved at **30 columns minimum** as the tech-spec smoke-test threshold.                                                                                                                                                                                                            | Medium — if 30-column tables jank, performance tuning may be required. Threshold is unified across A9 and OQ-5.                                                                                             |

---

## 9. Dependencies

| Dependency                                                                                    | Type            | Status                                                                                                                                                                                                                      | Risk                                                            |
| --------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `Column.order` field in Prisma schema                                                         | Database        | Exists (no migration needed)                                                                                                                                                                                                | Low                                                             |
| `updateColumnOrder(id, order)` in `src/data/column.ts`                                        | Backend         | Exists                                                                                                                                                                                                                      | Low                                                             |
| `updateColumnOrderFn` HTTP server function in `src/routes/api/columns.ts`                     | Backend         | Exists (single-column)                                                                                                                                                                                                      | Low                                                             |
| Batch transactional reorder endpoint (`reorderColumnsFn` or its WebSocket equivalent)         | Backend         | **Does not exist — must be added**                                                                                                                                                                                          | Low                                                             |
| Socket.IO server handler for `column:reorder`                                                 | Infrastructure  | **Does not exist — must be added**                                                                                                                                                                                          | Low (mirrors `column:update` pattern at `collaboration.ts:611`) |
| Drag-and-drop library (`@dnd-kit/core` + `@dnd-kit/sortable` or equivalent)                   | Frontend        | **Not installed — must be added**                                                                                                                                                                                           | Medium (compat with React Flow, see A4 — REQUIRES SPIKE)        |
| React Flow node-internal interactions (existing patterns in `TableNode.new.tsx`)              | Frontend        | Exists                                                                                                                                                                                                                      | Low                                                             |
| `useColumnCollaboration` hook pattern                                                         | Frontend        | Exists — extensible for reorder events                                                                                                                                                                                      | Low                                                             |
| `connectionState` and reconnect/`sync:request` flow                                           | Frontend        | Exists                                                                                                                                                                                                                      | Low                                                             |
| shadcn/ui Tooltip (for REQ-12 drag-handle tooltip)                                            | UI              | **Available — verify installed via `bunx shadcn@latest add tooltip` in tech-spec if missing**                                                                                                                               | Low                                                             |
| shadcn/ui Toast (for REQ-08, REQ-14, REQ-15 notifications)                                    | UI              | Available (existing usage)                                                                                                                                                                                                  | Low                                                             |
| `lucide-react` `GripVertical` icon                                                            | UI              | Available                                                                                                                                                                                                                   | Low                                                             |
| TanStack Query for cache invalidation after reorder                                           | Frontend        | Available                                                                                                                                                                                                                   | Low                                                             |
| Product/Comms: in-app release-notes or changelog entry calling out the new reorder affordance | Non-engineering | **Out of scope for this PRD's engineering work, but noted as a recommended communication accompaniment to the feature ship.** REQ-12 (tooltip) is the primary in-app discovery vector and does not depend on release notes. | Low                                                             |

---

## 10. Open Questions

| #    | Question                                                                                                                | Impact                 | Proposed Default                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | Should the reorder broadcast carry the full new ordered ID list, or just `{ columnId, oldOrder, newOrder }` deltas?     | Backend / WebSocket    | Full ordered ID list. Simpler for the receiver — they replace their order array directly with no risk of off-by-one drift. The cost (a few hundred bytes per reorder for typical tables) is negligible.                                                                                                   |
| OQ-2 | Should the batch reorder be a new HTTP server function OR exclusively go through WebSocket (matching `column:create`)?  | Architecture           | Tech-spec decision (Hephaestus). The existing `column:create`/`column:update`/`column:delete` are WebSocket-only handlers (post the dynamic-field-management Apollo SA-C1 decision to avoid double-persistence). The same pattern is recommended here: a single WebSocket-only path for `column:reorder`. |
| OQ-3 | What happens if a user with VIEWER role tries to reorder?                                                               | Permissions / Security | Same as existing column-edit permission policy in this app: any whiteboard collaborator has full edit rights (per the user-confirmed default in clarification). No new permission gate required.                                                                                                          |
| OQ-4 | Should the `order` integers be re-sequenced to `0..N-1` on every reorder, or use sparse spacing (e.g., 1000-step gaps)? | Backend / Performance  | Tech-spec decision. PRD does not require either approach. From the user's perspective, only `ORDER BY order ASC` matters.                                                                                                                                                                                 |
| OQ-5 | Maximum table size at which reorder remains responsive?                                                                 | Performance            | Tech-spec smoke-test at **30 columns** (unified with A9). If jank appears, address in implementation.                                                                                                                                                                                                     |
| OQ-6 | Does keyboard reorder (REQ-11) need its own broadcast mechanism, or does it reuse `column:reorder`?                     | Stretch / Architecture | Reuse `column:reorder`. Each Alt+Arrow keystroke is its own atomic reorder, identical in payload to a drag drop.                                                                                                                                                                                          |
| OQ-7 | What should the auto-scroll velocity be exactly?                                                                        | UX / Performance       | 600 px/s default (REQ-09 AC-09a); 300 px/s when `prefers-reduced-motion: reduce` (AC-09d). Tech-spec may use the chosen DnD library's documented default if it differs by < 20% — the value used MUST be documented.                                                                                      |

---

## 11. External Research Summary

No external research was commissioned for this PRD — the requirements are tightly bounded by existing codebase patterns, and the user's clarification answers resolved the meaningful product decisions (drag visuals, conflict policy, scope boundaries). The tech-spec phase (Hephaestus) may want to research React Flow + drag-and-drop library compatibility (e.g., `@dnd-kit` documentation, known issues with React Flow node-internal DnD); that research belongs at spec time, not PRD time.

If implementation hits friction with React Flow + `@dnd-kit` interaction (per Assumption A4 / Section 13 spike), that is the natural moment to summon Mimir for a focused technical investigation.

---

## 12. WCAG Accessibility Debt (Explicit V1 Decision)

**Status**: V1 ships **without WCAG 2.1.1 (Keyboard, Level A) conformance** for the column-reorder operation, contingent on REQ-11 remaining P2 stretch.

**Why this is a debt entry rather than a blocker**:

- Drag-and-drop alone is not keyboard-accessible.
- Making column rows keyboard-focusable + adding Alt+Arrow handlers + integrating with the same reorder backend is meaningful work beyond the core mouse-DnD scope.
- The team has chosen to ship the core feature (mouse DnD) first and follow up with REQ-11 as a fast-follow. The risk profile is accepted.

**What this means for tech-spec and ship-decision**:

- Hephaestus does not need to design keyboard reorder for V1 (only the architecture must be open to it without rework).
- Before V1 ships, the team must verify:
  - The product has no contractual WCAG 2.1.1 Level A obligation that this violates (e.g., a B2B customer's accessibility commitment, a public-sector requirement).
  - The product's published accessibility statement (if any) does not claim Level A conformance.
- If either check fails, REQ-11 MUST be promoted to P0 and shipped in V1.
- **This decision is explicitly logged in `decisions.md` as an accepted compliance debt.**

**Mitigation in V1** (without REQ-11):

- Drag handle has `aria-label="Reorder column [name]"` (AC-01d) for screen-reader announcement of the affordance.
- Tooltip text "Drag to reorder" is announced via `aria-describedby` (AC-12e), giving screen-reader users a textual cue that a non-keyboard interaction exists.
- Screen-reader users can still use existing add/delete operations to recreate columns in a different order — this is a workaround, not a fix.

---

## 13. Required Pre-Tech-Spec Spikes

Before Hephaestus commits to a DnD library choice and writes the tech spec, the following spikes MUST be completed and their results documented in the tech spec:

### Spike S1: React Flow Pointer Suppression (resolves Assumption A4)

**Question**: Can React Flow's pointer-event handling be locally suppressed for a column drag (via `nodrag` class, event-stopping, or a similar mechanism) such that:

- Pressing pointer-down on a drag handle starts a column reorder drag (using the chosen DnD library).
- React Flow does NOT also start a node-drag or canvas-pan.
- The column drag visually claims the pointer until drop.
- This works robustly across mouse and trackpad input.

**Method**: Build a 30-minute proof-of-concept inside `TableNode.new.tsx` that:

1. Renders a column row with a `GripVertical` handle.
2. Wires up `@dnd-kit/core` (or the candidate library) to that handle.
3. Verifies that pointer-down on the handle does NOT trigger React Flow's `onNodeDragStart`.
4. Verifies that pointer-move during the drag does NOT pan the canvas.

**Outcome required before tech-spec entry**:

- **Pass** → proceed with `@dnd-kit` (or chosen library); document the suppression mechanism (which class, which event-stopping, which `nodrag` invocation).
- **Fail** → tech-spec must specify a custom pointer-handling implementation (lower risk of React Flow conflicts, but more code) OR an alternative DnD library.

### Spike S2: Edge Re-Anchor Behavior (resolves Assumption A6)

**Question**: When a column row's DOM position changes within a React Flow node, do the edges attached to that column's handle re-anchor automatically, or is an explicit `updateNodeInternals` call required?

**Method**: Build a 15-minute proof-of-concept that programmatically reorders two columns in an existing table node (via state mutation) and observes whether:

1. The edges visually re-anchor to the new row position immediately.
2. The edges visually re-anchor only after a `useUpdateNodeInternals` call.
3. The edges break or attach to the wrong column.

**Outcome required before tech-spec entry**:

- The tech spec must specify whether `updateNodeInternals` is called on reorder (and if so, with what timing relative to the state update).

---

## Appendix A: Existing Backend API Reference (Reorder-Relevant)

| Function / Endpoint                              | File                                         | Purpose                                                                                                               | Status                     |
| ------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `updateColumnOrder(id, order)`                   | `src/data/column.ts:126-141`                 | Update one column's `order` field via Prisma.                                                                         | Exists                     |
| `updateColumnOrderFn(params)`                    | `src/routes/api/columns.ts:286-318`          | HTTP server function: update one column's order. Auth-gated (with RBAC commented out).                                | Exists, single-column      |
| `reorderColumnsFn(tableId, orderedColumnIds[])`  | (TBD — does not exist)                       | Proposed batch endpoint to update all column orders for a table in a single transaction. **Mandatory transactional.** | **Must be added (REQ-03)** |
| `socket.on('column:reorder', ...)`               | (TBD — does not exist in `collaboration.ts`) | Proposed WebSocket handler. Pattern mirrors `column:update` at `collaboration.ts:611-671`.                            | **Must be added**          |
| `socket.broadcast.emit('column:reordered', ...)` | (TBD)                                        | Proposed broadcast event for collaborators.                                                                           | **Must be added**          |

**Existing IDOR-prevention pattern to mirror** (from `column:update` at `collaboration.ts:625-644`):

```text
1. Look up the column by ID.
2. If not found, emit error 'NOT_FOUND'.
3. Look up the table that owns the column.
4. If the table's whiteboardId does not match the caller's whiteboardId, emit error 'FORBIDDEN'.
```

For `column:reorder`, the equivalent is: look up the table by `tableId`, verify `table.whiteboardId === caller's whiteboardId`, and additionally verify that every entry in `orderedColumnIds` belongs to that `tableId`.

---

## Appendix B: WebSocket Event Inventory (Reorder-Relevant Additions)

**Existing column events** (no change):

| Event            | Direction        | Status |
| ---------------- | ---------------- | ------ |
| `column:create`  | Client → Server  | Exists |
| `column:created` | Server → Clients | Exists |
| `column:update`  | Client → Server  | Exists |
| `column:updated` | Server → Clients | Exists |
| `column:delete`  | Client → Server  | Exists |
| `column:deleted` | Server → Clients | Exists |

**New events for this feature**:

| Event              | Direction        | Payload                                                            | Status          |
| ------------------ | ---------------- | ------------------------------------------------------------------ | --------------- |
| `column:reorder`   | Client → Server  | `{ tableId: uuid, orderedColumnIds: uuid[] }`                      | **To be added** |
| `column:reordered` | Server → Clients | `{ tableId: uuid, orderedColumnIds: uuid[], reorderedBy: userId }` | **To be added** |

`reorderedBy` is consumed by REQ-14 on the receiving client (to optionally include the collaborator's display name in the overwrite-notification toast). It is NOT consumed by any audit/log UI in V1.

---

## Appendix C: Revision History

### Revision 1 (2026-04-30) — addressing Nemesis review

**BLOCKING items resolved**:

1. **FM-05 silent overwrite** → REQ-14 added (P0). Toast surfaced when local drop overrides a buffered remote reorder. AC-07c, AC-14a-g, FM-05 handling step 3 all updated.
2. **FM-04 silent reorder loss** → REQ-08 AC-08e/f added. Post-reconnect sync mismatch surfaces a toast. FM-04 handling step 4 references this.
3. **p95 latency methodology** → Section 3 expanded with full measurement methodology (drop timestamp definition, remote-render definition, sample size, warm cache, LAN target added at 1000ms p95).
4. **Optimistic <100ms methodology** → Section 3 expanded with `pointerup`-to-rAF measurement, sample size, `performance.mark` instrumentation specified.
5. **First-time discovery gap** → REQ-12 (tooltip on drag handle) added (P1). Tooltip "Drag to reorder" is the primary in-app discovery vector. New persona "Returning User (Existing User First Encountering This Feature)" added; first-time-user persona added.

**MAJOR items resolved**:

- **REQ-03 transactional mandate** → Option B (parallel per-column writes) explicitly forbidden. Single Prisma transaction is mandatory.
- **REQ-11 / WCAG 2.1.1** → New Section 12 (WCAG Accessibility Debt) explicitly documents the V1 non-conformance, the conditions under which REQ-11 must be promoted to P0, and the V1 mitigations (aria-label, tooltip).
- **FM-07 missing-column placement** → Tightened. New deterministic rule: missing columns appended in ascending order of their existing `Column.order`, then full ordering re-sequenced.
- **Personas** → Added: Returning User, First-Time User, Mac trackpad user, Reduced-motion user, Screen-reader user. Each has an in/out-of-V1 decision with justification.
- **AC-02c / AC-02d testability** → AC-02c specifies "8px right + 8px down"; AC-02d specifies the midpoint-crossing rule and the exact-midpoint hysteresis behavior.
- **"Refresh" toast guidance** → REQ-15 added (P0). Operation-failed toasts say "try again", not "refresh". FM-01 / FM-03 toast text updated.
- **Assumption A4 elevated** → Section 13 (Required Pre-Tech-Spec Spikes) added. Spike S1 (React Flow pointer suppression) and S2 (edge re-anchor) MUST complete before tech-spec.
- **Auto-scroll "moderate speed"** → REQ-09 AC-09a now specifies 600 px/s default (and 300 px/s for reduced-motion). Tech-spec may adopt DnD library default if within 20%.

**MINOR items resolved**:

- AC-02a opacity is now exactly 50% (not "~50%").
- AC-02b opacity is now exactly 80% (not "~80%").
- A9 / OQ-5 unified at 30 columns minimum.
- `reorderedBy` field justified by REQ-14's use of it.
- REQ-07 rationale strengthened beyond "matching existing patterns" — see "Why an explicit decision" section.
- AC-04c "single render pass" tightened to "between event receipt and next painted frame, no intermediate ordering observable in DOM".
- Rapid-succession user persona addressed in AC-08d (FIFO queue, 5-pending bound).
