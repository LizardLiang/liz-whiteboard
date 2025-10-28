# Claude Code Instructions for liz-whiteboard

## Package Manager

**CRITICAL**: This project uses **Bun** as the package manager, NOT npm or yarn.

- ✅ Use `bun install` to install dependencies
- ✅ Use `bun add <package>` to add dependencies
- ✅ Use `bun run <script>` to run scripts
- ✅ Use `bunx shadcn@latest add <component>` to add shadcn/ui components
- ❌ DO NOT use `npm`, `npx`, `yarn`, or `pnpm`

## UI Framework

**CRITICAL**: This project uses **ONLY shadcn/ui and TailwindCSS** for UI.

- ✅ Use shadcn/ui components (installed via `bunx shadcn@latest add <component>`)
- ✅ Use TailwindCSS for styling
- ✅ Use plain React/HTML if shadcn doesn't have the component
- ❌ DO NOT use any other UI libraries (react-resizable-panels, Material-UI, Ant Design, etc.)

## Tech Stack

- **Runtime**: Bun
- **Framework**: TanStack Start 1.132 (full-stack React framework)
- **Router**: TanStack React Router 1.132
- **State Management**: TanStack Query 5.66
- **Database**: PostgreSQL via Prisma 6.16
- **Validation**: Zod 4.1
- **UI**: shadcn/ui + TailwindCSS 4.0
- **Canvas**: Konva + react-konva
- **Real-time**: Socket.IO
- **Parser**: Chevrotain
- **Layout**: d3-force

## Project Structure

```
src/
├── components/       # React components
│   ├── ui/          # shadcn/ui components
│   ├── whiteboard/  # Canvas components (Konva-based)
│   ├── navigator/   # Project/folder navigation
│   └── layout/      # App layout
├── routes/          # TanStack Router routes
├── lib/             # Utilities and business logic
├── hooks/           # React hooks
├── data/            # Data access layer (Prisma)
└── styles.css       # Global styles

prisma/
└── schema.prisma    # Database schema

specs/001-collaborative-er-whiteboard/
├── spec.md          # Feature specification
├── plan.md          # Implementation plan
├── tasks.md         # Task breakdown
├── data-model.md    # Database schema
├── contracts/       # API/WebSocket contracts
└── research.md      # Technical decisions
```

## Common Commands

```bash
# Install dependencies
bun install

# Development server
bun run dev

# Database operations
bun run db:push      # Push schema changes
bun run db:generate  # Generate Prisma client
bun run db:migrate   # Create migration
bun run db:studio    # Open Prisma Studio
bun run db:seed      # Seed database

# Code quality
bun run lint         # Run ESLint
bun run format       # Run Prettier
bun run check        # Format + lint with auto-fix

# Testing
bun run test         # Run tests

# Build
bun run build        # Production build
bun run serve        # Preview production build

# Add shadcn/ui components
bunx shadcn@latest add <component-name>
```

## Development Workflow

1. **Read specification first**: Check `specs/001-collaborative-er-whiteboard/` for context
2. **Follow task list**: Reference `specs/001-collaborative-er-whiteboard/tasks.md`
3. **Use server functions**: TanStack Start server functions (not REST API)
4. **Validate with Zod**: All inputs must use Zod schemas from `src/data/schema.ts`
5. **Mark tasks complete**: Update `tasks.md` with [X] when done

## Important Notes

- Environment variables are in `.env.local` (NOT `.env`)
- Database schema is in `prisma/schema.prisma`
- Server functions use `createServerFn` from `@tanstack/react-start`
- WebSocket events follow patterns in `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md`
- All UI must be accessible and responsive
- Support dark mode (User Story 7)

## Git Repository

This is a git repository. Use standard git commands for version control:

- `.gitignore` is already configured
- Commit frequently with descriptive messages
- Branch: `master` (main branch)

## Quick Reference

| Task                   | Command                              |
| ---------------------- | ------------------------------------ |
| Install package        | `bun add <package>`                  |
| Install dev package    | `bun add -d <package>`               |
| Add shadcn component   | `bunx shadcn@latest add <component>` |
| Run dev server         | `bun run dev`                        |
| Push database schema   | `bun run db:push`                    |
| Generate Prisma client | `bun run db:generate`                |

## Troubleshooting

- If Prisma client is missing: `bun run db:generate`
- If database is out of sync: `bun run db:push`
- If shadcn component import fails: `bunx shadcn@latest add <component-name>`
- If TypeScript errors: Check `tsconfig.json` paths are correct

---

**Last Updated**: 2025-10-28
