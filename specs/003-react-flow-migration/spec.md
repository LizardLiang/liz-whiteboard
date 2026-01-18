# Feature Specification: React Flow Whiteboard Migration

**Feature Branch**: `003-react-flow-migration`
**Created**: 2025-11-15
**Status**: Draft
**Input**: User description: "read @.claude/liam-whiteboard-implementation.md and migrate all diagram drawing and whiteboard to use the same tech as liam"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - View ERD Diagrams with Modern Canvas (Priority: P1)

Users need to view existing ERD diagrams on a whiteboard with smooth pan, zoom, and navigation capabilities. The diagram should display tables with their columns and relationships between tables with visual indicators showing connection types.

**Why this priority**: This is the foundation of the migration - users must be able to view diagrams before any other functionality works. Without this, the whiteboard is non-functional.

**Independent Test**: Can be fully tested by loading a whiteboard with existing tables and relationships, verifying that all tables are visible, relationships are correctly drawn between them, and users can pan/zoom around the canvas smoothly.

**Acceptance Scenarios**:

1. **Given** a whiteboard with multiple tables and relationships, **When** the user opens the whiteboard, **Then** all tables are displayed as nodes with their column information
2. **Given** tables with foreign key relationships, **When** the diagram loads, **Then** relationship lines connect the appropriate tables with visual cardinality markers (1:1, 1:n)
3. **Given** a loaded diagram, **When** the user scrolls or drags, **Then** the canvas pans smoothly without lag or visual artifacts
4. **Given** a loaded diagram, **When** the user zooms in or out, **Then** the canvas scales appropriately while maintaining visual clarity
5. **Given** multiple tables on the canvas, **When** the diagram renders, **Then** tables display their name, columns, and key indicators (primary key, foreign key)

---

### User Story 2 - Interact with Tables and Relationships (Priority: P2)

Users need to click on tables to select them, see which other tables are related, and understand the relationships through visual highlighting. Hovering over elements should provide additional context.

**Why this priority**: Interactive feedback is essential for understanding complex diagrams with many relationships. This builds on the viewing capability (P1) to add user engagement.

**Independent Test**: Can be tested by clicking on a table and verifying that related tables and relationship lines are highlighted, then hovering over different elements to see tooltips or visual changes.

**Acceptance Scenarios**:

1. **Given** a diagram with multiple tables, **When** the user clicks on a table, **Then** that table is highlighted and all directly connected tables are visually emphasized
2. **Given** a selected table, **When** viewing its relationships, **Then** the relationship lines to connected tables are highlighted with animated visual indicators
3. **Given** any table on the canvas, **When** the user hovers over it, **Then** the table shows a hover state without affecting selection
4. **Given** a selected table, **When** the user clicks on the canvas background, **Then** all highlights are cleared and the diagram returns to default state
5. **Given** a relationship line between tables, **When** highlighted, **Then** animated particles flow along the line showing the direction of the relationship

---

### User Story 3 - Manually Position Tables (Priority: P2)

Users need to drag tables to custom positions on the canvas to organize their diagrams according to their preferences. The system should remember these custom positions.

**Why this priority**: Manual positioning gives users control over their diagram layout, which is important for creating meaningful visual groupings and improving comprehension.

**Independent Test**: Can be tested by dragging a table to a new position, verifying that relationship lines update automatically, and confirming that the position is preserved when the whiteboard is reloaded.

**Acceptance Scenarios**:

1. **Given** any table on the canvas, **When** the user drags it to a new position, **Then** the table moves smoothly and relationship lines automatically adjust their paths
2. **Given** a table being dragged, **When** the drag operation completes, **Then** the new position is immediately saved to the database
3. **Given** tables with custom positions, **When** the whiteboard is reloaded, **Then** all tables appear at their previously saved positions
4. **Given** multiple tables being repositioned, **When** relationship lines need to update, **Then** the lines automatically recalculate their paths without manual intervention

---

### User Story 4 - Automatic Layout Generation (Priority: P3)

Users need a button to automatically arrange all tables on the canvas using an intelligent layout algorithm. This helps organize complex diagrams with many tables and relationships.

**Why this priority**: Auto-layout is a convenience feature that helps with initial diagram organization but isn't essential for basic functionality. Users can manually position tables if needed.

**Independent Test**: Can be tested by creating a whiteboard with randomly positioned tables, clicking the auto-layout button, and verifying that tables are arranged in a hierarchical, easy-to-read layout with minimal edge crossings.

**Acceptance Scenarios**:

1. **Given** a diagram with randomly positioned tables, **When** the user triggers auto-layout, **Then** tables are arranged in a hierarchical left-to-right layout that minimizes relationship line crossings
2. **Given** tables with many relationships, **When** auto-layout runs, **Then** related tables are positioned near each other for easier comprehension
3. **Given** a completed auto-layout, **When** viewing the result, **Then** the canvas automatically adjusts zoom and position to fit all tables in view
4. **Given** tables after auto-layout, **When** positions are calculated, **Then** the new positions are saved so the layout persists on reload

---

### User Story 5 - Multi-User Collaboration (Priority: P3)

Users working together on the same whiteboard need to see real-time updates when another user moves a table or modifies the diagram. Changes should appear instantly without manual refresh.

**Why this priority**: Real-time collaboration enhances the value of the tool but the core viewing and editing functionality (P1, P2) must work first. This builds on those foundations.

**Independent Test**: Can be tested by opening the same whiteboard in two browser windows, moving a table in one window, and verifying it updates in the other window within 1 second.

**Acceptance Scenarios**:

1. **Given** two users viewing the same whiteboard, **When** one user moves a table, **Then** the other user sees the table move to its new position within 1 second
2. **Given** collaborative editing in progress, **When** position updates arrive, **Then** table movements are smooth and don't cause visual jumps or conflicts
3. **Given** multiple users editing simultaneously, **When** changes occur, **Then** each user sees a consistent view of the diagram state

---

### User Story 6 - Display Modes for Information Density (Priority: P4)

Users need to toggle between different display modes to control how much information is shown on each table: table names only, primary/foreign keys only, or all columns.

**Why this priority**: Display modes improve usability for large diagrams but aren't essential for the core migration. Users can function with a default "show all" mode initially.

**Independent Test**: Can be tested by clicking a display mode toggle and verifying that all tables update to show the appropriate level of detail (names only, keys only, or all fields).

**Acceptance Scenarios**:

1. **Given** tables displaying all columns, **When** the user switches to "table names only" mode, **Then** all tables collapse to show only their name
2. **Given** any display mode, **When** the user switches to "keys only" mode, **Then** tables show name, primary keys, and foreign keys but hide other columns
3. **Given** a display mode preference, **When** set by the user, **Then** the preference is saved and persists when the whiteboard is reloaded

---

### Edge Cases

- What happens when a whiteboard has over 100 tables? System should maintain smooth performance with virtualized rendering.
- How does the system handle relationship lines when tables are positioned at extreme distances? Lines should automatically route around obstacles or use simplified paths.
- What happens when two users drag the same table simultaneously? The last update should win, with the position being broadcast to all connected users.
- How does auto-layout behave with disconnected table groups? Each disconnected component should be laid out separately with spacing between groups.
- What happens when a table has no relationships? It should still be draggable and visible, possibly grouped with other unconnected tables.
- How does the system handle very long table or column names? Text should truncate with ellipsis and show full name on hover.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST render tables as draggable nodes on a canvas with each table displaying its name, columns, and key indicators
- **FR-002**: System MUST display relationship lines (edges) between tables based on foreign key constraints stored in the database
- **FR-003**: System MUST show cardinality markers on relationship lines indicating one-to-one or one-to-many relationships
- **FR-004**: System MUST allow users to pan across the canvas by dragging the background or using scroll gestures
- **FR-005**: System MUST allow users to zoom in and out of the canvas with configurable minimum and maximum zoom levels
- **FR-006**: System MUST highlight a selected table and all its directly connected tables when a user clicks on any table
- **FR-007**: System MUST highlight relationship lines when connected tables are selected, with animated visual indicators flowing along the line
- **FR-008**: System MUST allow users to drag individual tables to new positions on the canvas
- **FR-009**: System MUST automatically update relationship line paths when table positions change
- **FR-010**: System MUST persist table positions to the database when users manually reposition them
- **FR-011**: System MUST restore table positions from the database when loading a whiteboard
- **FR-012**: System MUST provide an auto-layout function that arranges tables using a hierarchical algorithm
- **FR-013**: Auto-layout MUST minimize crossing relationship lines and position related tables near each other
- **FR-014**: System MUST broadcast table position changes to all connected users in real-time via WebSocket
- **FR-015**: System MUST update the canvas when receiving position updates from other users without requiring page refresh
- **FR-016**: System MUST support three display modes: table names only, primary/foreign keys only, and all columns
- **FR-017**: System MUST deselect all highlights when users click on the canvas background
- **FR-018**: System MUST show hover states on tables without changing selection state
- **FR-019**: System MUST render a dot-pattern background on the canvas for visual reference
- **FR-020**: System MUST handle tables with no relationships by displaying them as standalone nodes
- **FR-021**: System MUST maintain smooth canvas performance with at least 100 tables and relationships
- **FR-022**: System MUST preserve existing database schema for tables, columns, relationships, and positions
- **FR-023**: System MUST migrate from Konva-based rendering to React Flow-based rendering
- **FR-024**: System MUST use ELK (Eclipse Layout Kernel) algorithm for automatic layout computation

### Key Entities

- **Table Node**: Represents a database table on the whiteboard canvas, contains table name, column list, position coordinates (x, y), highlighting state (active, highlighted, hovered), and display mode setting
- **Relationship Edge**: Represents a foreign key relationship between two tables, contains source table reference, target table reference, source column reference, target column reference, cardinality type (one-to-one or one-to-many), and highlighting state
- **Canvas State**: Manages the current view of the whiteboard, contains zoom level, pan position, selected table reference, hovered table reference, and display mode setting
- **Position Data**: Stores custom table positions set by users, linked to specific table and whiteboard, contains x and y coordinates, persists in database

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can load a whiteboard with 50 tables and relationships and see the complete diagram rendered within 2 seconds
- **SC-002**: Users can pan and zoom the canvas with no perceived lag or frame drops (maintains 60 FPS)
- **SC-003**: When a user clicks a table, related tables and edges highlight within 100 milliseconds
- **SC-004**: Auto-layout completes and displays results for a 50-table diagram within 3 seconds
- **SC-005**: Table position changes from one user appear on other users' screens within 1 second
- **SC-006**: Users can drag tables and see relationship lines update smoothly in real-time without visual glitches
- **SC-007**: The system maintains visual clarity and usability at zoom levels from 10% to 200%
- **SC-008**: 95% of existing whiteboard data (tables, columns, relationships, positions) migrates successfully without data loss
- **SC-009**: Users can complete common tasks (view diagram, select table, drag table, auto-layout) without errors occurring
- **SC-010**: The whiteboard supports at least 100 concurrent users viewing/editing the same diagram without performance degradation

## Assumptions

- The existing database schema for tables, columns, relationships, and positions will be preserved during migration
- Users are accessing the whiteboard via modern web browsers with WebSocket support
- The current WebSocket infrastructure for real-time collaboration can be reused with the new canvas library
- Table position data is already stored in the database and can be queried for initial node positioning
- Cardinality information (1:1 vs 1:n) can be determined from existing foreign key and unique constraint data
- The React Flow library provides sufficient performance for the expected number of tables (up to 100+)
- The ELK layout algorithm can compute layouts within acceptable time limits for typical diagrams
- Display mode preference can default to "all fields" if no user preference is stored
- Auto-layout is an optional feature and users can continue using manual positioning if preferred
- The migration will maintain backward compatibility with existing saved whiteboard data

## Scope

### In Scope

- Migration from Konva canvas library to React Flow for all diagram rendering
- Implementation of custom table nodes as React components with column display
- Implementation of custom relationship edges with cardinality markers
- Integration of ELK layout engine for automatic table positioning
- Visual highlighting system for selected and related tables
- Animated visual indicators on highlighted relationship lines
- Pan and zoom functionality on the canvas
- Manual drag-and-drop table positioning
- Auto-layout button and functionality
- Real-time position synchronization via existing WebSocket infrastructure
- Three display modes for information density control
- Dot-pattern background for visual reference
- Persistence of table positions to database
- Loading and restoring table positions from database

### Out of Scope

- Changes to database schema (existing schema must be preserved)
- Modifications to table/column/relationship CRUD operations (only position updates)
- Adding new types of entities or relationships beyond existing foreign keys
- Creating new authentication or authorization features
- Modifying the project navigation or folder structure
- Changes to the text-based ERD parser or diagram creation flow
- Support for curved or custom-routed relationship lines beyond automatic routing
- Minimap or birds-eye view controls
- Keyboard shortcuts for canvas navigation (may be added in future iteration)
- Undo/redo functionality for table positioning (may be added in future iteration)
- Export or print functionality for diagrams
- Mobile or touch device optimization (desktop web browser focus)
