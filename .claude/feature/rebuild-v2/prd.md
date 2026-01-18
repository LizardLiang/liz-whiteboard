# Product Requirements Document: Liz-Whiteboard v2 Complete Rebuild

**Feature ID**: rebuild-v2
**Created**: 2026-01-18
**Status**: Draft
**Author**: Athena (PM Agent)

---

## Executive Summary

This PRD defines the complete rebuild of the Liz-Whiteboard collaborative ER diagram application. The goal is to eliminate technical debt from dual-implementation architecture (Konva + React Flow running in parallel) and deliver a clean, focused codebase with React Flow as the single rendering engine.

### Current State Problems

1. **Dual Canvas Implementation**: Two routes (`$whiteboardId.tsx` for Konva, `$whiteboardId.new.tsx` for React Flow) with 70% code duplication
2. **Legacy d3-force Layout Engine**: 500 lines of custom layout code in `src/lib/canvas/layout-engine.ts` when ELK is already integrated with React Flow
3. **Redundant Converters**: Multiple converter files (`converters.ts`, `convert-to-nodes.ts`, `convert-to-edges.ts`) serving the same purpose
4. **Feature Flag Complexity**: Runtime toggling between Konva and React Flow adds conditional logic throughout the codebase
5. **Dependency Bloat**: Both `konva`, `react-konva`, AND `@xyflow/react` installed simultaneously

### Target State

A streamlined application with:

- Single React Flow canvas implementation
- ~40% reduction in codebase size
- Unified data flow from database to React Flow nodes
- Clean, maintainable architecture for future development

---

## User Scenarios & Testing

### User Story 1: Create and Edit ER Diagrams (Priority: P0 - Critical)

A database architect opens a whiteboard to design a database schema. They add tables, define columns with data types and constraints, and create relationships between tables. The diagram renders on a React Flow canvas with smooth interactions.

**Why P0**: This is the core functionality. Without diagram creation and editing, the application has no value.

**Acceptance Scenarios**:

1. **Given** a user opens a new or existing whiteboard, **When** the page loads, **Then** React Flow renders all tables as nodes and relationships as edges within 2 seconds
2. **Given** the user clicks "Add Table", **When** they enter table name and columns, **Then** a new table node appears at the specified position
3. **Given** a table exists, **When** the user adds/edits/removes columns, **Then** the table node updates to reflect the changes
4. **Given** two tables with columns exist, **When** the user creates a relationship, **Then** an edge connects the source column to the target column with correct cardinality markers
5. **Given** the user drags a table, **When** they release, **Then** the new position persists to the database within 500ms

---

### User Story 2: Navigate Large Diagrams (Priority: P0 - Critical)

A database architect works with a diagram containing 30+ tables. They zoom in to see column details, zoom out for an overview, and pan to different areas of the canvas.

**Why P0**: Navigation is essential for usability with any non-trivial diagram.

**Acceptance Scenarios**:

1. **Given** a complex diagram, **When** the user scrolls the mouse wheel, **Then** the canvas zooms smoothly centered on the cursor position
2. **Given** a zoomed canvas, **When** the user drags on empty space, **Then** the viewport pans following the drag
3. **Given** a large diagram, **When** the user clicks "Fit View", **Then** React Flow adjusts zoom and position to show all nodes with padding
4. **Given** the user uses the minimap, **When** they click on a region, **Then** the viewport navigates to that area
5. **Given** 50 tables are visible, **When** the user pans, **Then** the canvas maintains 60 FPS performance

---

### User Story 3: Collaborate in Real-Time (Priority: P0 - Critical)

Two database architects work on the same whiteboard simultaneously. Changes made by one user appear immediately on the other's canvas.

**Why P0**: Real-time collaboration is a core differentiator of this application.

**Acceptance Scenarios**:

1. **Given** two users view the same whiteboard, **When** User A adds a table, **Then** User B sees the table appear within 1 second
2. **Given** User A drags a table, **When** the table moves, **Then** User B sees the position update in real-time (within 100ms)
3. **Given** User A creates a relationship, **When** the edge is added, **Then** User B's canvas shows the new edge within 1 second
4. **Given** User A deletes a table, **When** it is removed, **Then** User B's canvas removes the node and all connected edges
5. **Given** WebSocket connection drops, **When** reconnected, **Then** the canvas syncs to the latest state

---

### User Story 4: Define Diagrams via Text DSL (Priority: P1 - High)

A developer prefers writing code over visual editing. They use the text editor to define tables and relationships using Mermaid-like syntax, and the canvas updates to reflect the text.

**Why P1**: Text-based definition enables power users and automation workflows.

**Acceptance Scenarios**:

1. **Given** the user switches to text editor tab, **When** the existing diagram loads, **Then** the DSL syntax represents all tables and relationships
2. **Given** the user types valid DSL, **When** they stop typing for 500ms, **Then** the parser validates the syntax
3. **Given** valid DSL is entered, **When** applied to the canvas, **Then** tables and relationships update to match the text
4. **Given** the user modifies the visual diagram, **When** they switch to text tab, **Then** the DSL reflects the visual changes
5. **Given** the user enters invalid syntax, **When** parsing fails, **Then** error messages indicate the line and issue

---

### User Story 5: Apply Automatic Layout (Priority: P1 - High)

A database architect adds multiple tables without considering positions. They click "Auto Layout" and the system arranges tables using the ELK algorithm for optimal visualization.

**Why P1**: Automatic layout dramatically improves usability for new diagrams and after bulk imports.

**Acceptance Scenarios**:

1. **Given** multiple tables with relationships, **When** auto-layout is triggered, **Then** ELK algorithm repositions all nodes within 3 seconds
2. **Given** strongly-connected tables, **When** layout completes, **Then** related tables are positioned closer together
3. **Given** disconnected clusters, **When** layout runs, **Then** each cluster is arranged separately in the viewport
4. **Given** layout completes, **When** nodes move, **Then** edges automatically route to minimize crossings
5. **Given** auto-layout preference is enabled, **When** a new table is added, **Then** the layout recalculates automatically

---

### User Story 6: Organize Projects and Whiteboards (Priority: P1 - High)

A team lead organizes multiple database designs into projects and folders. They create, rename, and delete projects, folders, and whiteboards through the navigation sidebar.

**Why P1**: Organization is essential for teams working on multiple database designs.

**Acceptance Scenarios**:

1. **Given** the user is on the home page, **When** they click "Create Project", **Then** a new project appears in the tree
2. **Given** a project exists, **When** the user creates a folder, **Then** the folder appears nested under the project
3. **Given** a folder exists, **When** the user creates a whiteboard, **Then** the whiteboard appears in the folder
4. **Given** any item exists, **When** the user renames it, **Then** the new name persists immediately
5. **Given** an item is deleted, **When** confirmed, **Then** the item and its children are removed

---

### User Story 7: Support Dark/Light Theme (Priority: P2 - Medium)

A developer working late wants dark mode. They toggle the theme, and the entire application including the React Flow canvas switches themes.

**Why P2**: Theme support is important for comfort but not critical functionality.

**Acceptance Scenarios**:

1. **Given** light mode is active, **When** the user toggles theme, **Then** all UI elements switch to dark colors
2. **Given** dark mode is active, **When** the canvas renders, **Then** React Flow background, nodes, and edges use dark theme colors
3. **Given** theme preference, **When** the user returns later, **Then** their preference is restored from localStorage
4. **Given** theme changes, **When** the canvas re-renders, **Then** there are no visual glitches or flashes

---

## Requirements

### Functional Requirements

#### Canvas Rendering (React Flow)

- **FR-001**: System SHALL render tables as custom React Flow nodes with table name, columns, data types, and constraint indicators
- **FR-002**: System SHALL render relationships as custom React Flow edges with column-level connection handles
- **FR-003**: System SHALL display cardinality markers (one-to-one, one-to-many, many-to-many) on relationship edges
- **FR-004**: System SHALL support zoom in/out via mouse wheel, with zoom level from 10% to 500%
- **FR-005**: System SHALL support panning by dragging on empty canvas space
- **FR-006**: System SHALL provide zoom controls (zoom in, zoom out, reset, fit view)
- **FR-007**: System SHALL display a minimap for large diagram navigation
- **FR-008**: System SHALL persist viewport state (zoom, position) per whiteboard

#### Table and Column Management

- **FR-009**: System SHALL allow creating tables with name, position, and initial columns
- **FR-010**: System SHALL allow adding/editing/removing columns on existing tables
- **FR-011**: System SHALL support column attributes: name, data type, isPrimaryKey, isForeignKey, isUnique, isNullable, order
- **FR-012**: System SHALL support dragging tables to new positions with database persistence
- **FR-013**: System SHALL support multiple display modes: ALL_FIELDS, KEYS_ONLY, TABLE_NAME_ONLY

#### Relationship Management

- **FR-014**: System SHALL allow creating relationships between table columns
- **FR-015**: System SHALL support cardinality types: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
- **FR-016**: System SHALL auto-route edges when tables are repositioned
- **FR-017**: System SHALL connect edges to specific column handles, not just table centers

#### Automatic Layout

- **FR-018**: System SHALL compute layout using ELK (elkjs) algorithm
- **FR-019**: System SHALL arrange strongly-connected tables closer together
- **FR-020**: System SHALL handle disconnected clusters separately
- **FR-021**: System SHALL animate transitions when layout is applied
- **FR-022**: System SHALL optionally auto-layout on diagram changes (user preference)

#### Text DSL Parser

- **FR-023**: System SHALL parse Mermaid-like syntax for table and relationship definition
- **FR-024**: System SHALL convert parsed AST to database entities
- **FR-025**: System SHALL generate DSL text from existing diagram state
- **FR-026**: System SHALL provide syntax validation with line-level error messages
- **FR-027**: System SHALL debounce parsing during typing (500ms delay)

#### Real-Time Collaboration

- **FR-028**: System SHALL establish WebSocket connection per whiteboard
- **FR-029**: System SHALL broadcast table create/update/delete events
- **FR-030**: System SHALL broadcast relationship create/update/delete events
- **FR-031**: System SHALL broadcast table position changes during drag
- **FR-032**: System SHALL broadcast layout computation and results
- **FR-033**: System SHALL display connection status indicator
- **FR-034**: System SHALL handle reconnection with state synchronization

#### Project Organization

- **FR-035**: System SHALL support creating/reading/updating/deleting projects
- **FR-036**: System SHALL support nested folders within projects
- **FR-037**: System SHALL support creating whiteboards within projects or folders
- **FR-038**: System SHALL display hierarchical navigation tree

#### Theming

- **FR-039**: System SHALL support dark and light themes
- **FR-040**: System SHALL persist theme preference in localStorage
- **FR-041**: System SHALL apply theme to all UI components and canvas elements

### Non-Functional Requirements

#### Performance

- **NFR-001**: Canvas SHALL maintain 60 FPS during pan/zoom with up to 50 tables
- **NFR-002**: Initial page load SHALL complete within 3 seconds
- **NFR-003**: Auto-layout SHALL complete within 3 seconds for 30 tables
- **NFR-004**: Real-time updates SHALL appear within 1 second of change
- **NFR-005**: Position drag updates SHALL appear within 100ms to collaborators

#### Code Quality

- **NFR-006**: Codebase SHALL have zero Konva dependencies after rebuild
- **NFR-007**: Codebase SHALL have single rendering path (no feature flags for canvas)
- **NFR-008**: All components SHALL use TypeScript with strict mode
- **NFR-009**: Code SHALL pass eslint and prettier checks

#### Security

- **NFR-010**: All database queries SHALL use parameterized inputs
- **NFR-011**: All user inputs SHALL be validated with Zod schemas
- **NFR-012**: WebSocket connections SHALL authenticate user sessions

---

## Success Criteria

### Measurable Outcomes

1. **SC-001**: Application renders existing whiteboards correctly with zero visual regression
2. **SC-002**: Package dependencies reduced by removing konva, react-konva, d3-force (net reduction of ~3 packages)
3. **SC-003**: Route files reduced from 2 whiteboard routes to 1
4. **SC-004**: Total lines of code reduced by 30-40%
5. **SC-005**: All existing Vitest tests pass after rebuild
6. **SC-006**: Canvas maintains 60 FPS during zoom/pan with 50 tables
7. **SC-007**: WebSocket collaboration works across multiple clients

---

## Architecture Overview

### Technology Stack (Retained)

- **Framework**: TanStack Start (full-stack React with SSR)
- **Router**: TanStack React Router (file-based routing)
- **State**: TanStack Query for server state
- **Database**: PostgreSQL via Prisma
- **Real-time**: Socket.IO
- **Parser**: Chevrotain for DSL parsing
- **Canvas**: React Flow (@xyflow/react) - ONLY renderer
- **Layout**: ELK (elkjs) for automatic layout
- **UI**: shadcn/ui + TailwindCSS

### Components to Remove

1. `src/components/whiteboard/Canvas.tsx` - Konva canvas wrapper
2. `src/routes/whiteboard/$whiteboardId.tsx` - Konva-based route (merge into single route)
3. `src/lib/canvas/layout-engine.ts` - d3-force layout (use ELK only)
4. `src/lib/canvas/layout-worker.ts` - d3-force web worker
5. Feature flag `VITE_USE_REACT_FLOW` and all conditional logic

### Components to Simplify

1. `src/routes/whiteboard/$whiteboardId.new.tsx` -> `src/routes/whiteboard/$whiteboardId.tsx` (single route)
2. Merge `convert-to-nodes.ts`, `convert-to-edges.ts`, `converters.ts` into single `converters.ts`
3. Simplify `ReactFlowWhiteboard.tsx` and `ReactFlowCanvas.tsx` into cleaner structure

### New Directory Structure

```
src/
  routes/
    __root.tsx
    index.tsx
    whiteboard/
      $whiteboardId.tsx        # Single whiteboard route
    api/
      collaboration.ts
      columns.ts
      folders.ts
      projects.ts
      relationships.ts
      tables.ts
      whiteboards.ts
  components/
    layout/
      Header.tsx
      Sidebar.tsx
    navigator/
      ProjectTree.tsx
      FolderItem.tsx
      WhiteboardItem.tsx
    whiteboard/
      WhiteboardEditor.tsx     # Main editor component
      TableNode.tsx            # React Flow custom node
      RelationshipEdge.tsx     # React Flow custom edge
      CardinalityMarkers.tsx   # Edge marker components
      TextEditor.tsx           # DSL text editor
      Toolbar.tsx              # Canvas toolbar
    ui/                        # shadcn components
  lib/
    react-flow/
      converters.ts            # Single converter file
      elk-layout.ts            # ELK layout computation
      types.ts                 # React Flow type definitions
      hooks.ts                 # useAutoLayout, etc.
    parser/
      diagram-parser.ts        # Chevrotain parser
      ast.ts                   # AST type definitions
    utils.ts
  hooks/
    use-collaboration.ts       # WebSocket hook
    use-theme.tsx              # Theme hook
  data/
    schema.ts                  # Zod schemas
    tables.ts                  # Table data access
    columns.ts                 # Column data access
    relationships.ts           # Relationship data access
    projects.ts                # Project data access
    folders.ts                 # Folder data access
    whiteboards.ts             # Whiteboard data access
```

---

## Dependencies Analysis

### Current Dependencies to REMOVE

```json
{
  "konva": "^10.0.8",
  "react-konva": "^19.2.0",
  "d3-force": "^3.0.0",
  "@types/d3-force": "^3.0.10"
}
```

### Dependencies to KEEP

```json
{
  "@xyflow/react": "^12.9.2",
  "elkjs": "0.10.0",
  "chevrotain": "^11.0.3",
  "socket.io": "^4.8.1",
  "socket.io-client": "^4.8.1"
}
```

---

## Database Schema (Retained)

The existing Prisma schema is clean and does not require changes:

- **Project**: Container for whiteboards and folders
- **Folder**: Hierarchical organization within projects
- **Whiteboard**: Canvas containing tables and canvas state
- **DiagramTable**: Table entity with position (x, y)
- **Column**: Column within a table with data type and constraints
- **Relationship**: Connection between columns with cardinality
- **CollaborationSession**: Active WebSocket sessions

---

## Risks and Mitigations

| Risk                            | Impact | Mitigation                                      |
| ------------------------------- | ------ | ----------------------------------------------- |
| Regression in existing features | High   | Comprehensive test coverage before refactor     |
| Data migration issues           | Medium | Keep same database schema, only change UI layer |
| Performance degradation         | Medium | Benchmark before/after with 50-table diagram    |
| WebSocket compatibility         | Low    | Minimal changes to collaboration layer          |
| Theme styling differences       | Low    | Test both themes thoroughly                     |

---

## Out of Scope

- New feature development (focus is clean rebuild)
- Authentication/authorization (future feature)
- Database schema changes
- Mobile-specific optimizations
- Additional DSL syntax features
- Undo/redo functionality
- Export to SQL/other formats

---

## Implementation Phases

### Phase 1: Foundation (Remove Legacy)

- Remove Konva dependencies from package.json
- Delete Konva-specific files (Canvas.tsx, d3-force layout)
- Remove feature flag and conditional rendering

### Phase 2: Consolidate React Flow

- Merge two whiteboard routes into single route
- Consolidate converter files
- Simplify component hierarchy

### Phase 3: Clean Up

- Remove unused code and dead imports
- Update tests
- Verify all functionality
- Performance benchmarking

### Phase 4: Documentation

- Update CLAUDE.md with new architecture
- Update component documentation
- Create migration notes for developers

---

## Appendix: Files to Remove

```
src/components/whiteboard/Canvas.tsx (496 lines)
src/lib/canvas/layout-engine.ts (500 lines)
src/lib/canvas/layout-worker.ts (100 lines)
src/routes/whiteboard/$whiteboardId.tsx (740 lines - legacy Konva route)
src/components/whiteboard/Minimap.tsx (200 lines - replaced by React Flow minimap)
src/lib/react-flow/converters.ts (consolidate with others)
```

**Estimated Lines Removed**: ~2000+ lines
**Estimated Final Lines**: ~60% of current codebase

---

_This PRD was generated by Athena, the PM Agent, as part of the Kratos pipeline._
