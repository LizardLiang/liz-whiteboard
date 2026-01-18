# Technical Specification: Liz-Whiteboard v2 Complete Rebuild

**Feature ID**: rebuild-v2
**Created**: 2026-01-18
**Author**: Hephaestus (Tech Spec Agent)
**PRD**: Approved with Notes

---

## Executive Summary

This technical specification defines the implementation plan for rebuilding the Liz-Whiteboard application to use React Flow as the sole canvas renderer. The rebuild removes the legacy Konva.js implementation, d3-force layout engine, and all associated feature flags and dual-component patterns.

### Scope

- **REMOVE**: Konva.js, react-konva, d3-force, dual-route architecture, legacy components
- **KEEP**: React Flow, ELK layout, Prisma schema, Socket.IO collaboration, Chevrotain parser
- **CONSOLIDATE**: Multiple converter files, dual-component patterns, whiteboard routes

### Code Metrics

| Metric                    | Before | After   | Change |
| ------------------------- | ------ | ------- | ------ |
| Total Lines (src/)        | 16,806 | ~14,100 | -16%   |
| Dependencies              | 47     | 43      | -4     |
| Whiteboard Routes         | 2      | 1       | -1     |
| Converter Files           | 3      | 1       | -2     |
| TableNode Variants        | 2      | 1       | -1     |
| RelationshipEdge Variants | 2      | 1       | -1     |

**Revised Code Reduction Target**: 15-20% (realistic based on actual file analysis)

---

## 1. Detailed File Operations

### 1.1 Files to DELETE (Total: ~2,655 lines)

| File Path                                        | Lines | Reason                                                 |
| ------------------------------------------------ | ----- | ------------------------------------------------------ |
| `src/components/whiteboard/Canvas.tsx`           | 496   | Konva canvas wrapper - replaced by React Flow          |
| `src/components/whiteboard/Minimap.tsx`          | 268   | Custom Konva minimap - React Flow has built-in MiniMap |
| `src/components/whiteboard/TableNode.tsx`        | 400   | Konva TableNode - keep only React Flow version         |
| `src/components/whiteboard/RelationshipEdge.tsx` | 373   | Konva RelationshipEdge - keep only React Flow version  |
| `src/lib/canvas/layout-engine.ts`                | 499   | d3-force layout engine - replaced by ELK               |
| `src/lib/canvas/layout-worker.ts`                | 153   | d3-force web worker - replaced by ELK worker           |
| `src/routes/whiteboard/$whiteboardId.tsx`        | 739   | Legacy Konva route - consolidate into single route     |
| `src/lib/react-flow/convert-to-nodes.ts`         | 66    | Duplicate converter - merge into converters.ts         |
| `src/lib/react-flow/convert-to-edges.ts`         | 119   | Duplicate converter - merge into converters.ts         |

**Files to delete after consolidation:**

```
DELETE: src/components/whiteboard/Canvas.tsx
DELETE: src/components/whiteboard/Minimap.tsx
DELETE: src/components/whiteboard/TableNode.tsx (Konva version)
DELETE: src/components/whiteboard/RelationshipEdge.tsx (Konva version)
DELETE: src/lib/canvas/layout-engine.ts
DELETE: src/lib/canvas/layout-worker.ts
DELETE: src/routes/whiteboard/$whiteboardId.tsx
DELETE: src/lib/react-flow/convert-to-nodes.ts (after merge)
DELETE: src/lib/react-flow/convert-to-edges.ts (after merge)
```

### 1.2 Files to RENAME

| Current Path                                         | New Path                                         | Reason                                |
| ---------------------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| `src/components/whiteboard/TableNode.new.tsx`        | `src/components/whiteboard/TableNode.tsx`        | Promote React Flow version to primary |
| `src/components/whiteboard/RelationshipEdge.new.tsx` | `src/components/whiteboard/RelationshipEdge.tsx` | Promote React Flow version to primary |
| `src/routes/whiteboard/$whiteboardId.new.tsx`        | `src/routes/whiteboard/$whiteboardId.tsx`        | Single route after cleanup            |

### 1.3 Files to MODIFY

| File Path                                           | Changes Required                                               |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `src/lib/react-flow/converters.ts`                  | Merge in code from convert-to-nodes.ts and convert-to-edges.ts |
| `src/lib/react-flow/types.ts`                       | Remove any Konva-related types                                 |
| `src/lib/react-flow/node-types.ts`                  | Update imports after TableNode rename                          |
| `src/components/whiteboard/ReactFlowWhiteboard.tsx` | Update imports, remove legacy references                       |
| `src/components/whiteboard/ReactFlowCanvas.tsx`     | Update imports after component renames                         |
| `src/components/whiteboard/Toolbar.tsx`             | Remove Konva-specific props and handlers                       |
| `src/hooks/use-auto-layout-preference.ts`           | Keep as-is (ELK only)                                          |
| `src/lib/server-functions.ts`                       | Remove `computeAutoLayout` that uses d3-force                  |

### 1.4 Files to KEEP (unchanged)

```
KEEP: src/lib/react-flow/elk-layout.ts
KEEP: src/lib/react-flow/elk-layout.worker.ts
KEEP: src/lib/react-flow/highlighting.ts
KEEP: src/lib/react-flow/handles.ts
KEEP: src/lib/react-flow/layout-adapter.ts
KEEP: src/lib/react-flow/use-auto-layout.ts
KEEP: src/lib/react-flow/viewport.ts
KEEP: src/lib/parser/diagram-parser.ts
KEEP: src/lib/parser/ast.ts
KEEP: src/lib/parser/diagram-parser.test.ts
KEEP: src/hooks/use-collaboration.ts
KEEP: src/hooks/use-whiteboard-collaboration.ts
KEEP: src/hooks/use-theme.tsx
KEEP: src/components/whiteboard/TextEditor.tsx
KEEP: src/components/whiteboard/CardinalityMarkerDefs.tsx
KEEP: src/components/whiteboard/cardinality-markers.tsx
KEEP: src/components/whiteboard/markers/* (all files)
KEEP: All API routes in src/routes/api/*
KEEP: All data access files in src/data/*
KEEP: prisma/schema.prisma
```

---

## 2. Dependency Changes

### 2.1 package.json Modifications

**Remove these dependencies:**

```json
{
  "dependencies": {
    "konva": "^10.0.8", // DELETE
    "react-konva": "^19.2.0", // DELETE
    "d3-force": "^3.0.0", // DELETE
    "@types/d3-force": "^3.0.10" // DELETE (move to devDependencies was wrong - just delete)
  }
}
```

**Final dependencies (keep):**

```json
{
  "dependencies": {
    "@xyflow/react": "^12.9.2",
    "elkjs": "0.10.0",
    "chevrotain": "^11.0.3",
    "socket.io": "^4.8.1",
    "socket.io-client": "^4.8.1"
  }
}
```

### 2.2 Bundle Size Impact

| Package       | Size (gzip) | Status                 |
| ------------- | ----------- | ---------------------- |
| konva         | ~80KB       | REMOVED                |
| react-konva   | ~15KB       | REMOVED                |
| d3-force      | ~10KB       | REMOVED                |
| @xyflow/react | ~45KB       | KEPT                   |
| elkjs         | ~120KB      | KEPT (already present) |

**Estimated Bundle Reduction**: ~105KB (gzipped)

---

## 3. Component Architecture

### 3.1 Final Component Structure

```
src/components/
  layout/
    Header.tsx                    # No changes
    Sidebar.tsx                   # No changes
  navigator/
    ProjectTree.tsx               # No changes
    FolderItem.tsx                # No changes
    WhiteboardItem.tsx            # No changes
  whiteboard/
    ReactFlowCanvas.tsx           # Main canvas wrapper (KEEP)
    ReactFlowWhiteboard.tsx       # Data loading + canvas (KEEP)
    TableNode.tsx                 # React Flow node (RENAMED from .new.tsx)
    RelationshipEdge.tsx          # React Flow edge (RENAMED from .new.tsx)
    CardinalityMarkerDefs.tsx     # SVG markers (KEEP)
    cardinality-markers.tsx       # Marker components (KEEP)
    markers/                      # Marker subfolder (KEEP)
    TextEditor.tsx                # DSL text editor (KEEP)
    Toolbar.tsx                   # Canvas toolbar (MODIFY)
    node-types.ts                 # Node type registry (KEEP)
  ui/
    * (all shadcn components)     # No changes
```

### 3.2 Component Dependency Graph (After Rebuild)

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

### 3.3 Dual-Component Resolution

**TableNode Resolution:**

- DELETE: `src/components/whiteboard/TableNode.tsx` (Konva version - 400 lines)
- RENAME: `src/components/whiteboard/TableNode.new.tsx` -> `TableNode.tsx`
- The React Flow version (`TableNode.new.tsx`) becomes the only implementation

**RelationshipEdge Resolution:**

- DELETE: `src/components/whiteboard/RelationshipEdge.tsx` (Konva version - 373 lines)
- RENAME: `src/components/whiteboard/RelationshipEdge.new.tsx` -> `RelationshipEdge.tsx`
- The React Flow version (`RelationshipEdge.new.tsx`) becomes the only implementation

---

## 4. Data Flow Architecture

### 4.1 Database to React Flow Pipeline

```
Database (Prisma)
      |
      v
Server Functions (getWhiteboardWithDiagram, getWhiteboardRelationships)
      |
      v
TanStack Query (caching, refetching)
      |
      v
Converters (converters.ts - unified)
  - convertToReactFlowNodes(): DiagramTable[] -> TableNode[]
  - convertToReactFlowEdges(): Relationship[] -> RelationshipEdge[]
      |
      v
React Flow State (useNodesState, useEdgesState)
      |
      v
React Flow Canvas (rendering)
```

### 4.2 Position Update Flow

```
User drags table
      |
      v
React Flow onNodeDragStop callback
      |
      +-> Update Prisma (updateTablePositionFn)
      |
      +-> Emit WebSocket (table:move)
      |
      v
TanStack Query cache update
      |
      v
Collaborators receive via WebSocket
      |
      v
Update their React Flow nodes state
```

### 4.3 Auto-Layout Flow (ELK)

```
User clicks "Auto Layout"
      |
      v
useAutoLayout hook (src/lib/react-flow/use-auto-layout.ts)
      |
      v
computeElkLayout (src/lib/react-flow/elk-layout.ts)
      |
      +-> Convert nodes to ELK graph format
      +-> Run ELK algorithm (elkjs)
      +-> Extract new positions
      |
      v
Batch update positions to database
      |
      v
Emit WebSocket (layout:computed)
      |
      v
All clients update React Flow state
```

---

## 5. Implementation Phases

### Phase 1: Preparation (Pre-commit checkpoint)

**Duration**: 30 minutes
**Risk**: Low

**Steps:**

1. Create git branch: `feature/rebuild-v2`
2. Run `bun run test` - ensure existing test passes
3. Run `bun run build` - ensure production build works
4. Document current state for rollback reference

**Checkpoint**: Commit "chore: pre-rebuild checkpoint"

### Phase 2: Remove Feature Flag and Konva Route

**Duration**: 1 hour
**Risk**: Medium

**Steps:**

1. Remove `VITE_USE_REACT_FLOW` from `.env.local`
2. Delete feature flag logic from `$whiteboardId.tsx`:
   - Remove `const USE_REACT_FLOW = import.meta.env.VITE_USE_REACT_FLOW === 'true'`
   - Remove all conditional rendering based on USE_REACT_FLOW
   - Remove Konva-specific imports
3. Delete the legacy route file `$whiteboardId.tsx`
4. Rename `$whiteboardId.new.tsx` to `$whiteboardId.tsx`
5. Update route registration in routeTree (if needed)

**Checkpoint**: Commit "feat: remove feature flag and consolidate whiteboard route"

### Phase 3: Remove Konva Components

**Duration**: 1 hour
**Risk**: Medium

**Steps:**

1. Delete `src/components/whiteboard/Canvas.tsx`
2. Delete `src/components/whiteboard/Minimap.tsx`
3. Delete `src/components/whiteboard/TableNode.tsx` (Konva version)
4. Delete `src/components/whiteboard/RelationshipEdge.tsx` (Konva version)
5. Rename `TableNode.new.tsx` to `TableNode.tsx`
6. Rename `RelationshipEdge.new.tsx` to `RelationshipEdge.tsx`
7. Update all imports in:
   - `src/lib/react-flow/node-types.ts`
   - `src/components/whiteboard/ReactFlowCanvas.tsx`
   - Any other files referencing these components

**Checkpoint**: Commit "refactor: remove Konva components and rename React Flow components"

### Phase 4: Remove d3-force Layout Engine

**Duration**: 30 minutes
**Risk**: Low

**Steps:**

1. Delete `src/lib/canvas/layout-engine.ts`
2. Delete `src/lib/canvas/layout-worker.ts`
3. Delete the `src/lib/canvas/` directory (should be empty)
4. Update `src/lib/server-functions.ts`:
   - Remove `computeAutoLayout` that uses d3-force
   - Or update it to use ELK instead
5. Verify `useAutoLayout` hook uses ELK exclusively

**Checkpoint**: Commit "refactor: remove d3-force layout engine"

### Phase 5: Consolidate Converters

**Duration**: 45 minutes
**Risk**: Low

**Steps:**

1. Merge `convert-to-nodes.ts` functionality into `converters.ts`:
   - Add `extractTablePosition()`
   - Add `convertTableToNode()`
   - Add `convertTablesToNodes()`
2. Merge `convert-to-edges.ts` functionality into `converters.ts`:
   - Add `createHandleId()`
   - Add `parseHandleId()`
   - Add `getCardinalityMarkerStart()`
   - Add `getCardinalityMarkerEnd()`
   - Add `convertRelationshipToEdge()`
   - Add `convertRelationshipsToEdges()`
3. Update all imports to use unified `converters.ts`
4. Delete `convert-to-nodes.ts`
5. Delete `convert-to-edges.ts`

**Checkpoint**: Commit "refactor: consolidate converter files"

### Phase 6: Remove Dependencies

**Duration**: 15 minutes
**Risk**: Low

**Steps:**

1. Run: `bun remove konva react-konva d3-force @types/d3-force`
2. Run: `bun install` to update lockfile
3. Verify no import errors

**Checkpoint**: Commit "chore: remove Konva and d3-force dependencies"

### Phase 7: Clean Up and Verification

**Duration**: 1 hour
**Risk**: Low

**Steps:**

1. Run `bun run check` - fix any lint/format issues
2. Run `bun run build` - verify production build
3. Run `bun run test` - verify tests pass
4. Manual testing:
   - Create new whiteboard
   - Add tables
   - Create relationships
   - Drag tables
   - Test auto-layout
   - Test real-time collaboration
   - Test text editor
   - Test zoom/pan
   - Test minimap (React Flow built-in)

**Checkpoint**: Commit "chore: clean up and verify rebuild"

### Phase 8: Update Documentation

**Duration**: 30 minutes
**Risk**: None

**Steps:**

1. Update `CLAUDE.md`:
   - Remove Konva references
   - Remove feature flag documentation
   - Update architecture overview
2. Remove or update any comments referencing Konva
3. Update any inline documentation

**Checkpoint**: Commit "docs: update documentation after rebuild"

---

## 6. Migration Steps

### 6.1 Pre-Migration Checklist

- [ ] All code committed to git
- [ ] Create feature branch `feature/rebuild-v2`
- [ ] Run and pass `bun run test`
- [ ] Run and pass `bun run build`
- [ ] Note current bundle size for comparison

### 6.2 Migration Execution Order

```
1. BACKUP: Create pre-rebuild checkpoint commit
2. REMOVE: Feature flag and conditional logic
3. DELETE: Legacy Konva route ($whiteboardId.tsx)
4. RENAME: $whiteboardId.new.tsx -> $whiteboardId.tsx
5. DELETE: Konva components (Canvas.tsx, Minimap.tsx, etc.)
6. RENAME: TableNode.new.tsx -> TableNode.tsx
7. RENAME: RelationshipEdge.new.tsx -> RelationshipEdge.tsx
8. UPDATE: All imports referencing renamed files
9. DELETE: d3-force layout files
10. MERGE: Converter files
11. REMOVE: npm dependencies
12. VERIFY: Build and tests pass
13. TEST: Manual verification
14. DOCUMENT: Update CLAUDE.md
```

### 6.3 File Rename Script (PowerShell)

```powershell
# Execute from project root
# Rename component files
Move-Item -Path "src/components/whiteboard/TableNode.new.tsx" -Destination "src/components/whiteboard/TableNode.new.tsx.bak"
Move-Item -Path "src/components/whiteboard/TableNode.tsx" -Destination "src/components/whiteboard/TableNode.konva.bak"
Move-Item -Path "src/components/whiteboard/TableNode.new.tsx.bak" -Destination "src/components/whiteboard/TableNode.tsx"

Move-Item -Path "src/components/whiteboard/RelationshipEdge.new.tsx" -Destination "src/components/whiteboard/RelationshipEdge.new.tsx.bak"
Move-Item -Path "src/components/whiteboard/RelationshipEdge.tsx" -Destination "src/components/whiteboard/RelationshipEdge.konva.bak"
Move-Item -Path "src/components/whiteboard/RelationshipEdge.new.tsx.bak" -Destination "src/components/whiteboard/RelationshipEdge.tsx"

# Rename route file
Move-Item -Path "src/routes/whiteboard/$whiteboardId.new.tsx" -Destination "src/routes/whiteboard/$whiteboardId.new.tsx.bak"
Move-Item -Path "src/routes/whiteboard/$whiteboardId.tsx" -Destination "src/routes/whiteboard/$whiteboardId.konva.bak"
Move-Item -Path "src/routes/whiteboard/$whiteboardId.new.tsx.bak" -Destination "src/routes/whiteboard/$whiteboardId.tsx"
```

---

## 7. Testing Strategy

### 7.1 Existing Test Coverage

**Current test files:**

- `src/lib/parser/diagram-parser.test.ts` - DSL parser tests

**Test command:** `bun run test`

### 7.2 Manual Test Checklist

**Core Functionality:**

- [ ] Create new whiteboard
- [ ] Add table with columns
- [ ] Edit table name
- [ ] Add/remove columns
- [ ] Delete table

**Canvas Interactions:**

- [ ] Drag table to new position
- [ ] Position persists after page refresh
- [ ] Zoom in/out with mouse wheel
- [ ] Pan canvas by dragging
- [ ] Fit view button works
- [ ] Zoom controls work

**Relationships:**

- [ ] Create relationship between tables
- [ ] Relationship edge renders correctly
- [ ] Cardinality markers display correctly
- [ ] Edge updates when tables are moved

**Auto-Layout:**

- [ ] Click auto-layout button
- [ ] Tables reposition smoothly
- [ ] Positions persist to database
- [ ] Works with multiple disconnected clusters

**Collaboration:**

- [ ] WebSocket connects (green status)
- [ ] Table movement syncs between users
- [ ] New table creation syncs
- [ ] Relationship creation syncs
- [ ] Text editor changes sync

**Text Editor:**

- [ ] Switch to text tab
- [ ] Existing diagram renders as DSL
- [ ] Edit DSL text
- [ ] Changes apply to canvas (if implemented)
- [ ] Syntax errors show properly

**Display Modes:**

- [ ] ALL_FIELDS mode shows all columns
- [ ] KEY_ONLY mode shows only PK/FK
- [ ] TABLE_NAME mode shows only table name
- [ ] Mode persists to localStorage

**Theme:**

- [ ] Dark theme renders correctly
- [ ] Light theme renders correctly
- [ ] Theme toggle works
- [ ] Theme persists

### 7.3 Performance Benchmarks

**Test with 50 tables:**

- [ ] Canvas maintains 60 FPS during pan/zoom
- [ ] Initial load completes < 3 seconds
- [ ] Auto-layout completes < 3 seconds
- [ ] Real-time updates appear < 1 second

### 7.4 Recommended Future Tests

Post-rebuild, add these tests:

```typescript
// src/lib/react-flow/converters.test.ts
describe('convertToReactFlowNodes', () => {
  it('converts tables to nodes with correct positions')
  it('includes column data in node data')
  it('handles empty tables array')
})

describe('convertToReactFlowEdges', () => {
  it('converts relationships to edges')
  it('sets correct source/target handles')
  it('includes cardinality markers')
})

// src/components/whiteboard/TableNode.test.tsx
describe('TableNode', () => {
  it('renders table name')
  it('renders all columns in ALL_FIELDS mode')
  it('renders only key columns in KEY_ONLY mode')
  it('shows only table name in TABLE_NAME mode')
  it('displays PK/FK indicators')
})
```

---

## 8. Rollback Plan

### 8.1 Rollback Triggers

Execute rollback if:

- Build fails after migration
- Tests fail after migration
- Critical functionality broken (canvas not rendering, collaboration not working)
- Performance degradation > 50%

### 8.2 Rollback Steps

**Quick Rollback (< 5 minutes):**

```bash
# From feature branch, reset to pre-rebuild commit
git log --oneline -10  # Find pre-rebuild checkpoint commit
git reset --hard <pre-rebuild-commit-hash>
bun install
```

**Full Rollback (if merged to main):**

```bash
# Revert the merge commit
git revert -m 1 <merge-commit-hash>
bun install
bun run build
```

### 8.3 Rollback Verification

After rollback:

1. Run `bun run build` - verify build passes
2. Run `bun run test` - verify tests pass
3. Start dev server - verify app loads
4. Manual smoke test - canvas renders, can create tables

---

## 9. Risk Mitigation

### 9.1 Identified Risks

| Risk                        | Probability | Impact | Mitigation                                  |
| --------------------------- | ----------- | ------ | ------------------------------------------- |
| Import errors after renames | High        | Low    | Run TypeScript compiler, fix as encountered |
| Missing functionality       | Medium      | Medium | Comprehensive manual testing checklist      |
| Performance regression      | Low         | Medium | Benchmark before/after                      |
| WebSocket compatibility     | Low         | High   | Test collaboration thoroughly               |
| Theme styling issues        | Low         | Low    | Test both themes                            |

### 9.2 Mitigation Strategies

**Import Errors:**

- Run `bun run build` after each phase
- Use IDE "Find all references" before deleting
- Fix errors incrementally

**Missing Functionality:**

- Keep Konva files in .bak until verification complete
- Delete backup files only after full verification

**Performance Regression:**

- Record baseline metrics before rebuild
- Test with 50-table diagram
- Compare FPS, load time, layout time

---

## 10. Success Criteria

### 10.1 Technical Success Criteria

- [ ] Zero Konva imports in codebase
- [ ] Zero d3-force imports in codebase
- [ ] Single whiteboard route file
- [ ] Single converter file
- [ ] Production build passes
- [ ] All existing tests pass
- [ ] 4 fewer npm dependencies

### 10.2 Functional Success Criteria

- [ ] Canvas renders tables and relationships
- [ ] Table dragging works
- [ ] Auto-layout with ELK works
- [ ] Real-time collaboration works
- [ ] Text editor works
- [ ] Display modes work
- [ ] Theme switching works

### 10.3 Performance Success Criteria

- [ ] 60 FPS with 50 tables
- [ ] Initial load < 3 seconds
- [ ] Auto-layout < 3 seconds
- [ ] Bundle size reduced by ~100KB

---

## Appendix A: File Line Counts (Current)

```
Files to DELETE:
  src/components/whiteboard/Canvas.tsx          496 lines
  src/components/whiteboard/Minimap.tsx         268 lines
  src/components/whiteboard/TableNode.tsx       400 lines (Konva)
  src/components/whiteboard/RelationshipEdge.tsx 373 lines (Konva)
  src/lib/canvas/layout-engine.ts               499 lines
  src/lib/canvas/layout-worker.ts               153 lines
  src/routes/whiteboard/$whiteboardId.tsx       739 lines
  src/lib/react-flow/convert-to-nodes.ts         66 lines
  src/lib/react-flow/convert-to-edges.ts        119 lines
  ----------------------------------------
  TOTAL TO DELETE:                            3,113 lines

Files to KEEP (React Flow):
  src/components/whiteboard/TableNode.new.tsx   151 lines
  src/components/whiteboard/RelationshipEdge.new.tsx 107 lines
  src/routes/whiteboard/$whiteboardId.new.tsx   506 lines
  src/lib/react-flow/converters.ts               96 lines
  src/lib/react-flow/elk-layout.ts              143 lines
  src/lib/react-flow/types.ts                   181 lines
  src/components/whiteboard/ReactFlowCanvas.tsx 211 lines
  src/components/whiteboard/ReactFlowWhiteboard.tsx 325 lines
```

---

## Appendix B: Import Updates Required

After component renames, update these imports:

```typescript
// src/lib/react-flow/node-types.ts
- import { TableNode } from '@/components/whiteboard/TableNode.new'
+ import { TableNode } from '@/components/whiteboard/TableNode'

// src/lib/react-flow/node-types.ts
- import { RelationshipEdge } from '@/components/whiteboard/RelationshipEdge.new'
+ import { RelationshipEdge } from '@/components/whiteboard/RelationshipEdge'

// Any file using convert-to-nodes or convert-to-edges
- import { convertTablesToNodes } from '@/lib/react-flow/convert-to-nodes'
- import { convertRelationshipsToEdges } from '@/lib/react-flow/convert-to-edges'
+ import { convertTablesToNodes, convertRelationshipsToEdges } from '@/lib/react-flow/converters'
```

---

_This Technical Specification was generated by Hephaestus, the Tech Spec Agent, as part of the Kratos pipeline._
