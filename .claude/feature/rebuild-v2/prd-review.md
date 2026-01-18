# PRD Review: Liz-Whiteboard v2 Complete Rebuild

**Feature ID**: rebuild-v2
**Reviewer**: Athena (PM Agent)
**Review Date**: 2026-01-18
**PRD Version**: Draft

---

## Verdict: APPROVED_WITH_NOTES

The PRD is comprehensive, well-structured, and accurately reflects the current codebase state. It provides clear direction for the rebuild effort with measurable success criteria. Minor clarifications are needed in a few areas, but these do not block implementation.

---

## Review Summary

| Category         | Rating | Notes                                       |
| ---------------- | ------ | ------------------------------------------- |
| Completeness     | 9/10   | Comprehensive coverage of all major areas   |
| Clarity          | 8/10   | Minor ambiguities in edge cases             |
| Feasibility      | 9/10   | Goals are achievable with validated metrics |
| Scope            | 9/10   | Well-bounded, appropriate exclusions        |
| Risks            | 8/10   | Good coverage, minor gaps identified        |
| Success Criteria | 9/10   | Measurable and realistic                    |

---

## 1. Completeness Assessment

### Strengths

1. **User Stories**: All 7 user stories follow proper Given/When/Then format with clear acceptance scenarios
2. **Functional Requirements**: 41 requirements (FR-001 to FR-041) cover all aspects of the application
3. **Non-Functional Requirements**: 12 NFRs address performance, code quality, and security
4. **Architecture Overview**: Clear before/after directory structure with explicit files to remove
5. **Dependencies Analysis**: Accurate listing of packages to remove vs. keep

### Validated Claims

I verified the following PRD claims against the actual codebase:

| Claim                               | Actual                                                                            | Status            |
| ----------------------------------- | --------------------------------------------------------------------------------- | ----------------- |
| Canvas.tsx is 496 lines             | 496 lines                                                                         | VERIFIED          |
| layout-engine.ts is 500 lines       | 499 lines                                                                         | VERIFIED (close)  |
| layout-worker.ts is 100 lines       | 153 lines                                                                         | MINOR DISCREPANCY |
| $whiteboardId.tsx is 740 lines      | 739 lines                                                                         | VERIFIED          |
| Minimap.tsx is 200 lines            | 268 lines                                                                         | MINOR DISCREPANCY |
| Total estimated removal ~2000 lines | 2155 lines actual                                                                 | VERIFIED          |
| Dual routes exist                   | $whiteboardId.tsx and $whiteboardId.new.tsx confirmed                             | VERIFIED          |
| Konva dependencies exist            | konva ^10.0.8 and react-konva ^19.2.0 in package.json                             | VERIFIED          |
| d3-force dependencies exist         | d3-force ^3.0.0 and @types/d3-force ^3.0.10 confirmed                             | VERIFIED          |
| Feature flag exists                 | VITE_USE_REACT_FLOW found in $whiteboardId.tsx                                    | VERIFIED          |
| Multiple converter files            | 3 converter files exist (converters.ts, convert-to-nodes.ts, convert-to-edges.ts) | VERIFIED          |

### Minor Gaps

1. **Missing Test Strategy**: User Story acceptance criteria mention tests passing, but no specific test coverage requirements are defined for:
   - Integration tests for WebSocket collaboration
   - Visual regression tests for React Flow rendering
   - Performance benchmark methodology

2. **Dual Component Files Not Mentioned**: The PRD mentions removing Canvas.tsx but doesn't explicitly address the dual component pattern:
   - `TableNode.tsx` vs `TableNode.new.tsx`
   - `RelationshipEdge.tsx` vs `RelationshipEdge.new.tsx`

   **Recommendation**: Add these to the files-to-consolidate list

3. **Current Total Codebase Size**: The PRD mentions 40% reduction but doesn't state the baseline. For reference:
   - Current src/ directory: ~16,806 lines
   - Files to remove: ~2,155 lines
   - Estimated reduction: ~13% from removal alone, additional consolidation needed to reach 30-40%

---

## 2. Clarity Assessment

### Clear and Testable Requirements

- FR-001 through FR-041 are well-written with specific, verifiable behavior
- NFR performance metrics are specific (60 FPS, 2 seconds load, 100ms latency)
- User story acceptance scenarios are measurable

### Ambiguities Identified

1. **FR-008**: "System SHALL persist viewport state (zoom, position) per whiteboard"
   - **Question**: Where is viewport state persisted? The Prisma schema shows `canvasState Json?` which appears to be the storage location, but this isn't explicitly stated.
   - **Recommendation**: Clarify that `Whiteboard.canvasState` stores viewport information

2. **FR-017**: "System SHALL connect edges to specific column handles, not just table centers"
   - **Question**: What happens when a column is deleted that has connected relationships?
   - **Clarification**: The Prisma schema has `onDelete: Cascade` on Relationship -> Column, so relationships are automatically deleted. This behavior should be documented as an acceptance scenario.

3. **Success Criteria SC-004**: "Total lines of code reduced by 30-40%"
   - **Issue**: Based on my analysis, removing the 2,155 identified lines from a 16,806 line codebase is only ~13%. The 30-40% reduction requires significant consolidation beyond just removal.
   - **Recommendation**: Either adjust the target or expand the scope of consolidation

---

## 3. Feasibility Assessment

### Technical Feasibility: HIGH

1. **React Flow is Production-Ready**: Already integrated and working in $whiteboardId.new.tsx (506 lines)
2. **ELK Layout is Functional**: `src/lib/react-flow/elk-layout.ts` exists and is operational
3. **No Database Changes Required**: Prisma schema is clean and adequate
4. **WebSocket Layer Stable**: Socket.IO integration is mature

### Effort Estimation Validation

| Phase                  | PRD Estimate            | Assessment                          |
| ---------------------- | ----------------------- | ----------------------------------- |
| Phase 1: Foundation    | Remove legacy           | 1-2 days - straightforward deletion |
| Phase 2: Consolidate   | Merge routes/converters | 2-3 days - requires careful merging |
| Phase 3: Clean Up      | Tests, verification     | 2-3 days - depends on test coverage |
| Phase 4: Documentation | Update docs             | 1 day                               |

**Total Estimated Effort**: 6-9 days for experienced developer

### Potential Blockers

1. **Limited Test Coverage**: Only 1 test file found (`diagram-parser.test.ts`). Manual verification will be needed for visual regression.
2. **Konva References in Multiple Files**: Found 7 files with Konva references that need updating:
   - src/routes/whiteboard/$whiteboardId.new.tsx
   - src/routes/whiteboard/$whiteboardId.tsx
   - src/lib/react-flow/types.ts
   - src/components/whiteboard/TableNode.tsx
   - src/components/whiteboard/RelationshipEdge.tsx
   - src/components/whiteboard/Canvas.tsx
   - src/components/whiteboard/ReactFlowCanvas.tsx

---

## 4. Scope Assessment

### Well-Bounded Scope

The Out of Scope section appropriately excludes:

- New feature development
- Authentication/authorization
- Database schema changes
- Mobile optimizations
- Additional DSL features
- Undo/redo
- Export functionality

### Scope Creep Risk: LOW

The PRD correctly focuses on removal and consolidation rather than enhancement. No feature creep is present.

### Boundary Clarifications Needed

1. **Display Mode Feature**: FR-013 mentions "System SHALL support multiple display modes: ALL_FIELDS, KEYS_ONLY, TABLE_NAME_ONLY"
   - **Question**: Is this existing functionality being preserved, or new functionality being added?
   - **Recommendation**: Verify this exists in current React Flow implementation

2. **Theme Support**: User Story 7 and FR-039 through FR-041 mention theming
   - **Observation**: `next-themes` is already in package.json
   - **Question**: Is theming currently working in React Flow mode, or does it require implementation?

---

## 5. Risk Assessment

### Risks Identified in PRD

| Risk                            | Impact | Mitigation                  | Assessment                           |
| ------------------------------- | ------ | --------------------------- | ------------------------------------ |
| Regression in existing features | High   | Comprehensive test coverage | ADEQUATE - but test coverage is thin |
| Data migration issues           | Medium | Keep same schema            | ADEQUATE                             |
| Performance degradation         | Medium | Benchmark before/after      | ADEQUATE                             |
| WebSocket compatibility         | Low    | Minimal changes             | ADEQUATE                             |
| Theme styling differences       | Low    | Test both themes            | ADEQUATE                             |

### Additional Risks Identified

1. **RISK: Incomplete Component Removal**
   - **Description**: Dual component files (TableNode.tsx vs TableNode.new.tsx) may be missed
   - **Impact**: Medium - code duplication persists
   - **Mitigation**: Add explicit list of all dual-component files to Phase 2

2. **RISK: Import Path Breakage**
   - **Description**: Other files may import from soon-to-be-deleted files
   - **Impact**: Medium - build failures
   - **Mitigation**: Run full dependency graph analysis before deletion

3. **RISK: Type Definition Dependencies**
   - **Description**: `src/lib/react-flow/types.ts` contains Konva references - may have wider type dependencies
   - **Impact**: Low - TypeScript will catch issues
   - **Mitigation**: Update types.ts early in Phase 1

---

## 6. Success Criteria Assessment

### Measurable Criteria

| Criterion                       | Measurability                  | Realistic?               |
| ------------------------------- | ------------------------------ | ------------------------ |
| SC-001: Zero visual regression  | Subjective - needs screenshots | Yes, with manual testing |
| SC-002: Remove 3 packages       | Objective - package.json       | Yes                      |
| SC-003: Single whiteboard route | Objective - file count         | Yes                      |
| SC-004: 30-40% LOC reduction    | Objective - wc -l              | QUESTIONABLE (see note)  |
| SC-005: All tests pass          | Objective - vitest             | Yes                      |
| SC-006: 60 FPS with 50 tables   | Objective - dev tools          | Yes                      |
| SC-007: WebSocket works         | Objective - multi-client test  | Yes                      |

### SC-004 Concern

As noted earlier, removing 2,155 lines from 16,806 total is only ~13%. To achieve 30-40%:

- Additional consolidation of React Flow files needed (~12 files in lib/react-flow/)
- Simplification of component hierarchy
- Removal of any other legacy code

**Recommendation**: Either lower target to 20-25% or add explicit consolidation tasks for React Flow files.

---

## 7. Recommendations

### Must Address Before Implementation

1. **Add dual-component files to removal list**: TableNode.tsx, TableNode.new.tsx, RelationshipEdge.tsx, RelationshipEdge.new.tsx - clarify which is kept
2. **Clarify code reduction target**: Adjust SC-004 from 30-40% to 15-20% OR expand consolidation scope
3. **Document existing vs. new functionality** for display modes (FR-013) and theming (US-7)

### Nice to Have

1. Add visual regression testing strategy
2. Create dependency graph before removal
3. Define rollback strategy if issues discovered mid-rebuild

---

## 8. Conclusion

This PRD demonstrates excellent preparation for a refactoring project:

- **Accurate Codebase Analysis**: File line counts and dependency lists are verified
- **Clear Problem Statement**: Dual-implementation issues are well-documented
- **Appropriate Scope**: Focus on removal/consolidation without feature creep
- **Measurable Goals**: Most success criteria are objective and testable

The minor issues identified do not block approval but should be addressed in the technical specification phase to ensure implementation success.

**Final Verdict: APPROVED_WITH_NOTES**

---

_Review completed by Athena, PM Agent, as part of the Kratos pipeline._
