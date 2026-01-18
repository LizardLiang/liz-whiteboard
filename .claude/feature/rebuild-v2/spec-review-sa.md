# Technical Specification Review (Architecture)

**Feature ID**: rebuild-v2
**Reviewer**: Apollo (Architecture Review Agent)
**Review Date**: 2026-01-18
**Tech Spec Version**: 1.0

---

## Verdict: APPROVED_WITH_NOTES

The technical specification is architecturally sound and represents a well-planned consolidation effort. The proposed component structure is clean, the data flow is well-designed, and the implementation phases are correctly ordered with proper dependencies. Minor recommendations are provided to strengthen the implementation plan.

---

## Review Summary

| Category               | Rating | Notes                                                    |
| ---------------------- | ------ | -------------------------------------------------------- |
| Architecture Soundness | 9/10   | Clean component hierarchy, proper separation of concerns |
| Data Flow Design       | 9/10   | Well-designed database to React Flow pipeline            |
| Implementation Order   | 10/10  | Phases correctly ordered with proper dependencies        |
| Risk Assessment        | 8/10   | Good coverage, minor gaps identified                     |
| Performance            | 9/10   | Architecture meets 60 FPS and <3s load requirements      |
| Code Quality           | 9/10   | Significant maintainability improvements                 |

---

## 1. Architecture Soundness Assessment

### Strengths

**1.1 Clean Component Hierarchy**

The proposed component structure after rebuild is exemplary:

```
$whiteboardId.tsx (route)
  |
  +-> ReactFlowWhiteboard.tsx
       |
       +-> ReactFlowCanvas.tsx
       |    |
       |    +-> TableNode.tsx
       |    +-> RelationshipEdge.tsx
       |    +-> CardinalityMarkerDefs.tsx
       |
       +-> Toolbar.tsx
       +-> TextEditor.tsx
       +-> useAutoLayout (hook)
       +-> useWhiteboardCollaboration (hook)
```

This hierarchy follows the **Single Responsibility Principle**:

- `$whiteboardId.tsx`: Route handling and data fetching
- `ReactFlowWhiteboard.tsx`: Data coordination and state management
- `ReactFlowCanvas.tsx`: React Flow wrapper with interaction handling
- `TableNode.tsx` / `RelationshipEdge.tsx`: Atomic visual components

**1.2 Elimination of Dual-Component Anti-Pattern**

The current dual-component pattern (`.tsx` vs `.new.tsx` files) violates the **Don't Repeat Yourself (DRY)** principle. The tech spec correctly identifies and eliminates:

- `TableNode.tsx` (Konva) vs `TableNode.new.tsx` (React Flow) - RESOLVED
- `RelationshipEdge.tsx` (Konva) vs `RelationshipEdge.new.tsx` (React Flow) - RESOLVED
- `$whiteboardId.tsx` (Konva route) vs `$whiteboardId.new.tsx` (React Flow route) - RESOLVED

**1.3 Unified Converter Pattern**

Consolidating three converter files into one is architecturally correct:

- Current: `converters.ts` (96 lines) + `convert-to-nodes.ts` (66 lines) + `convert-to-edges.ts` (119 lines)
- Proposed: Single `converters.ts` (~200 lines)

The consolidated file maintains cohesion by keeping all database-to-React-Flow transformations together.

### Verified Implementation Files

I analyzed the existing React Flow implementation files:

| File                  | Lines | Quality   | Notes                                       |
| --------------------- | ----- | --------- | ------------------------------------------- |
| `converters.ts`       | 96    | Good      | Clean conversion functions, proper typing   |
| `convert-to-nodes.ts` | 66    | Good      | Well-documented, handles ShowMode           |
| `convert-to-edges.ts` | 119   | Good      | Cardinality markers properly handled        |
| `types.ts`            | 181   | Excellent | No Konva references, pure React Flow types  |
| `elk-layout.ts`       | 168   | Excellent | Web Worker pattern, proper timeout handling |
| `ReactFlowCanvas.tsx` | 211   | Excellent | Proper memoization, clean event handling    |
| `TableNode.new.tsx`   | 151   | Good      | Proper Handle placement, display modes      |

### Minor Concerns

**1.4 Type Duplication in Converter Merge**

Current `converters.ts` uses:

```typescript
type TableNode = { id, type: 'erTable', ... }
```

While `convert-to-nodes.ts` uses:

```typescript
type TableNodeType = Node<TableNodeData, 'table'>
```

**Recommendation**: During merge, standardize on `TableNodeType` from `types.ts` for consistency.

**1.5 Handle ID Format Inconsistency**

- `converters.ts`: `${columnId}-source` / `${columnId}-target`
- `convert-to-edges.ts`: `${tableId}__${columnId}`

**Recommendation**: Document which format is canonical and ensure consistency post-merge.

---

## 2. Data Flow Assessment

### Pipeline Architecture

The proposed data flow is well-designed:

```
Database (Prisma)
      |
      v
Server Functions (createServerFn)
      |
      v
TanStack Query (caching, refetching)
      |
      v
Converters (convertTablesToNodes, convertRelationshipsToEdges)
      |
      v
React Flow State (useNodesState, useEdgesState)
      |
      v
React Flow Canvas (rendering)
```

### Verified Data Flow Components

**2.1 Database to React Flow (Verified)**

The converters properly map Prisma types to React Flow types:

```typescript
// From convert-to-nodes.ts
export function convertTableToNode(
  table: DiagramTable & { columns: Column[] }
): TableNodeType {
  return {
    id: table.id,
    type: 'table',
    position: { x: table.positionX, y: table.positionY },
    data: { table, showMode: 'ALL_FIELDS', ... }
  }
}
```

**2.2 Position Update Flow (Verified)**

The `onNodeDragStop` callback in `ReactFlowCanvas.tsx` properly propagates position updates:

```typescript
const onNodeDragStop = useCallback<NodeDragHandler<TableNodeType>>(
  (event, node) => {
    onNodeDragStopProp?.(event, node) // Propagates to parent
  },
  [onNodeDragStopProp],
)
```

**2.3 ELK Layout Flow (Verified)**

The ELK integration is production-ready:

- Web Worker pattern prevents UI blocking
- 10-second timeout prevents hanging
- Proper error handling with Promise rejection
- `extractPositionsForBatchUpdate()` enables efficient database updates

### Data Flow Improvements in Tech Spec

1. **Unified Conversion Point**: Single `converters.ts` reduces cognitive load
2. **Eliminated Legacy Viewport Conversion**: `convertToCanvasViewport()` / `convertToReactFlowViewport()` can be removed
3. **Simplified Position Extraction**: `extractPositionUpdates()` consolidates position handling

---

## 3. Implementation Order Assessment

### Phase Dependency Analysis

| Phase                            | Dependencies | Correct Order | Notes                                     |
| -------------------------------- | ------------ | ------------- | ----------------------------------------- |
| Phase 1: Preparation             | None         | YES           | Baseline checkpoint before changes        |
| Phase 2: Remove Feature Flag     | Phase 1      | YES           | Must occur before file deletions          |
| Phase 3: Remove Konva Components | Phase 2      | YES           | Feature flag must be removed first        |
| Phase 4: Remove d3-force         | Phase 3      | YES           | Konva components may reference layout     |
| Phase 5: Consolidate Converters  | Phase 3      | YES           | Imports must be updated after renames     |
| Phase 6: Remove Dependencies     | Phase 5      | YES           | All code references must be removed first |
| Phase 7: Clean Up                | Phase 6      | YES           | Verification after all changes            |
| Phase 8: Documentation           | Phase 7      | YES           | Document final state                      |

**Assessment: CORRECT**

The phases are properly sequenced. Key ordering decisions:

1. Feature flag removal (Phase 2) before component deletion (Phase 3) prevents broken conditional imports
2. Component renames (Phase 3) before converter consolidation (Phase 5) ensures correct import paths
3. Dependency removal (Phase 6) after all code changes prevents build failures during development

### Critical Path Analysis

```
Phase 1 (30 min)
     |
     v
Phase 2 (1 hr) - CRITICAL: Feature flag removal
     |
     v
Phase 3 (1 hr) - CRITICAL: Component renames
     |
     v
Phase 4 (30 min)
     |
     v
Phase 5 (45 min)
     |
     v
Phase 6 (15 min)
     |
     v
Phase 7 (1 hr) - CRITICAL: Verification
     |
     v
Phase 8 (30 min)
```

**Total Critical Path**: ~5.5 hours

---

## 4. Risk Assessment

### Identified Risks in Tech Spec

| Risk                        | Tech Spec Rating | My Assessment       |
| --------------------------- | ---------------- | ------------------- |
| Import errors after renames | High/Low         | ACCURATE            |
| Missing functionality       | Medium/Medium    | ACCURATE            |
| Performance regression      | Low/Medium       | SLIGHTLY OPTIMISTIC |
| WebSocket compatibility     | Low/High         | ACCURATE            |
| Theme styling issues        | Low/Low          | ACCURATE            |

### Additional Risks Identified

**4.1 RISK: Highlighting Logic Infinite Loop**

Current `ReactFlowCanvas.tsx` has a documented issue:

```typescript
// Apply highlighting when selection changes
useEffect(() => {
  const highlighted = calculateHighlighting(
    nodes,
    edges,
    activeTableId,
    hoveredTableId,
  )
  setNodes(highlighted.nodes) // This modifies state...
  setEdges(highlighted.edges)
}, [activeTableId, hoveredTableId]) // ...while depending on derived values
```

The comment "Don't include nodes/edges to avoid infinite loop" indicates fragile state management.

**Impact**: Medium - May cause subtle bugs or performance issues
**Recommendation**: Consider using `useMemo` for highlighting calculation instead of `useEffect` with state updates

**4.2 RISK: ShowMode Type Mismatch**

`convert-to-nodes.ts` defaults to `'ALL_FIELDS'`:

```typescript
showMode: 'ALL_FIELDS',
```

But `types.ts` defines:

```typescript
export type ShowMode = 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS'
```

**Impact**: Low - TypeScript will catch mismatches
**Recommendation**: Verify `TableNode.new.tsx` handles all three modes (confirmed in review)

**4.3 RISK: Orphaned CSS Classes**

Konva components may have associated CSS that won't be automatically removed:

- `.canvas-container`
- `.minimap-container`
- Konva-specific theme variables

**Impact**: Low - Dead CSS won't break functionality
**Recommendation**: Add CSS audit to Phase 7 verification

---

## 5. Performance Assessment

### 60 FPS Requirement

React Flow is designed for 60 FPS rendering. The implementation properly uses:

- `memo()` on `TableNode` component
- `useMemo()` for `nodeTypes` and `edgeTypes`
- `useCallback()` for event handlers

**Assessment: WILL MEET REQUIREMENT**

### <3 Second Initial Load

The architecture enables fast loading:

1. TanStack Query provides caching
2. Server functions use Prisma with efficient queries
3. React Flow renders incrementally

**Assessment: WILL MEET REQUIREMENT**

### ELK Layout <3 Seconds

The ELK implementation includes:

- Web Worker for non-blocking computation
- 10-second timeout (conservative)
- Layered algorithm with appropriate settings

For 30-50 tables, ELK typically completes in <1 second.

**Assessment: WILL MEET REQUIREMENT**

### Bundle Size Impact

| Change              | Size Impact        |
| ------------------- | ------------------ |
| Remove konva        | -80KB gzipped      |
| Remove react-konva  | -15KB gzipped      |
| Remove d3-force     | -10KB gzipped      |
| **Total Reduction** | **~105KB gzipped** |

**Assessment: ACCURATE - Significant improvement**

---

## 6. Code Quality Assessment

### Maintainability Improvements

| Before                             | After            | Improvement                       |
| ---------------------------------- | ---------------- | --------------------------------- |
| 2 whiteboard routes                | 1 route          | 50% reduction in route complexity |
| 3 converter files                  | 1 file           | Unified conversion point          |
| 2 TableNode implementations        | 1 implementation | Single source of truth            |
| 2 RelationshipEdge implementations | 1 implementation | Single source of truth            |
| Feature flag conditionals          | None             | Eliminated runtime branching      |
| 47 dependencies                    | 43 dependencies  | Reduced attack surface            |

### Type Safety

The `types.ts` file is well-structured:

- Pure React Flow types with no Konva contamination
- Proper use of branded types (`TableNodeType`, `RelationshipEdgeType`)
- Constants for constraints (`ZOOM_CONSTRAINTS`, `LAYOUT_CONSTRAINTS`)

### Testing Strategy Gap

Current test coverage is minimal (only `diagram-parser.test.ts`). The tech spec provides a good testing checklist but lacks:

- Unit test requirements for converters
- Integration test requirements for React Flow components

**Recommendation**: Consider adding converter tests before rebuild to establish baseline:

```typescript
// Proposed: src/lib/react-flow/converters.test.ts
describe('convertTablesToNodes', () => {
  it('converts DiagramTable to TableNodeType')
  it('handles empty columns array')
  it('preserves position coordinates')
})
```

---

## 7. Recommendations

### Must Address (Blocking)

None - the specification is sound for implementation.

### Should Address (Before Merge)

1. **Standardize Handle ID Format**: Document canonical format (`${tableId}__${columnId}` or `${columnId}-source/target`) in tech spec appendix

2. **Add CSS Audit Step**: Include in Phase 7:

   ```
   - [ ] Search for Konva-specific CSS classes
   - [ ] Remove dead CSS from stylesheets
   - [ ] Verify React Flow theme variables are complete
   ```

3. **Address Highlighting State Pattern**: Consider refactoring highlighting to use `useMemo`:
   ```typescript
   const { highlightedNodes, highlightedEdges } = useMemo(
     () => calculateHighlighting(nodes, edges, activeTableId, hoveredTableId),
     [nodes, edges, activeTableId, hoveredTableId],
   )
   ```

### Nice to Have (Future)

1. **Add Converter Unit Tests**: Establish test coverage before rebuild
2. **Create Visual Regression Baseline**: Screenshot key states before rebuild
3. **Document ELK Options**: Explain layout algorithm choices for future maintainers

---

## 8. Final Assessment

### Architectural Verdict

The technical specification demonstrates sound architectural judgment:

1. **Correct Problem Identification**: The dual-implementation pattern is correctly identified as technical debt
2. **Appropriate Solution**: React Flow is the right choice for canvas rendering (modern, well-maintained, performant)
3. **Clean Migration Path**: Phases are correctly ordered with minimal risk
4. **Performance Preservation**: Architecture maintains 60 FPS requirement
5. **Maintainability Improvement**: Significant reduction in code complexity

### Comparison: Before vs After

| Metric                 | Before                 | After             | Verdict |
| ---------------------- | ---------------------- | ----------------- | ------- |
| Canvas Implementations | 2 (Konva + React Flow) | 1 (React Flow)    | CLEANER |
| Layout Algorithms      | 2 (d3-force + ELK)     | 1 (ELK)           | CLEANER |
| Converter Files        | 3                      | 1                 | CLEANER |
| Runtime Feature Flags  | 1                      | 0                 | CLEANER |
| Bundle Size            | ~225KB canvas          | ~120KB canvas     | SMALLER |
| Maintenance Burden     | High (dual sync)       | Low (single path) | EASIER  |

### Verdict: APPROVED_WITH_NOTES

The technical specification is approved for implementation. The architecture is sound, the data flow is well-designed, and the implementation phases are correctly ordered. The minor recommendations above should be addressed during implementation but do not block approval.

---

_Review completed by Apollo, Architecture Review Agent, as part of the Kratos pipeline._
