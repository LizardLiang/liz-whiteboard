# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Rules

**Package Manager**: Use **Bun** exclusively. Never use npm, npx, yarn, or pnpm.

```bash
bun install              # Install dependencies
bun add <package>        # Add dependency
bun run <script>         # Run script
bunx shadcn@latest add <component>  # Add shadcn component
```

**UI Framework**: Use **shadcn/ui + TailwindCSS** only. No other UI libraries (Material-UI, Ant Design, react-resizable-panels, etc.).

**Environment**: Variables are in `.env.local` (NOT `.env`).

## Common Commands

```bash
bun run dev              # Development server (port 3000)
bun run build            # Production build
bun run test             # Run Vitest tests
bun run check            # Format + lint with auto-fix

# Database (Prisma)
bun run db:generate      # Generate Prisma client
bun run db:push          # Push schema changes
bun run db:migrate       # Create migration
bun run db:studio        # Open Prisma Studio
bun run db:seed          # Seed database
```

## Architecture Overview

### Application Type

Collaborative ER diagram whiteboard with real-time multi-user editing. Users define database schemas visually (drag tables, draw relationships) or via text syntax (Mermaid-like DSL).

### Tech Stack

- **Framework**: TanStack Start (full-stack React with SSR)
- **Router**: TanStack React Router (file-based routing in `src/routes/`)
- **State**: TanStack Query for server state
- **Database**: PostgreSQL via Prisma (`prisma/schema.prisma`)
- **Canvas**: React Flow (`@xyflow/react`) for diagram rendering
- **Real-time**: Socket.IO for collaboration
- **Parser**: Chevrotain for text syntax parsing
- **Layout**: ELK (elkjs) for automatic diagram layout

### Key Data Flow

```
Text Editor (DSL)  <-->  Chevrotain Parser  <-->  AST
                              |
                              v
                    Prisma Database (Tables, Columns, Relationships)
                              |
                              v
                    React Flow (Nodes, Edges)
                              |
                              v
                    WebSocket (Real-time sync)
```

### Directory Structure

```
src/
├── routes/              # TanStack Router pages + API routes
│   ├── api/            # Server functions (createServerFn)
│   └── whiteboard/     # Whiteboard editor pages
├── components/
│   ├── ui/             # shadcn/ui components
│   └── whiteboard/     # React Flow canvas, TableNode, RelationshipEdge
├── lib/
│   ├── react-flow/     # Node/edge converters, ELK layout, types
│   ├── parser/         # Chevrotain lexer/parser for DSL
│   └── server-functions.ts
├── data/               # Prisma data access + Zod schemas
└── hooks/              # Collaboration hooks, auto-layout

specs/                   # Feature specifications (spec.md, tasks.md, plan.md)
prisma/schema.prisma     # Database schema
```

### Core Patterns

**Server Functions**: Use `createServerFn` from `@tanstack/react-start` for server-side operations:

```typescript
export const myServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: MyType) => data)
  .handler(async ({ data }) => {
    /* ... */
  })
```

**Validation**: All inputs use Zod schemas defined in `src/data/schema.ts`.

**React Flow Integration**:

- Tables → Custom `TableNode` components with column-level handles
- Relationships → Custom `RelationshipEdge` with cardinality markers
- Positions stored in DB, converted to React Flow format via `src/lib/react-flow/converters.ts`

**Real-time Collaboration**:

- WebSocket events defined in `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md`
- `useCollaboration` hook for WebSocket connection
- `useWhiteboardCollaboration` for React Flow-specific updates

**Auto-layout**:

- ELK hierarchical layout algorithm via `elkjs`
- `useAutoLayout` hook for triggering layout computation
- Layout computed client-side and positions batch-updated to database

## Tool Usage

Prefer `rg` (ripgrep) for content search and `fd` for file search:

```bash
rg "search_term"        # Search file contents
fd "filename_pattern"   # Search by filename
rg -l "pattern"         # List files containing pattern
```

## Troubleshooting

- **Prisma client missing**: `bun run db:generate`
- **Database out of sync**: `bun run db:push`
- **shadcn import fails**: `bunx shadcn@latest add <component-name>`
