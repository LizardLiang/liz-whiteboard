# Feature Specification: React Flow Migration

**Feature Branch**: `002-react-flow-migration`
**Created**: 2025-11-15
**Status**: Draft
**Input**: User description: "remove the old render structure konva with d3-force, migrate it to use React Flow"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - View ER Diagrams with React Flow (Priority: P1)

A database architect opens an existing whiteboard with ER diagram tables and relationships. The system renders the diagram using React Flow instead of Konva, displaying all tables and relationship arrows with the same visual fidelity and layout as before.

**Why this priority**: This is the core migration requirement - without being able to render existing diagrams in React Flow, no other migration features matter. This delivers the minimum viable product for the migration.

**Independent Test**: Can be fully tested by opening an existing whiteboard with tables and relationships, verifying that all elements render correctly using React Flow components, and confirming that the diagram matches the previous Konva-based rendering. Delivers immediate value by validating the rendering layer migration.

**Acceptance Scenarios**:

1. **Given** a whiteboard contains multiple ER diagram tables, **When** the user opens the whiteboard, **Then** all tables render correctly using React Flow nodes with the same visual appearance (table name, columns, data types, constraints)
2. **Given** a whiteboard contains relationships between tables, **When** the diagram renders, **Then** all relationship arrows display correctly using React Flow edges connecting the appropriate tables
3. **Given** tables have specific positions on the canvas, **When** the diagram loads, **Then** all tables appear at their stored positions using React Flow's positioning system
4. **Given** relationships have cardinality types (one-to-one, one-to-many, etc.), **When** arrows render, **Then** the correct visual notation appears on React Flow edges
5. **Given** columns are marked as primary keys or foreign keys, **When** tables render, **Then** the key indicators display correctly in React Flow nodes

---

### User Story 2 - Interactive Canvas Navigation with React Flow (Priority: P1)

A database architect working with a complex ER diagram needs to navigate the canvas. They use zoom in/out controls and pan by dragging the canvas, experiencing smooth interactions powered by React Flow's built-in viewport controls.

**Why this priority**: Canvas navigation is essential for usability and must work immediately after migration. React Flow provides these features built-in, replacing the custom Konva implementation.

**Independent Test**: Can be fully tested by opening a whiteboard with multiple tables, using mouse wheel to zoom, dragging the canvas to pan, and verifying smooth performance. Delivers value of maintaining existing navigation capabilities with React Flow's optimized implementation.

**Acceptance Scenarios**:

1. **Given** a whiteboard with multiple tables, **When** the user scrolls the mouse wheel, **Then** the canvas zooms in/out smoothly using React Flow's zoom controls
2. **Given** a zoomed canvas, **When** the user drags on empty space, **Then** the viewport pans using React Flow's pan functionality
3. **Given** a large diagram, **When** the user uses "fit to screen" control, **Then** React Flow adjusts the zoom and position to show all nodes
4. **Given** the user zooms to 200%, **When** they interact with table nodes, **Then** interactions work correctly at the scaled zoom level
5. **Given** viewport changes occur, **When** the user navigates, **Then** the zoom level indicator updates to reflect the current React Flow zoom state

---

### User Story 3 - Drag and Reposition Tables (Priority: P2)

A database architect wants to manually arrange tables on the canvas for better visualization. They click and drag individual table nodes to new positions, and React Flow updates the positions smoothly while maintaining all relationship connections.

**Why this priority**: Manual positioning is important for diagram customization but diagrams can be viewed without repositioning. This leverages React Flow's built-in draggable nodes feature.

**Independent Test**: Can be tested by opening a whiteboard, clicking and dragging table nodes to new positions, verifying that relationship edges automatically adjust to follow the nodes, and confirming that positions persist. Delivers value of interactive diagram customization.

**Acceptance Scenarios**:

1. **Given** a table node exists on the canvas, **When** the user clicks and drags the table, **Then** the table moves smoothly using React Flow's drag functionality
2. **Given** a table has relationship arrows connected to it, **When** the user drags the table, **Then** React Flow automatically updates all connected edges to maintain connections
3. **Given** the user repositions a table, **When** they release the drag, **Then** the new position persists to the database
4. **Given** multiple users are collaborating, **When** one user drags a table, **Then** other users see the table move in real-time through WebSocket updates
5. **Given** a table is being dragged, **When** the user drags near canvas edges, **Then** React Flow's auto-pan behavior activates if enabled

---

### User Story 4 - Apply Automatic Layout (Priority: P1)

A database architect adds multiple tables to a whiteboard and wants them automatically arranged. They trigger automatic layout, and the system uses React Flow's layout capabilities to position tables based on relationship strength, minimizing arrow crossings.

**Why this priority**: Automatic layout was a core feature of the d3-force implementation and must continue working after migration. This requires integrating layout algorithms with React Flow's positioning system.

**Independent Test**: Can be tested by creating a whiteboard with interconnected tables, triggering automatic layout, and verifying that React Flow positions nodes according to relationship-based algorithms with minimal edge crossings. Delivers value by maintaining the automatic organization feature.

**Acceptance Scenarios**:

1. **Given** multiple tables exist with defined relationships, **When** the user triggers automatic layout, **Then** React Flow repositions all nodes using a layout algorithm (e.g., dagre, elkjs, or custom force-directed layout)
2. **Given** tables A and B have multiple direct connections, **When** automatic layout runs, **Then** these strongly-connected nodes are positioned close together in the React Flow canvas
3. **Given** a diagram has disconnected clusters, **When** automatic layout is applied, **Then** each cluster is arranged separately in the React Flow viewport
4. **Given** automatic layout completes, **When** nodes are repositioned, **Then** React Flow's edge routing automatically adjusts to connect nodes with minimal crossings
5. **Given** the layout algorithm finishes, **When** the diagram updates, **Then** React Flow animates the transition from old to new positions smoothly

---

### User Story 5 - Maintain Real-Time Collaboration (Priority: P2)

Two database architects collaborate on a whiteboard simultaneously. Changes made in React Flow by one user (adding tables, moving nodes, creating relationships) appear immediately on the other user's React Flow canvas via WebSocket synchronization.

**Why this priority**: Collaboration is a key feature that must continue working after the rendering migration. React Flow's controlled state model enables straightforward WebSocket integration.

**Independent Test**: Can be tested by opening the same whiteboard in two browser sessions, making changes (add/move/delete nodes and edges) in one session, and verifying that React Flow in the second session reflects those changes immediately. Delivers value by preserving collaborative workflows.

**Acceptance Scenarios**:

1. **Given** two users view the same whiteboard, **When** User A adds a table, **Then** User B's React Flow canvas shows the new node within 2 seconds
2. **Given** users are collaborating, **When** User A drags a table node, **Then** User B sees the node position update in real-time in their React Flow instance
3. **Given** a relationship is created, **When** User A adds an edge between tables, **Then** User B's React Flow canvas renders the new edge immediately
4. **Given** users are collaborating, **When** User A deletes a table, **Then** React Flow in User B's session removes the corresponding node and connected edges
5. **Given** WebSocket updates arrive, **When** React Flow state is updated, **Then** the canvas re-renders only the changed nodes/edges for optimal performance

---

### User Story 6 - Support Dark Mode Theming (Priority: P3)

A developer working late wants to use dark mode. They toggle dark mode, and the React Flow canvas, nodes (tables), and edges (relationships) switch to dark theme colors with appropriate styling.

**Why this priority**: Dark mode is an existing feature that should continue working after migration. React Flow supports custom styling through CSS and component props.

**Independent Test**: Can be tested by toggling dark mode on/off and verifying that React Flow nodes, edges, background, and controls all display with appropriate dark/light theme colors. Delivers value by maintaining user comfort and preference.

**Acceptance Scenarios**:

1. **Given** a user views a whiteboard in light mode, **When** they toggle dark mode, **Then** the React Flow background, nodes, and edges switch to dark theme colors
2. **Given** dark mode is enabled, **When** tables render, **Then** React Flow nodes use dark backgrounds with light text for readability
3. **Given** dark mode is active, **When** relationship edges render, **Then** arrows and labels use colors with sufficient contrast against the dark background
4. **Given** the user toggles between themes, **When** React Flow updates, **Then** all built-in controls (zoom, minimap if enabled) also respect the theme
5. **Given** theme changes occur, **When** React Flow re-renders, **Then** the transition is smooth without visual glitches

---

### User Story 7 - Render Column-Level Relationship Endpoints (Priority: P2)

A database architect creates a relationship linking specific columns (e.g., Users.id to Orders.user_id). The React Flow edge should visually connect to the specific column positions within the table nodes, not just the table centers.

**Why this priority**: Column-specific relationships are a unique ER diagram requirement that differentiate this from standard flow diagrams. This requires custom handle positioning in React Flow.

**Independent Test**: Can be tested by creating relationships between specific columns, verifying that React Flow edges connect to the correct positions on the source and target table nodes (aligned with the specific column rows). Delivers value by maintaining the precise ER diagram semantics.

**Acceptance Scenarios**:

1. **Given** a relationship links Users.id to Orders.user_id, **When** the edge renders in React Flow, **Then** the edge connects from the specific row position of Users.id to the specific row position of Orders.user_id
2. **Given** tables have multiple columns, **When** multiple relationships exist from different columns, **Then** each React Flow edge connects to the correct vertical position corresponding to its source/target columns
3. **Given** a table is resized or columns are reordered, **When** the node updates, **Then** React Flow edge handles automatically adjust to maintain correct column connections
4. **Given** a user hovers over a relationship arrow, **When** the edge is highlighted, **Then** the specific source and target columns are visually indicated
5. **Given** column positions change due to table structure updates, **When** React Flow re-renders, **Then** all relationship edges automatically reconnect to updated column positions

---

### Edge Cases

- What happens when migrating from Konva's coordinate system to React Flow's coordinate system - how are existing position values converted?
- How does React Flow handle extremely large diagrams (100+ nodes) compared to Konva's performance characteristics?
- What happens to custom Konva event handlers (mouse events, keyboard shortcuts) - how are they reimplemented in React Flow?
- How does React Flow's edge routing algorithm handle complex relationship patterns (multiple edges between same tables, circular relationships)?
- What happens when automatic layout produces overlapping nodes - does React Flow's collision detection prevent overlaps?
- How are the existing d3-force layout calculations integrated with React Flow's node positioning system?
- What happens to the zoom indicator component - is it replaced by React Flow's built-in controls or kept as custom UI?
- How does React Flow handle the transition from Konva's Layer/Group structure to React Flow's node/edge components?
- What happens to the Web Worker-based layout computation - can it still be used with React Flow's state management?
- How are table dimensions calculated for React Flow nodes to match the previous Konva rendering?
- What happens when bidirectional text editor synchronization updates the diagram - how does React Flow handle bulk node/edge updates efficiently?
- How does React Flow's controlled vs uncontrolled node positioning affect manual dragging vs automatic layout positioning?
- What happens to viewport state persistence - does React Flow's viewport state format match the previous CanvasViewport interface?
- How does React Flow handle relationship arrow styling (different cardinality notations like crow's foot) compared to custom Konva rendering?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST render ER diagram tables as React Flow custom nodes instead of Konva shapes
- **FR-002**: System MUST render relationships as React Flow edges instead of Konva lines and arrows
- **FR-003**: System MUST convert existing Konva position coordinates (x, y) to React Flow node position format
- **FR-004**: System MUST implement custom React Flow node components that visually match the previous TableNode rendering (table name, columns, data types, constraints, key indicators)
- **FR-005**: System MUST implement custom React Flow edges that display relationship cardinality notation (one-to-one, one-to-many, crow's foot, etc.)
- **FR-006**: System MUST support zoom in/out using React Flow's built-in zoom controls
- **FR-007**: System MUST support canvas panning using React Flow's built-in pan functionality
- **FR-008**: System MUST provide "fit to screen" functionality using React Flow's fitView API
- **FR-009**: System MUST enable draggable table nodes using React Flow's draggable node feature
- **FR-010**: System MUST persist node position changes to the database when users drag tables
- **FR-011**: System MUST automatically update edge routing when nodes are repositioned in React Flow
- **FR-012**: System MUST implement automatic layout using a layout algorithm compatible with React Flow (e.g., dagre, elkjs, or custom algorithm)
- **FR-013**: System MUST calculate relationship strength between tables for automatic layout positioning (preserving existing d3-force logic)
- **FR-014**: System MUST apply automatic layout by updating React Flow node positions based on calculated layout
- **FR-015**: System MUST handle disconnected table clusters separately during automatic layout
- **FR-016**: System MUST minimize edge crossings during automatic layout
- **FR-017**: System MUST synchronize React Flow state with WebSocket updates for real-time collaboration
- **FR-018**: System MUST broadcast node position changes via WebSocket when users drag tables
- **FR-019**: System MUST broadcast node additions/deletions via WebSocket when users add/remove tables
- **FR-020**: System MUST broadcast edge additions/deletions via WebSocket when users create/remove relationships
- **FR-021**: System MUST support dark mode theming for React Flow nodes, edges, and background
- **FR-022**: System MUST implement custom handles on React Flow nodes to enable column-specific edge connections
- **FR-023**: System MUST position edge handles at vertical offsets corresponding to specific column positions within table nodes
- **FR-024**: System MUST connect React Flow edges to specific source and target handles based on relationship column specifications
- **FR-025**: System MUST display relationship labels on React Flow edges
- **FR-026**: System MUST preserve viewport state (zoom level, pan position) using React Flow's viewport API
- **FR-027**: System MUST remove all Konva dependencies (konva, react-konva packages)
- **FR-028**: System MUST remove d3-force as a direct dependency (may retain layout algorithm logic separately)
- **FR-029**: System MUST add React Flow (reactflow or @xyflow/react) as a dependency
- **FR-030**: System MUST migrate Canvas component from Konva Stage/Layer to React Flow ReactFlow component
- **FR-031**: System MUST ensure React Flow performance is acceptable for diagrams with up to 50 tables (60 FPS during pan/zoom)
- **FR-032**: System MUST maintain bidirectional synchronization between text editor and React Flow canvas (text changes update React Flow, manual node dragging updates text representation)
- **FR-033**: System MUST calculate table node dimensions in React Flow to match previous Konva rendering (minimum width, header height, row height based on columns)

### Key Entities

- **React Flow Node (Table)**: A custom React Flow node type representing a database table; has id, position (x, y), data containing table information (name, columns), and type identifier
- **React Flow Edge (Relationship)**: A React Flow edge representing a relationship; has id, source node id, target node id, source handle id (column identifier), target handle id (column identifier), edge type, label, and data containing relationship metadata (cardinality, strength)
- **React Flow Handle**: A connection point on a table node; positioned at vertical offset corresponding to a specific column; has id matching column identifier and type (source/target)
- **Layout Algorithm Adapter**: A utility that calculates node positions using relationship-based layout logic and outputs positions in React Flow format
- **Node Component**: A custom React component that renders a table with columns, data types, and constraints; registers handles for each column
- **Edge Component**: A custom React component that renders relationship arrows with cardinality notation and labels
- **Viewport State**: React Flow viewport configuration; includes zoom level, x/y offsets, fits to React Flow's viewport API

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All existing whiteboards render correctly in React Flow with zero visual regressions (tables, relationships, labels all display as before)
- **SC-002**: Users can zoom and pan on diagrams with 50+ tables at 60 FPS using React Flow's viewport controls
- **SC-003**: Users can drag table nodes and see relationship edges automatically adjust in real-time without lag
- **SC-004**: Automatic layout completes in under 3 seconds for diagrams with up to 30 tables when applied through React Flow positioning
- **SC-005**: Real-time collaboration updates appear in other users' React Flow canvases within 2 seconds of changes
- **SC-006**: Column-specific relationships visually connect to the correct column positions within table nodes with 100% accuracy
- **SC-007**: Dark mode displays all React Flow nodes, edges, and controls with readable contrast (minimum 4.5:1 contrast ratio)
- **SC-008**: Text editor bidirectional sync updates React Flow canvas with less than 500ms delay
- **SC-009**: Application bundle size decreases or remains similar after removing Konva and adding React Flow (within 10% of previous size)
- **SC-010**: Zero errors or warnings related to Konva dependencies appear in the console after migration
- **SC-011**: Relationship arrows display correct cardinality notation (crow's foot, etc.) on React Flow edges matching previous visual standards
- **SC-012**: Viewport state (zoom/pan) persists across page refreshes using React Flow's viewport state

## Assumptions

- React Flow (reactflow or @xyflow/react) is the chosen replacement library for Konva
- React Flow's coordinate system and positioning can accurately represent the previous Konva-based diagrams
- React Flow's performance is suitable for ER diagrams with up to 100 tables
- Custom node and edge components can be styled to match the existing visual design
- React Flow's edge routing algorithms can handle column-specific connection points through custom handles
- Automatic layout algorithms (d3-force logic or alternatives like dagre/elkjs) can be integrated with React Flow's node positioning API
- Existing database schema for storing table positions is compatible with React Flow's position format (or minimal migration required)
- WebSocket collaboration implementation can be updated to work with React Flow's state management
- Text editor parsing logic can output React Flow node/edge data structures
- React Flow's licensing is compatible with the project (MIT licensed)
- React Flow's API stability is sufficient for production use
- Migration can be done incrementally or requires a complete cutover (specific approach to be determined)
- No custom Konva-specific features exist that cannot be replicated in React Flow
- React Flow's TypeScript support is compatible with the project's TypeScript configuration

## Out of Scope

- Adding new features beyond maintaining existing functionality (focus is on migration, not enhancement)
- Performance optimization beyond ensuring feature parity with Konva implementation
- Rewriting the text editor syntax or parser (only updating the output to React Flow format)
- Changing the visual design or styling of tables and relationships (must match current appearance)
- Migrating to a different layout algorithm (preserve d3-force logic unless React Flow provides equivalent built-in options)
- Adding React Flow-specific features like minimap or node grouping (unless they replace existing functionality)
- Changing the database schema for storing diagram data (minimal changes only)
- Implementing undo/redo specific to React Flow (outside migration scope)
- Adding animations or transitions beyond what React Flow provides by default
- Supporting additional shape types beyond tables and relationship arrows (optional shapes remain out of scope)
- Optimizing for mobile touch interactions specific to React Flow (maintain existing mobile support level)
- Implementing custom edge routing algorithms (use React Flow's default edge routing)
