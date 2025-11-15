# React Flow Migration - Testing Guide

**Purpose**: Manual validation of React Flow implementation against performance and quality targets
**Applies to**: Tasks T088-T092, T096 (Phase 10 testing tasks)
**Prerequisites**: Development server running (`bun run dev`)

---

## Quick Start

### 1. Start Development Server

```bash
bun run dev
```

Server will start at: `http://0.0.0.0:3000`

### 2. Access Test Routes

- **React Flow version**: `/whiteboard/{whiteboardId}/new`
- **Konva version (baseline)**: `/whiteboard/{whiteboardId}`

### 3. Test Data Setup

Use the existing demo data or create test whiteboards with varying complexity:
- Small: 10 tables, 15 relationships
- Medium: 30 tables, 50 relationships
- Large: 50 tables, 100 relationships

---

## Test Tasks

### T088: Performance Testing with 50 Table Nodes

**Target**: 60 FPS during pan/zoom operations

**Steps**:

1. **Create test whiteboard** with 50 tables:
   - Use text editor to generate 50 table definitions
   - Apply automatic layout to distribute tables

2. **Measure FPS during pan**:
   - Open browser DevTools (F12)
   - Go to Performance tab
   - Start recording
   - Pan the canvas in all directions for 10 seconds
   - Stop recording
   - Check FPS graph: Should maintain 60 FPS

3. **Measure FPS during zoom**:
   - Start performance recording
   - Zoom in/out using mouse wheel for 10 seconds
   - Stop recording
   - Check FPS graph: Should maintain 60 FPS

4. **Compare with Konva baseline**:
   - Repeat tests on `/whiteboard/{id}` (Konva version)
   - Document FPS differences

**Success Criteria**:
- ✅ React Flow maintains ≥60 FPS during pan
- ✅ React Flow maintains ≥60 FPS during zoom
- ✅ Performance comparable to or better than Konva

**How to check FPS**:
```javascript
// In browser console
let lastTime = performance.now();
let frames = 0;
function measureFPS() {
  frames++;
  const currentTime = performance.now();
  if (currentTime >= lastTime + 1000) {
    console.log(`FPS: ${frames}`);
    frames = 0;
    lastTime = currentTime;
  }
  requestAnimationFrame(measureFPS);
}
measureFPS();
```

---

### T089: Performance Testing with 100 Edge Connections

**Target**: Smooth rendering with no lag

**Steps**:

1. **Create test whiteboard** with 100 relationships:
   - 30-40 tables with multiple relationships each
   - Mix of one-to-one, one-to-many, many-to-many

2. **Test edge rendering**:
   - Verify all 100 edges render correctly
   - Check crow's foot notation appears on all edges
   - Confirm no visual glitches or overlapping

3. **Test edge interaction**:
   - Hover over edges (should highlight)
   - Select edges (should show selection state)
   - Verify labels render correctly

4. **Measure performance**:
   - Pan canvas: Edges should move smoothly with nodes
   - Zoom in/out: Edges should scale properly
   - Drag nodes: Edges should update in real-time

**Success Criteria**:
- ✅ All 100 edges render correctly
- ✅ No lag when panning/zooming with 100 edges
- ✅ Dragging nodes updates edges smoothly
- ✅ Cardinality markers visible and correct

---

### T090: Automatic Layout Performance

**Target**: Complete layout computation in <3 seconds for 30 tables

**Steps**:

1. **Create test whiteboard** with 30 tables:
   - Include variety of relationships
   - Mix of connected and disconnected clusters

2. **Measure layout time**:
   ```javascript
   // Open browser console, then trigger auto layout
   const startTime = performance.now();
   // Click "Auto Layout" button
   // Wait for layout to complete
   const endTime = performance.now();
   console.log(`Layout time: ${(endTime - startTime) / 1000}s`);
   ```

3. **Verify layout quality**:
   - No overlapping nodes
   - Related tables positioned near each other
   - Disconnected clusters separated
   - Minimal edge crossings

4. **Test multiple iterations**:
   - Run layout 3 times, record all timings
   - Calculate average time
   - Verify consistency

**Success Criteria**:
- ✅ Layout completes in <3 seconds
- ✅ No node overlaps after layout
- ✅ Visual layout is logical and readable
- ✅ Disconnected clusters handled correctly

---

### T091: Real-Time Collaboration Latency

**Target**: <2 seconds latency for remote changes

**Steps**:

1. **Setup two browser sessions**:
   - Open same whiteboard in two different browser windows
   - Use private/incognito for second session
   - Verify both show "Connected" status

2. **Test table creation**:
   - Session 1: Create a new table
   - Session 2: Measure time until table appears
   - Should be <2 seconds

3. **Test table movement**:
   - Session 1: Drag a table to new position
   - Session 2: Measure time until position updates
   - Should be <2 seconds

4. **Test relationship creation**:
   - Session 1: Create a new relationship
   - Session 2: Measure time until edge appears
   - Should be <2 seconds

5. **Test layout synchronization**:
   - Session 1: Trigger auto layout
   - Session 2: Measure time until layout applies
   - Should be <2 seconds

**Success Criteria**:
- ✅ Table creation syncs in <2 seconds
- ✅ Table movement syncs in <2 seconds
- ✅ Relationship creation syncs in <2 seconds
- ✅ Layout changes sync in <2 seconds
- ✅ No visual conflicts or race conditions

**Debug tool**:
```javascript
// Monitor WebSocket events in console
// Should see events logged as they occur
```

---

### T092: Visual Regression Testing

**Target**: React Flow matches Konva visual fidelity

**Steps**:

1. **Create reference whiteboard**:
   - 10-15 tables with various column types
   - Mix of relationship types
   - Both primary and foreign keys

2. **Side-by-side comparison**:
   - Open Konva version: `/whiteboard/{id}`
   - Take screenshot
   - Open React Flow version: `/whiteboard/{id}/new`
   - Take screenshot
   - Compare visually

3. **Check visual elements**:
   - **Table nodes**:
     - Header style and color
     - Column list rendering
     - Primary key indicators (🔑)
     - Foreign key indicators (🔗)
     - Border and shadow
   - **Edges**:
     - Line style and color
     - Cardinality markers (crow's foot)
     - Edge labels
     - Selection highlights
   - **Background**:
     - Grid pattern
     - Colors in light/dark mode
   - **Controls**:
     - Zoom controls position and style
     - Minimap (if enabled)

4. **Test dark mode**:
   - Toggle dark mode
   - Verify all colors update correctly
   - Check contrast ratios
   - Compare with Konva dark mode

**Success Criteria**:
- ✅ Table nodes visually match Konva
- ✅ Edges visually match Konva
- ✅ Cardinality markers match Konva
- ✅ Dark mode works correctly
- ✅ No visual regressions or glitches

**Visual checklist**:
- [ ] Table headers match
- [ ] Column rendering matches
- [ ] Key indicators match
- [ ] Edge paths match
- [ ] Cardinality notation matches
- [ ] Colors match in light mode
- [ ] Colors match in dark mode
- [ ] Background pattern matches
- [ ] Controls placement matches

---

### T096: Final Acceptance Testing

**Target**: All 7 user stories function correctly

**Test each user story**:

#### US1: View ER Diagrams
- [ ] All tables render with correct names
- [ ] All columns display with data types
- [ ] Primary keys show 🔑 indicator
- [ ] Foreign keys show 🔗 indicator
- [ ] Relationships connect correct tables
- [ ] Cardinality markers correct (crow's foot)
- [ ] Initial positions loaded from database

#### US2: Interactive Canvas Navigation
- [ ] Mouse wheel zooms in/out
- [ ] Drag canvas to pan
- [ ] Zoom controls work (+/- buttons)
- [ ] Fit-to-screen button works
- [ ] Zoom indicator shows current zoom level
- [ ] Zoom limits enforced (min/max)
- [ ] Pan boundaries enforced
- [ ] Smooth 60 FPS performance

#### US3: Drag and Reposition Tables
- [ ] Tables can be dragged
- [ ] Edges update during drag
- [ ] Position persists after drag
- [ ] Cursor shows drag state
- [ ] Auto-pan at canvas edges works
- [ ] Multiple tables can be selected and dragged

#### US4: Apply Automatic Layout
- [ ] Layout button triggers computation
- [ ] Loading state shown during layout
- [ ] Nodes reposition after layout
- [ ] Transitions are smooth and animated
- [ ] Disconnected clusters separated
- [ ] No node overlaps after layout
- [ ] Layout persists to database
- [ ] Completes in <3 seconds for 30 tables

#### US5: Real-Time Collaboration
- [ ] Connection status indicator shows "Connected"
- [ ] Remote table creation appears
- [ ] Remote table movement syncs
- [ ] Remote relationship creation appears
- [ ] Remote layout changes sync
- [ ] Latency <2 seconds for all events
- [ ] Reconnection works after disconnect
- [ ] No echo-back loops

#### US6: Dark Mode Theming
- [ ] Toggle dark mode works
- [ ] Tables render with dark colors
- [ ] Edges render with dark colors
- [ ] Background uses dark theme
- [ ] Controls use dark theme
- [ ] Text remains readable (contrast)
- [ ] Theme persists across sessions

#### US7: Column-Level Endpoints
- [ ] Edges connect to specific columns
- [ ] Source handle aligns with source column
- [ ] Target handle aligns with target column
- [ ] Handles visible on hover
- [ ] Multiple edges to same table connect to correct columns
- [ ] Column reordering updates handle positions

**Success Criteria**:
- ✅ All 7 user stories pass acceptance tests
- ✅ No critical bugs found
- ✅ Performance meets all targets
- ✅ Visual quality matches or exceeds Konva

---

## Performance Comparison Template

Use this template to document performance findings:

```markdown
# Performance Test Results

Date: [DATE]
Tester: [NAME]
Environment: [Browser, OS, Hardware]

## T088: 50 Table Nodes Performance

| Metric | React Flow | Konva | Winner |
|--------|-----------|-------|--------|
| Pan FPS | _____ | _____ | _____ |
| Zoom FPS | _____ | _____ | _____ |
| Subjective smoothness | _____ | _____ | _____ |

## T089: 100 Edge Connections

| Metric | React Flow | Konva | Winner |
|--------|-----------|-------|--------|
| Initial render time | _____ | _____ | _____ |
| Pan FPS | _____ | _____ | _____ |
| Drag FPS | _____ | _____ | _____ |

## T090: Auto Layout Performance

| Metric | React Flow | Konva | Winner |
|--------|-----------|-------|--------|
| 30 tables - Time 1 | _____ | _____ | _____ |
| 30 tables - Time 2 | _____ | _____ | _____ |
| 30 tables - Time 3 | _____ | _____ | _____ |
| Average | _____ | _____ | _____ |

## T091: Collaboration Latency

| Event | React Flow | Konva | Winner |
|-------|-----------|-------|--------|
| Table create | _____ | _____ | _____ |
| Table move | _____ | _____ | _____ |
| Relationship create | _____ | _____ | _____ |
| Layout sync | _____ | _____ | _____ |

## T092: Visual Regression

| Element | Match? | Notes |
|---------|--------|-------|
| Table nodes | ☐ | _____ |
| Edges | ☐ | _____ |
| Cardinality | ☐ | _____ |
| Dark mode | ☐ | _____ |

## T096: Acceptance Tests

| User Story | Pass? | Notes |
|-----------|-------|-------|
| US1: View ER Diagrams | ☐ | _____ |
| US2: Navigation | ☐ | _____ |
| US3: Drag Tables | ☐ | _____ |
| US4: Auto Layout | ☐ | _____ |
| US5: Collaboration | ☐ | _____ |
| US6: Dark Mode | ☐ | _____ |
| US7: Column Endpoints | ☐ | _____ |

## Overall Recommendation

☐ **PROCEED**: React Flow meets or exceeds Konva performance
☐ **ABORT**: Optimize Konva instead (research recommendation)

Reasoning: _____
```

---

## Troubleshooting

### Server not starting
```bash
# Check if database is running
bun run db:push

# Regenerate Prisma client
bun run db:generate

# Check for port conflicts
lsof -i :3000
```

### React Flow route not loading
- Verify route exists: `src/routes/whiteboard/$whiteboardId.new.tsx`
- Check browser console for errors
- Verify @xyflow/react is installed: `bun pm ls @xyflow/react`

### WebSocket not connecting
- Check server logs for Socket.IO initialization
- Verify firewall allows WebSocket connections
- Check browser console for connection errors

### Performance issues
- Open DevTools → Performance tab
- Look for:
  - Long tasks (>50ms)
  - Excessive re-renders
  - Memory leaks (increasing heap size)

---

## Reporting Results

After completing tests, update:

1. **`IMPLEMENTATION_STATUS.md`**: Mark testing tasks complete
2. **`specs/002-react-flow-migration/tasks.md`**: Check off T088-T092, T096
3. **Create test report**: Document all findings
4. **Make recommendation**: Proceed with migration or optimize Konva

---

## Decision Criteria

### Proceed with React Flow Migration if:
- ✅ All performance targets met (60 FPS, <3s layout, <2s sync)
- ✅ Visual quality matches Konva
- ✅ All user stories pass acceptance tests
- ✅ No critical bugs found

### Optimize Konva instead if:
- ❌ React Flow underperforms vs Konva
- ❌ Visual quality issues found
- ❌ Critical bugs or missing features
- ❌ Research findings confirmed (4-6 hours optimization better ROI)

---

**Good luck with testing! 🚀**
