# Implementation Plan: React Flow Migration

**Branch**: `002-react-flow-migration` | **Date**: 2025-11-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-react-flow-migration/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Migrate the ER diagram whiteboard rendering engine from Konva (canvas-based) with d3-force layout to React Flow (SVG/HTML-based flow diagram library). This migration replaces the custom Canvas component and layout engine while preserving all existing functionality: diagram rendering, zoom/pan navigation, manual table dragging, automatic layout, real-time collaboration, dark mode theming, and column-specific relationship connections.

Primary requirement: Replace Konva Stage/Layer/Shape rendering with React Flow nodes/edges while maintaining visual fidelity, performance (60 FPS for 50+ tables), and feature parity.

Technical approach: Implement custom React Flow node components for tables, custom edge components for relationships with cardinality notation, integrate layout algorithms with React Flow's positioning API, and update WebSocket collaboration to sync React Flow state.

## Technical Context

**Language/Version**: TypeScript 5.7, React 19.2
**Primary Dependencies**:

- Current: Konva 10.0.8, react-konva 19.2.0, d3-force 3.0.0
- Migration target: React Flow (reactflow or @xyflow/react) - version TBD in Phase 0 research
- Keep: TanStack Start 1.132, TanStack Router 1.132, TanStack Query 5.66, Socket.IO 4.8.1, Prisma 6.16.3

**Storage**: PostgreSQL via Prisma (existing schema for tables, columns, relationships, positions)
**Testing**: Vitest 4.0.4, @testing-library/react 16.2.0
**Target Platform**: Web browser (modern browsers with ES2022+ support)
**Project Type**: Web application (full-stack TanStack Start)
**Performance Goals**:

- 60 FPS during zoom/pan with 50+ table nodes
- Automatic layout computation under 3 seconds for 30 tables
- Real-time collaboration updates within 2 seconds

**Constraints**:

- Zero visual regressions from Konva implementation
- Bundle size within 10% of current size
- Column-specific relationship endpoints (custom handle positioning required)
- Preserve existing database schema (minimal changes only)

**Scale/Scope**:

- Support up to 100 tables per whiteboard
- Multiple concurrent users per whiteboard
- 7 user stories, 33 functional requirements

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

**Note**: No constitution file exists yet for this project. This is a migration feature focused on replacing a rendering library while maintaining existing architecture and functionality. Standard architectural principles apply:

- **Simplicity**: Use React Flow's built-in features where possible instead of custom implementations
- **Incremental Migration**: Ensure existing functionality continues working during migration
- **Performance**: Validate performance targets through testing
- **Type Safety**: Maintain full TypeScript coverage

No violations anticipated - this is a library replacement, not an architectural change.

## Project Structure

### Documentation (this feature)

```text
specs/002-react-flow-migration/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── react-flow-types.md
│   └── websocket-updates.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── components/
│   ├── ui/              # shadcn/ui components
│   ├── whiteboard/      # Canvas components - MIGRATION TARGET
│   │   ├── Canvas.tsx   # TO BE REPLACED: Konva Stage wrapper → React Flow wrapper
│   │   ├── TableNode.tsx   # TO BE CREATED: Custom React Flow node for tables
│   │   ├── RelationshipEdge.tsx  # TO BE CREATED: Custom React Flow edge for relationships
│   │   └── [other whiteboard components]
│   ├── navigator/       # Project/folder navigation (unchanged)
│   └── layout/          # App layout (unchanged)
├── routes/              # TanStack Router routes (minimal changes)
│   └── whiteboard/$whiteboardId.tsx  # Main whiteboard route - update Canvas usage
├── lib/
│   ├── canvas/          # Canvas utilities - MIGRATION TARGET
│   │   ├── layout-engine.ts  # TO BE ADAPTED: d3-force logic → React Flow compatible
│   │   ├── layout-worker.ts  # TO BE UPDATED: Output React Flow positions
│   │   └── [new React Flow utilities]
│   ├── parser/          # Diagram parser (update to output React Flow format)
│   └── [other libs]
├── hooks/               # React hooks (update Canvas-related hooks)
├── data/                # Data access layer (Prisma, unchanged schema)
└── styles.css           # Global styles (add React Flow theme styles)

tests/
├── unit/                # Component unit tests
│   └── whiteboard/      # Test new React Flow components
├── integration/         # Integration tests
│   └── whiteboard-rendering.test.tsx  # Test migration compatibility
└── [other tests]

prisma/
└── schema.prisma        # Database schema (unchanged)
```

**Structure Decision**:
This is a web application using TanStack Start. The migration targets the `src/components/whiteboard/` and `src/lib/canvas/` directories, where Konva-based rendering and d3-force layout are implemented. The rest of the application structure remains unchanged. Key files to modify:

- Replace: `src/components/whiteboard/Canvas.tsx`
- Create: `src/components/whiteboard/TableNode.tsx`, `src/components/whiteboard/RelationshipEdge.tsx`
- Adapt: `src/lib/canvas/layout-engine.ts` to output React Flow-compatible positions
- Update: `src/routes/whiteboard/$whiteboardId.tsx` to use new React Flow components

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

N/A - No constitution violations. This is a straightforward library migration.

## Phase 0: Research

See [research.md](./research.md) for detailed findings.

### Research Tasks

1. **React Flow library selection and versioning**
   - Evaluate `reactflow` vs `@xyflow/react` (newer package name)
   - Determine stable version compatible with React 19.2
   - Review TypeScript support and type definitions
   - Compare bundle size vs Konva + d3-force

2. **Custom node implementation patterns**
   - Best practices for complex custom nodes (tables with multiple rows)
   - Handle positioning for column-specific connection points
   - Node dimension calculation and auto-sizing
   - Styling approaches (CSS vs inline styles) for theme support

3. **Custom edge implementation patterns**
   - Custom edge components for relationship arrows
   - Cardinality notation rendering (crow's foot, one-to-one markers)
   - Edge label positioning and styling
   - Handle-to-handle connection configuration

4. **Layout algorithm integration**
   - Options for integrating custom layout algorithms (dagre, elkjs, custom force-directed)
   - How to preserve d3-force relationship strength calculations
   - Performance considerations for layout computation with React Flow
   - Animated transitions between layout positions

5. **State management and collaboration**
   - React Flow state management patterns (controlled vs uncontrolled)
   - Syncing React Flow state with external state (TanStack Query, WebSocket)
   - Optimizing re-renders for real-time collaboration
   - Handling concurrent node/edge updates

6. **Performance optimization**
   - React Flow rendering performance with 50-100 nodes
   - Virtual rendering or viewport culling capabilities
   - Edge routing performance with many connections
   - Comparison with Konva canvas rendering performance

7. **Migration strategy**
   - Incremental migration approach vs complete cutover
   - Data format conversion (Konva coordinates → React Flow positions)
   - Backward compatibility during migration period
   - Testing strategy for visual regression detection

## Phase 1: Design Artifacts

See detailed design in:

- [data-model.md](./data-model.md) - React Flow data structures
- [contracts/](./contracts/) - Component interfaces and WebSocket protocol
- [quickstart.md](./quickstart.md) - Developer setup guide

### Key Design Decisions

1. **React Flow Node Structure**

   ```typescript
   {
     id: string,              // table.id
     type: 'erTable',         // Custom node type
     position: { x, y },      // From table.positionX/Y
     data: {
       table: DiagramTable,
       columns: Column[],
       onUpdate: (updates) => void
     }
   }
   ```

2. **React Flow Edge Structure**

   ```typescript
   {
     id: string,              // relationship.id
     source: string,          // sourceTableId
     target: string,          // targetTableId
     sourceHandle: string,    // sourceColumnId
     targetHandle: string,    // targetColumnId
     type: 'erRelationship',  // Custom edge type
     data: {
       relationship: Relationship,
       cardinality: CardinalityType,
       label?: string
     }
   }
   ```

3. **Layout Algorithm Adapter**
   - Preserve existing d3-force logic for relationship strength calculation
   - Output positions compatible with React Flow's `{ x, y }` format
   - Support incremental updates (add/remove nodes) without full recalculation
   - Provide smooth animation using React Flow's animation utilities

4. **Component Architecture**
   - `ReactFlowCanvas`: Wrapper component replacing Konva Canvas
   - `TableNode`: Custom node component with column handles
   - `RelationshipEdge`: Custom edge with cardinality markers
   - `LayoutEngine`: Adapted layout computation
   - `useReactFlowSync`: Hook for WebSocket collaboration sync

## Phase 2: Task Breakdown

Task breakdown will be generated by the `/speckit.tasks` command and stored in [tasks.md](./tasks.md).

Expected task categories:

1. Setup and dependency management (add React Flow, remove Konva/d3-force)
2. Component implementation (TableNode, RelationshipEdge, ReactFlowCanvas)
3. Layout engine adaptation
4. WebSocket collaboration integration
5. Theme and styling
6. Testing and validation
7. Migration utilities and data conversion
8. Documentation and cleanup
