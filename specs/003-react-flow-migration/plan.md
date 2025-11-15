# Implementation Plan: React Flow Whiteboard Migration

**Branch**: `003-react-flow-migration` | **Date**: 2025-11-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-react-flow-migration/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Migrate the collaborative ERD whiteboard from Konva-based canvas rendering to React Flow-based declarative components. This migration will improve maintainability, performance, and developer experience by leveraging React Flow's built-in features (pan, zoom, edge routing) and integrating the ELK (Eclipse Layout Kernel) algorithm for automatic hierarchical layout generation. The existing database schema, real-time collaboration infrastructure (WebSocket), and data persistence will remain unchanged.

**Primary Requirement**: Replace Konva Stage/Layer/Shape imperative rendering with React Flow's declarative node/edge architecture while preserving all existing functionality (manual positioning, real-time collaboration, highlighting, cardinality markers).

**Technical Approach**: Implement custom React Flow nodes for tables and custom edges for relationships, integrate ELK.js for auto-layout, reuse existing TanStack Query data fetching and WebSocket collaboration, migrate Konva event handlers to React Flow callbacks.

## Technical Context

**Language/Version**: TypeScript 5.7, React 19.2
**Primary Dependencies**:
- @xyflow/react 12.9.2 (already installed)
- elkjs 0.10.0 (to be added)
- TanStack Start 1.132 (existing)
- TanStack Query 5.66 (existing)
- Prisma 6.16 (existing)
- Socket.IO (existing for WebSocket)

**Storage**: PostgreSQL via Prisma (existing schema preserved)
**Testing**: Vitest (existing test infrastructure)
**Target Platform**: Modern web browsers (Chrome, Firefox, Safari, Edge) with WebSocket support
**Project Type**: Web application (TanStack Start full-stack React framework)
**Performance Goals**:
- 60 FPS canvas rendering with 100+ tables
- <2 seconds initial render for 50 tables
- <100ms highlight response on table click
- <3 seconds auto-layout computation for 50 tables

**Constraints**:
- Must preserve existing database schema (DiagramTable, Column, Relationship models)
- Must maintain backward compatibility with saved positions (positionX, positionY)
- Must integrate with existing WebSocket collaboration infrastructure
- Cannot break existing text-based ERD parser and diagram creation flow
- Desktop browser focus (mobile optimization out of scope)

**Scale/Scope**:
- Support 100+ tables per whiteboard
- Handle 100+ concurrent collaborative users
- Maintain smooth performance for diagrams with 200+ relationships

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: N/A - No constitution file has been configured for this project yet.

The project uses a placeholder constitution template. Since this is a migration of existing functionality rather than a new feature with novel patterns, and the constitution hasn't been ratified with project-specific principles, we proceed with standard best practices:

- Maintain existing test coverage during migration
- Follow existing code organization patterns
- Preserve backward compatibility with saved data
- Document breaking changes (if any) in migration guide

**Post-Design Re-check**: Will verify that the migration maintains the same external contracts (database schema, API endpoints, WebSocket events) as the current implementation.

## Project Structure

### Documentation (this feature)

```text
specs/003-react-flow-migration/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── websocket-events.md
│   └── react-flow-types.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── components/
│   ├── whiteboard/
│   │   ├── Canvas.tsx                    # DEPRECATED: Konva Stage wrapper (remove after migration)
│   │   ├── TableNode.tsx                 # DEPRECATED: Konva table rendering (remove after migration)
│   │   ├── RelationshipEdge.tsx          # DEPRECATED: Konva relationship line (remove after migration)
│   │   ├── ReactFlowCanvas.tsx           # NEW: React Flow wrapper component
│   │   ├── TableNode.new.tsx             # RENAME TO: TableNode.tsx (React Flow custom node)
│   │   ├── RelationshipEdge.new.tsx      # RENAME TO: RelationshipEdge.tsx (React Flow custom edge)
│   │   ├── cardinality-markers.tsx       # KEEP: SVG marker definitions (compatible with React Flow)
│   │   ├── Toolbar.tsx                   # UPDATE: Integrate React Flow controls
│   │   └── Minimap.tsx                   # UPDATE: Migrate to React Flow <MiniMap /> component
│   ├── layout/
│   │   └── Header.tsx                    # KEEP: No changes needed
│   └── navigator/
│       └── ...                           # KEEP: No changes needed
├── lib/
│   ├── canvas/
│   │   ├── layout-engine.ts              # DEPRECATED: d3-force layout (remove after migration)
│   │   └── layout-worker.ts              # DEPRECATED: Web Worker for d3-force (remove after migration)
│   ├── react-flow/                       # NEW: React Flow utilities
│   │   ├── convert-to-nodes.ts           # Convert DiagramTable[] to React Flow Node[]
│   │   ├── convert-to-edges.ts           # Convert Relationship[] to React Flow Edge[]
│   │   ├── elk-layout.ts                 # ELK.js integration for auto-layout
│   │   ├── highlighting.ts               # Node/edge highlighting logic
│   │   └── node-types.ts                 # Node/edge type registry
│   ├── parser/
│   │   └── diagram-parser.ts             # KEEP: Text-based ERD parser (no changes)
│   └── ...
├── routes/
│   └── whiteboard/
│       └── $whiteboardId.tsx             # UPDATE: Replace Canvas with ReactFlowCanvas
├── data/                                  # KEEP: Prisma data access layer (no changes)
└── hooks/                                 # KEEP: Existing hooks (no changes)

tests/
├── unit/
│   ├── react-flow/                       # NEW: Unit tests for React Flow utilities
│   │   ├── convert-to-nodes.test.ts
│   │   ├── convert-to-edges.test.ts
│   │   ├── elk-layout.test.ts
│   │   └── highlighting.test.ts
│   └── ...
├── integration/
│   └── whiteboard-migration.test.ts      # NEW: Integration test for migration compatibility
└── ...

prisma/
└── schema.prisma                         # KEEP: No changes to database schema
```

**Structure Decision**: Web application structure maintained. The migration adds new React Flow-specific utilities under `src/lib/react-flow/` while deprecating Konva-specific files in `src/components/whiteboard/` and `src/lib/canvas/`. The existing TanStack Start routes, Prisma data layer, and component structure remain unchanged.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

N/A - No constitution violations. This is a technology migration within the existing architecture.
