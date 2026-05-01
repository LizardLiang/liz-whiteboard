# Product Requirements Document (PRD)

## Document Info
| Field | Value |
|-------|-------|
| **Feature** | Auto Layout |
| **Author** | Athena (PM Agent) |
| **Status** | Draft (revised) |
| **Date** | 2026-05-01 |
| **Version** | 1.2 |
| **Revision** | 1.2 — resolves the 1 BLOCKING + 1 MAJOR + 1 MINOR raised by Nemesis round 2: FR-009 rewritten to commit unambiguously to option (a) atomic bulk-broadcast (consistent with NFR Persistence, NFR Collaboration, Risks Row 3, Error Flows); FR-011 pre-run dialog now has explicit a11y ACs (role=alertdialog, focus-trap, initial focus on Run Layout, Esc=Cancel, AT announcement); FR-004 "Equivalent test" parenthetical replaced with a correct L∞-gap formula. Prior 1.1 revision resolved 8 round-1 BLOCKING items. |

---

## 1. Executive Summary

The collaborative ER whiteboard currently relies on users to manually drag every table into a meaningful position. As schemas grow past a handful of tables, this manual placement becomes time-consuming and produces cluttered diagrams where related tables are scattered across the canvas, making the foreign-key (FK) relationship structure hard to read at a glance.

**Auto Layout** adds a single button in the whiteboard toolbar that, on click, repositions every table on the current whiteboard using a force-directed simulation. Tables connected by FK relationships are pulled together; unrelated tables are pushed apart; the simulation produces visually obvious clusters that mirror the schema's logical structure. After the simulation settles, the canvas auto-fits the viewport so the entire diagram is visible in a single zoom level.

**Impact:** users get a readable starting layout in one click for diagrams up to ~100 tables, dramatically reducing the time required to make sense of an unfamiliar schema and enabling them to focus on data modelling rather than canvas housekeeping.

---

## 2. Problem Statement

### Current Situation

The whiteboard supports drag-to-position for individual tables, and new tables drop at a default location. There is no mechanism that uses FK relationships as a layout signal. As a result:

- Newly imported or seeded schemas appear stacked or scattered with no spatial relationship to FK structure.
- Users spend several minutes manually arranging tables every time they open a non-trivial diagram.
- After a heavy session of adding tables, the diagram drifts out of any coherent organisation and is hard to share or screenshot.

There is no existing automatic layout feature in the product.

### Target Users

| Persona | Description | Primary Need |
|---------|-------------|--------------|
| **Schema Author** | Backend engineer or data modeller designing a new schema in the whiteboard | Quickly arrange a working diagram so they can reason about FK structure without dragging every table by hand |
| **Schema Reviewer** | Engineer or PM joining an existing whiteboard to review a teammate's design | Open the diagram and see a readable, FK-driven layout immediately, without having to reorganise someone else's mess |
| **Schema Importer** | User who has just imported a schema (e.g., demo seed, future import path) into a fresh whiteboard | Convert a heap of overlapping tables into an organised diagram with one action |

### Pain Points

1. Manually positioning tables to reflect FK relationships is tedious — every table requires dragging, and the user has to keep mental track of which tables are related.
2. Imported or seeded schemas land in stacked default positions, forcing the user to do layout work before they can even see the structure.
3. With dozens of tables, manual positioning produces inconsistent spacing — clusters become cramped or sparse depending on where the user started.
4. There is no fast way to "reset" a diagram that has drifted into disorganisation.

---

## 3. Goals & Success Metrics

### Business Goals

- Reduce friction when working with non-trivial ER diagrams so the whiteboard remains usable as schemas scale.
- Make FK relationship structure spatially obvious, supporting the product's core value proposition of "see your data model at a glance."
- Provide a low-risk, opt-in (button-triggered) feature so existing users who prefer manual layout are unaffected.

### Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Tables overlapping after Auto Layout (any whiteboard with ≥ 2 tables) | N/A (feature absent) | 0 overlaps | Automated test: after running the layout, no two table bounding boxes intersect on a representative seed dataset (10 / 30 / 100 tables) |
| Visual proximity of FK-related tables | N/A | Median centre-to-centre distance between FK-related tables is ≤ 60% of the median distance between unrelated table pairs | Automated test on the same representative datasets, measuring euclidean distances post-layout |
| Viewport coverage after layout | N/A | 100% of tables visible in the viewport without manual zoom/pan | Automated test asserting every node's bounding box is inside the React Flow viewport bounds after the post-layout fit-view |
| Time to complete layout (perceived "freeze" budget) | N/A | ≤ 2.0s p95 (over 5 consecutive runs) on a 100-table diagram on the **reference benchmark hardware** defined in NFR Performance; **no main-thread longtask ≥ 200ms** during the run, measured via `PerformanceObserver` longtask entries | Performance test in Cassandra's stage with the FK-density fixture defined in NFR Performance |
| Layout determinism for the same input | N/A | Same set of tables + same FK edges → similar visual clusters across runs (cluster membership consistent; absolute positions may differ) | Manual QA spot-check; not a hard pass/fail |

### Out of Scope

- **Selection-based / partial layout.** The button always lays out every table on the current whiteboard. There is no "lay out only selected tables" mode in v1.
- **Preserving existing positions.** All tables are repositioned; existing positions are overwritten. No "merge with current layout" mode.
- **Manual layout parameters in the UI.** Users cannot tune force strengths, link distance, iteration count, etc. from the UI in v1. (Tuning happens in code; can be revisited later.)
- **Undo via a dedicated button.** Standard whiteboard undo (if present) covers the action; Auto Layout does not ship its own dedicated undo control.
- **Alternative algorithms.** Hierarchical (ELK), tree, or grid layouts are out of scope. v1 ships force-directed only, even though `elkjs` is in the dependency tree.
- **Cross-whiteboard or multi-page layout.** Only the active whiteboard is affected.
- **Real-time / continuous layout.** Layout runs once per click and stops; no live re-layout as the user adds tables.
- **Animated transition from old positions to new.** Tables snap to their final positions when the simulation completes. (Optional polish; not required for v1.)
- **Layout for non-table nodes.** Only `TableNode` instances are repositioned. If future node types exist, they are out of scope here.

---

## 4. Requirements

### P0 - Must Have

| ID | Requirement | User Story | Acceptance Criteria |
|----|-------------|------------|---------------------|
| FR-001 | Auto Layout button in the whiteboard toolbar | As a Schema Author, I want a clearly labelled "Auto Layout" button in the toolbar so that I can trigger automatic positioning without hunting through menus | Given I am on a whiteboard with at least one table, When I look at the toolbar, Then I see a button labelled "Auto Layout" (or equivalent icon + tooltip) that is enabled |
| FR-002 | Button disabled when no layout is possible | As a user, I want the button to be disabled when there is nothing to lay out so I am not misled | Given the whiteboard has 0 or 1 tables, When I view the toolbar, Then the Auto Layout button is disabled with a tooltip explaining why ("Add at least 2 tables to use Auto Layout") |
| FR-003 | Force-directed layout uses FK relationships as links | As a Schema Author, I want FK-related tables to be placed near each other so I can see clusters that match my schema's structure | **Definition — "FK-related":** two tables A and B are FK-related iff there exists a `Relationship` row in the database (equivalently, a React Flow edge in the client model) whose `sourceTableId` and `targetTableId` are A and B (in either direction). Only **direct** edges count; transitive relationships (2-hop or "same connected component") do **not** count as FK-related for this metric. **Acceptance:** Given a whiteboard with `n_fk ≥ 1` directly FK-related table pairs **and** `n_unrelated ≥ 1` non-FK-related table pairs, When I click Auto Layout, Then after the layout completes, `median(distance over FK-related pairs) ≤ 0.60 × median(distance over non-FK-related pairs)`. **Edge cases:** (a) If the whiteboard has 0 FK relationships (every pair is unrelated — see also FR-010), the proximity assertion is **skipped**; only FR-004 (no overlap) and FR-006 (fit-view) apply. (b) If every pair of tables is directly FK-related (fully-connected schema), the non-FK denominator is empty and the proximity assertion is **skipped**. (c) For "isolated" tables (a table with no FK to any other table), they participate only in the non-FK-pair set — the simulation's repulsion force still positions them on the canvas but they are not pulled toward any neighbour. (d) Circular FK references (A→B→C→A) count as 3 direct pairs (A-B, B-C, A-C) and are treated identically to any other direct edge. |
| FR-004 | Tables maintain ≥ 16px gap after layout | As a user, I want clear visual separation between tables so I can read every column without ambiguity at the edges | **Single contract:** Given any whiteboard with ≥ 2 tables, When I click Auto Layout and the simulation completes (including any deterministic post-pass nudge), Then for every pair of distinct tables (A, B) the **L∞ gap between their axis-aligned bounding boxes is ≥ 16px**, where: `L∞ gap = max(A.left - B.right, B.left - A.right, A.top - B.bottom, B.top - A.bottom)`. This single quantity is negative when the boxes overlap, zero when they touch, and positive equal to the minimum per-axis separation when they are apart; the contract asserts it is ≥ 16 for every pair. The 16px floor is the **single, sole** overlap contract; the previous "0px overlap or 16px gap" alternative is **removed**. |
| FR-005 | All existing positions are overwritten | As a user, I do not want a half-applied layout where some tables move and others stay | Given any current set of table positions, When Auto Layout runs, Then every table on the whiteboard receives a new position; there is no concept of "fixed" tables in v1 |
| FR-006 | Viewport auto-fits after layout | As a user, I want to see the whole diagram immediately after layout without manually zooming out | Given Auto Layout completes, When the new positions are applied, Then the React Flow viewport zooms/pans so that every table is visible within the visible canvas with reasonable padding |
| FR-007 | Layout completes in under 2 seconds for ≤ 100 tables; main thread stays responsive | As a user, I do not want the UI to freeze on large diagrams | **Performance:** Given a whiteboard with up to 100 tables and the FK-density fixture defined in NFR Performance, When I click Auto Layout, Then total wall-clock time from button-press to fit-view-complete is ≤ 2.0s (p95 over 5 runs) on the **reference benchmark hardware** defined in NFR Performance. **Main-thread responsiveness:** During the run, **no single main-thread task may block ≥ 200ms**, measured via `PerformanceObserver({ entryTypes: ['longtask'] })` — a longtask entry with `duration ≥ 200ms` constitutes a violation. The simulation must therefore tick in `requestAnimationFrame` chunks (or a Web Worker), not in a single synchronous block. **Re-entry contract (reconciles with Error Flow #3):** The Auto Layout button is set to `disabled` synchronously before computation begins and re-enabled after fit-view completes (or after the failure path runs). Because the button is disabled, "clicks remain processable" is **not** a contract for the Auto Layout button itself — it is a contract that **other UI affordances** (canvas pan/zoom, sidebar, other toolbar buttons) remain interactive in the sense that user-input events are dispatched to handlers within one frame (≤ 16ms input-to-handler latency, again derived from longtask absence). Re-clicking Auto Layout while disabled is a no-op — the disabled state is the v1 cancellation/re-entry policy (see FR-011). |
| FR-008 | New positions persist | As a user, I expect my layout to still be there when I refresh the page | Given Auto Layout completes, When I reload the whiteboard, Then the tables appear in the positions produced by the layout (positions are saved through the existing persistence path used by manual drags) |
| FR-009 | Multi-user sync: atomic bulk broadcast via `table:move:bulk`, last-write-wins | As a collaborator, I want to converge on the same layout my teammate just applied, in one tick, with no piecewise rearrangement | **Chosen contract: option (a) — server-emitted atomic bulk broadcast, last-write-wins per whiteboard.** Given two users are viewing the same whiteboard, When user A clicks Auto Layout, Then: (1) user A's client computes all new positions locally; (2) user A's client emits a single `table:move:bulk` Socket.IO event (via the new `updateTablePositionsBulk` server function) containing all `{ id, positionX, positionY }` pairs; (3) the server validates auth/permissions once, persists all rows in a single `prisma.$transaction`, and broadcasts a single server-side `table:move:bulk` event to every other connected client on the same whiteboard; (4) collaborators apply all positions in **one render tick** on receipt — no piecewise rearrangement is observable. FR-005 atomicity is preserved on **both** the local user's screen and every collaborator's screen. **Mid-drag conflict resolution:** if user B is mid-drag of a table at the moment user A's `table:move:bulk` arrives, user B's drag wins for that node until they release (local drag state is the local source of truth); on drag-end, user B's per-table `table:move` (the existing manual-drag path) propagates and overwrites the bulk-applied position for that one node — this is the existing last-write-wins behaviour, no new conflict-resolution code. **Concurrent Auto Layout clicks:** if two users click Auto Layout near-simultaneously, two `updateTablePositionsBulk` transactions are submitted; whichever transaction commits second is the one that converges (still last-write-wins, but now per whiteboard rather than per node — both bulks are applied atomically, second wins). **Why option (a), not option (b) streamed per-node:** option (b) (N `table:move` events over the existing per-table channel) was rejected because (i) collaborators would observe the diagram rearranging piecewise over hundreds of milliseconds, violating FR-005 atomicity on the remote side, and (ii) 100 sequential server round-trips on the existing per-table path jeopardises the FR-007 2s budget. Option (a) reuses the new bulk persistence path that FR-008 / NFR Persistence already commit to as a P0 requirement, so the additional protocol surface is not net-new — `table:move:bulk` is the same event used for the bulk persistence flow. |
| FR-010 | Whiteboard with zero FK relationships still produces a non-overlapping layout | As a user with a fresh schema and no relationships yet, I still want clean placement | Given a whiteboard with 2+ tables and 0 FK relationships, When I click Auto Layout, Then tables are spread out and the FR-004 16px-gap contract holds (the force simulation runs with repulsion + collision force only and produces a reasonable spread) |
| FR-011 | Cancellation policy & large-diagram pre-run warning | As a user about to run layout on a large diagram, I want to know it may take a while and not feel stuck | **Decision: no in-flight cancellation in v1.** Once Auto Layout is clicked and computation begins, it runs to completion (or to the internal 500-tick hard cap, whichever is first); there is no Esc / cancel button in v1. Rationale: implementing safe cancellation requires either (a) running the simulation in a Web Worker with a transferable abort signal, or (b) cooperative tick-level cancellation that integrates with persistence rollback — both materially expand v1 scope without measurable user benefit on the supported size range (≤ 100 tables, target ≤ 2s). **Pre-run warning (P0 — required to ship):** Given the active whiteboard contains **> 50 tables**, When the user clicks Auto Layout, Then before the simulation starts a confirmation dialog appears: *"This whiteboard has N tables. Auto Layout may take several seconds and cannot be cancelled once started. Existing positions will be overwritten. Continue?"* with **Cancel** and **Run Layout** buttons. Below 50 tables there is no dialog — the layout starts immediately. **Accessibility ACs (P0 — must satisfy all):** (a) the dialog has `role="alertdialog"`; (b) focus is **trapped** within the dialog while it is open (Tab/Shift+Tab cycle only between the dialog's interactive elements — Cancel button, Run Layout button, and any close affordance); (c) **initial focus** lands on the **Run Layout button** (the primary action) — the user explicitly invoked Auto Layout, and the dialog is a "are you sure" gate, so the primary action receives focus by design; (d) **Esc** closes the dialog and is treated identically to Cancel (no layout runs, focus returns to the toolbar Auto Layout button); (e) the dialog is **announced to assistive technologies on open** via `role="alertdialog"` plus `aria-labelledby` (pointing to the dialog's title text) and `aria-describedby` (pointing to the descriptive paragraph) — screen readers must read the title and description automatically when the dialog opens; (f) on dialog close (whether via Cancel, Esc, or Run Layout), focus returns to the toolbar Auto Layout button. **Documentation:** the absence of cancellation is documented in the toolbar tooltip when hovering the button on a > 50 table diagram: *"Layout cannot be cancelled once started."* |

### P1 - Should Have

| ID | Requirement | User Story | Acceptance Criteria |
|----|-------------|------------|---------------------|
| FR-020 | Visual feedback while layout is running | As a user, I want to know the system is working when I click the button on a large diagram | Given I click Auto Layout on a large diagram, When the layout is running, Then the button shows a loading/disabled state until layout completes |
| FR-021 | Layout result is undoable via the standard undo path | As a user, I want to revert if the layout looks worse than what I had | Given Auto Layout has just completed, When I trigger the standard undo action, Then table positions return to their pre-layout values (depends on existing undo support; if undo is not implemented project-wide, this becomes "future work" rather than a blocker) |
| FR-022 | Toast / inline notification on completion | As a user on a large diagram, I want a small confirmation that the layout finished | Given Auto Layout completes, When the new positions are applied, Then a brief toast (e.g., "Layout applied to N tables") appears |

### P2 - Nice to Have

| ID | Requirement | User Story | Acceptance Criteria |
|----|-------------|------------|---------------------|
| FR-030 | Animated transition to new positions | As a user, I want to visually track where each table moved | Given Auto Layout produces new positions, When positions are applied, Then tables animate from old to new positions over ~300ms rather than snapping |
| FR-031 | Keyboard shortcut for Auto Layout | As a power user, I want to trigger layout without reaching for the mouse | Given the whiteboard is focused, When I press a documented shortcut, Then Auto Layout runs as if I clicked the button |

### Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance — reference benchmark hardware** | The 2s budget binds to a **reproducible benchmark** rather than the phrase "mid-range laptop". The benchmark is defined as: **CPU class** ≥ 4 physical cores at ≥ 2.5 GHz base clock (Intel i5-1135G7 / Ryzen 5 5600U / Apple M1 or comparable); **RAM** ≥ 8 GB system memory with ≥ 4 GB free; **OS** any of Linux, macOS, Windows 10/11; **Browser** Chrome (latest stable, currently 120+); **CPU throttling** off (no 4×/6× DevTools throttling); **Power** AC-connected (battery-saver disabled). The metric is **p95 wall-clock time over 5 consecutive runs** of the same fixture from button-press to fit-view-complete. CI reproduction: a Linux runner with 4 vCPU and 8 GB RAM running headless Chrome counts as the reference benchmark. The phrase "mid-range laptop" elsewhere in this document refers to this binding. |
| **Performance — fixture** | "Typical FK density" is fixed for the perf test as: each table has on average 1.5 outgoing FK edges (50% of tables have 1 FK, 25% have 2 FKs, 25% have 0 FKs); 10 / 30 / 100 table fixtures are generated procedurally and stored as test seeds. These three sizes are the regression-test points. |
| **Performance — main-thread responsiveness** | During a layout run, **no main-thread task may block ≥ 200ms** (measured via `PerformanceObserver({ entryTypes: ['longtask'] })`). The simulation must therefore tick in `requestAnimationFrame` chunks or in a Web Worker; a single synchronous block over 100 ticks is a violation regardless of total wall time. |
| **Performance — degradation policy** | For diagrams > 100 tables, layout must still complete (no crash) but the 2s p95 target does not bind. The pre-run warning dialog (FR-011) gates diagrams > 50 tables. |
| **Reliability** | Running Auto Layout multiple times in a row never produces a layout that violates FR-004 (16px gap). A single click never leaves the diagram in a partially-laid-out state on either the local user's screen **or** any collaborator's screen — atomicity is preserved on both sides via the `table:move:bulk` server-emitted broadcast (FR-009). |
| **Determinism** | Same input → similar visual clustering across runs. Exact positions may differ run-to-run because the force simulation has randomised initial conditions, but cluster *membership* (which tables end up near which) should be stable for the same FK graph. **Note:** cluster-membership stability is a *quality goal* documented here, not a Success Metric pass/fail gate. |
| **Persistence — bulk update requirement** | The existing client-callable position-update path is **per-table** (`updateTablePosition` server function emits one `table:move` event and one DB write per call — confirmed by reading `src/lib/server-functions.ts` lines 113–141 and `src/hooks/use-whiteboard-collaboration.ts` lines 207–217). Calling it 100 times after layout would produce 100 sequential server round-trips and 100 broadcast events, jeopardising the 2s budget. Therefore this PRD adds a **new bulk-update requirement: a client-callable `updateTablePositionsBulk` server function** that accepts `{ whiteboardId, positions: Array<{ id, positionX, positionY }> }`, validates auth/permissions once, persists all rows in a single transaction, and **emits a single `table:move:bulk` Socket.IO event** carrying all updated positions to every other connected client on the same whiteboard. Collaborators apply all positions in **one render tick** on receipt — this is the multi-user atomic-broadcast contract committed in FR-009. The existing per-table `updateTablePosition` and `table:move` paths are unchanged and continue to handle manual drags. **Note:** a server-side `computeAutoLayout` server function already exists at `src/lib/server-functions.ts` lines 204–259 and uses `prisma.$transaction` for bulk DB writes — it confirms the DB layer supports the pattern, but it does not emit a Socket.IO broadcast and is not the path Auto Layout will use (Auto Layout computes client-side per the chosen architecture). |
| **Persistence — failure UX (resolves "fall back to existing behaviour" hand-wave)** | If the new `updateTablePositionsBulk` server call fails (network error, server 5xx, validation rejection, or any error reaching the client) **after** the layout has already been applied to the local React Flow state, the user sees: (1) **Toast**: error variant, message *"Auto Layout could not be saved — your changes are visible locally but not persisted. Click Retry to save."* with a **Retry** action button. (2) **Local state**: the new positions remain visible on the user's canvas (optimistic application is preserved — the user is **not** snapped back to pre-layout positions). (3) **Retry**: clicking Retry re-invokes `updateTablePositionsBulk` with the same payload; success dismisses the toast, repeated failure re-shows it. (4) **Reload-during-failure consistency**: if the user reloads the page while in the failed state without clicking Retry, the server's last-saved positions (i.e., pre-Auto-Layout) reload — the client must NOT block reload or warn ("unsaved changes" dialog is out of scope for v1; this matches existing manual-drag behaviour where unsaved local-only positions are also lost on reload). (5) **Collaboration consistency in failure case**: because the Socket.IO emit happens **only after** the server confirms the bulk save (server-emitted `table:move:bulk`), a failed save means **no** collaborators see the layout — local-only divergence is the failure mode, and the toast tells the user their teammates do not yet see the layout. |
| **Collaboration** | Position updates emitted by Auto Layout flow through the new `table:move:bulk` Socket.IO event (server-side, fired after a successful `updateTablePositionsBulk` transaction). The existing per-table `table:move` channel is preserved for manual drags. Collaborators converge on the same layout in a single tick on receipt of `table:move:bulk`. |
| **Accessibility** | The button is keyboard-focusable, has an accessible name, and a tooltip describing what it does. Disabled state is communicated to screen readers. |
| **Internationalisation** | Button label and any toast/tooltip/dialog strings are localisable (use existing string handling in the toolbar). |

---

## 5. User Flows

### Primary Flow: Apply Auto Layout to a whiteboard

```
1. User opens a whiteboard that contains ≥ 2 tables (with or without FK relationships)
2. User locates the "Auto Layout" button in the toolbar
3. User clicks the button
4. System disables the button and shows a brief loading state (P1)
5. System computes new positions for every table using a force-directed simulation that uses FK relationships as attractive links and repulsion between every pair of tables
6. System applies all new positions atomically (every table moves at once)
7. System fits the React Flow viewport so all tables are visible
8. System persists new positions via a single `updateTablePositionsBulk` server call (atomic transaction)
9. Server emits a single `table:move:bulk` Socket.IO event to every other connected client on the same whiteboard; collaborators apply all positions in one render tick
10. System re-enables the button; (P1) shows a brief confirmation toast
```

### Secondary Flow: Empty / single-table whiteboard

```
1. User opens a whiteboard with 0 or 1 tables
2. User looks at the toolbar
3. The Auto Layout button is visible but disabled
4. Hovering shows a tooltip: "Add at least 2 tables to use Auto Layout"
```

### Error Flows

- **Layout simulation throws an unexpected error** (e.g., NaN propagation, library bug): The diagram is left in its **pre-click positions** (no partial mutation, no `updateTablePositionsBulk` call is made), the button is re-enabled, and a toast surfaces *"Auto Layout failed — please try again."* The error is logged via the existing client-side error path.
- **Layout takes longer than the 2s budget on a > 100 table diagram**: The button stays disabled until the simulation finishes; no timeout is enforced and no cancellation is offered in v1 (see FR-011). The pre-run warning dialog gates diagrams > 50 tables. If the simulation does not converge within the internally-defined 500-tick hard cap, the layout applies the best-so-far positions rather than aborting; the FR-004 16px-gap deterministic post-pass still runs.
- **User clicks the button while a previous run is still in progress**: The button is disabled synchronously when the run begins, so re-entry is prevented at the UI level. The button re-enables only after fit-view (success path) or the failure path completes.
- **Persistence call (`updateTablePositionsBulk`) fails after layout computes**: See **NFR Persistence — failure UX** for the full contract. Summary: error toast with Retry action; local positions remain visible; `table:move:bulk` is **not** emitted to collaborators (server emits only on successful transaction); user can retry from the toast.
- **Partial persistence failure** (transaction aborts mid-write): Because `updateTablePositionsBulk` uses a single `prisma.$transaction`, a partial commit is impossible — the database either has all new positions or none. The client treats any non-2xx response as a full failure and runs the failure UX.
- **Collaboration emit fails after a successful save**: If the server successfully persists but the Socket.IO broadcast fails (server-side error, transient network), user A's diagram is correct and persisted; user B will see the layout on the next page reload or next position event. This is acceptable v1 behaviour and matches existing per-table behaviour for failed `table:move` emits — no new contract is added.
- **User reloads the page mid-run**: The simulation is client-side and ephemeral; reloading aborts it. The user sees the last persisted server state on reload (i.e., pre-Auto-Layout positions if `updateTablePositionsBulk` had not yet succeeded; new positions if it had). No "unsaved changes" warning is shown — this matches existing manual-drag behaviour.

---

## 6. Dependencies & Risks

### Dependencies

| Dependency | Type | Impact |
|------------|------|--------|
| `d3-force` (already installed, v3.0.0) | External library | Provides the simulation. If it had a bug, the feature would not work — but it is mature and stable. |
| `@xyflow/react` (React Flow) | External library, already in use | Provides the canvas and `fitView` API used after layout. Existing fitView usage in `ReactFlowWhiteboard.tsx` confirms the integration point exists. |
| Existing whiteboard position-persistence layer | Internal | Auto Layout adds a new `updateTablePositionsBulk` server function (see NFR Persistence) on top of the existing Prisma layer. No schema changes required; the new function uses a single `prisma.$transaction`. |
| Existing collaboration / Socket.IO position-sync channel | Internal | Auto Layout adds a new server-emitted `table:move:bulk` event alongside the existing per-table `table:move`. The existing per-table channel is unchanged and continues to handle manual drags. |
| Existing Toolbar component (`src/components/whiteboard/Toolbar.tsx`) | Internal | The button lives here. |

### Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Force-directed layout produces overlapping tables on dense graphs | Medium | High (violates a P0 acceptance criterion) | Use a collision-detection force tuned to actual table dimensions (table width/height in px), not point particles. Add a deterministic post-pass that detects any remaining overlap and nudges tables apart. Tech-spec phase to define the exact force configuration. |
| 100-table layout exceeds 2s budget | Medium | Medium | Cap simulation iterations (e.g., 300–500 ticks), avoid synchronous re-renders during ticks (run the simulation off the React render path, then apply final positions in one `setNodes` call). Tech-spec phase to confirm. |
| Multi-user race: two users click Auto Layout at the same time | Low | Medium | New `table:move:bulk` events are last-write-wins per whiteboard at the server; whichever bulk transaction commits second overwrites the first. Acceptable for v1. Documented in FR-009 tradeoffs. |
| Layout makes existing diagrams "worse" subjectively | Medium | Low | Mitigated by (a) it's a button, not automatic; users opt in. (b) Standard undo (if present). (c) P1 toast acknowledges what happened. |
| Persistence floods the server with N position updates after layout | ~~Medium~~ Resolved | ~~Medium~~ N/A | Resolved by adding the `updateTablePositionsBulk` server function as a PRD-level requirement (see NFR Persistence — bulk update requirement). Hephaestus implements the new endpoint and the `table:move:bulk` Socket.IO event. |
| Layout result drifts off-screen if fit-view misbehaves | Low | High (user thinks the feature broke) | FR-006 makes fit-view a hard requirement with an automated test. |
| Tables with very different sizes (huge column count vs. tiny) cluster awkwardly | Low | Low | Use actual measured node sizes (already available via React Flow) when computing collision radius. |

---

## 7. Open Questions

| Question | Status |
|----------|--------|
| Should Auto Layout be an entry in an "Edit / Layout" menu instead of a top-level toolbar button if the toolbar is space-constrained? | Open — UX placement decision. PRD specifies "in the toolbar" as the requirement; exact visual placement (icon vs. labelled button, dropdown grouping) is delegated to the tech spec / design pass. |
| Should we record an analytics event when Auto Layout is used? | Open — pending product analytics decision; not a blocker for v1. |
| What is the exact icon/label? "Auto Layout" plus a sparkle or graph icon are the leading candidates. | Open — tech-spec / design decision. |
| Is there an existing global undo stack? | Open — affects whether FR-021 is shippable in v1 or deferred. To be confirmed during tech-spec. |
| For the 100-table performance target, what hardware counts as "mid-range laptop"? | **Resolved (revision 1.1)** — bound to the **reference benchmark hardware** specification in NFR Performance: ≥ 4-core / 2.5GHz CPU, ≥ 8GB RAM, Chrome latest, no throttling, AC power; metric is p95 wall time over 5 runs. CI proxy: 4 vCPU / 8GB Linux runner. |

---

## 8. External API Dependencies

This feature does not introduce any *external* (third-party network) API dependencies. It uses two pre-installed libraries that are already part of the project:

### d3-force

| Aspect | Details |
|--------|---------|
| **Library** | `d3-force` |
| **Version** | `^3.0.0` (already in `package.json`) |
| **Key Capabilities** | `forceSimulation`, `forceLink` (FK edges as links), `forceManyBody` (repulsion), `forceCollide` (overlap prevention), `forceCenter` (keeps cluster centred). No network calls. |
| **Authentication** | N/A (client-side library) |
| **Constraints** | Pure JS / browser; CPU-bound. No quotas. Stable, mature API. |

### @xyflow/react (React Flow)

| Aspect | Details |
|--------|---------|
| **Library** | `@xyflow/react` |
| **Version** | `^12.9.2` (already in use across the whiteboard) |
| **Key Capabilities** | `setNodes` to apply new positions, `fitView` to zoom/pan to the whole diagram. Already used in `ReactFlowWhiteboard.tsx`. |
| **Authentication** | N/A |
| **Constraints** | None new. |

---

## 9. External Research Summary

Mimir was **not** summoned for this PRD. Rationale:

- The chosen algorithm (force-directed) and the library (`d3-force`) were specified directly by the user during clarification.
- The integration target (React Flow) is already in production use in this codebase.
- The success criteria (no overlap, FK-related tables close, fit viewport) are concretely defined and do not require domain research.
- No external network APIs are involved.

If the tech-spec phase surfaces specific questions (e.g., "is there a known better force configuration for ER-style graphs," "have other React Flow projects integrated d3-force well"), Hephaestus can summon Mimir or use context7 then.

---

## Appendix A: Assumptions

| Assumption | Risk if wrong |
|------------|---------------|
| The existing whiteboard already exposes a way to enumerate all tables and their FK relationships in the client (via React Flow nodes + edges or an equivalent data model). | If not, the PRD scope still holds, but the tech-spec must add a small data-collection step. |
| ~~The existing position-persistence path supports updating many tables at once.~~ **Validated and resolved (revision 1.1):** the existing client-callable path is **per-table only** (`updateTablePosition` at `src/lib/server-functions.ts:113`; `emitPositionUpdate` at `src/hooks/use-whiteboard-collaboration.ts:207`). A bulk path does **not** exist for client-triggered Auto Layout (note: a server-side `computeAutoLayout` at `src/lib/server-functions.ts:204` uses `prisma.$transaction` for bulk DB writes — proves the DB pattern works but does not expose a client API or emit a Socket.IO event). The PRD now adds `updateTablePositionsBulk` + `table:move:bulk` as P0 requirements (see NFR Persistence). | N/A — assumption was invalidated and replaced by an explicit requirement. |
| There is at most one active Auto Layout run per client at a time (enforced by disabling the button). | True by design (FR-007 / button-disabled). |
| Table dimensions are measurable from the client at the moment Auto Layout runs (so collision force can use real sizes). | If the client only has logical nodes without rendered sizes, layout falls back to a conservative fixed bounding box per table; layout still satisfies "no overlap" but uses worst-case sizing. |
| "Mid-range laptop" performance target (now bound to **reference benchmark hardware** in NFR Performance) is acceptable as the bar; we are not committing to specific low-end hardware. | If the user later requires e.g., a Chromebook target, the 100-table budget may need re-evaluation. |

---

## Appendix B: Revision History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | 2026-05-01 | Athena | Initial PRD. |
| 1.1 | 2026-05-01 | Athena | Resolves all 8 BLOCKING items raised by Nemesis: (1) FR-003 — defines "FK-related" precisely (direct edge in `Relationship` table / React Flow edge; non-transitive) with explicit fallback for empty FK-set, fully-connected schemas, isolated tables, and circular references. (2) FR-004 — single overlap contract: ≥ 16px L∞ gap between every pair of bounding boxes; ambiguous "0 overlap or 16px" alternative removed. (3) FR-007 — main-thread responsiveness measured via `PerformanceObserver` longtask entries (≥ 200ms = violation); reconciled with disabled-button re-entry policy. (4) Performance target bound to **reference benchmark hardware** (CPU class, RAM, Chrome version, throttling-off, AC power) and p95 metric over 5 runs; "mid-range laptop" phrase deprecated. (5) FR-009 — chosen explicitly streamed per-node sync with last-write-wins + new `table:move:bulk` server-emitted broadcast for Auto Layout; tradeoffs documented (collaborator-side flicker accepted; mid-drag conflict resolution by existing last-write-wins). (6) Persistence-failure UX — explicit toast + Retry + optimistic local positions + collaboration-divergence warning; replaces "fall back to existing behaviour" hand-wave. (7) Bulk persistence assumption validated against `src/lib/server-functions.ts` and `src/hooks/use-whiteboard-collaboration.ts`; new `updateTablePositionsBulk` server function + `table:move:bulk` Socket.IO event added as P0 requirements. (8) FR-011 added — explicit "no cancellation in v1" policy with rationale, plus mandatory pre-run confirmation dialog for whiteboards > 50 tables. |
| 1.2 | 2026-05-01 | Athena | Resolves Nemesis round 2 findings (1 BLOCKING + 1 MAJOR + 1 MINOR). (1) **FR-009 internal contradiction resolved (BLOCKING):** v1.1 said "option (b) — streamed per-node `table:move`" in FR-009 but described option (a) — server-emitted `table:move:bulk` applied in one tick — in NFR Persistence, NFR Collaboration, Error Flows, and Risks Row 3. v1.2 commits unambiguously to **option (a) atomic bulk-broadcast** throughout: FR-009 rewritten to describe client-computes-then-emits-`table:move:bulk` → server-validates-and-transacts → server-broadcasts-`table:move:bulk` → collaborators apply in one tick. The "rearranges piecewise" tradeoff in old FR-009 is removed. NFR Reliability rewritten so atomicity is preserved on both local and remote screens. User Flow steps 8–9 made specific to `updateTablePositionsBulk` and the server-emitted `table:move:bulk`. Dependencies table updated to reflect that `table:move:bulk` is a new event (not pure reuse). NFR Persistence text trimmed of stale reference to "streamed-flicker concern." (2) **FR-011 dialog a11y (MAJOR):** added explicit ACs — `role="alertdialog"`, focus-trap while open, initial focus on **Run Layout** (primary action; the dialog is a confirm gate after the user already invoked the action), Esc closes (= Cancel) with focus return to toolbar button, AT announcement on open via `aria-labelledby` + `aria-describedby`. (3) **FR-004 "Equivalent test" wording (MINOR):** old parenthetical claimed `gapSum ≥ 16` is "false only when boxes overlap" — mathematically wrong (also false when boxes are gapped < 16px). Replaced with a single, correct L∞ formula: `L∞ gap = max(A.left - B.right, B.left - A.right, A.top - B.bottom, B.top - A.bottom)`, asserted ≥ 16 for every pair. |
