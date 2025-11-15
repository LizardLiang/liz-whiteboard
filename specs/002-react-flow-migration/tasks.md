# Tasks: React Flow Migration

**Input**: Design documents from `/specs/002-react-flow-migration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**⚠️ IMPORTANT NOTICE**: Based on comprehensive research findings (see research.md), **migration to React Flow is NOT RECOMMENDED**. Research shows:
- Konva performs better for ER diagrams (50+ FPS vs 35-40 FPS)
- Migration cost: 5-8 weeks with no significant feature gains
- Bundle size savings negligible (~48 KB, 5% of total)
- Konva's API better suited for ER diagram features

**Alternative recommendation**: Invest 4-6 hours optimizing the current Konva + d3-force implementation for same or better results.

**This task list is provided for reference only if stakeholders decide to proceed despite research recommendations.**

**Tests**: Not explicitly requested in spec.md - test tasks excluded

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `- [ ] [ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US7)
- Include exact file paths in descriptions

## Path Conventions

Project uses single-repo structure: `src/`, `tests/` at repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install React Flow and create foundational type definitions

- [X] T001 Install @xyflow/react@^12.9.2 package via bun add
- [X] T002 [P] Create type definitions in src/lib/react-flow/types.ts
- [X] T003 [P] Create converter functions in src/lib/react-flow/converters.ts
- [X] T004 [P] Create handle utilities in src/lib/react-flow/handles.ts
- [X] T005 [P] Create theme CSS file in src/styles/react-flow-theme.css

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core React Flow components that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create TableNode component in src/components/whiteboard/TableNode.tsx
- [X] T007 Create RelationshipEdge component in src/components/whiteboard/RelationshipEdge.tsx
- [X] T008 Create ReactFlowCanvas wrapper in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T009 Register custom node and edge types in src/components/whiteboard/node-types.ts
- [X] T010 [P] Create viewport utilities in src/lib/react-flow/viewport.ts
- [X] T011 [P] Add React Flow CSS imports to src/styles.css

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View ER Diagrams with React Flow (Priority: P1) 🎯 MVP

**Goal**: Render existing ER diagrams using React Flow instead of Konva with visual fidelity

**Independent Test**: Open an existing whiteboard with tables and relationships, verify all elements render correctly using React Flow, confirm visual match with previous Konva rendering

### Implementation for User Story 1

- [X] T012 [US1] Update whiteboard route to use ReactFlowCanvas in src/routes/whiteboard/$whiteboardId.tsx
- [X] T013 [US1] Implement data loading and conversion in ReactFlowCanvas component in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T014 [P] [US1] Implement table header rendering in TableNode in src/components/whiteboard/TableNode.tsx
- [X] T015 [P] [US1] Implement column list rendering in TableNode in src/components/whiteboard/TableNode.tsx
- [X] T016 [US1] Implement column handle positioning logic in src/lib/react-flow/handles.ts
- [X] T017 [P] [US1] Implement primary key indicators in TableNode in src/components/whiteboard/TableNode.tsx
- [X] T018 [P] [US1] Implement foreign key indicators in TableNode in src/components/whiteboard/TableNode.tsx
- [X] T019 [US1] Implement edge path calculation in RelationshipEdge in src/components/whiteboard/RelationshipEdge.tsx
- [X] T020 [P] [US1] Implement cardinality markers (crow's foot notation) in src/components/whiteboard/cardinality-markers.tsx
- [X] T021 [US1] Apply cardinality markers to RelationshipEdge in src/components/whiteboard/RelationshipEdge.tsx
- [X] T022 [P] [US1] Style TableNode for light mode in src/styles/react-flow-theme.css
- [X] T023 [P] [US1] Style RelationshipEdge for light mode in src/styles/react-flow-theme.css
- [X] T024 [US1] Implement initial position loading from database in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T025 [US1] Add fitView on initial load in src/components/whiteboard/ReactFlowCanvas.tsx

**Checkpoint**: User Story 1 complete - diagrams render correctly in React Flow

---

## Phase 4: User Story 2 - Interactive Canvas Navigation with React Flow (Priority: P1)

**Goal**: Enable smooth zoom and pan navigation using React Flow's built-in viewport controls

**Independent Test**: Open a whiteboard with multiple tables, use mouse wheel to zoom, drag canvas to pan, verify smooth performance

### Implementation for User Story 2

- [X] T026 [US2] Enable React Flow zoom controls in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T027 [US2] Enable React Flow pan controls in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T028 [US2] Add Controls component from React Flow in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T029 [US2] Implement fit-to-screen button using fitView API in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T030 [P] [US2] Create ZoomIndicator component in src/components/whiteboard/ZoomIndicator.tsx
- [X] T031 [US2] Integrate ZoomIndicator with viewport state in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T032 [US2] Configure zoom limits (min/max zoom levels) in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T033 [US2] Configure pan boundaries in src/components/whiteboard/ReactFlowCanvas.tsx

**Checkpoint**: User Stories 1 AND 2 complete - navigation works smoothly

---

## Phase 5: User Story 4 - Apply Automatic Layout (Priority: P1)

**Goal**: Position tables automatically based on relationship strength using layout algorithms

**Independent Test**: Create whiteboard with interconnected tables, trigger automatic layout, verify nodes positioned according to relationships with minimal edge crossings

### Implementation for User Story 4

- [X] T034 [P] [US4] Create layout adapter in src/lib/react-flow/layout-adapter.ts
- [X] T035 [US4] Adapt existing d3-force logic to output React Flow positions in src/lib/react-flow/layout-adapter.ts
- [X] T036 [US4] Update layout worker to accept React Flow node format in src/lib/canvas/layout-worker.ts
- [X] T037 [US4] Create layout trigger hook in src/hooks/use-layout-trigger.ts
- [X] T038 [P] [US4] Create LayoutControls component in src/components/whiteboard/LayoutControls.tsx
- [X] T039 [US4] Integrate LayoutControls with ReactFlowCanvas in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T040 [US4] Implement applyLayout function to update node positions in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T041 [US4] Add animated transitions for layout changes using React Flow in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T042 [US4] Handle disconnected clusters in layout algorithm in src/lib/react-flow/layout-adapter.ts
- [X] T043 [US4] Persist layout results to database in src/components/whiteboard/ReactFlowCanvas.tsx

**Checkpoint**: User Stories 1, 2, AND 4 complete - automatic layout functional

---

## Phase 6: User Story 3 - Drag and Reposition Tables (Priority: P2)

**Goal**: Allow manual table repositioning with automatic edge updates and position persistence

**Independent Test**: Open whiteboard, click and drag table nodes, verify edges adjust automatically, confirm positions persist

### Implementation for User Story 3

- [X] T044 [US3] Enable nodesDraggable prop in ReactFlowCanvas in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T045 [US3] Implement onNodeDragStop handler in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T046 [US3] Create position update API call in src/routes/api/tables.ts
- [X] T047 [US3] Persist node position to database on drag stop in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T048 [US3] Add drag visual feedback (cursor, node styling) in src/components/whiteboard/TableNode.tsx
- [X] T049 [US3] Configure auto-pan behavior at canvas edges in src/components/whiteboard/ReactFlowCanvas.tsx

**Checkpoint**: User Stories 1-4 AND 3 complete - manual dragging works

---

## Phase 7: User Story 7 - Render Column-Level Relationship Endpoints (Priority: P2)

**Goal**: Connect edges to specific column positions within table nodes, not table centers

**Independent Test**: Create relationships between specific columns, verify edges connect to correct positions on source and target table nodes (aligned with specific column rows)

### Implementation for User Story 7

- [X] T050 [P] [US7] Generate handle IDs for each column in TableNode in src/components/whiteboard/TableNode.tsx
- [X] T051 [P] [US7] Calculate vertical handle positions based on column index in src/lib/react-flow/handles.ts
- [X] T052 [US7] Render source handles (right side) for each column in src/components/whiteboard/TableNode.tsx
- [X] T053 [US7] Render target handles (left side) for each column in src/components/whiteboard/TableNode.tsx
- [X] T054 [US7] Map sourceColumnId to sourceHandle in converter in src/lib/react-flow/converters.ts
- [X] T055 [US7] Map targetColumnId to targetHandle in converter in src/lib/react-flow/converters.ts
- [X] T056 [US7] Update edge rendering to connect to specific handles in src/components/whiteboard/RelationshipEdge.tsx
- [X] T057 [P] [US7] Style handles for visibility and interaction in src/styles/react-flow-theme.css
- [X] T058 [US7] Handle column reordering impact on handle positions in src/components/whiteboard/TableNode.tsx

**Checkpoint**: User Stories 1-4, 3, AND 7 complete - column-specific connections work

---

## Phase 8: User Story 5 - Maintain Real-Time Collaboration (Priority: P2)

**Goal**: Sync React Flow state changes via WebSocket for multi-user collaboration

**Independent Test**: Open same whiteboard in two browser sessions, make changes (add/move/delete) in one session, verify React Flow in second session reflects changes immediately

### Implementation for User Story 5

- [X] T059 [P] [US5] Create WebSocket sync hook in src/hooks/use-react-flow-sync.ts
- [X] T060 [US5] Implement node position broadcast on drag in src/hooks/use-react-flow-sync.ts
- [X] T061 [US5] Implement node added broadcast in src/hooks/use-react-flow-sync.ts
- [X] T062 [US5] Implement node deleted broadcast in src/hooks/use-react-flow-sync.ts
- [X] T063 [US5] Implement edge added broadcast in src/hooks/use-react-flow-sync.ts
- [X] T064 [US5] Implement edge deleted broadcast in src/hooks/use-react-flow-sync.ts
- [X] T065 [US5] Handle remote node position updates in src/hooks/use-react-flow-sync.ts
- [X] T066 [US5] Handle remote node add events in src/hooks/use-react-flow-sync.ts
- [X] T067 [US5] Handle remote node delete events in src/hooks/use-react-flow-sync.ts
- [X] T068 [US5] Handle remote edge add events in src/hooks/use-react-flow-sync.ts
- [X] T069 [US5] Handle remote edge delete events in src/hooks/use-react-flow-sync.ts
- [X] T070 [US5] Prevent echo-back loop using isProcessingRemote flag in src/hooks/use-react-flow-sync.ts
- [X] T071 [US5] Throttle position updates to 100ms in src/hooks/use-react-flow-sync.ts
- [X] T072 [US5] Integrate sync hook with ReactFlowCanvas in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T073 [P] [US5] Update server WebSocket handlers for React Flow events in src/routes/api/collaboration.ts
- [X] T074 [US5] Implement state sync on reconnection in src/hooks/use-react-flow-sync.ts

**Checkpoint**: All P1 and P2 user stories complete - collaboration functional

---

## Phase 9: User Story 6 - Support Dark Mode Theming (Priority: P3)

**Goal**: Apply dark theme colors to React Flow nodes, edges, and background

**Independent Test**: Toggle dark mode on/off, verify React Flow nodes, edges, background, and controls all display with appropriate theme colors

### Implementation for User Story 6

- [X] T075 [P] [US6] Define dark mode CSS variables in src/styles/react-flow-theme.css
- [X] T076 [P] [US6] Update TableNode styles to use theme CSS variables in src/styles/react-flow-theme.css
- [X] T077 [P] [US6] Update RelationshipEdge styles to use theme CSS variables in src/styles/react-flow-theme.css
- [X] T078 [US6] Apply theme to React Flow background in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T079 [US6] Apply theme to React Flow Controls in src/components/whiteboard/ReactFlowCanvas.tsx
- [X] T080 [US6] Ensure contrast ratios meet accessibility standards (4.5:1 minimum) in src/styles/react-flow-theme.css
- [X] T081 [US6] Test theme switching for visual glitches in src/components/whiteboard/ReactFlowCanvas.tsx

**Checkpoint**: All user stories (P1-P3) complete - dark mode working

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, optimization, and migration completion

**⚠️ IMPORTANT**: Tasks T082-T087 should only be executed after thorough testing confirms React Flow implementation is production-ready. Keep Konva as fallback until validated.

- [ ] T082 [P] Remove Konva dependencies (konva, react-konva) via bun remove - **DEFERRED**
- [ ] T083 [P] Remove d3-force if no longer used via bun remove - **KEEP** (used by layout)
- [ ] T084 Remove old Canvas.tsx component from src/components/whiteboard/Canvas.tsx - **DEFERRED**
- [ ] T085 Remove unused Konva utilities from src/lib/canvas/ - **DEFERRED**
- [ ] T086 [P] Update import statements across codebase to remove Konva references - **DEFERRED**
- [ ] T087 Verify no console errors or warnings related to Konva - **DEFERRED**
- [ ] T088 [P] Performance testing with 50 table nodes (target: 60 FPS during pan/zoom) - **TESTING REQUIRED**
- [ ] T089 [P] Performance testing with 100 edge connections - **TESTING REQUIRED**
- [ ] T090 Verify automatic layout completes under 3 seconds for 30 tables - **TESTING REQUIRED**
- [ ] T091 Verify real-time collaboration latency under 2 seconds - **TESTING REQUIRED**
- [ ] T092 [P] Visual regression testing (screenshot comparison) - **TESTING REQUIRED**
- [X] T093 Bundle size analysis (verify within 10% of previous size)
- [X] T094 [P] Update documentation in quickstart.md
- [X] T095 Code cleanup and remove TODO comments
- [ ] T096 Final acceptance testing across all user stories - **TESTING REQUIRED**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-9)**: All depend on Foundational phase completion
  - US1 (P1) → US2 (P1) → US4 (P1): Critical path (rendering → navigation → layout)
  - US3 (P2), US7 (P2), US5 (P2): Can proceed after foundational
  - US6 (P3): Can proceed after foundational
- **Polish (Phase 10)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: FOUNDATIONAL - All other stories depend on rendering working
- **User Story 2 (P1)**: Depends on US1 (needs rendered nodes to navigate)
- **User Story 4 (P1)**: Depends on US1 (needs nodes to position)
- **User Story 3 (P2)**: Depends on US1 (needs nodes to drag)
- **User Story 7 (P2)**: Depends on US1 (needs nodes to add handles)
- **User Story 5 (P2)**: Depends on US1 (needs React Flow state to sync)
- **User Story 6 (P3)**: Depends on US1 (needs components to theme)

### Critical Path

```
Setup → Foundational → US1 (rendering) → US2 (navigation) → US4 (layout) → US3 (dragging)
```

### Parallel Opportunities

- **Setup Phase**: T002, T003, T004, T005 can run in parallel
- **Foundational Phase**: T010, T011 can run in parallel
- **User Story 1**: T014+T015, T017+T018, T022+T023 can run in parallel
- **After US1 complete**: US2, US3, US4, US7, US5, US6 can all start in parallel (different files)
- **Polish Phase**: T082+T083, T086, T088+T089, T092, T094 can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch rendering tasks in parallel:
Task: "Implement table header rendering in TableNode in src/components/whiteboard/TableNode.tsx"
Task: "Implement column list rendering in TableNode in src/components/whiteboard/TableNode.tsx"

# Launch indicator tasks in parallel:
Task: "Implement primary key indicators in TableNode in src/components/whiteboard/TableNode.tsx"
Task: "Implement foreign key indicators in TableNode in src/components/whiteboard/TableNode.tsx"

# Launch styling tasks in parallel:
Task: "Style TableNode for light mode in src/styles/react-flow-theme.css"
Task: "Style RelationshipEdge for light mode in src/styles/react-flow-theme.css"
```

---

## Implementation Strategy

### ⚠️ Reconsider Migration

**Before starting implementation**, review research.md findings:
- Current Konva implementation performs well (50+ FPS)
- Migration offers minimal benefits (48 KB savings, 5% of bundle)
- Alternative: Optimize Konva (4-6 hours vs 5-8 weeks)

**If proceeding despite research:**

### MVP First (User Stories 1, 2, 4 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Rendering)
4. Complete Phase 4: User Story 2 (Navigation)
5. Complete Phase 5: User Story 4 (Layout)
6. **STOP and VALIDATE**: Test core functionality
7. Compare performance with Konva baseline

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add US1 → Test rendering → Validate visual fidelity
3. Add US2 → Test navigation → Validate 60 FPS performance
4. Add US4 → Test layout → Validate 3-second target
5. Add US3, US7, US5 → Test interactions and collaboration
6. Add US6 → Complete theming
7. Each story adds value without breaking previous stories

### Performance Validation Checkpoints

- **After US1**: Verify rendering performance with 50 nodes
- **After US2**: Verify 60 FPS during zoom/pan
- **After US4**: Verify layout computation under 3 seconds
- **After US5**: Verify collaboration latency under 2 seconds
- **After Phase 10**: Compare bundle size with Konva baseline

---

## Notes

- **[P]** tasks = different files, no dependencies - can run in parallel
- **[Story]** label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- **Monitor performance**: If React Flow underperforms vs Konva, consider aborting migration
- **Fallback plan**: Keep Konva implementation until React Flow proves equal/better performance

---

## Summary

- **Total Tasks**: 96 tasks
- **User Stories**: 7 (US1-US7)
- **Estimated Effort**: 5-8 weeks (based on research findings)
- **Critical Path**: Setup → Foundational → US1 → US2 → US4 → US3
- **Parallel Opportunities**: ~25 tasks can run in parallel
- **MVP Scope**: US1 + US2 + US4 (rendering, navigation, layout)
- **⚠️ Recommendation**: Reconsider migration - optimize Konva instead (4-6 hours for better ROI)
