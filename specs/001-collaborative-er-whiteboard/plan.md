# Implementation Plan: Collaborative ER Diagram Whiteboard

**Branch**: `001-collaborative-er-whiteboard` | **Date**: 2025-10-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-collaborative-er-whiteboard/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Build a collaborative whiteboard application for creating and editing ER diagrams with real-time multi-user support. Core features include visual table/relationship creation, text-based diagram syntax (Mermaid.js-like), automatic graph layout, hierarchical organization (projects/folders), and canvas navigation (zoom/pan). The application uses TanStack Start (React SSR framework) with Prisma ORM and PostgreSQL for persistence, HTML5 Canvas for rendering, and WebSocket for real-time collaboration.

## Technical Context

**Language/Version**: TypeScript 5.7+ (from package.json), React 19.2
**Primary Dependencies**: TanStack Start 1.132, TanStack React Router 1.132, TanStack React Query 5.66, Prisma 6.16, PostgreSQL (via pg 8.11), Zod 4.1, shadcn/ui (with TailwindCSS 4.0), Vite 7.1
**Storage**: PostgreSQL (via Prisma ORM) for whiteboard data, projects, folders, tables, relationships, user sessions
**Testing**: Vitest 3.0, Testing Library (React 16.2, DOM 10.4), jsdom 27.0
**Target Platform**: Web browsers (modern browsers with HTML5 Canvas, WebSocket support), Node.js server (TanStack Start SSR)
**Project Type**: Full-stack web application (TanStack Start unified structure)
**Performance Goals**: 60 FPS canvas rendering for diagrams up to 50 tables, <500ms text-to-diagram rendering, <2s real-time collaboration sync, <3s automatic layout computation (30 tables)
**Constraints**: <200ms API response time (p95), real-time WebSocket latency <100ms, support concurrent editing by 10+ users per whiteboard
**Scale/Scope**: Support 100+ whiteboards per project, 50+ tables per diagram, 3-level deep folder hierarchy, NEEDS CLARIFICATION: WebSocket/real-time sync strategy, NEEDS CLARIFICATION: Canvas rendering library choice, NEEDS CLARIFICATION: Graph layout algorithm selection

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

**Status**: ✅ PASS (No constitution file exists - using standard web application best practices)

Since no project-specific constitution exists, we apply general best practices:

- Modular component architecture (React components, hooks, services)
- Type safety (TypeScript + Zod validation)
- Test coverage for critical paths (canvas rendering, collaboration, data persistence)
- Performance monitoring for canvas operations
- Database migrations via Prisma

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

**Structure Decision**: TanStack Start unified full-stack structure - frontend and backend code coexist in `src/` with routing, components, and server functions integrated through TanStack Router.

```text
src/
├── components/                  # Existing - React components
│   ├── ui/                     # shadcn/ui components (existing)
│   ├── whiteboard/             # NEW: Whiteboard canvas components
│   │   ├── Canvas.tsx          # Main canvas wrapper
│   │   ├── TableNode.tsx       # ER diagram table visual
│   │   ├── RelationshipEdge.tsx # Arrows between tables
│   │   ├── Toolbar.tsx         # Canvas controls (zoom, pan, layout)
│   │   └── TextEditor.tsx      # Diagram text syntax editor
│   ├── navigator/              # NEW: Project/folder tree navigation
│   │   ├── ProjectTree.tsx
│   │   ├── FolderItem.tsx
│   │   └── WhiteboardItem.tsx
│   └── layout/                 # NEW: App layout components
│       ├── Sidebar.tsx
│       └── Header.tsx
├── routes/                      # Existing - TanStack Router routes
│   ├── __root.tsx              # Root layout
│   ├── index.tsx               # Home/dashboard
│   ├── whiteboard/             # NEW: Whiteboard routes
│   │   ├── $whiteboardId.tsx   # Whiteboard editor page
│   │   └── new.tsx             # Create whiteboard
│   └── api/                    # NEW: API route handlers (TanStack Start server functions)
│       ├── whiteboards.ts      # CRUD for whiteboards
│       ├── projects.ts         # Project/folder management
│       ├── collaboration.ts    # WebSocket handlers
│       └── layout.ts           # Auto-layout computation
├── lib/                         # Existing - Utilities
│   ├── canvas/                 # NEW: Canvas rendering logic
│   │   ├── renderer.ts         # Canvas drawing primitives
│   │   ├── layout-engine.ts    # Graph layout algorithms
│   │   └── zoom-pan.ts         # Viewport transformation
│   ├── parser/                 # NEW: Text syntax parser
│   │   ├── diagram-parser.ts   # Parse Mermaid-like syntax
│   │   └── ast.ts              # Diagram AST types
│   ├── collaboration/          # NEW: Real-time sync
│   │   ├── websocket.ts        # WebSocket client
│   │   └── crdt.ts             # Conflict-free data structures
│   └── utils.ts                # Existing utilities
├── hooks/                       # Existing - React hooks
│   ├── use-canvas.ts           # NEW: Canvas state management
│   ├── use-diagram.ts          # NEW: Diagram data hooks
│   ├── use-collaboration.ts    # NEW: Real-time collaboration
│   └── use-theme.ts            # NEW: Dark mode support
├── data/                        # Existing - Data access layer
│   ├── whiteboard.ts           # NEW: Whiteboard queries/mutations
│   ├── project.ts              # NEW: Project/folder operations
│   └── schema.ts               # NEW: Zod schemas for validation
├── db.ts                        # Existing - Prisma client
├── router.tsx                   # Existing - Router config
└── styles.css                   # Existing - Global styles

prisma/
└── schema.prisma               # Database schema (extend existing)

tests/                          # NEW: Test files
├── unit/
│   ├── parser/                 # Text parser tests
│   ├── layout/                 # Layout algorithm tests
│   └── components/             # Component tests
└── integration/
    ├── whiteboard.test.ts      # End-to-end whiteboard tests
    └── collaboration.test.ts   # Multi-user collaboration tests
```

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

N/A - No constitution violations. Standard React full-stack application architecture.
