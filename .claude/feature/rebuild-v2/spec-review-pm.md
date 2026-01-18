# PM Spec Review: Tech Spec for rebuild-v2

**Reviewer**: Athena (PM Agent)
**Review Date**: 2026-01-18
**Tech Spec Version**: 1.0
**PRD Reference**: prd.md (rebuild-v2)

---

## Executive Summary

This review assesses whether the technical specification adequately addresses all Product Requirements Document (PRD) requirements for the Liz-Whiteboard v2 rebuild project. The tech spec is evaluated against 41 functional requirements, 7 user stories, success criteria, scope adherence, and risk mitigation.

**VERDICT: APPROVED_WITH_NOTES**

The tech spec is comprehensive and well-aligned with PRD requirements. It can proceed to the next stage with minor clarifications needed during implementation.

---

## 1. Requirements Coverage Analysis

### 1.1 Functional Requirements Mapping (41 Total)

#### Canvas Rendering (FR-001 to FR-008): COVERED

| Requirement                                             | Tech Spec Coverage                                                       | Status               |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------- |
| FR-001: Render tables as custom React Flow nodes        | TableNode.tsx kept, renders table name, columns, data types, constraints | COVERED              |
| FR-002: Render relationships as custom React Flow edges | RelationshipEdge.tsx kept, column-level handles                          | COVERED              |
| FR-003: Cardinality markers                             | CardinalityMarkerDefs.tsx, cardinality-markers.tsx explicitly kept       | COVERED              |
| FR-004: Zoom via mouse wheel (10%-500%)                 | React Flow built-in, ReactFlowCanvas.tsx                                 | COVERED              |
| FR-005: Panning on empty space                          | React Flow built-in                                                      | COVERED              |
| FR-006: Zoom controls                                   | Toolbar.tsx modified, React Flow controls                                | COVERED              |
| FR-007: Minimap navigation                              | React Flow MiniMap replaces custom Minimap.tsx                           | COVERED              |
| FR-008: Persist viewport state                          | Not explicitly mentioned in tech spec                                    | CLARIFICATION NEEDED |

#### Table and Column Management (FR-009 to FR-013): COVERED

| Requirement                          | Tech Spec Coverage                                                    | Status  |
| ------------------------------------ | --------------------------------------------------------------------- | ------- |
| FR-009: Create tables                | API routes preserved (tables.ts)                                      | COVERED |
| FR-010: Add/edit/remove columns      | API routes preserved (columns.ts)                                     | COVERED |
| FR-011: Column attributes            | Prisma schema unchanged                                               | COVERED |
| FR-012: Drag tables with persistence | Section 4.2 Position Update Flow explicitly covers                    | COVERED |
| FR-013: Display modes                | Manual test checklist includes ALL_FIELDS, KEY_ONLY, TABLE_NAME modes | COVERED |

#### Relationship Management (FR-014 to FR-017): COVERED

| Requirement                  | Tech Spec Coverage                      | Status  |
| ---------------------------- | --------------------------------------- | ------- |
| FR-014: Create relationships | API routes preserved (relationships.ts) | COVERED |
| FR-015: Cardinality types    | Prisma schema unchanged, markers kept   | COVERED |
| FR-016: Auto-route edges     | React Flow built-in edge routing        | COVERED |
| FR-017: Column-level handles | handles.ts explicitly kept              | COVERED |

#### Automatic Layout (FR-018 to FR-022): COVERED

| Requirement                    | Tech Spec Coverage                                    | Status               |
| ------------------------------ | ----------------------------------------------------- | -------------------- |
| FR-018: ELK layout             | elk-layout.ts explicitly kept, d3-force removed       | COVERED              |
| FR-019: Related tables closer  | ELK algorithm handles this                            | COVERED              |
| FR-020: Disconnected clusters  | Section 4.3 mentions this, test checklist includes it | COVERED              |
| FR-021: Animated transitions   | Not explicitly mentioned                              | CLARIFICATION NEEDED |
| FR-022: Auto-layout preference | use-auto-layout.ts kept, test checklist includes it   | COVERED              |

#### Text DSL Parser (FR-023 to FR-027): COVERED

| Requirement                       | Tech Spec Coverage                 | Status  |
| --------------------------------- | ---------------------------------- | ------- |
| FR-023: Parse Mermaid-like syntax | diagram-parser.ts explicitly kept  | COVERED |
| FR-024: Convert AST to entities   | ast.ts explicitly kept             | COVERED |
| FR-025: Generate DSL from diagram | TextEditor.tsx kept                | COVERED |
| FR-026: Syntax validation         | diagram-parser.test.ts kept        | COVERED |
| FR-027: Debounce parsing          | Implementation detail, not altered | COVERED |

#### Real-Time Collaboration (FR-028 to FR-034): COVERED

| Requirement                           | Tech Spec Coverage                                | Status               |
| ------------------------------------- | ------------------------------------------------- | -------------------- |
| FR-028: WebSocket per whiteboard      | use-collaboration.ts explicitly kept              | COVERED              |
| FR-029: Broadcast table events        | Section 4.2 covers WebSocket events               | COVERED              |
| FR-030: Broadcast relationship events | use-whiteboard-collaboration.ts kept              | COVERED              |
| FR-031: Broadcast position changes    | Section 4.2 explicitly covers table:move          | COVERED              |
| FR-032: Broadcast layout results      | Section 4.3 covers layout:computed event          | COVERED              |
| FR-033: Connection status indicator   | Not explicitly mentioned                          | CLARIFICATION NEEDED |
| FR-034: Reconnection handling         | Manual test checklist mentions WebSocket connects | COVERED              |

#### Project Organization (FR-035 to FR-038): COVERED

| Requirement                     | Tech Spec Coverage                       | Status  |
| ------------------------------- | ---------------------------------------- | ------- |
| FR-035: Project CRUD            | API routes preserved (projects.ts)       | COVERED |
| FR-036: Nested folders          | API routes preserved (folders.ts)        | COVERED |
| FR-037: Whiteboards in folders  | API routes preserved (whiteboards.ts)    | COVERED |
| FR-038: Hierarchical navigation | Navigator components marked "No changes" | COVERED |

#### Theming (FR-039 to FR-041): COVERED

| Requirement                     | Tech Spec Coverage                        | Status  |
| ------------------------------- | ----------------------------------------- | ------- |
| FR-039: Dark/light themes       | use-theme.tsx explicitly kept             | COVERED |
| FR-040: Persist in localStorage | Theme test checklist includes persistence | COVERED |
| FR-041: Apply to all UI/canvas  | Theme test checklist covers both themes   | COVERED |

### 1.2 Requirements Coverage Summary

| Category          | Total  | Covered | Clarification Needed |
| ----------------- | ------ | ------- | -------------------- |
| Canvas Rendering  | 8      | 7       | 1                    |
| Table/Column Mgmt | 5      | 5       | 0                    |
| Relationship Mgmt | 4      | 4       | 0                    |
| Auto Layout       | 5      | 4       | 1                    |
| Text DSL          | 5      | 5       | 0                    |
| Collaboration     | 7      | 6       | 1                    |
| Project Org       | 4      | 4       | 0                    |
| Theming           | 3      | 3       | 0                    |
| **TOTAL**         | **41** | **38**  | **3**                |

**Coverage Rate: 92.7% explicit, 100% implicit (all requirements addressed)**

---

## 2. User Story Alignment

### User Story 1: Create and Edit ER Diagrams (P0) - ALIGNED

**Tech Spec Support:**

- TableNode.tsx handles table rendering
- API routes for tables/columns/relationships preserved
- ReactFlowCanvas.tsx handles interactions
- Position Update Flow (Section 4.2) covers persistence

**Acceptance Scenarios Coverage:**

- Page load rendering: ReactFlowWhiteboard.tsx handles data loading
- Add table: API + React Flow state update
- Column operations: API routes unchanged
- Relationship creation: API + RelationshipEdge.tsx
- Position persistence: Explicitly covered in Section 4.2

### User Story 2: Navigate Large Diagrams (P0) - ALIGNED

**Tech Spec Support:**

- React Flow built-in zoom/pan
- React Flow MiniMap (replaces custom Minimap.tsx)
- Toolbar.tsx for controls
- ReactFlowCanvas.tsx handles 60 FPS requirement

**Acceptance Scenarios Coverage:**

- Zoom with mouse wheel: React Flow built-in
- Pan by dragging: React Flow built-in
- Fit View: Toolbar.tsx controls
- Minimap navigation: React Flow MiniMap
- 60 FPS performance: Performance benchmarks defined

### User Story 3: Collaborate in Real-Time (P0) - ALIGNED

**Tech Spec Support:**

- use-collaboration.ts explicitly kept
- use-whiteboard-collaboration.ts explicitly kept
- WebSocket events documented in Section 4.2, 4.3

**Acceptance Scenarios Coverage:**

- Table sync: table:move event
- Position updates: Position Update Flow
- Relationship sync: use-whiteboard-collaboration.ts
- Delete sync: WebSocket events
- Reconnection: Manual test checklist

### User Story 4: Define Diagrams via Text DSL (P1) - ALIGNED

**Tech Spec Support:**

- TextEditor.tsx explicitly kept
- diagram-parser.ts explicitly kept
- ast.ts explicitly kept
- Parser tests preserved

**Acceptance Scenarios Coverage:**

- DSL display: TextEditor.tsx
- Syntax validation: diagram-parser.ts
- Apply changes: Parser integration
- Bidirectional sync: TextEditor.tsx
- Error messages: diagram-parser.test.ts

### User Story 5: Apply Automatic Layout (P1) - ALIGNED

**Tech Spec Support:**

- elk-layout.ts explicitly kept
- use-auto-layout.ts explicitly kept
- d3-force removed, ELK only
- Section 4.3 Auto-Layout Flow

**Acceptance Scenarios Coverage:**

- ELK layout trigger: Manual test checklist
- Connected table grouping: ELK algorithm
- Disconnected clusters: ELK algorithm
- Edge routing: React Flow
- Auto-layout preference: use-auto-layout-preference.ts kept

### User Story 6: Organize Projects and Whiteboards (P1) - ALIGNED

**Tech Spec Support:**

- All navigator components marked "No changes"
- All API routes preserved
- Data access files preserved

**Acceptance Scenarios Coverage:**

- Create project: API + navigator
- Create folder: API + navigator
- Create whiteboard: API + navigator
- Rename: API + navigator
- Delete with children: API + navigator

### User Story 7: Support Dark/Light Theme (P2) - ALIGNED

**Tech Spec Support:**

- use-theme.tsx explicitly kept
- Manual test checklist includes theme testing

**Acceptance Scenarios Coverage:**

- Theme toggle: use-theme.tsx
- Canvas dark theme: Test checklist
- Persistence: localStorage test
- No glitches: Manual testing

### User Story Alignment Summary

| User Story                    | Priority | Alignment Status |
| ----------------------------- | -------- | ---------------- |
| US-1: Create/Edit Diagrams    | P0       | FULLY ALIGNED    |
| US-2: Navigate Large Diagrams | P0       | FULLY ALIGNED    |
| US-3: Real-Time Collaboration | P0       | FULLY ALIGNED    |
| US-4: Text DSL                | P1       | FULLY ALIGNED    |
| US-5: Auto Layout             | P1       | FULLY ALIGNED    |
| US-6: Project Organization    | P1       | FULLY ALIGNED    |
| US-7: Theme Support           | P2       | FULLY ALIGNED    |

**All 7 user stories are aligned with tech spec implementation.**

---

## 3. Success Criteria Verification

### PRD Success Criteria vs Tech Spec

| Success Criterion               | Tech Spec Coverage                                                           | Status   |
| ------------------------------- | ---------------------------------------------------------------------------- | -------- |
| SC-001: Zero visual regression  | Manual test checklist comprehensive                                          | COVERED  |
| SC-002: 3 packages removed      | Section 2 removes konva, react-konva, d3-force, @types/d3-force (4 packages) | EXCEEDED |
| SC-003: Routes reduced 2->1     | Section 1.2 renames .new.tsx to .tsx                                         | COVERED  |
| SC-004: 30-40% code reduction   | Revised to 15-20% (realistic)                                                | ADJUSTED |
| SC-005: Vitest tests pass       | Phase 7 verification steps                                                   | COVERED  |
| SC-006: 60 FPS with 50 tables   | Section 7.3 Performance Benchmarks                                           | COVERED  |
| SC-007: WebSocket collaboration | Manual test checklist, Section 4.2                                           | COVERED  |

**Note on SC-004:** The PRD stated 30-40% code reduction, but the tech spec revised this to 15-20% based on actual file analysis. This is a realistic adjustment documented in the PRD review notes.

---

## 4. Scope Adherence Assessment

### In-Scope Items (PRD Defined)

| Item                        | Tech Spec Status                      |
| --------------------------- | ------------------------------------- | -------- |
| Remove Konva dependencies   | Phase 6 explicitly removes            | IN SCOPE |
| Delete Konva-specific files | Section 1.1 lists all files to delete | IN SCOPE |
| Remove feature flag         | Phase 2 removes VITE_USE_REACT_FLOW   | IN SCOPE |
| Consolidate routes          | Phase 2-3 handles                     | IN SCOPE |
| Merge converters            | Phase 5 consolidates                  | IN SCOPE |
| Update documentation        | Phase 8 updates CLAUDE.md             | IN SCOPE |

### Out-of-Scope Items (PRD Defined)

| Item                         | Tech Spec Status                  |
| ---------------------------- | --------------------------------- |
| New feature development      | NOT INCLUDED - Correct            |
| Authentication/authorization | NOT INCLUDED - Correct            |
| Database schema changes      | Prisma schema unchanged - Correct |
| Mobile optimizations         | NOT INCLUDED - Correct            |
| Additional DSL syntax        | NOT INCLUDED - Correct            |
| Undo/redo                    | NOT INCLUDED - Correct            |
| Export to SQL                | NOT INCLUDED - Correct            |

**No feature creep detected. Tech spec stays within defined scope.**

---

## 5. Risk Mitigation Review

### PRD Risks vs Tech Spec Mitigation

| PRD Risk                        | PRD Mitigation              | Tech Spec Handling                                            |
| ------------------------------- | --------------------------- | ------------------------------------------------------------- | -------- |
| Regression in existing features | Comprehensive test coverage | Section 7: Manual test checklist, future test recommendations | ADEQUATE |
| Data migration issues           | Keep same schema            | Prisma schema explicitly unchanged                            | ADEQUATE |
| Performance degradation         | Benchmark before/after      | Section 7.3: Performance benchmarks with specific metrics     | ADEQUATE |
| WebSocket compatibility         | Minimal changes to collab   | use-collaboration.ts, use-whiteboard-collaboration.ts kept    | ADEQUATE |
| Theme styling differences       | Test both themes            | Manual test checklist includes theme testing                  | ADEQUATE |

### Additional Risks Identified by Tech Spec

| Risk                        | Mitigation                             |
| --------------------------- | -------------------------------------- |
| Import errors after renames | TypeScript compiler, incremental fixes |
| Missing functionality       | Keep .bak files until verification     |

### Rollback Plan

The tech spec includes a comprehensive rollback plan (Section 8):

- Rollback triggers defined
- Quick rollback steps (< 5 minutes)
- Full rollback if merged to main
- Verification steps after rollback

**Risk mitigation is thorough and exceeds PRD requirements.**

---

## 6. Review Findings

### Strengths

1. **Comprehensive file operations**: Every file to delete, rename, and modify is explicitly listed with line counts
2. **Clear implementation phases**: 8 phases with duration estimates and risk levels
3. **Detailed data flow documentation**: Sections 4.1-4.3 clearly explain data pipelines
4. **Robust testing strategy**: Manual test checklist covers all user scenarios
5. **Proactive rollback planning**: Triggers, steps, and verification defined
6. **Realistic metrics**: Code reduction target adjusted to achievable 15-20%
7. **Import update guide**: Appendix B provides copy-paste import changes

### Items Requiring Clarification

1. **FR-008 (Viewport state persistence)**: Not explicitly mentioned how viewport state is persisted. Need to confirm React Flow/localStorage implementation.

2. **FR-021 (Animated transitions for layout)**: The tech spec doesn't explicitly mention animation during layout. ELK layout may apply positions instantly. Consider if animation is needed.

3. **FR-033 (Connection status indicator)**: WebSocket status UI is not explicitly called out. The use-collaboration hook likely handles this, but should be verified during implementation.

### Minor Recommendations

1. **Add viewport test to checklist**: Include "Viewport state persists after page refresh" in Section 7.2

2. **Clarify animation approach**: Add note about whether layout transitions should animate or apply instantly

3. **Connection status verification**: Add "WebSocket connection status indicator displays correctly" to collaboration test checklist

---

## 7. Verdict

### APPROVED_WITH_NOTES

The technical specification is comprehensive, well-organized, and adequately covers all 41 functional requirements and 7 user stories from the PRD. The implementation phases are realistic, risks are well-mitigated, and the scope remains focused on the rebuild without feature creep.

**Rationale:**

- 100% user story coverage
- 92.7% explicit functional requirement coverage (3 items need implementation clarification)
- All success criteria addressed (with realistic code reduction adjustment)
- No scope creep
- Comprehensive risk mitigation and rollback planning

**Conditions for Proceeding:**

1. Development team acknowledges the 3 clarification items (FR-008, FR-021, FR-033)
2. These items should be verified during implementation testing
3. No blocking issues identified

---

## 8. Approval Record

| Field                 | Value               |
| --------------------- | ------------------- |
| Review Stage          | 4-spec-review-pm    |
| Reviewer              | Athena (PM Agent)   |
| Review Date           | 2026-01-18          |
| Verdict               | APPROVED_WITH_NOTES |
| Blocking Issues       | 0                   |
| Clarifications Needed | 3 (minor)           |
| Ready for Next Stage  | YES                 |

---

_This review was conducted by Athena, the PM Agent, as part of the Kratos pipeline._
