# Tasks: React Flow Whiteboard Migration

**Input**: Design documents from `/specs/003-react-flow-migration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: NOT included - tests are optional and not explicitly requested in the specification

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

---

## 📊 Implementation Progress Summary

**Overall Progress**: 75/92 tasks complete (82%)

**Completed Phases**:

- ✅ **Phase 1: Setup** (3/3 tasks) - Dependencies installed
- ✅ **Phase 2: Foundational** (11/11 tasks) - Core utilities complete
- ✅ **Phase 3: User Story 1** (11/11 tasks) - View ERD diagrams complete ✓
- ✅ **Phase 4: User Story 2** (13/13 tasks) - Highlighting system complete
- ✅ **Phase 5: User Story 3** (6/6 tasks) - Manual table positioning complete ✓
- ✅ **Phase 6: User Story 4** (11/11 tasks) - ELK auto-layout complete ✓
- ✅ **Phase 7: User Story 5** (9/9 tasks) - Real-time collaboration complete ✓
- ✅ **Phase 8: User Story 6** (11/11 tasks) - Display modes complete ✓

**Pending**:

- ⏳ **Phase 9: Polish** (0/17 tasks) - Optimization and cleanup

**Key Achievements**:

- React Flow canvas rendering with feature flag toggle
- Data fetching and conversion layer complete
- Interactive highlighting with animated particles
- Drag-and-drop table positioning with database persistence
- Automatic edge path recalculation when nodes move
- ELK hierarchical auto-layout with Web Worker
- Batch position updates to database after auto-layout
- Automatic fitView after layout completion
- Real-time collaboration via WebSocket for position updates
- **Display modes: Compact, Keys Only, and All Fields (NEW!)**
- **LocalStorage persistence for display mode preference (NEW!)**
- Build passing with no TypeScript errors
- **6/6 user stories complete (100% feature completion)** ✨

**Feature Flag**: `VITE_USE_REACT_FLOW` in `.env.local` (default: `false` for safe rollout)

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Project structure: Web application (TanStack Start framework)

- Frontend: `src/` at repository root
- Components: `src/components/whiteboard/`
- Utilities: `src/lib/react-flow/`
- Tests: `tests/` (unit, integration)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and prepare React Flow infrastructure

- [x] T001 Install elkjs@0.10.0 dependency via `bun add elkjs@0.10.0`
- [x] T002 [P] Create React Flow utility directory at `src/lib/react-flow/`
- [x] T003 [P] Create cardinality markers SVG component (verify existing `src/components/whiteboard/cardinality-markers.tsx` is React Flow compatible)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core React Flow utilities that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Implement `convertTableToNode` function in `src/lib/react-flow/convert-to-nodes.ts`
- [x] T005 [P] Implement `convertTablesToNodes` function in `src/lib/react-flow/convert-to-nodes.ts`
- [x] T006 [P] Implement `extractTablePosition` helper in `src/lib/react-flow/convert-to-nodes.ts`
- [x] T007 [P] Implement `convertRelationshipToEdge` function in `src/lib/react-flow/convert-to-edges.ts`
- [x] T008 [P] Implement `convertRelationshipsToEdges` function in `src/lib/react-flow/convert-to-edges.ts`
- [x] T009 [P] Implement `createHandleId` helper in `src/lib/react-flow/convert-to-edges.ts`
- [x] T010 [P] Implement `parseHandleId` helper in `src/lib/react-flow/convert-to-edges.ts`
- [x] T011 [P] Implement `getCardinalityMarkerStart` helper in `src/lib/react-flow/convert-to-edges.ts`
- [x] T012 [P] Implement `getCardinalityMarkerEnd` helper in `src/lib/react-flow/convert-to-edges.ts`
- [x] T013 [P] Create TypeScript type definitions in `src/lib/react-flow/types.ts` (ShowMode, TableNodeData, RelationshipEdgeData, etc.)
- [x] T014 [P] Create node/edge type registry in `src/lib/react-flow/node-types.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View ERD Diagrams with Modern Canvas (Priority: P1) 🎯 MVP

**Goal**: Users can view existing ERD diagrams with tables, relationships, and smooth pan/zoom

**Independent Test**: Load a whiteboard with existing tables and relationships. Verify all tables display with columns, relationship lines show cardinality markers, and pan/zoom works smoothly.

### Implementation for User Story 1

- [x] T015 [P] [US1] Create TableNode component in `src/components/whiteboard/TableNode.new.tsx` (with display mode and highlighting support)
- [x] T016 [P] [US1] Create RelationshipEdge component in `src/components/whiteboard/RelationshipEdge.new.tsx` (basic rendering with cardinality markers)
- [x] T017 [US1] Create ReactFlowCanvas wrapper component in `src/components/whiteboard/ReactFlowCanvas.tsx` (depends on T015, T016)
- [x] T018 [US1] Implement data fetching in ReactFlowWhiteboard using TanStack Query to load tables and relationships (depends on T017)
- [x] T019 [US1] Implement node/edge conversion in ReactFlowWhiteboard using foundational utilities (depends on T018)
- [x] T020 [US1] Configure React Flow props (minZoom: 0.1, maxZoom: 2, panOnScroll, Background with dots) in `src/components/whiteboard/ReactFlowCanvas.tsx`
- [x] T021 [US1] Add Handle components to TableNode for each column connection point in `src/components/whiteboard/TableNode.new.tsx`
- [x] T022 [US1] Wire sourceHandle and targetHandle to RelationshipEdge using createHandleId in `src/components/whiteboard/RelationshipEdge.new.tsx`
- [x] T023 [US1] Update whiteboard route to use ReactFlowCanvas with feature flag in `src/routes/whiteboard/$whiteboardId.tsx`
- [x] T024 [US1] Verify cardinality markers display correctly (one-to-one circle+line, one-to-many crow's foot)
- [x] T025 [US1] Verify tables display name, columns, and key indicators (primary key, foreign key)

**Checkpoint**: At this point, users can view diagrams with tables and relationships. Pan and zoom should work smoothly.

---

## Phase 4: User Story 2 - Interact with Tables and Relationships (Priority: P2)

**Goal**: Users can click tables to select them and see visual highlighting of related tables and relationships

**Independent Test**: Click on a table and verify that table is highlighted, connected tables are emphasized, relationship lines are highlighted with animated particles. Click canvas background to clear highlights.

### Implementation for User Story 2

- [x] T026 [P] [US2] Implement `buildEdgeMap` function in `src/lib/react-flow/highlighting.ts`
- [x] T027 [P] [US2] Implement `calculateHighlighting` function in `src/lib/react-flow/highlighting.ts` (calculates which nodes/edges to highlight based on selection)
- [x] T028 [US2] Create `useHighlighting` custom hook in `src/lib/react-flow/highlighting.ts` (depends on T027)
- [x] T029 [US2] Add selection state management to ReactFlowCanvas (activeTableId, hoveredTableId) in `src/components/whiteboard/ReactFlowCanvas.tsx`
- [x] T030 [US2] Implement onNodeClick handler to set activeTableId in `src/components/whiteboard/ReactFlowCanvas.tsx`
- [x] T031 [US2] Implement onPaneClick handler to clear activeTableId in `src/components/whiteboard/ReactFlowCanvas.tsx`
- [x] T032 [US2] Implement onNodeMouseEnter handler to set hoveredTableId in `src/components/whiteboard/ReactFlowCanvas.tsx`
- [x] T033 [US2] Implement onNodeMouseLeave handler to clear hoveredTableId in `src/components/whiteboard/ReactFlowCanvas.tsx`
- [x] T034 [US2] Integrate calculateHighlighting in ReactFlowCanvas to update node/edge data when selection changes in `src/components/whiteboard/ReactFlowCanvas.tsx`
- [x] T035 [US2] Add visual highlighting styles to TableNode component (isActiveHighlighted, isHighlighted, isHovered) in `src/components/whiteboard/TableNode.new.tsx`
- [x] T036 [US2] Add animated particles to RelationshipEdge when isHighlighted is true in `src/components/whiteboard/RelationshipEdge.new.tsx`
- [x] T037 [US2] Implement SVG animateMotion for particles flowing along edge path in `src/components/whiteboard/RelationshipEdge.new.tsx`
- [x] T038 [US2] Apply z-index updates to highlighted nodes and edges (z-index: 1000 for highlighted, 1 for default)

**Checkpoint**: At this point, users can interact with tables. Clicking highlights related tables and edges with animations.

---

## Phase 5: User Story 3 - Manually Position Tables (Priority: P2)

**Goal**: Users can drag tables to custom positions, positions are saved to database, and relationship lines update automatically

**Independent Test**: Drag a table to a new position. Verify relationship lines update smoothly. Reload the whiteboard and verify the table appears at the saved position.

### Implementation for User Story 3

- [x] T039 [US3] Implement onNodeDragStop handler in ReactFlowCanvas to extract position from node in `src/components/whiteboard/ReactFlowCanvas.tsx`
- [x] T040 [US3] Create TanStack Query mutation for updating table position in `src/components/whiteboard/ReactFlowWhiteboard.tsx`
- [x] T041 [US3] Wire onNodeDragStop to position update mutation in `src/components/whiteboard/ReactFlowWhiteboard.tsx` (depends on T040)
- [x] T042 [US3] Verify database update: position saved to DiagramTable.positionX and DiagramTable.positionY
- [x] T043 [US3] Verify React Flow automatic edge path recalculation when nodes move
- [x] T044 [US3] Verify position restoration: nodes render at saved positions when ReactFlowCanvas loads

**Checkpoint**: At this point, users can drag tables. Positions are persisted and restored correctly.

---

## Phase 6: User Story 4 - Automatic Layout Generation (Priority: P3)

**Goal**: Users can click a button to auto-arrange tables using ELK hierarchical layout algorithm

**Independent Test**: Create a whiteboard with randomly positioned tables. Click auto-layout button. Verify tables arrange in left-to-right hierarchical layout with minimal edge crossings. Verify canvas zooms to fit all tables.

### Implementation for User Story 4

- [x] T045 [P] [US4] Create ELK Web Worker in `src/lib/react-flow/elk-layout.worker.ts` for non-blocking layout computation
- [x] T046 [US4] Implement `convertNodesToELKGraph` function in `src/lib/react-flow/elk-layout.ts` (depends on T045)
- [x] T047 [US4] Implement `applyELKLayout` function in `src/lib/react-flow/elk-layout.ts` (depends on T045)
- [x] T048 [US4] Implement `computeELKLayout` function with Web Worker integration in `src/lib/react-flow/elk-layout.ts` (depends on T046, T047)
- [x] T049 [US4] Create `useAutoLayout` custom hook in `src/lib/react-flow/use-auto-layout.ts` (depends on T048)
- [x] T050 [US4] Add auto-layout button to Toolbar component (already exists in `src/components/whiteboard/Toolbar.tsx`)
- [x] T051 [US4] Wire auto-layout to ReactFlowWhiteboard via onAutoLayoutReady callback in `src/routes/whiteboard/$whiteboardId.tsx`
- [x] T052 [US4] Implement fitView after layout completion (with 100ms delay) in useAutoLayout hook
- [x] T053 [US4] Batch update table positions to database after auto-layout completes via onLayoutComplete callback
- [x] T054 [US4] Verify ELK layout options: algorithm 'layered', direction 'RIGHT', appropriate spacing values (DEFAULT_ELK_OPTIONS)
- [x] T055 [US4] Verify disconnected table groups are laid out separately with spacing between groups (elk.spacing.componentComponent: '80')

**Checkpoint**: At this point, users can trigger auto-layout. Tables arrange hierarchically and positions are saved.

---

## Phase 7: User Story 5 - Multi-User Collaboration (Priority: P3)

**Goal**: Users see real-time updates when other users move tables on the same whiteboard

**Independent Test**: Open the same whiteboard in two browser windows. Move a table in one window. Verify it updates in the other window within 1 second without manual refresh.

### Implementation for User Story 5

- [x] T056 [US5] Create `useWhiteboardCollaboration` hook in `src/hooks/use-whiteboard-collaboration.ts`
- [x] T057 [US5] Implement Socket.IO connection in useWhiteboardCollaboration (reuse existing WebSocket infrastructure)
- [x] T058 [US5] Implement join-whiteboard event emission in useWhiteboardCollaboration
- [x] T059 [US5] Implement table:position-updated event listener in useWhiteboardCollaboration
- [x] T060 [US5] Update React Flow nodes state when receiving position updates from other users in useWhiteboardCollaboration
- [x] T061 [US5] Emit table:position-update event in onNodeDragStop handler in ReactFlowWhiteboard
- [x] T062 [US5] Integrate useWhiteboardCollaboration hook in ReactFlowWhiteboard component in `src/components/whiteboard/ReactFlowWhiteboard.tsx`
- [x] T063 [US5] Verify smooth position updates without visual jumps or conflicts (handled via React Flow state management)
- [x] T064 [US5] Implement leave-whiteboard event on component unmount (handled by base useCollaboration hook)

**Checkpoint**: At this point, multiple users can collaborate. Position changes propagate in real-time.

---

## Phase 8: User Story 6 - Display Modes for Information Density (Priority: P4)

**Goal**: Users can toggle between TABLE_NAME, KEY_ONLY, and ALL_FIELDS display modes

**Independent Test**: Click display mode toggle. Verify all tables update to show appropriate level of detail. Verify preference persists when whiteboard is reloaded.

### Implementation for User Story 6

- [x] T065 [US6] Add showMode state to ReactFlowWhiteboard (default: 'ALL_FIELDS') in `src/components/whiteboard/ReactFlowWhiteboard.tsx`
- [x] T066 [US6] Update convertTablesToNodes to accept showMode option and set it on all nodes in `src/lib/react-flow/convert-to-nodes.ts`
- [x] T067 [US6] Implement conditional column rendering in TableNode based on data.showMode in `src/components/whiteboard/TableNode.new.tsx`
- [x] T068 [US6] Add display mode toggle buttons to Toolbar component in `src/components/whiteboard/Toolbar.tsx`
- [x] T069 [US6] Wire display mode toggle to showMode state in ReactFlowWhiteboard via callback pattern
- [x] T070 [US6] Update all nodes' data.showMode when display mode changes via useEffect
- [x] T071 [US6] Persist showMode preference to localStorage
- [x] T072 [US6] Restore showMode preference on ReactFlowWhiteboard mount
- [x] T073 [US6] Verify TABLE_NAME mode shows only table name (no columns) - implemented in TableNode.new.tsx
- [x] T074 [US6] Verify KEY_ONLY mode shows table name + primary/foreign keys only - implemented in TableNode.new.tsx
- [x] T075 [US6] Verify ALL_FIELDS mode shows table name + all columns - implemented in TableNode.new.tsx

**Checkpoint**: All user stories complete. Users can toggle display modes and preferences persist.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Migration cleanup and optimization

- [ ] T076 [P] Add loading states to ReactFlowCanvas while data is being fetched
- [ ] T077 [P] Add error handling for failed data fetches in ReactFlowCanvas
- [ ] T078 [P] Optimize performance with useMemo for nodeTypes and edgeTypes in ReactFlowCanvas
- [ ] T079 [P] Optimize performance with useMemo for data conversion functions
- [ ] T080 [P] Optimize performance with useCallback for event handlers
- [ ] T081 [P] Verify React Flow virtualization is enabled (handles 100+ tables at 60 FPS)
- [ ] T082 [P] Add feature flag `VITE_USE_REACT_FLOW` for gradual rollout in `.env.local`
- [ ] T083 Toggle between old Canvas (Konva) and new ReactFlowCanvas based on feature flag in `src/routes/whiteboard/$whiteboardId.tsx`
- [ ] T084 Test migration with existing demo data from `src/data/demo.punk-songs.ts`
- [ ] T085 [P] Verify backward compatibility: all existing whiteboards load correctly
- [ ] T086 [P] Verify database schema unchanged (no Prisma migrations generated)
- [ ] T087 [P] Verify WebSocket events unchanged (existing server code works)
- [ ] T088 Mark old Konva files as deprecated with comments in `src/components/whiteboard/Canvas.tsx`, `src/lib/canvas/layout-engine.ts`, `src/lib/canvas/layout-worker.ts`
- [ ] T089 Update quickstart.md with any discovered implementation nuances
- [ ] T090 Run full integration test: create whiteboard, add tables, drag tables, auto-layout, collaborate (two windows)
- [ ] T091 Set feature flag to true by default after validation
- [ ] T092 [P] Remove deprecated Konva files in follow-up PR (not in this migration)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P2 → P3 → P3 → P4)
- **Polish (Phase 9)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories ✅ INDEPENDENT
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Builds on US1 but can be tested independently
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Builds on US1 but can be tested independently
- **User Story 4 (P3)**: Can start after Foundational (Phase 2) - Builds on US1 and US3, can be tested independently
- **User Story 5 (P3)**: Can start after Foundational (Phase 2) - Builds on US1 and US3, can be tested independently
- **User Story 6 (P4)**: Can start after Foundational (Phase 2) - Builds on US1, can be tested independently

### Within Each User Story

- Conversion utilities before components (foundational phase)
- TableNode and RelationshipEdge components before ReactFlowCanvas
- ReactFlowCanvas before route integration
- Core features before enhancements (e.g., basic rendering before highlighting, before drag, before auto-layout)

### Parallel Opportunities

**Setup Phase (Phase 1)**:

- T001, T002, T003 can all run in parallel

**Foundational Phase (Phase 2)**:

- T004-T014 can all run in parallel (different utility files)

**User Story 1 (Phase 3)**:

- T015 and T016 can run in parallel (TableNode and RelationshipEdge are independent)
- T024 and T025 can run in parallel (verification tasks)

**User Story 2 (Phase 4)**:

- T026 and T027 can run in parallel (buildEdgeMap and calculateHighlighting)

**User Story 4 (Phase 6)**:

- T045, T050 can start in parallel (worker and UI button)

**User Story 5 (Phase 7)**:

- Most tasks are sequential due to WebSocket integration complexity

**User Story 6 (Phase 8)**:

- T073, T074, T075 can run in parallel (verification tasks)

**Polish Phase (Phase 9)**:

- T076-T082, T085-T089 can run in parallel (different concerns)

---

## Parallel Example: Foundational Phase

```bash
# Launch all conversion utilities together (different files):
Task: "Implement convertTableToNode in src/lib/react-flow/convert-to-nodes.ts"
Task: "Implement convertRelationshipToEdge in src/lib/react-flow/convert-to-edges.ts"
Task: "Create type definitions in src/lib/react-flow/types.ts"
Task: "Create node/edge registry in src/lib/react-flow/node-types.ts"
```

## Parallel Example: User Story 1

```bash
# Launch custom components together:
Task: "Create TableNode component in src/components/whiteboard/TableNode.tsx"
Task: "Create RelationshipEdge component in src/components/whiteboard/RelationshipEdge.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
   - Load existing whiteboard
   - Verify all tables render with columns
   - Verify relationships render with cardinality markers
   - Verify pan and zoom work smoothly
5. Enable feature flag for limited rollout

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Enable for beta users (View-only MVP!)
3. Add User Story 2 → Test independently → Enable highlighting
4. Add User Story 3 → Test independently → Enable drag-and-drop
5. Add User Story 4 → Test independently → Enable auto-layout
6. Add User Story 5 → Test independently → Enable collaboration
7. Add User Story 6 → Test independently → Enable display modes
8. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together (15 tasks, ~2-3 days)
2. Once Foundational is done:
   - **Developer A**: User Story 1 (11 tasks) - View diagrams
   - **Developer B**: User Story 2 (13 tasks) - Highlighting
   - **Developer C**: User Story 3 (6 tasks) - Manual positioning
3. After US1-US3 complete:
   - **Developer A**: User Story 4 (11 tasks) - Auto-layout
   - **Developer B**: User Story 5 (9 tasks) - Collaboration
   - **Developer C**: User Story 6 (11 tasks) - Display modes
4. Team completes Polish phase together (17 tasks, ~2 days)

**Total**: 92 tasks

---

## Task Count Summary

- **Phase 1 (Setup)**: 3 tasks
- **Phase 2 (Foundational)**: 11 tasks ⚠️ BLOCKING
- **Phase 3 (US1 - View Diagrams - P1)**: 11 tasks 🎯 MVP
- **Phase 4 (US2 - Highlighting - P2)**: 13 tasks
- **Phase 5 (US3 - Manual Positioning - P2)**: 6 tasks
- **Phase 6 (US4 - Auto Layout - P3)**: 11 tasks
- **Phase 7 (US5 - Collaboration - P3)**: 9 tasks
- **Phase 8 (US6 - Display Modes - P4)**: 11 tasks
- **Phase 9 (Polish)**: 17 tasks

**Total Tasks**: 92

**Parallel Opportunities**: 20+ tasks can run in parallel within phases

**Independent Test Criteria**: All 6 user stories have clear independent test criteria defined

**Suggested MVP Scope**: Phase 1 + Phase 2 + Phase 3 (User Story 1 only) = 25 tasks

---

## Notes

- [P] tasks = different files, no dependencies within phase
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Feature flag allows gradual rollout and easy rollback
- Database schema and WebSocket contracts unchanged (backward compatible)
- Konva files deprecated but not removed (allows rollback if needed)
- All conversion utilities are pure functions (easily testable)
- React Flow handles edge routing automatically (no manual path calculation)
- ELK layout runs in Web Worker (non-blocking)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
