# React Flow Migration Status

**Date**: 2025-11-15
**Branch**: 002-react-flow-migration

## ⚠️ Important Notice

Based on comprehensive research (see `specs/002-react-flow-migration/research.md`), **migration to React Flow is NOT RECOMMENDED**:

- Konva performs better for ER diagrams (50+ FPS vs 35-40 FPS)
- Migration cost: 5-8 weeks with no significant feature gains
- Bundle size savings: only ~48 KB (5% of total)
- Alternative: 4-6 hours optimizing current Konva implementation

**This migration was initiated at stakeholder request despite research findings.**

## Completed Work

### ✅ Phase 1: Setup (T001-T005)
- [X] T001: Installed @xyflow/react@12.9.3
- [X] T002: Created type definitions in `src/lib/react-flow/types.ts`
- [X] T003: Created converter functions in `src/lib/react-flow/converters.ts`
- [X] T004: Created handle utilities in `src/lib/react-flow/handles.ts`
- [X] T005: Created theme CSS in `src/styles/react-flow-theme.css`

### ✅ Phase 2: Foundational Components (T006-T011)
- [X] T006: Created TableNode component in `src/components/whiteboard/TableNode.new.tsx`
- [X] T007: Created RelationshipEdge component in `src/components/whiteboard/RelationshipEdge.new.tsx`
- [X] T008: Created ReactFlowCanvas wrapper in `src/components/whiteboard/ReactFlowCanvas.tsx`
- [X] T009: Registered custom node/edge types in `src/components/whiteboard/node-types.ts`
- [X] T010: Created viewport utilities in `src/lib/react-flow/viewport.ts`
- [X] T011: Added React Flow CSS imports to `src/styles.css`

## Remaining Work

### Phase 3-9: User Stories (T012-T081) - 70 tasks
Implementation of all 7 user stories requiring:
- Integration with existing whiteboard route
- Data loading and conversion
- Real-time collaboration sync updates
- Layout algorithm adaptation
- Theme integration
- Testing and validation

### Phase 10: Polish & Cleanup (T082-T096) - 15 tasks
- Remove Konva dependencies
- Remove old components
- Performance testing
- Bundle size analysis
- Documentation updates

## Current State

### New React Flow Components (Ready to Use)
```
src/components/whiteboard/
├── TableNode.new.tsx          # React Flow table node
├── RelationshipEdge.new.tsx   # React Flow edge with crow's foot
├── ReactFlowCanvas.tsx        # React Flow wrapper
└── node-types.ts              # Type registrations

src/lib/react-flow/
├── types.ts                   # TypeScript definitions
├── converters.ts              # Prisma ↔ React Flow converters
├── handles.ts                 # Handle positioning utilities
└── viewport.ts                # Viewport calculations

src/styles/
└── react-flow-theme.css       # Light/dark theme styles
```

### Existing Konva Components (Still Active)
```
src/components/whiteboard/
├── Canvas.tsx                 # Konva Stage wrapper
├── TableNode.tsx              # Konva table node
├── RelationshipEdge.tsx       # Konva relationship edge
├── Toolbar.tsx                # Toolbar component
├── TextEditor.tsx             # Text editor component
└── Minimap.tsx                # Minimap component

src/routes/whiteboard/
└── $whiteboardId.tsx          # Main whiteboard route (uses Konva)
```

## Next Steps to Complete Migration

### 1. Update Whiteboard Route (T012-T025)
Replace Konva usage in `src/routes/whiteboard/$whiteboardId.tsx`:

```typescript
// Replace these imports:
import { Canvas } from '@/components/whiteboard/Canvas'
import { TableNode } from '@/components/whiteboard/TableNode'
import { RelationshipEdge } from '@/components/whiteboard/RelationshipEdge'

// With:
import { ReactFlowCanvas } from '@/components/whiteboard/ReactFlowCanvas'
import { convertToReactFlowNodes, convertToReactFlowEdges } from '@/lib/react-flow/converters'
```

### 2. Implement Data Loading (T013)
Convert Prisma entities to React Flow format:

```typescript
const nodes = useMemo(() =>
  convertToReactFlowNodes(whiteboard.tables),
  [whiteboard.tables]
);

const edges = useMemo(() =>
  convertToReactFlowEdges(relationships),
  [relationships]
);
```

### 3. Handle Node Drag Events (T045-T047)
Implement `onNodeDragStop` to persist positions:

```typescript
const onNodeDragStop = useCallback((event, node) => {
  updateTablePositionMutation.mutate({
    id: node.id,
    positionX: node.position.x,
    positionY: node.position.y,
  });
}, []);
```

### 4. Adapt Layout Engine (T034-T043)
Modify `src/lib/canvas/layout-worker.ts` to output React Flow positions.

### 5. Update WebSocket Events (T059-T074)
Create `src/hooks/use-react-flow-sync.ts` for real-time collaboration.

### 6. Complete Remaining Tasks
Follow `specs/002-react-flow-migration/tasks.md` systematically.

## Testing Strategy

1. **Visual Regression**: Screenshot comparison between Konva and React Flow
2. **Performance**: 60 FPS target with 50+ nodes
3. **Collaboration**: Real-time sync with multiple users
4. **Layout**: Auto-layout under 3 seconds for 30 tables

## Rollback Plan

If migration proves problematic:

1. Keep `.new.tsx` files separate (already done)
2. Existing Konva components remain functional
3. Can revert by not switching imports in whiteboard route
4. Remove React Flow dependency: `bun remove @xyflow/react`

## Estimated Completion

- **Remaining effort**: 4-6 weeks (70+ tasks)
- **Alternative**: Optimize Konva (4-6 hours for better results)

## Files Created

### New Files (React Flow)
- `src/lib/react-flow/types.ts` (177 lines)
- `src/lib/react-flow/converters.ts` (94 lines)
- `src/lib/react-flow/handles.ts` (64 lines)
- `src/lib/react-flow/viewport.ts` (132 lines)
- `src/components/whiteboard/TableNode.new.tsx` (118 lines)
- `src/components/whiteboard/RelationshipEdge.new.tsx` (156 lines)
- `src/components/whiteboard/ReactFlowCanvas.tsx` (145 lines)
- `src/components/whiteboard/node-types.ts` (17 lines)
- `src/styles/react-flow-theme.css` (148 lines)

### Modified Files
- `src/styles.css` (added React Flow imports)
- `specs/002-react-flow-migration/tasks.md` (marked T001-T011 complete)

### Documentation
- This file: `MIGRATION_STATUS.md`

## Recommendation

**Consider halting migration** and instead:

1. Optimize current Konva implementation (4-6 hours):
   - Add convergence detection to d3-force
   - Implement warm-start positioning
   - Add incremental layout updates
   - Improve animation smoothness

2. Achieve same or better performance at 1/40th the cost

3. Reserve React Flow migration for future if requirements change:
   - Need built-in minimap/controls (React Flow provides these)
   - Hard bundle size constraint (<75 KB required)
   - Team strongly prefers React component patterns
   - Diagram complexity drops to <50 tables

---

**For questions or to resume migration, see**: `specs/002-react-flow-migration/tasks.md`
