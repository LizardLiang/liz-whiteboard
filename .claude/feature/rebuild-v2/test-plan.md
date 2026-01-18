# Test Plan: Liz-Whiteboard v2 Complete Rebuild

**Feature ID**: rebuild-v2
**Created**: 2026-01-18
**Author**: Artemis (QA Agent)
**Status**: Draft
**PRD Version**: 1.0
**Tech Spec Version**: 1.0

---

## Executive Summary

This test plan defines the comprehensive testing strategy for the Liz-Whiteboard v2 rebuild project. The rebuild removes the legacy Konva.js canvas implementation and d3-force layout engine, consolidating to a single React Flow implementation with ELK layout.

### Testing Philosophy

**This is a REBUILD/REFACTOR project, not new feature development.** The primary risk is **REGRESSION** - breaking existing functionality while removing code. Our testing strategy prioritizes:

1. **Regression Prevention**: Verify all existing features continue to work after the rebuild
2. **Performance Validation**: Ensure performance meets or exceeds current benchmarks
3. **Architecture Validation**: Confirm the simplified architecture maintains correctness
4. **Collaboration Stability**: Verify real-time collaboration remains stable

### Test Coverage Summary

| Test Category            | Priority | Test Count | Automation Status          |
| ------------------------ | -------- | ---------- | -------------------------- |
| Unit Tests (New)         | High     | 15         | To be automated            |
| Integration Tests        | High     | 8          | Manual + Future automation |
| Manual Functional Tests  | Critical | 44         | Manual                     |
| Performance Tests        | High     | 4          | Manual + tooling           |
| Regression Suite         | Critical | 28         | Manual                     |
| Phase Verification Tests | Medium   | 8          | Manual                     |

**Total Test Cases**: 107

---

## 1. Test Strategy Overview

### 1.1 Risk-Based Testing Approach

**Critical Risks** (Highest Priority):

1. **Canvas Rendering Failure**: Tables or relationships fail to render after removing Konva
2. **Data Loss**: Position or relationship data lost during converter consolidation
3. **Collaboration Breakdown**: WebSocket synchronization breaks due to component changes
4. **Performance Degradation**: React Flow performs worse than Konva for large diagrams

**Medium Risks**: 5. **Import Errors**: Component renames cause undetected import issues 6. **Layout Regression**: ELK layout behaves differently after d3-force removal 7. **Theme Inconsistency**: React Flow components don't properly support dark/light themes

**Low Risks**: 8. **Text Editor Sync**: DSL parser integration breaks 9. **Display Mode Issues**: Table display modes (ALL_FIELDS, KEY_ONLY, TABLE_NAME) malfunction

### 1.2 Testing Phases

```
Phase 1: Pre-Rebuild Baseline Testing (30 min)
  └─> Establish performance benchmarks and functional baselines

Phase 2: Per-Implementation-Phase Testing (4-6 hours)
  └─> Verify each phase completes successfully before proceeding

Phase 3: Post-Rebuild Regression Testing (2 hours)
  └─> Comprehensive verification of all functionality

Phase 4: Performance Validation (1 hour)
  └─> Confirm performance meets requirements

Phase 5: User Acceptance Testing (1 hour)
  └─> End-to-end scenario validation
```

### 1.3 Test Environment Setup

**Required Environment**:

- PostgreSQL database with test data (50+ tables for performance testing)
- Two browser windows/tabs for collaboration testing
- Development server running (`bun run dev`)
- Browser DevTools open for performance profiling

**Test Data Sets**:

1. **Minimal**: 2 tables, 1 relationship (smoke tests)
2. **Standard**: 10 tables, 8 relationships (functional tests)
3. **Complex**: 30 tables, 25 relationships (integration tests)
4. **Stress**: 50 tables, 45 relationships (performance tests)

### 1.4 Exit Criteria

**Rebuild CANNOT proceed to production until**:

- [ ] All Phase Verification Tests pass
- [ ] All Critical Regression Tests pass (100% pass rate)
- [ ] 95% of Manual Functional Tests pass
- [ ] All Performance Tests meet benchmarks
- [ ] Zero Konva/d3-force imports in codebase
- [ ] Production build succeeds
- [ ] Existing `diagram-parser.test.ts` passes

---

## 2. Unit Tests (To Be Written)

### 2.1 Converter Functions (`src/lib/react-flow/converters.ts`)

**Test File**: `src/lib/react-flow/converters.test.ts`

#### TC-UNIT-001: convertToReactFlowNodes - Basic Conversion

```typescript
it('should convert tables to nodes with correct positions', () => {
  const tables = [
    {
      id: 't1',
      name: 'Users',
      positionX: 100,
      positionY: 200,
      whiteboardId: 'w1',
      columns: [],
    },
  ]
  const nodes = convertToReactFlowNodes(tables)

  expect(nodes).toHaveLength(1)
  expect(nodes[0].id).toBe('t1')
  expect(nodes[0].type).toBe('erTable')
  expect(nodes[0].position).toEqual({ x: 100, y: 200 })
  expect(nodes[0].data.table.name).toBe('Users')
})
```

#### TC-UNIT-002: convertToReactFlowNodes - Column Ordering

```typescript
it('should sort columns by orderIndex', () => {
  const tables = [{
    id: 't1', name: 'Users', positionX: 0, positionY: 0,
    whiteboardId: 'w1',
    columns: [
      { id: 'c1', name: 'name', orderIndex: 2, ... },
      { id: 'c2', name: 'id', orderIndex: 1, ... }
    ]
  }]
  const nodes = convertToReactFlowNodes(tables)

  expect(nodes[0].data.columns[0].name).toBe('id')  // orderIndex 1
  expect(nodes[0].data.columns[1].name).toBe('name') // orderIndex 2
})
```

#### TC-UNIT-003: convertToReactFlowNodes - Empty Tables Array

```typescript
it('should handle empty tables array', () => {
  const nodes = convertToReactFlowNodes([])
  expect(nodes).toEqual([])
})
```

#### TC-UNIT-004: convertToReactFlowEdges - Basic Conversion

```typescript
it('should convert relationships to edges', () => {
  const relationships = [
    {
      id: 'r1',
      sourceTableId: 't1',
      targetTableId: 't2',
      sourceColumnId: 'c1',
      targetColumnId: 'c2',
      relationshipType: 'ONE_TO_MANY',
      label: 'owns',
      whiteboardId: 'w1',
    },
  ]
  const edges = convertToReactFlowEdges(relationships)

  expect(edges).toHaveLength(1)
  expect(edges[0].id).toBe('r1')
  expect(edges[0].type).toBe('erRelationship')
  expect(edges[0].source).toBe('t1')
  expect(edges[0].target).toBe('t2')
  expect(edges[0].sourceHandle).toBe('c1-source')
  expect(edges[0].targetHandle).toBe('c2-target')
  expect(edges[0].data.cardinality).toBe('ONE_TO_MANY')
  expect(edges[0].data.label).toBe('owns')
})
```

#### TC-UNIT-005: convertToReactFlowEdges - Null Column IDs

```typescript
it('should handle null sourceColumnId and targetColumnId', () => {
  const relationships = [
    {
      id: 'r1',
      sourceTableId: 't1',
      targetTableId: 't2',
      sourceColumnId: null,
      targetColumnId: null,
      relationshipType: 'MANY_TO_MANY',
      label: null,
      whiteboardId: 'w1',
    },
  ]
  const edges = convertToReactFlowEdges(relationships)

  expect(edges[0].sourceHandle).toBeUndefined()
  expect(edges[0].targetHandle).toBeUndefined()
})
```

#### TC-UNIT-006: extractPositionUpdates - Position Extraction

```typescript
it('should extract position from node', () => {
  const node = {
    id: 't1',
    type: 'erTable',
    position: { x: 350, y: 450 },
    data: { table: { ... }, columns: [] }
  }
  const position = extractPositionUpdates(node)

  expect(position).toEqual({ positionX: 350, positionY: 450 })
})
```

#### TC-UNIT-007: convertToReactFlowViewport - Viewport Conversion

```typescript
it('should convert legacy CanvasViewport to ReactFlowViewport', () => {
  const canvasViewport = { zoom: 1.5, offsetX: 100, offsetY: 200 }
  const rfViewport = convertToReactFlowViewport(canvasViewport)

  expect(rfViewport).toEqual({ x: 100, y: 200, zoom: 1.5 })
})
```

#### TC-UNIT-008: convertToCanvasViewport - Reverse Viewport Conversion

```typescript
it('should convert ReactFlowViewport to legacy CanvasViewport', () => {
  const rfViewport = { x: 100, y: 200, zoom: 1.5 }
  const canvasViewport = convertToCanvasViewport(rfViewport)

  expect(canvasViewport).toEqual({ offsetX: 100, offsetY: 200, zoom: 1.5 })
})
```

### 2.2 Handle ID Utilities (from convert-to-edges.ts - to be merged)

**Test File**: `src/lib/react-flow/handles.test.ts` (if handles.ts exists)

#### TC-UNIT-009: createHandleId - Source Handle

```typescript
it('should create source handle ID', () => {
  const handleId = createHandleId('col-123', 'source')
  expect(handleId).toBe('col-123-source')
})
```

#### TC-UNIT-010: parseHandleId - Parse Source Handle

```typescript
it('should parse source handle ID', () => {
  const result = parseHandleId('col-123-source')
  expect(result).toEqual({ columnId: 'col-123', type: 'source' })
})
```

#### TC-UNIT-011: parseHandleId - Parse Target Handle

```typescript
it('should parse target handle ID', () => {
  const result = parseHandleId('col-456-target')
  expect(result).toEqual({ columnId: 'col-456', type: 'target' })
})
```

### 2.3 ELK Layout Functions (src/lib/react-flow/elk-layout.ts)

**Test File**: `src/lib/react-flow/elk-layout.test.ts`

#### TC-UNIT-012: computeElkLayout - Basic Layout

```typescript
it('should compute layout for simple graph', async () => {
  const nodes = [
    { id: 't1', type: 'erTable', position: { x: 0, y: 0 }, data: { ... } },
    { id: 't2', type: 'erTable', position: { x: 0, y: 0 }, data: { ... } }
  ]
  const edges = [
    { id: 'e1', source: 't1', target: 't2', ... }
  ]

  const layouted = await computeElkLayout(nodes, edges)

  expect(layouted.nodes).toHaveLength(2)
  expect(layouted.nodes[0].position.x).toBeGreaterThan(0)
  expect(layouted.nodes[0].position.y).toBeGreaterThan(0)
})
```

#### TC-UNIT-013: computeElkLayout - Empty Graph

```typescript
it('should handle empty nodes and edges', async () => {
  const layouted = await computeElkLayout([], [])
  expect(layouted.nodes).toEqual([])
  expect(layouted.edges).toEqual([])
})
```

#### TC-UNIT-014: computeElkLayout - Disconnected Components

```typescript
it('should layout disconnected components separately', async () => {
  const nodes = [
    { id: 't1', ... }, { id: 't2', ... }, // Cluster 1
    { id: 't3', ... }, { id: 't4', ... }  // Cluster 2 (no edges to cluster 1)
  ]
  const edges = [
    { id: 'e1', source: 't1', target: 't2' },
    { id: 'e2', source: 't3', target: 't4' }
  ]

  const layouted = await computeElkLayout(nodes, edges)

  // Verify clusters are spatially separated
  const cluster1X = layouted.nodes.find(n => n.id === 't1').position.x
  const cluster2X = layouted.nodes.find(n => n.id === 't3').position.x
  expect(Math.abs(cluster1X - cluster2X)).toBeGreaterThan(200)
})
```

#### TC-UNIT-015: computeElkLayout - Performance (30 Tables)

```typescript
it('should complete layout within 3 seconds for 30 tables', async () => {
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    id: `t${i}`, type: 'erTable', position: { x: 0, y: 0 }, data: { ... }
  }))
  const edges = Array.from({ length: 25 }, (_, i) => ({
    id: `e${i}`, source: `t${i}`, target: `t${i + 1}`
  }))

  const start = performance.now()
  await computeElkLayout(nodes, edges)
  const duration = performance.now() - start

  expect(duration).toBeLessThan(3000) // NFR-003
})
```

---

## 3. Integration Tests

### 3.1 React Flow Canvas Rendering

#### TC-INT-001: Canvas Renders Tables from Database

**Preconditions**: Database contains whiteboard with 3 tables
**Steps**:

1. Navigate to `/whiteboard/{whiteboardId}`
2. Wait for page load
   **Expected Results**:

- React Flow canvas renders within 2 seconds
- All 3 tables appear as nodes
- Table names, columns, and data types are visible
- No console errors

#### TC-INT-002: Canvas Renders Relationships from Database

**Preconditions**: Database contains 2 tables with 1 relationship
**Steps**:

1. Navigate to whiteboard
2. Observe canvas
   **Expected Results**:

- Edge connects source table to target table
- Edge connects to specific column handles (not table center)
- Cardinality marker appears on edge (arrow, crow's foot, etc.)

### 3.2 Database to UI Data Flow

#### TC-INT-003: Table Position Updates Persist

**Preconditions**: Whiteboard with 1 table at position (100, 100)
**Steps**:

1. Drag table to new position (300, 400)
2. Wait 500ms for save
3. Refresh page
   **Expected Results**:

- Table appears at position (300, 400) after refresh
- Database `DiagramTable.positionX` = 300, `positionY` = 400

#### TC-INT-004: Column Changes Sync to Canvas

**Preconditions**: Table with 2 columns
**Steps**:

1. Add new column "email" via UI
2. Observe canvas
   **Expected Results**:

- TableNode re-renders with 3 columns
- New column appears in correct `orderIndex`
- Column handle is created for relationship connections

### 3.3 WebSocket Collaboration

#### TC-INT-005: Table Creation Syncs Between Users

**Preconditions**: Two browser tabs open to same whiteboard
**Steps**:

1. Tab A: Create new table "Products"
2. Tab B: Observe canvas
   **Expected Results**:

- Tab B receives WebSocket event within 1 second
- New table node appears in Tab B
- Position matches Tab A

#### TC-INT-006: Position Drag Syncs in Real-Time

**Preconditions**: Two tabs on same whiteboard with 1 table
**Steps**:

1. Tab A: Drag table from (100, 100) to (500, 500)
2. Tab B: Observe during drag
   **Expected Results**:

- Tab B shows position updates within 100ms (NFR-005)
- Position sync is smooth, not jerky

#### TC-INT-007: Relationship Creation Syncs

**Preconditions**: Two tabs on whiteboard with 2 tables
**Steps**:

1. Tab A: Create relationship between tables
2. Tab B: Observe
   **Expected Results**:

- Edge appears in Tab B within 1 second
- Cardinality markers match Tab A

#### TC-INT-008: WebSocket Reconnection Recovery

**Preconditions**: Whiteboard with active WebSocket connection
**Steps**:

1. Open browser DevTools > Network tab
2. Toggle "Offline" mode for 5 seconds
3. Toggle "Online"
4. Observe connection status indicator
   **Expected Results**:

- Connection indicator shows "Disconnected" (red)
- After reconnection, shows "Connected" (green)
- Canvas syncs to latest state from server

---

## 4. Manual Test Cases (Organized by User Story)

### 4.1 User Story 1: Create and Edit ER Diagrams (Priority: P0)

#### TC-FUNC-001: Create New Whiteboard

**Preconditions**: User on home page
**Steps**:

1. Click "Create Project"
2. Click "Create Folder" within project
3. Click "Create Whiteboard" within folder
4. Enter name "Test Diagram"
5. Submit
   **Expected Results**:

- Whiteboard created in database
- User navigated to `/whiteboard/{id}`
- React Flow canvas loads empty state

#### TC-FUNC-002: Add Table with Columns

**Preconditions**: Empty whiteboard open
**Steps**:

1. Click "Add Table" button
2. Enter name "Users"
3. Add columns:
   - id (uuid, primary key)
   - name (string)
   - email (string, unique)
4. Click "Create"
   **Expected Results**:

- TableNode appears at specified position
- All 3 columns visible in ALL_FIELDS mode
- PK indicator shows on "id" column

#### TC-FUNC-003: Edit Table Name

**Preconditions**: Table "Users" exists
**Steps**:

1. Click table node
2. Click "Edit" icon
3. Change name to "Accounts"
4. Save
   **Expected Results**:

- Table name updates to "Accounts"
- Node re-renders with new name
- Database `DiagramTable.name` = "Accounts"

#### TC-FUNC-004: Add Column to Existing Table

**Preconditions**: Table with 2 columns
**Steps**:

1. Select table
2. Click "Add Column"
3. Enter name "created_at", type "date"
4. Save
   **Expected Results**:

- Column appears in table node
- `orderIndex` = 3 (after existing columns)
- Column handle created for relationships

#### TC-FUNC-005: Remove Column from Table

**Preconditions**: Table with 3 columns
**Steps**:

1. Select table
2. Click delete icon on "created_at" column
3. Confirm deletion
   **Expected Results**:

- Column removed from node
- Database `Column` record deleted
- Connected relationships deleted (cascade)

#### TC-FUNC-006: Delete Table

**Preconditions**: Whiteboard with 2 tables, 1 relationship
**Steps**:

1. Select "Users" table
2. Click "Delete Table"
3. Confirm
   **Expected Results**:

- TableNode removed from canvas
- Database `DiagramTable` record deleted
- All columns deleted (cascade)
- Relationships involving table deleted
- Connected edges removed from canvas

#### TC-FUNC-007: Create Relationship Between Tables

**Preconditions**: Two tables: Users(id), Orders(user_id)
**Steps**:

1. Click "Create Relationship" button
2. Select source: Users.id
3. Select target: Orders.user_id
4. Select cardinality: ONE_TO_MANY
5. Add label: "places"
6. Create
   **Expected Results**:

- Edge connects Users node to Orders node
- Edge connects to specific column handles
- Cardinality marker shows "one-to-many" (crow's foot on Orders side)
- Label "places" appears on edge

---

### 4.2 User Story 2: Navigate Large Diagrams (Priority: P0)

#### TC-FUNC-008: Zoom In with Mouse Wheel

**Preconditions**: Whiteboard with 5 tables
**Steps**:

1. Hover over table in center
2. Scroll mouse wheel up (zoom in)
   **Expected Results**:

- Canvas zooms in centered on cursor position
- Zoom level increases (max 500%)
- Zoom is smooth (60 FPS)

#### TC-FUNC-009: Zoom Out with Mouse Wheel

**Preconditions**: Zoomed-in canvas
**Steps**:

1. Scroll mouse wheel down (zoom out)
   **Expected Results**:

- Canvas zooms out
- Zoom level decreases (min 10%)
- All nodes remain visible

#### TC-FUNC-010: Pan Canvas by Dragging

**Preconditions**: Zoomed canvas
**Steps**:

1. Click and hold on empty canvas space
2. Drag in any direction
3. Release
   **Expected Results**:

- Viewport pans following drag
- Pan is smooth (60 FPS)
- Nodes move together maintaining relative positions

#### TC-FUNC-011: Fit View Button

**Preconditions**: Whiteboard with 10 tables, camera focused on corner
**Steps**:

1. Click "Fit View" button
   **Expected Results**:

- React Flow adjusts zoom and position
- All nodes visible with padding
- Transition is animated and smooth

#### TC-FUNC-012: Zoom Controls (In/Out/Reset)

**Preconditions**: Whiteboard open
**Steps**:

1. Click "Zoom In" button (or +)
2. Click "Zoom Out" button (or -)
3. Click "Reset Zoom" button
   **Expected Results**:

- Zoom In: increases zoom by 10%
- Zoom Out: decreases zoom by 10%
- Reset: returns to 100% zoom

#### TC-FUNC-013: Minimap Navigation

**Preconditions**: Large diagram (20+ tables)
**Steps**:

1. Observe minimap in corner
2. Click on region of minimap
   **Expected Results**:

- Viewport navigates to clicked area
- Minimap shows current viewport as highlighted rectangle
- Minimap uses React Flow built-in MiniMap component

#### TC-FUNC-014: Performance with 50 Tables

**Preconditions**: Whiteboard with 50 tables and 45 relationships
**Steps**:

1. Pan canvas in all directions
2. Zoom in and out
3. Monitor FPS in DevTools
   **Expected Results**:

- Canvas maintains 60 FPS during pan (NFR-001)
- Canvas maintains 60 FPS during zoom (NFR-001)
- No lag or stuttering

---

### 4.3 User Story 3: Collaborate in Real-Time (Priority: P0)

#### TC-FUNC-015: WebSocket Connection Establishes

**Preconditions**: User opens whiteboard
**Steps**:

1. Navigate to whiteboard
2. Observe connection status indicator
   **Expected Results**:

- Status shows "Connected" (green dot)
- WebSocket URL in Network tab shows connection
- No connection errors in console

#### TC-FUNC-016: Table Addition Syncs (User A → User B)

**Preconditions**: Two users on same whiteboard
**Steps**:

1. User A: Add table "Products"
2. User B: Observe canvas
   **Expected Results**:

- Table appears in User B within 1 second (NFR-004)
- Position, name, and columns match User A

#### TC-FUNC-017: Table Drag Syncs in Real-Time

**Preconditions**: Two users, whiteboard with 1 table
**Steps**:

1. User A: Drag table continuously across canvas
2. User B: Observe
   **Expected Results**:

- Position updates appear in User B within 100ms (NFR-005)
- Movement is smooth, not jerky

#### TC-FUNC-018: Relationship Creation Syncs

**Preconditions**: Two users, 2 tables on canvas
**Steps**:

1. User A: Create relationship
2. User B: Observe
   **Expected Results**:

- Edge appears within 1 second
- Cardinality markers match

#### TC-FUNC-019: Table Deletion Syncs

**Preconditions**: Two users, 2 tables, 1 relationship
**Steps**:

1. User A: Delete table
2. User B: Observe
   **Expected Results**:

- Table node disappears
- Connected edges removed
- No orphaned edges remain

#### TC-FUNC-020: Reconnection After Network Drop

**Preconditions**: Active WebSocket connection
**Steps**:

1. User A: Go offline (DevTools)
2. User B: Add table
3. User A: Go online
   **Expected Results**:

- User A reconnects automatically
- User A's canvas syncs to latest state
- New table added by User B appears

---

### 4.4 User Story 4: Define Diagrams via Text DSL (Priority: P1)

#### TC-FUNC-021: Switch to Text Editor Tab

**Preconditions**: Whiteboard with 2 tables, 1 relationship
**Steps**:

1. Click "Text Editor" tab
   **Expected Results**:

- Text editor shows DSL syntax representing diagram
- Tables defined with `table TableName { ... }`
- Relationship defined with `TableA.col -> TableB.col (cardinality)`

#### TC-FUNC-022: DSL Reflects Visual Changes

**Preconditions**: Text editor tab open
**Steps**:

1. Switch to visual tab
2. Add new table "Comments"
3. Switch back to text tab
   **Expected Results**:

- Text includes new `table Comments { ... }` block
- DSL is regenerated from database state

#### TC-FUNC-023: Valid DSL Parsing

**Preconditions**: Text editor open
**Steps**:

1. Type valid DSL:
   ```
   table Users {
     id uuid pk
     name string
   }
   ```
2. Wait 500ms (debounce)
   **Expected Results**:

- No syntax errors shown
- Parser validates successfully

#### TC-FUNC-024: Invalid DSL Shows Errors

**Preconditions**: Text editor open
**Steps**:

1. Type invalid DSL:
   ```
   table Users {
     id uuid pk
   # Missing closing brace
   ```
2. Wait 500ms
   **Expected Results**:

- Error message appears
- Line number indicated
- Error description provided

---

### 4.5 User Story 5: Apply Automatic Layout (Priority: P1)

#### TC-FUNC-025: Auto-Layout with ELK

**Preconditions**: Whiteboard with 10 tables, random positions
**Steps**:

1. Click "Auto Layout" button
2. Observe canvas
   **Expected Results**:

- ELK algorithm repositions all nodes within 3 seconds (NFR-003)
- Nodes move to new positions (animated)
- Positions persist to database

#### TC-FUNC-026: Auto-Layout Groups Related Tables

**Preconditions**: Tables with relationships: Users -> Orders -> OrderItems
**Steps**:

1. Trigger auto-layout
   **Expected Results**:

- Related tables positioned closer together
- Hierarchical structure visible (Users at top, Orders below, OrderItems below Orders)

#### TC-FUNC-027: Auto-Layout Handles Disconnected Clusters

**Preconditions**: Two clusters: (Users, Orders) and (Products, Categories)
**Steps**:

1. Trigger auto-layout
   **Expected Results**:

- Each cluster arranged separately
- Clusters spatially separated in viewport
- No edge crossings between clusters

#### TC-FUNC-028: Auto-Layout Edge Routing

**Preconditions**: Complex diagram with many relationships
**Steps**:

1. Trigger auto-layout
   **Expected Results**:

- Edges route to minimize crossings
- Edges connect to correct column handles
- No overlapping edges where possible

#### TC-FUNC-029: Auto-Layout Preference (Auto-Apply)

**Preconditions**: User has enabled "Auto-layout on change" preference
**Steps**:

1. Add new table
   **Expected Results**:

- Layout recalculates automatically
- New table positioned according to relationships

---

### 4.6 User Story 6: Organize Projects and Whiteboards (Priority: P1)

#### TC-FUNC-030: Create Project

**Preconditions**: User on home page
**Steps**:

1. Click "Create Project"
2. Enter name "Database Designs"
3. Submit
   **Expected Results**:

- Project appears in navigation tree
- Database `Project` record created

#### TC-FUNC-031: Create Folder in Project

**Preconditions**: Project exists
**Steps**:

1. Right-click project
2. Select "Create Folder"
3. Enter name "E-Commerce"
4. Submit
   **Expected Results**:

- Folder appears nested under project
- Database `Folder` record created with correct `projectId`

#### TC-FUNC-032: Create Whiteboard in Folder

**Preconditions**: Folder exists
**Steps**:

1. Right-click folder
2. Select "Create Whiteboard"
3. Enter name "Orders Schema"
4. Submit
   **Expected Results**:

- Whiteboard appears in folder
- Database `Whiteboard` record created with `folderId`

#### TC-FUNC-033: Rename Project/Folder/Whiteboard

**Preconditions**: Item exists
**Steps**:

1. Right-click item
2. Select "Rename"
3. Enter new name
4. Submit
   **Expected Results**:

- Name updates immediately in tree
- Database record updated

#### TC-FUNC-034: Delete Project (Cascade)

**Preconditions**: Project with 2 folders, 3 whiteboards
**Steps**:

1. Right-click project
2. Select "Delete"
3. Confirm deletion
   **Expected Results**:

- Project removed from tree
- All folders deleted (cascade)
- All whiteboards deleted (cascade)
- All tables/columns/relationships deleted (cascade)

---

### 4.7 User Story 7: Support Dark/Light Theme (Priority: P2)

#### TC-FUNC-035: Toggle to Dark Theme

**Preconditions**: Light theme active
**Steps**:

1. Click theme toggle button
   **Expected Results**:

- All UI elements switch to dark colors
- React Flow background becomes dark
- TableNodes use dark theme colors
- RelationshipEdges use dark theme colors
- No visual glitches or flashes

#### TC-FUNC-036: Toggle to Light Theme

**Preconditions**: Dark theme active
**Steps**:

1. Click theme toggle button
   **Expected Results**:

- All UI elements switch to light colors
- React Flow background becomes light
- Nodes and edges use light theme colors

#### TC-FUNC-037: Theme Persistence

**Preconditions**: Dark theme selected
**Steps**:

1. Refresh page
2. Navigate to different whiteboard
   **Expected Results**:

- Dark theme restored from localStorage
- Theme consistent across navigation

#### TC-FUNC-038: Canvas Rendering with Theme Change

**Preconditions**: Canvas with 10 tables
**Steps**:

1. Toggle theme
2. Observe canvas re-render
   **Expected Results**:

- No visual glitches
- No white flashes
- Smooth transition

---

### 4.8 Display Modes

#### TC-FUNC-039: ALL_FIELDS Display Mode

**Preconditions**: Table with 5 columns (1 PK, 1 FK, 3 regular)
**Steps**:

1. Set display mode to "ALL_FIELDS"
2. Observe table node
   **Expected Results**:

- All 5 columns visible
- Column names, data types, and constraints shown
- PK/FK indicators displayed

#### TC-FUNC-040: KEY_ONLY Display Mode

**Preconditions**: Same table as above
**Steps**:

1. Set display mode to "KEY_ONLY"
2. Observe table node
   **Expected Results**:

- Only PK and FK columns visible (2 columns)
- Regular columns hidden
- Table node is smaller

#### TC-FUNC-041: TABLE_NAME Display Mode

**Preconditions**: Same table
**Steps**:

1. Set display mode to "TABLE_NAME"
2. Observe table node
   **Expected Results**:

- Only table name visible
- No columns shown
- Table node is minimal size

#### TC-FUNC-042: Display Mode Persistence

**Preconditions**: Display mode set to KEY_ONLY
**Steps**:

1. Refresh page
   **Expected Results**:

- Display mode restored from localStorage
- All tables render in KEY_ONLY mode

---

### 4.9 Additional Functional Tests

#### TC-FUNC-043: Initial Page Load Performance

**Preconditions**: Whiteboard with 30 tables
**Steps**:

1. Navigate to whiteboard URL
2. Measure time to canvas render
   **Expected Results**:

- Page load completes within 3 seconds (NFR-002)
- Measured in DevTools Performance tab

#### TC-FUNC-044: Viewport State Persistence (FR-008)

**Preconditions**: Whiteboard with zoom at 150%, position at (500, 300)
**Steps**:

1. Navigate away
2. Navigate back to whiteboard
   **Expected Results**:

- Viewport restores to zoom 150%
- Viewport restores to position (500, 300)
- Persistence uses localStorage or database

---

## 5. Performance Tests

### 5.1 Performance Benchmarks

#### TC-PERF-001: 60 FPS with 50 Tables (NFR-001)

**Test Environment**: Chrome 120+, Whiteboard with 50 tables, 45 relationships
**Steps**:

1. Open DevTools > Performance tab
2. Start recording
3. Pan canvas continuously for 10 seconds
4. Zoom in/out 5 times
5. Stop recording
6. Analyze FPS
   **Expected Results**:

- FPS remains at or above 60 during pan
- FPS remains at or above 60 during zoom
- No dropped frames

**Measurement**:

```javascript
// DevTools Console
const fps = document.querySelector('[aria-label="FPS"]')?.textContent
// Should show "60 FPS"
```

#### TC-PERF-002: Initial Load < 3 Seconds (NFR-002)

**Test Environment**: Chrome, cold cache, 30 tables
**Steps**:

1. Clear browser cache
2. Open DevTools > Network tab
3. Navigate to whiteboard URL
4. Measure time to "DOMContentLoaded" + React Flow render
   **Expected Results**:

- Total load time < 3000ms
- React Flow canvas visible and interactive

**Measurement**:

```javascript
// DevTools Performance tab
// "Load Event" - "Navigation Start" < 3000ms
```

#### TC-PERF-003: Auto-Layout < 3 Seconds (NFR-003)

**Test Environment**: 30 tables, 25 relationships
**Steps**:

1. Click "Auto Layout"
2. Measure time from click to layout completion
   **Expected Results**:

- ELK computation + database save + render < 3000ms

**Measurement**:

```javascript
// Add performance.mark in code
performance.mark('layout-start')
// ... layout computation ...
performance.mark('layout-end')
performance.measure('layout-duration', 'layout-start', 'layout-end')
console.log(performance.getEntriesByName('layout-duration')[0].duration)
// Should be < 3000ms
```

#### TC-PERF-004: Real-Time Sync < 1 Second (NFR-004)

**Test Environment**: Two browser tabs, same whiteboard
**Steps**:

1. Tab A: Add table
2. Tab B: Measure time from Tab A action to Tab B render
   **Expected Results**:

- WebSocket event received < 1000ms
- Canvas update rendered < 1000ms total

**Measurement**:

- Use browser DevTools timestamp on WebSocket messages
- Compare Tab A action timestamp to Tab B `table:created` event timestamp

---

## 6. Regression Test Suite

### 6.1 Critical Path Regression Tests

These tests verify that critical user journeys continue to work after the rebuild.

#### TC-REG-001: End-to-End Diagram Creation

**Scenario**: User creates complete ER diagram from scratch
**Steps**:

1. Create new whiteboard
2. Add 3 tables (Users, Orders, Products)
3. Add columns to each table
4. Create 2 relationships (Users -> Orders, Orders -> Products)
5. Drag tables to custom positions
6. Apply auto-layout
7. Save and refresh
   **Expected Results**:

- All tables visible after refresh
- All relationships visible
- Positions match auto-layout
- No data loss

#### TC-REG-002: Collaboration Workflow

**Scenario**: Two users collaborate on same diagram
**Steps**:

1. User A opens whiteboard
2. User B opens same whiteboard
3. User A adds table
4. User B sees table
5. User B drags table
6. User A sees position update
7. User A creates relationship
8. User B sees relationship
   **Expected Results**:

- All changes sync correctly
- No conflicts or race conditions
- Canvas state consistent between users

#### TC-REG-003: Text-to-Visual Round-Trip

**Scenario**: User edits via text DSL and visual canvas
**Steps**:

1. Create diagram visually (2 tables, 1 relationship)
2. Switch to text editor
3. Verify DSL matches visual
4. Edit DSL (add column)
5. Apply changes
6. Verify visual canvas updates
7. Switch back to visual tab
8. Add table visually
9. Switch to text tab
10. Verify DSL updated
    **Expected Results**:

- DSL accurately reflects visual state
- Visual state accurately reflects DSL
- Round-trip conversion preserves data

---

### 6.2 Component-Level Regression Tests

#### TC-REG-004: TableNode Rendering After Rename

**Preconditions**: `TableNode.new.tsx` renamed to `TableNode.tsx`
**Steps**:

1. Open whiteboard with tables
2. Verify tables render
   **Expected Results**:

- No import errors
- TableNode component renders correctly
- All columns visible

#### TC-REG-005: RelationshipEdge Rendering After Rename

**Preconditions**: `RelationshipEdge.new.tsx` renamed to `RelationshipEdge.tsx`
**Steps**:

1. Open whiteboard with relationships
2. Verify edges render
   **Expected Results**:

- No import errors
- Edges connect tables correctly
- Cardinality markers display

#### TC-REG-006: Converters After Merge

**Preconditions**: `convert-to-nodes.ts` and `convert-to-edges.ts` merged into `converters.ts`
**Steps**:

1. Open whiteboard
2. Verify data conversion
   **Expected Results**:

- Nodes convert correctly from database
- Edges convert correctly from database
- No missing data

#### TC-REG-007: No Konva Imports Remain

**Preconditions**: All Konva files deleted
**Steps**:

1. Search codebase for `import.*konva`
2. Search for `from 'konva'`
3. Search for `from 'react-konva'`
   **Expected Results**:

- Zero matches found (NFR-006)
- Build succeeds
- No runtime errors

#### TC-REG-008: No d3-force Imports Remain

**Preconditions**: d3-force files deleted
**Steps**:

1. Search codebase for `import.*d3-force`
2. Search for `from 'd3-force'`
   **Expected Results**:

- Zero matches found
- Build succeeds

#### TC-REG-009: Single Whiteboard Route

**Preconditions**: Legacy `$whiteboardId.tsx` deleted, `.new.tsx` renamed
**Steps**:

1. Navigate to `/whiteboard/{id}`
2. Verify route loads
   **Expected Results**:

- Route resolves correctly
- No 404 errors
- React Flow canvas renders

---

### 6.3 Data Integrity Regression Tests

#### TC-REG-010: Position Data Preserved

**Preconditions**: Whiteboard with tables at specific positions
**Steps**:

1. Record positions before rebuild
2. Complete rebuild
3. Open whiteboard
4. Compare positions
   **Expected Results**:

- Positions match exactly
- No position data lost

#### TC-REG-011: Relationship Data Preserved

**Preconditions**: Whiteboard with relationships
**Steps**:

1. Record relationship count and details before rebuild
2. Complete rebuild
3. Query database
4. Compare
   **Expected Results**:

- All relationships preserved
- Source/target columns correct
- Cardinality correct

#### TC-REG-012: Column Order Preserved

**Preconditions**: Table with columns in specific order
**Steps**:

1. Record `orderIndex` values before rebuild
2. Complete rebuild
3. Open whiteboard
4. Verify column order in node
   **Expected Results**:

- Columns appear in same order
- `orderIndex` values unchanged

---

### 6.4 Functional Regression Tests

#### TC-REG-013: Drag and Drop Works

**Steps**:

1. Drag table node
2. Release
   **Expected Results**:

- Node follows cursor
- Position updates in database
- Position syncs to collaborators

#### TC-REG-014: Zoom Controls Work

**Steps**:

1. Click "Zoom In"
2. Click "Zoom Out"
3. Scroll mouse wheel
   **Expected Results**:

- Zoom changes as expected
- Min/max zoom respected (10%-500%)

#### TC-REG-015: Pan Works

**Steps**:

1. Click empty canvas
2. Drag
   **Expected Results**:

- Viewport pans
- Nodes move together

#### TC-REG-016: Minimap Works

**Steps**:

1. Observe minimap
2. Click on minimap region
   **Expected Results**:

- Minimap shows current view
- Click navigates viewport

#### TC-REG-017: Table Creation Modal Works

**Steps**:

1. Click "Add Table"
2. Fill form
3. Submit
   **Expected Results**:

- Modal appears
- Form validation works
- Table created

#### TC-REG-018: Relationship Creation Modal Works

**Steps**:

1. Click "Create Relationship"
2. Select source and target columns
3. Select cardinality
4. Submit
   **Expected Results**:

- Modal appears
- Dropdowns populated correctly
- Relationship created

#### TC-REG-019: Column Editing Works

**Steps**:

1. Click table
2. Edit column name
3. Save
   **Expected Results**:

- Column updates
- Node re-renders

#### TC-REG-020: Table Deletion Works

**Steps**:

1. Select table
2. Delete
3. Confirm
   **Expected Results**:

- Table removed from canvas
- Relationships deleted

---

### 6.5 Theme and Display Mode Regression Tests

#### TC-REG-021: Dark Theme Works

**Steps**:

1. Toggle to dark theme
2. Observe canvas
   **Expected Results**:

- Background dark
- Nodes use dark colors
- Text readable

#### TC-REG-022: Light Theme Works

**Steps**:

1. Toggle to light theme
2. Observe canvas
   **Expected Results**:

- Background light
- Nodes use light colors
- Text readable

#### TC-REG-023: ALL_FIELDS Mode Works

**Steps**:

1. Set mode to ALL_FIELDS
2. Observe nodes
   **Expected Results**:

- All columns visible

#### TC-REG-024: KEY_ONLY Mode Works

**Steps**:

1. Set mode to KEY_ONLY
2. Observe nodes
   **Expected Results**:

- Only PK/FK visible

#### TC-REG-025: TABLE_NAME Mode Works

**Steps**:

1. Set mode to TABLE_NAME
2. Observe nodes
   **Expected Results**:

- Only table name visible

---

### 6.6 Parser Regression Tests

#### TC-REG-026: Existing Parser Test Passes

**Preconditions**: `diagram-parser.test.ts` exists
**Steps**:

1. Run `bun run test`
   **Expected Results**:

- All 17 test suites pass
- Zero failures

#### TC-REG-027: DSL Parsing Works

**Steps**:

1. Open text editor
2. Enter valid DSL
3. Wait 500ms
   **Expected Results**:

- No errors
- Syntax valid

#### TC-REG-028: DSL Generation Works

**Steps**:

1. Create diagram visually
2. Switch to text editor
   **Expected Results**:

- DSL generated
- Syntax matches visual state

---

## 7. Phase-by-Phase Verification Tests

These tests are executed after each implementation phase to verify the phase completed successfully.

### Phase 1: Preparation

#### TC-PHASE-001: Pre-Rebuild Baseline

**Steps**:

1. Run `bun run test`
2. Run `bun run build`
3. Measure bundle size
4. Create test whiteboard with 10 tables
5. Measure FPS during pan
   **Expected Results**:

- Tests pass ✓
- Build succeeds ✓
- Bundle size recorded
- FPS ≥ 60
- Whiteboard functions correctly

**Checkpoint**: Commit created "chore: pre-rebuild checkpoint"

---

### Phase 2: Remove Feature Flag and Konva Route

#### TC-PHASE-002: Feature Flag Removed

**Steps**:

1. Search for `VITE_USE_REACT_FLOW` in codebase
2. Search for `USE_REACT_FLOW` constant
3. Check `.env.local`
   **Expected Results**:

- Zero references found
- `.env.local` does not contain `VITE_USE_REACT_FLOW`

#### TC-PHASE-003: Single Whiteboard Route Loads

**Steps**:

1. Navigate to `/whiteboard/{id}`
2. Verify page loads
   **Expected Results**:

- Route resolves
- React Flow canvas renders
- No 404 errors

**Checkpoint**: Commit created "feat: remove feature flag and consolidate whiteboard route"

---

### Phase 3: Remove Konva Components

#### TC-PHASE-004: TableNode Renders After Rename

**Steps**:

1. Verify `src/components/whiteboard/TableNode.tsx` exists (renamed from .new.tsx)
2. Verify `TableNode.new.tsx` deleted
3. Open whiteboard
4. Verify tables render
   **Expected Results**:

- File renamed correctly
- No import errors
- Tables render

#### TC-PHASE-005: RelationshipEdge Renders After Rename

**Steps**:

1. Verify `src/components/whiteboard/RelationshipEdge.tsx` exists
2. Verify `RelationshipEdge.new.tsx` deleted
3. Open whiteboard
4. Verify edges render
   **Expected Results**:

- File renamed correctly
- Edges render

**Checkpoint**: Commit created "refactor: remove Konva components and rename React Flow components"

---

### Phase 4: Remove d3-force Layout Engine

#### TC-PHASE-006: d3-force Files Deleted

**Steps**:

1. Verify `src/lib/canvas/layout-engine.ts` deleted
2. Verify `src/lib/canvas/layout-worker.ts` deleted
3. Verify `src/lib/canvas/` directory deleted
   **Expected Results**:

- Files do not exist
- Directory does not exist

#### TC-PHASE-007: ELK Layout Works

**Steps**:

1. Open whiteboard with 10 tables
2. Click "Auto Layout"
3. Observe
   **Expected Results**:

- Layout computes using ELK
- Tables reposition
- No errors

**Checkpoint**: Commit created "refactor: remove d3-force layout engine"

---

### Phase 5: Consolidate Converters

#### TC-PHASE-008: Unified Converters Work

**Steps**:

1. Verify `src/lib/react-flow/converters.ts` contains all functions
2. Verify `convert-to-nodes.ts` deleted
3. Verify `convert-to-edges.ts` deleted
4. Run `bun run build`
5. Open whiteboard
   **Expected Results**:

- Single converters.ts file exists
- Old files deleted
- Build succeeds
- Whiteboard renders correctly

**Checkpoint**: Commit created "refactor: consolidate converter files"

---

### Phase 6: Remove Dependencies

#### TC-PHASE-009: Dependencies Removed from package.json

**Steps**:

1. Check `package.json` dependencies
2. Verify `konva`, `react-konva`, `d3-force`, `@types/d3-force` not present
3. Run `bun install`
4. Run `bun run build`
   **Expected Results**:

- Dependencies removed
- Install succeeds
- Build succeeds

**Checkpoint**: Commit created "chore: remove Konva and d3-force dependencies"

---

### Phase 7: Clean Up and Verification

#### TC-PHASE-010: Build Passes

**Steps**:

1. Run `bun run check` (format + lint)
2. Run `bun run build`
   **Expected Results**:

- No lint errors
- Format passes
- Build succeeds

#### TC-PHASE-011: Tests Pass

**Steps**:

1. Run `bun run test`
   **Expected Results**:

- All tests pass (including `diagram-parser.test.ts`)

#### TC-PHASE-012: Manual Verification Checklist

**Steps**: Execute all Manual Test Cases (TC-FUNC-001 through TC-FUNC-044)
**Expected Results**: 95%+ pass rate

**Checkpoint**: Commit created "chore: clean up and verify rebuild"

---

### Phase 8: Update Documentation

#### TC-PHASE-013: Documentation Updated

**Steps**:

1. Review `CLAUDE.md`
2. Verify Konva references removed
3. Verify feature flag documentation removed
4. Verify architecture diagram updated
   **Expected Results**:

- Documentation accurate
- No outdated references

**Checkpoint**: Commit created "docs: update documentation after rebuild"

---

## 8. Test Execution Plan

### 8.1 Pre-Rebuild Execution (30 minutes)

**Objective**: Establish baseline metrics and verify current state

**Tests to Run**:

1. TC-PHASE-001: Pre-Rebuild Baseline
2. TC-PERF-001: FPS Benchmark (record baseline)
3. TC-PERF-002: Load Time Benchmark (record baseline)
4. TC-REG-026: Existing Parser Test

**Deliverable**: Baseline report with FPS, load time, bundle size

---

### 8.2 During Implementation (4-6 hours)

**Objective**: Verify each phase before proceeding to next

**Execution Order**:

- After Phase 2: Run TC-PHASE-002, TC-PHASE-003
- After Phase 3: Run TC-PHASE-004, TC-PHASE-005
- After Phase 4: Run TC-PHASE-006, TC-PHASE-007
- After Phase 5: Run TC-PHASE-008
- After Phase 6: Run TC-PHASE-009
- After Phase 7: Run TC-PHASE-010, TC-PHASE-011, TC-PHASE-012

**Blocker Policy**: Do NOT proceed to next phase if current phase tests fail

---

### 8.3 Post-Rebuild Execution (3 hours)

**Objective**: Comprehensive regression and validation

**Day 1 - Regression Suite (2 hours)**:

1. TC-REG-001 through TC-REG-028 (Critical path, component, data integrity, functional, theme, parser)
2. Record pass/fail status
3. File bugs for failures

**Day 1 - Performance Suite (1 hour)**:

1. TC-PERF-001: FPS with 50 tables
2. TC-PERF-002: Initial load time
3. TC-PERF-003: Auto-layout time
4. TC-PERF-004: Real-time sync latency
5. Compare to baseline
6. Verify benchmarks met

**Day 2 - Manual Functional Suite (2 hours)**:

1. TC-FUNC-001 through TC-FUNC-044
2. Focus on critical user stories (P0)
3. Record any issues

**Day 2 - Integration Suite (1 hour)**:

1. TC-INT-001 through TC-INT-008
2. Verify end-to-end data flow

---

### 8.4 Final Acceptance (1 hour)

**Objective**: Final go/no-go decision

**Criteria**:

- [ ] All Phase Verification Tests pass (100%)
- [ ] All Critical Regression Tests pass (100%)
- [ ] 95%+ Manual Functional Tests pass
- [ ] All Performance Tests meet benchmarks
- [ ] Zero Konva/d3-force imports
- [ ] `diagram-parser.test.ts` passes
- [ ] Production build succeeds

**Decision**: If all criteria met → APPROVED FOR PRODUCTION

---

## 9. Test Data Management

### 9.1 Test Database Setup

**Seed Script**: `bun run db:seed`

**Required Test Data**:

1. **Minimal Dataset**: 2 tables, 1 relationship
2. **Standard Dataset**: 10 tables, 8 relationships
3. **Complex Dataset**: 30 tables, 25 relationships
4. **Stress Dataset**: 50 tables, 45 relationships

**Seed File Location**: `prisma/seed.ts`

**Sample Seed**:

```typescript
// prisma/seed.ts
async function seedTestData() {
  // Create test project
  const project = await prisma.project.create({
    data: { name: 'Test Project', description: 'For testing' },
  })

  // Create test whiteboard
  const whiteboard = await prisma.whiteboard.create({
    data: {
      name: 'Test Whiteboard',
      projectId: project.id,
      canvasState: { zoom: 1, offsetX: 0, offsetY: 0 },
    },
  })

  // Create 50 tables for stress test
  for (let i = 0; i < 50; i++) {
    await prisma.diagramTable.create({
      data: {
        name: `Table_${i}`,
        whiteboardId: whiteboard.id,
        positionX: (i % 10) * 300,
        positionY: Math.floor(i / 10) * 300,
        columns: {
          create: [
            { name: 'id', dataType: 'uuid', isPrimaryKey: true, orderIndex: 0 },
            { name: 'name', dataType: 'string', orderIndex: 1 },
          ],
        },
      },
    })
  }
}
```

### 9.2 Test Data Cleanup

**Cleanup Script**: `bun run db:reset`

**Before Each Test Run**:

1. Drop test database
2. Run migrations
3. Seed test data

---

## 10. Bug Tracking and Reporting

### 10.1 Bug Severity Levels

| Severity     | Definition                                | Example                    |
| ------------ | ----------------------------------------- | -------------------------- |
| **Critical** | Feature completely broken, blocks testing | Canvas fails to render     |
| **High**     | Major functionality broken                | Collaboration doesn't sync |
| **Medium**   | Feature partially broken or degraded      | Auto-layout slow           |
| **Low**      | Minor issue, cosmetic                     | Theme color slightly off   |

### 10.2 Bug Report Template

```markdown
## Bug Report

**ID**: BUG-{number}
**Severity**: Critical / High / Medium / Low
**Test Case**: TC-{ID}
**Phase**: {Phase Number}

**Description**:
[Clear description of the bug]

**Steps to Reproduce**:

1. Step 1
2. Step 2
3. Step 3

**Expected Result**:
[What should happen]

**Actual Result**:
[What actually happened]

**Environment**:

- Browser: Chrome 120
- OS: Windows 11
- Database: PostgreSQL 15

**Screenshots/Logs**:
[Attach if applicable]

**Possible Cause**:
[Optional - hypothesis about root cause]
```

### 10.3 Bug Triage Process

**Daily Triage** (during implementation):

1. Review all bugs filed
2. Assign severity
3. Critical bugs: Fix immediately before proceeding
4. High bugs: Fix within current phase
5. Medium/Low bugs: Defer to cleanup phase

**Exit Criteria Blockers**:

- Zero Critical bugs
- Zero High bugs in critical paths
- Medium bugs documented with workarounds

---

## 11. Test Deliverables

### 11.1 Test Reports

**Pre-Rebuild Baseline Report**:

```
Baseline Metrics (2026-01-18)
==============================
Bundle Size: 2.4 MB (gzipped: 680 KB)
Initial Load (30 tables): 2.1 seconds
FPS (50 tables, pan): 60 FPS
Auto-layout (30 tables): 2.5 seconds
Existing Tests: 17/17 passing
```

**Phase Verification Report** (after each phase):

```
Phase {N} Verification Report
=============================
Phase: {Name}
Tests Run: {count}
Tests Passed: {count}
Tests Failed: {count}
Commit Hash: {hash}
Status: PASS / FAIL
Notes: {notes}
```

**Final Test Report**:

```
Final Test Report - Rebuild v2
==============================
Date: 2026-01-XX
Total Tests Run: 107
Tests Passed: {count}
Tests Failed: {count}
Pass Rate: {percentage}

Performance Benchmarks:
- FPS (50 tables): 60 FPS ✓
- Initial Load: {time}s ✓/✗
- Auto-layout: {time}s ✓/✗

Regression Tests:
- Critical: {pass}/{total}
- Component: {pass}/{total}
- Functional: {pass}/{total}

Exit Criteria Met: YES / NO

Recommendation: APPROVED / REJECTED
```

### 11.2 Test Coverage Matrix

| Requirement ID | Test Cases               | Status | Notes                |
| -------------- | ------------------------ | ------ | -------------------- |
| FR-001         | TC-FUNC-002, TC-REG-004  | ✓      | TableNode rendering  |
| FR-002         | TC-FUNC-007, TC-INT-002  | ✓      | Column-level handles |
| FR-003         | TC-FUNC-007              | ✓      | Cardinality markers  |
| FR-004         | TC-FUNC-008, TC-FUNC-009 | ✓      | Zoom functionality   |
| ...            | ...                      | ...    | ...                  |

---

## 12. Risks and Mitigation

### 12.1 Testing Risks

| Risk                                | Impact | Mitigation                                              |
| ----------------------------------- | ------ | ------------------------------------------------------- |
| Insufficient test coverage          | High   | Comprehensive manual test checklist                     |
| Performance regression not detected | High   | Explicit performance benchmarks with pass/fail criteria |
| Collaboration edge cases missed     | Medium | Multi-user test scenarios with network conditions       |
| Import errors after renames         | Medium | Phase-by-phase verification tests                       |

### 12.2 Rollback Triggers

**Execute Rollback If**:

1. Critical bug cannot be fixed within 2 hours
2. Performance degradation > 50% from baseline
3. Data loss detected in any test
4. WebSocket collaboration completely broken
5. Exit criteria cannot be met after 2 attempts

**Rollback Procedure**: See Tech Spec Section 8.2

---

## 13. Future Test Automation (Post-Rebuild)

### 13.1 Recommended Unit Test Additions

After rebuild is complete and stable, add these automated tests:

**Priority 1** (Converters):

- `src/lib/react-flow/converters.test.ts` (TC-UNIT-001 through TC-UNIT-008)

**Priority 2** (Handle Utilities):

- `src/lib/react-flow/handles.test.ts` (TC-UNIT-009 through TC-UNIT-011)

**Priority 3** (ELK Layout):

- `src/lib/react-flow/elk-layout.test.ts` (TC-UNIT-012 through TC-UNIT-015)

### 13.2 Recommended Component Tests

**Priority 1**:

- `src/components/whiteboard/TableNode.test.tsx`
  - Renders table name
  - Renders columns in ALL_FIELDS mode
  - Renders only keys in KEY_ONLY mode
  - Renders only name in TABLE_NAME mode
  - Displays PK/FK indicators

**Priority 2**:

- `src/components/whiteboard/RelationshipEdge.test.tsx`
  - Renders edge between nodes
  - Displays cardinality markers
  - Shows label if present

### 13.3 Recommended E2E Tests (Playwright)

**Post-MVP**:

- Full user journey: Create project → Create whiteboard → Add tables → Create relationships → Auto-layout
- Collaboration scenario: Two users editing same whiteboard
- Performance test: Load 50 tables and measure FPS

---

## Appendix A: Test Case Index

### Unit Tests (15 cases)

- TC-UNIT-001 to TC-UNIT-015: Converter and layout functions

### Integration Tests (8 cases)

- TC-INT-001 to TC-INT-008: Canvas rendering, data flow, WebSocket

### Manual Functional Tests (44 cases)

- TC-FUNC-001 to TC-FUNC-044: User stories 1-7, display modes, performance

### Performance Tests (4 cases)

- TC-PERF-001 to TC-PERF-004: FPS, load time, auto-layout, sync latency

### Regression Tests (28 cases)

- TC-REG-001 to TC-REG-028: Critical path, component, data integrity, functional, theme, parser

### Phase Verification Tests (13 cases)

- TC-PHASE-001 to TC-PHASE-013: Pre-rebuild baseline, phase-by-phase verification

**Total**: 107 test cases

---

## Appendix B: Test Checklist (Quick Reference)

**Pre-Rebuild** (30 min):

- [ ] TC-PHASE-001: Baseline established
- [ ] TC-PERF-001: FPS baseline recorded
- [ ] TC-PERF-002: Load time baseline recorded

**Phase 2** (1 hour):

- [ ] TC-PHASE-002: Feature flag removed
- [ ] TC-PHASE-003: Single route loads

**Phase 3** (1 hour):

- [ ] TC-PHASE-004: TableNode renders
- [ ] TC-PHASE-005: RelationshipEdge renders

**Phase 4** (30 min):

- [ ] TC-PHASE-006: d3-force deleted
- [ ] TC-PHASE-007: ELK layout works

**Phase 5** (45 min):

- [ ] TC-PHASE-008: Converters consolidated

**Phase 6** (15 min):

- [ ] TC-PHASE-009: Dependencies removed

**Phase 7** (1 hour):

- [ ] TC-PHASE-010: Build passes
- [ ] TC-PHASE-011: Tests pass
- [ ] TC-PHASE-012: Manual verification

**Phase 8** (30 min):

- [ ] TC-PHASE-013: Documentation updated

**Post-Rebuild** (3 hours):

- [ ] All TC-REG-xxx: Regression suite (28 cases)
- [ ] All TC-PERF-xxx: Performance suite (4 cases)
- [ ] All TC-FUNC-xxx: Functional suite (44 cases)
- [ ] All TC-INT-xxx: Integration suite (8 cases)

**Final Acceptance**:

- [ ] Exit criteria met
- [ ] Bugs triaged
- [ ] Test report generated
- [ ] APPROVED / REJECTED

---

## Appendix C: Performance Profiling Guide

### Using Chrome DevTools for Performance Testing

**TC-PERF-001: FPS Measurement**:

1. Open Chrome DevTools (F12)
2. Go to "Performance" tab
3. Check "Screenshots" and "Memory"
4. Click "Record" (red dot)
5. Perform pan/zoom actions for 10 seconds
6. Click "Stop"
7. Analyze "Frames" section - green bars = 60 FPS, red bars = dropped frames

**TC-PERF-002: Load Time Measurement**:

1. Open DevTools > Network tab
2. Check "Disable cache"
3. Refresh page (Ctrl+Shift+R)
4. Look at "DOMContentLoaded" event (blue line)
5. Measure to when React Flow canvas is interactive

**TC-PERF-003: Auto-Layout Profiling**:

```javascript
// Add to src/lib/react-flow/use-auto-layout.ts
performance.mark('layout-start')
await computeElkLayout(nodes, edges)
performance.mark('layout-end')
performance.measure('layout', 'layout-start', 'layout-end')
console.log(performance.getEntriesByName('layout')[0].duration)
```

**TC-PERF-004: WebSocket Latency**:

1. DevTools > Network tab > WS filter
2. Click on WebSocket connection
3. Click "Messages" tab
4. Compare timestamps between sent and received messages

---

## Appendix D: Collaboration Testing Setup

### Two-Browser Testing Setup

**Option 1: Two Browser Windows**:

1. Open Chrome window 1 → Navigate to whiteboard
2. Open Chrome window 2 (or Firefox) → Navigate to same whiteboard
3. Arrange windows side-by-side
4. Perform actions in window 1, observe window 2

**Option 2: Incognito Mode**:

1. Open Chrome normal window → Navigate to whiteboard
2. Open Chrome incognito window → Navigate to same whiteboard
3. Incognito simulates different user session

**Option 3: Different Devices**:

1. Open whiteboard on desktop
2. Open same whiteboard on laptop/tablet
3. Test cross-device synchronization

### Network Condition Testing

**Simulate Slow Network**:

1. DevTools > Network tab
2. Change throttling to "Slow 3G"
3. Test real-time sync latency

**Simulate Network Drop**:

1. DevTools > Network tab
2. Check "Offline"
3. Wait 5 seconds
4. Uncheck "Offline"
5. Verify reconnection

---

_This Test Plan was created by Artemis, the QA Agent, as part of the Kratos pipeline for feature rebuild-v2._
