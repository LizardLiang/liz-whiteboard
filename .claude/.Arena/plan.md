## Strategic Plan — liz-whiteboard MCP Server

_Updated: 2026-05-10_

### MCP Server Plan

#### Context

liz-whiteboard is a collaborative ER diagram whiteboard built on TanStack Start, React Flow, Prisma/PostgreSQL, and Socket.IO. The auth-security-hardening pipeline has completed all 12 stages. The project is now in a stable, security-hardened state.

**Next objective:** A standalone Bun MCP (Model Context Protocol) server that gives AI agents (Claude Desktop, Claude Code CLI, Cursor) full programmatic CRUD access to ER diagrams, writing directly to the same PostgreSQL database the UI uses.

#### Architecture Overview

**Transport:** stdio — all three target clients use stdio as primary transport.
**Deployment:** Standalone Bun process (`bun run mcp`) talking to the same PostgreSQL DB.
**Auth (Phase 1):** Process-trust model — `LIZMCP_PROJECT_ID` env var scopes all operations.
**Auth (Phase 2, optional):** API-key model — long-lived tokens stored in DB.

#### MCP Tools

| Tool                  | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `list_boards`         | List all boards in a project                                                 |
| `get_board`           | Full board state: tables, columns, relationships, positions                  |
| `get_schema_summary`  | Compact text schema optimized for AI context windows (highest-leverage tool) |
| `create_table`        | Create table with name + position (x, y)                                     |
| `update_table`        | Rename or reposition a table                                                 |
| `delete_table`        | Delete table and cascade columns/relationships                               |
| `create_column`       | Add column: name, data type, nullable, isPrimary, isUnique                   |
| `update_column`       | Rename, retype, or change constraints                                        |
| `delete_column`       | Remove a column                                                              |
| `reorder_columns`     | Set column display order                                                     |
| `create_relationship` | Define FK relationship: source → target, relationship type                   |
| `update_relationship` | Change type or endpoints                                                     |
| `delete_relationship` | Remove a relationship                                                        |

#### MCP Build Phases

**Priority 1 — MCP Foundation + Read Tools** _(Low-Medium, gate: merge auth PR first)_

- `src/mcp/index.ts` — stdio server via `@modelcontextprotocol/sdk`
- `src/mcp/tools/read.ts` — `list_boards`, `get_board`, `get_schema_summary`
- `bun run mcp` script, Claude Desktop + Cursor config examples
- `LIZMCP_PROJECT_ID` env var for scoping
- Start: `/kratos:main "Build MCP server foundation: stdio transport via @modelcontextprotocol/sdk, read-only tools (list_boards, get_board, get_schema_summary), Bun entry point at src/mcp/index.ts, bun run mcp script, config examples for Claude Desktop and Cursor"`

**Priority 2 — Write Tools: Tables + Columns** _(Medium, depends on P1)_

- `src/mcp/tools/tables.ts` — create/update/delete table
- `src/mcp/tools/columns.ts` — create/update/delete/reorder columns
- Reuse 25 data types from `src/data/schema.ts` (do NOT duplicate)
- Structured MCP error responses (no raw Prisma errors)
- Start: `/kratos:main "Add MCP write tools for tables and columns: create/update/delete table, create/update/delete/reorder column, Zod validation, structured error responses"`

**Priority 3 — Write Tools: Relationships + Position** _(Medium, depends on P2)_

- `src/mcp/tools/relationships.ts` — create/update/delete relationship
- Position updates on tables
- Many-to-many type validation
- Start: `/kratos:main "Add MCP relationship and position tools: create/update/delete relationship with type validation, table position updates"`

**Priority 4 — Socket.IO Bridge** _(Medium-High, optional)_

- Emit matching Socket.IO events after each write so live whiteboard users see AI changes
- Event contracts: `specs/001-collaborative-er-whiteboard/contracts/websocket-events.md`
- Start: `/kratos:main "MCP Socket.IO bridge: after each write tool succeeds, emit the corresponding Socket.IO event so live whiteboard users see AI changes in real time"`

**Priority 5 — API-Key Auth** _(Defer — only if multi-user needed)_

#### MCP Sequencing

```
merge auth PR → P1 (read tools) → P2 (tables/columns) → P3 (relationships) → P4 (Socket.IO bridge) → collaboration polish
```

#### MCP Risks

- **Merge auth PR first** — MCP imports Prisma/Zod from that branch
- **Data type enum coupling** — import from `src/data/schema.ts`, never duplicate
- **stdio = one client at a time** — each AI client spawns its own process (correct behavior)
- **AI writes are irreversible** — no undo layer in scope

---

## Previous Plan (Stabilization Sprint — largely complete)

### Context

liz-whiteboard is a collaborative ER diagram whiteboard built on TanStack Start, React Flow, Prisma, and Socket.IO. Six features have shipped (dynamic field management, table field deletion, example ecommerce schema, column reorder, auto layout, account authentication), but a dogfood session uncovered 7 bugs (3 HIGH) and PR #97 (auth) still carries 5 unresolved security vulnerabilities. The user has chosen a full stabilization sprint before any new feature work.

**Last updated:** 2026-05-09 (post-dogfood v0.2.2)

### In-Flight (Already Being Built)

- No features are currently in active implementation. All six completed features have reached pipeline stage 12 (review-fixes complete). PR #97 (auth) is open but unmerged with known bugs.

### Recommended Build Order

#### Priority 1: Auth Security Hardening (PR #97 Bugs)

- **Why now**: A hardcoded superpassword bypass works in production, two IDOR vulnerabilities expose data across project boundaries, the session-expired modal never fires, and several server functions skip RBAC entirely. These are security holes in code that is about to merge.
- **Complexity**: Medium
- **Depends on**: Nothing (can run in parallel with P2 and P3)
- **Scope**: Remove superpassword bypass, add whiteboard ownership check to column:create WebSocket handler, fix batch column RBAC to check all items, wire session_expired event to triggerSessionExpired(), add findEffectiveRole/hasMinimumRole to all server functions in server-functions.ts
- **Start**: `/kratos:main "Fix 5 auth security bugs in PR #97: remove superpassword bypass, add whiteboard ownership check to column:create WebSocket handler, fix batch column RBAC to check all items, wire session_expired event to triggerSessionExpired(), add findEffectiveRole/hasMinimumRole to all server functions in server-functions.ts"`

#### Priority 2: React Flow Handle Architecture Rework + Edge Visibility Fix

- **Why now**: ISSUE-002 (invisible edges) and ISSUE-004 (Add Column opens wrong dialog) are both symptoms of the same root cause — the handle ID format `{tableId}__{columnId}__{side}` is fragile, creates phantom handles for empty tables, and breaks when column UUIDs change. Fixing this also resolves the accessibility tree pollution (9 fake "Add new column" buttons on empty tables).
- **Complexity**: High
- **Depends on**: Nothing (can run in parallel with P1 and P3)
- **Scope**: Decouple connection handles from column UUIDs, fix invisible edges caused by stale handle references, fix Add Column button routing to wrong dialog on empty tables, add regression tests for edge visibility and handle-to-column mapping
- **Start**: `/kratos:main "Rearchitect React Flow handle ID system: decouple connection handles from column UUIDs, fix invisible edges caused by stale handle references, fix Add Column button routing to wrong dialog on empty tables, add regression tests for edge visibility and handle-to-column mapping"`

#### Priority 3: Unified Dev Server + Devtools Conditional Rendering

- **Why now**: ISSUE-001 (Socket.IO not running with `bun run dev`) means every developer hits a broken real-time experience on first launch. ISSUE-006 (TanStack Devtools exposed to all users) is a quick win. Both are DX issues that compound into wasted time on every session.
- **Complexity**: Low
- **Depends on**: Nothing (can run in parallel with P1 and P2)
- **Scope**: Make `bun run dev` also start the Socket.IO server (single command), conditionally render TanStack Router/Query devtools only in development mode
- **Start**: `/kratos:main "Unify dev startup: make bun run dev also start Socket.IO server (single command), and conditionally render TanStack Router/Query devtools only in development mode"`

#### Priority 4: Remaining Dogfood Bug Fixes (Medium + Low)

- **Why now**: After the three HIGH bugs and DX issues are resolved, clean up the remaining dogfood findings: Auto Layout skipping confirmation dialog (ISSUE-005), self-referencing edge data artifact in ecommerce schema (ISSUE-003), and dismissable disconnected banner (ISSUE-007).
- **Complexity**: Low
- **Depends on**: P3 should land first (the disconnected banner fix is more meaningful once Socket.IO actually starts)
- **Scope**: Wire AutoLayoutConfirmDialog to Auto Layout button, clean up self-referencing relationship in ecommerce seed data and add validation guard, add dismiss button to disconnected banner
- **Start**: `/kratos:main "Fix 3 remaining dogfood bugs: wire AutoLayoutConfirmDialog to Auto Layout button, clean up self-referencing relationship in ecommerce seed data and add validation guard, add dismiss button to disconnected banner"`

#### Priority 5: Collaboration Polish

- **Why now**: User's chosen next feature direction. With stabilization complete, the auth system merged, edge routing reliable, and Socket.IO startup unified, the foundation is solid for real-time collaboration polish.
- **Complexity**: High
- **Depends on**: Priorities 1–4 all merged (auth identity must be reliable, Socket.IO must start cleanly, edge rendering must be trustworthy for concurrent edits)
- **Scope**: Presence cursors showing other users' positions on canvas, live user indicator list in toolbar, conflict resolution UX for concurrent table/column edits
- **Start**: `/kratos:main "Collaboration polish: presence cursors showing other users' positions on canvas, live user indicator list in toolbar, conflict resolution UX for concurrent table/column edits"`

### What to Defer

- **User groups / team management**: Auth PRD explicitly deferred groups. Adds complexity without immediate value until there are multiple real users.
- **Undo/redo system**: Large architectural investment. The AutoLayoutConfirmDialog (Priority 4) is the right guard for now.
- **Production deployment hardening**: Prisma Accelerate blocks DDL and auth migration needs manual execution. Address after the app itself is stable.
- **Test environment fix (166 failing tests)**: Pre-existing jsdom baseline issue, not a regression. Does not block any feature work; 119 passing tests provide adequate coverage.

### Strategic Note

**P1, P2, and P3 have no dependencies on each other — run all three in parallel on separate branches for the fastest stabilization sprint.** The critical sequencing constraint is that Priority 5 (collaboration polish) must wait for all stabilization work to merge, because presence cursors depend on auth identity, reliable Socket.IO startup, and correct edge rendering. Watch the handle rearchitecture (Priority 2) closely — it touches the deepest layer of the React Flow integration and has the highest regression risk, which is exactly why regression tests are mandatory alongside it.
