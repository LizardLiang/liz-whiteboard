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
- **Database**: SQLite, raw SQL — no ORM, no migration runner. `bun:sqlite` under Bun in
  production, `node:sqlite` under Node in dev/tooling. The schema is a hand-written SQL string
  (`src/data/schema-sql.ts`) applied idempotently with `CREATE TABLE IF NOT EXISTS` at boot
  (`src/db.ts`) — a new table needs no migration, and re-running the schema on an existing
  database file is always safe.
- **Validation**: Zod 4.1
- **UI**: shadcn/ui + TailwindCSS 4.0
- **Canvas**: React Flow (@xyflow/react)
- **Real-time**: Socket.IO
- **Parser**: Chevrotain
- **Layout**: d3-force

## Project Structure

```
src/
├── components/       # React components
│   ├── ui/          # shadcn/ui components
│   ├── whiteboard/  # Canvas components (React Flow-based)
│   ├── navigator/   # Project/folder navigation
│   └── layout/      # App layout
├── routes/          # TanStack Router routes
├── lib/             # Utilities and business logic
├── hooks/           # React hooks
├── data/            # Data access layer (raw SQL over bun:sqlite/node:sqlite, no ORM)
└── styles.css       # Global styles

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
# There is no db:push/db:generate/db:migrate/db:studio — no ORM, no migration runner.
# The schema (src/data/schema-sql.ts) applies itself via CREATE TABLE IF NOT EXISTS at
# boot (src/db.ts). To reset a dev database, delete the SQLite file and restart the server.
bun run db:seed      # Seed database (scripted inserts, not an ORM seed)

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
5. **Ship an e2e test** (REQUIRED): Every completed feature MUST leave a Playwright end-to-end script — see "E2E Test Requirement" below. A feature is not "done" without it.
6. **Mark tasks complete**: Update `tasks.md` with [X] when done

## E2E Test Requirement (MANDATORY per feature)

**Every feature accomplished in this project MUST leave a Playwright e2e test script.** This is a completion gate, not optional — do not report a feature done until its e2e exists and passes.

- **Framework**: Playwright (`@playwright/test`). Run with `bun run test:e2e`.
- **Location**: put specs under `e2e/` — one `e2e/<feature>.spec.ts` per feature.
- **Pattern to mirror** (reference implementation): `e2e/version-history.spec.ts`, with shared setup in `e2e/global-setup.ts` (seeds via Bun, logs in → `storageState`), fixed test data in `e2e/seed.ts` + `e2e/fixtures.ts`, and config in `playwright.config.ts`.
- **Auth**: reuse the storageState session from `global-setup` (real login form); don't hand-inject cookies.
- **Seeding**: Playwright's runner is Node (no `bun:sqlite`) — seed by shelling out to `bun run e2e/seed.ts`; enable `PRAGMA foreign_keys = ON` on any raw seed connection.
- **Assert real behavior**: drive the actual UI flow end-to-end (not just the happy path). If a behavior only works in the single-process prod build (e.g. Socket.IO broadcasts — `io` is null in the dev Vite process), assert the persisted result via reload and note the prod/dev split in a comment.
- **Viewport**: use ≥1600px wide; some toolbar actions sit in the right overflow and are off-screen at narrower widths.

## Important Notes

- Environment variables are in `.env.local` (NOT `.env`)
- Database schema is a hand-written SQL string in `src/data/schema-sql.ts`, applied at boot by
  `src/db.ts` via `CREATE TABLE IF NOT EXISTS` — there is no ORM and no migration runner. Add a
  new entity as a new `CREATE TABLE IF NOT EXISTS` block; it needs no migration.
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
| Add/modify a table     | Edit `src/data/schema-sql.ts`, restart the server |

## Troubleshooting

- If a schema change didn't take effect: restart the server — `CREATE TABLE IF NOT EXISTS` in
  `src/data/schema-sql.ts` only adds new tables/indexes on boot; it does not alter existing
  columns. There is no `db:generate`/`db:push` step because there is no ORM.
- If shadcn component import fails: `bunx shadcn@latest add <component-name>`
- If TypeScript errors: Check `tsconfig.json` paths are correct

## Tool usage

"When searching for content within files, use rg (ripgrep) instead of grep. When searching for files by name or path, use fd instead of find. These tools are faster and more efficient. For example:

Use rg "search_term" to search file contents
Use fd "filename_pattern" to search for files by name
Use rg -l "pattern" to list files containing a pattern
Use fd -e py to find all Python files"

---

**Last Updated**: 2025-10-28

## Active Technologies

- TypeScript 5.7, React 19.2 (002-react-flow-migration)
- SQLite via raw SQL, no ORM (existing schema for tables, columns, relationships, positions) (002-react-flow-migration)
- SQLite via raw SQL, no ORM (existing schema preserved) (003-react-flow-migration)

## Recent Changes

- 002-react-flow-migration: Added TypeScript 5.7, React 19.2
