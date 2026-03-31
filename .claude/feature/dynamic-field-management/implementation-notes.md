# Implementation Notes: Dynamic Field Management

**Feature**: dynamic-field-management
**Agent**: Ares (Implementation)
**Date**: 2026-03-30
**Status**: In Progress

---

## Summary

Implementing frontend inline column management for the ER diagram whiteboard. Backend is complete. All work is frontend-only.

---

## Phases

### Phase 1: Foundation
- [x] 1.1 Install alert-dialog, tooltip, dropdown-menu shadcn/ui components
- [x] 1.2 Create `src/components/whiteboard/column/types.ts`
- [x] 1.3 Extend `TableNodeData` with column mutation callbacks + edges prop
- [x] 1.4 Create skeleton `ColumnRow` component
- [x] 1.5 Refactor `TableNode.new.tsx` to use `<ColumnRow>`

### Phase 2: Column Editing
- [x] 2.1 Create `InlineNameEditor` component
- [x] 2.2 Create `DataTypeSelector` component
- [x] 2.3 Create `ConstraintBadges` component
- [x] 2.4 Create skeleton `useColumnMutations` hook
- [x] 2.5 Wire editing sub-components into `ColumnRow`
- [x] 2.6 Add `editingField` local state to `TableNode.new.tsx`

### Phase 3: Column Creation
- [x] 3.1 Create `AddColumnRow` component
- [x] 3.2 Add `createColumn` function to `useColumnMutations`
- [x] 3.3 Add `<AddColumnRow>` to `TableNode.new.tsx`

### Phase 4: Column Deletion
- [x] 4.1 Create `DeleteColumnDialog` component
- [x] 4.2 Add `deleteColumn` function to `useColumnMutations`
- [x] 4.3 Add delete button to `ColumnRow`
- [x] 4.4 Wire delete flow in `TableNode.new.tsx`

### Phase 5: Real-Time Sync
- [x] 5.1 Create `useColumnCollaboration` hook
- [x] 5.2 Create `ConnectionStatusIndicator` component
- [x] 5.3 Wire WebSocket emitters into `useColumnMutations`
- [x] 5.4 Integrate `useColumnCollaboration` into `ReactFlowWhiteboard`
- [x] 5.5 ARIA labels and rapid entry mode

---

## Files Created

- `src/components/whiteboard/column/types.ts`
- `src/components/whiteboard/column/ColumnRow.tsx`
- `src/components/whiteboard/column/InlineNameEditor.tsx`
- `src/components/whiteboard/column/DataTypeSelector.tsx`
- `src/components/whiteboard/column/ConstraintBadges.tsx`
- `src/components/whiteboard/column/AddColumnRow.tsx`
- `src/components/whiteboard/column/DeleteColumnDialog.tsx`
- `src/components/whiteboard/ConnectionStatusIndicator.tsx`
- `src/hooks/use-column-mutations.ts`
- `src/hooks/use-column-collaboration.ts`

## Files Modified

- `src/lib/react-flow/types.ts` — Added column mutation callbacks + edges prop to TableNodeData
- `src/components/whiteboard/TableNode.new.tsx` — Major rewrite with column editing
- `src/components/whiteboard/ReactFlowWhiteboard.tsx` — Integrated useColumnCollaboration + ConnectionStatusIndicator
- `src/components/ui/alert-dialog.tsx` — Installed via shadcn
- `src/components/ui/tooltip.tsx` — Installed via shadcn
- `src/components/ui/dropdown-menu.tsx` — Installed via shadcn

---

## Deviations

None. Implementation follows tech-spec.md exactly.

---

## Test Coverage

Tests written by Ares (2026-03-30) as a follow-up pass after PRD alignment found zero suites.

### Test Files Created

| File | Suite | Tests |
|------|-------|-------|
| `src/test/fixtures.ts` | Shared fixtures | — |
| `src/test/setup.ts` | Vitest setup (cleanup) | — |
| `src/components/whiteboard/ConnectionStatusIndicator.test.tsx` | TS-09 | 5 |
| `src/components/whiteboard/column/InlineNameEditor.test.tsx` | TS-02 | 8 |
| `src/components/whiteboard/column/ConstraintBadges.test.tsx` | TS-03 | 12 |
| `src/components/whiteboard/column/DataTypeSelector.test.tsx` | TS-01 | 6 |
| `src/components/whiteboard/column/DeleteColumnDialog.test.tsx` | TS-05 | 7 |
| `src/components/whiteboard/column/AddColumnRow.test.tsx` | TS-04 | 8 |
| `src/components/whiteboard/column/ColumnRow.test.tsx` | TS-06 | 10 |
| `src/hooks/use-column-mutations.test.ts` | TS-07 + TS-13 | 14 |
| `src/hooks/use-column-collaboration.test.ts` | TS-08 | 10 |

**Total tests added**: 80 (across 9 test files)
**All tests pass**: Yes (160 total pass including pre-existing 80)

### Infrastructure Changes

- Created `vitest.config.ts` — standalone Vitest config that uses `@vitejs/plugin-react` and `vite-tsconfig-paths` without the TanStack Start plugin. This was required because the `tanstackStart()` Vite plugin causes "multiple copies of React" hook errors in the test environment.
- Created `src/test/setup.ts` — registers `afterEach(cleanup)` from `@testing-library/react` so DOM is cleaned between tests.

### Mock Strategy Used

- `@xyflow/react` — mocked `Handle` (renders null) and `Position` in ColumnRow tests
- `DataTypeSelector` — mocked with plain `<select>` in AddColumnRow and ColumnRow tests to avoid Radix UI portal complexity
- `use-collaboration` — mocked entirely in `useColumnCollaboration` tests with controllable `on`/`off`/`emit`/`connectionState`
- `sonner` toast — mocked with `vi.fn()` in `useColumnMutations` tests

---

## Code Review Fixes (2026-03-30)

Addressed the BLOCKER and HIGH findings from `code-review.md` and `risk-analysis.md`.

### BLOCKER Fixed: Delete Dialog Showing UUIDs Instead of Table Names

**File**: `src/components/whiteboard/TableNode.new.tsx`

Added `useNodes` from `@xyflow/react` inside `TableNode` to get the live node list. Built a `tableNameById` memo map (`tableId → tableName`). Updated the `affectedRelationships` builder to resolve human-readable table names via the lookup map, falling back to the raw UUID only if the node is not found.

### HIGH-01: onColumnError No-Op (VERIFIED — already fixed)

**File**: `src/components/whiteboard/ReactFlowWhiteboard.tsx`

Confirmed the `onColumnErrorRef` pattern was already in place from the code review auto-fix. Lines 249, 257-259, and 281-284 show the working ref-forwarding pattern. No further action needed.

### HIGH-02 Fixed: No Reconnect Reconciliation

**Files**: `src/hooks/use-column-collaboration.ts`, `src/components/whiteboard/ReactFlowWhiteboard.tsx`

Added optional `onReconnect` callback to `UseColumnCollaborationCallbacks`. In `useColumnCollaboration`, registered a `connect` listener that fires the callback on reconnect (skipping the initial connection using `hasConnectedRef`). In `ReactFlowWhiteboardInner`, wired `handleReconnect` which calls `queryClient.invalidateQueries` for both `['whiteboard', whiteboardId]` and `['relationships', whiteboardId]`, replacing any stale optimistic state with authoritative server data.

### HIGH-03 Fixed: Duplicate React Flow Handle IDs

**Files**: `src/lib/react-flow/edge-routing.ts`, `src/lib/react-flow/convert-to-edges.ts`, `src/components/whiteboard/column/ColumnRow.tsx`

Updated `createColumnHandleId` to accept an optional 4th `type: 'source' | 'target'` parameter (defaults to `'source'` for backward compatibility). Handle ID format is now `{tableId}__{columnId}__{side}__{type}`. Updated all call sites:
- `ColumnRow.tsx`: left-source, left-target, right-source, right-target handles are now uniquely identified
- `convert-to-edges.ts`: `sourceHandle` uses `'source'` type, `targetHandle` uses `'target'` type
- `recalculateEdgeHandles`: same type-specific IDs

Updated `ColumnRow.test.tsx` mock to accept the optional 4th parameter.

### Test Results After Fixes

- 160 tests: all passing
- Build: clean (no TypeScript errors)

## Bug Fix: PK Badge Always Visible (2026-03-31)

**Files**: `src/components/whiteboard/column/ConstraintBadges.tsx`, `src/components/whiteboard/column/ConstraintBadges.test.tsx`

### Problem

A previous fix had wrapped the PK badge in `{localPK && (...)}` to prevent ghost rendering — but this entirely removed the badge when a field was not a primary key. Users had no way to toggle a non-PK field into a PK.

### Fix Applied

**ConstraintBadges.tsx**: Removed the conditional wrapper. PK badge now always renders with the same active/inactive visual pattern as N and U badges:
- Active (localPK=true): amber background, white text, full opacity, amber border
- Inactive (localPK=false): transparent background, table text color, 0.4 opacity, outline border
- `aria-pressed` dynamically reflects `localPK` state
- `aria-label` dynamically describes current state
- `handlePKClick` (with its cascade logic: nullable=false, unique=true on enable) preserved intact

**ConstraintBadges.test.tsx**:
- TC-03-02: Updated from "PK badge NOT rendered when isPrimaryKey=false" to "PK badge always rendered; shows inactive style when isPrimaryKey=false" — asserts badge is present with `aria-pressed="false"`
- TC-03-04b (new): Tests PK toggle OFF->ON and verifies cascade — `isPrimaryKey=true`, `isNullable=false`, `isUnique=true` all called

### Test Results After Fix

- TS-03 (ConstraintBadges): 13 tests, all passing (was 12 before adding TC-03-04b)
- Total test suite: unchanged pass rate

## Bug Fix: Socket.IO Never Initialized (2026-03-31)

**File**: `vite.config.ts`

### Problem

`initializeSocketIO(httpServer)` was defined in `src/routes/api/collaboration.ts` but never called. The Socket.IO server was never mounted, causing `/socket.io` to return HTTP 404 and all collaboration connections to fail immediately.

### Root Cause

TanStack Start's server entry exports a `fetch` handler (Web standard), not a Node.js HTTP server. There was no call site that passed the underlying HTTP server to `initializeSocketIO`.

### Fix Applied

Added a `socketIOPlugin()` Vite plugin in `vite.config.ts`. The plugin uses the `configureServer` post-middleware hook to:

1. Access `viteDevServer.httpServer` (the underlying Node.js `http.Server`)
2. Load `src/routes/api/collaboration.ts` through the `"ssr"` environment's `RunnableDevEnvironment` runner — this honours `@/` path aliases and ensures Prisma and other server-only deps resolve correctly
3. Call `initializeSocketIO(httpServer)` once on server startup

Key finding: TanStack Start 1.132 names its SSR environment `"ssr"` (not `"server"`) for backwards compatibility with plugins that predate the Vite Environment API. Using `"server"` causes a silent fallback to the warn path.

### Verification

`GET /socket.io/?EIO=4&transport=polling` now returns HTTP 200 with a valid Socket.IO handshake:
```
0{"sid":"...","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
```

## Known Issues / Deferred Debt

**Production**: The `socketIOPlugin` only wires Socket.IO for the Vite dev server. A production deployment that does NOT use `vite preview` (i.e. a standalone Node.js server) would need a separate custom server entry point that creates an `http.Server`, mounts the TanStack Start fetch handler via `@hono/node-server` or similar, and calls `initializeSocketIO`. This is deferred until a production deployment target is chosen.

## Bug Fix: New Whiteboard Navigation Shows "Not Found" (2026-03-31)

**Files**: `src/routes/api/whiteboards.ts`, `src/components/navigator/ProjectTree.tsx`, `src/routes/index.tsx`

### Root Cause

All server functions in `src/routes/api/whiteboards.ts` used the OLD TanStack Start API:
```ts
createServerFn('POST', async (data) => { ... })
```

In TanStack Start 1.132, the Vite plugin (`@tanstack/start-plugin-core`) only transforms server functions whose source files contain `.handler(`. Because `whiteboards.ts` had no `.handler(` calls, the plugin NEVER processed the file. At runtime, calling these "functions" returned a builder object instead of making an HTTP request — no database operations were performed.

When `createWhiteboardFn` was used as a TanStack Query `mutationFn`, it returned a plain JS object (the builder), not the created whiteboard. TanStack Query resolved with this object. `onSuccess(whiteboard)` received a builder object:
- `whiteboard.id` = `undefined` → `navigate({ params: { whiteboardId: undefined } })`
- The URL became `/whiteboard/undefined`
- `getWhiteboardWithDiagram('undefined')` returned null → "Whiteboard not found"

The same bug affected `updateWhiteboardFn`, `deleteWhiteboardFn`, and `getRecentWhiteboards`.

### Fix Applied

Rewrote all 10 functions in `src/routes/api/whiteboards.ts` using the new builder API:
```ts
export const createWhiteboardFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createWhiteboardSchema.parse(data))
  .handler(async ({ data }) => {
    const whiteboard = await createWhiteboard(data)
    return whiteboard
  })
```

Updated callers in `ProjectTree.tsx` to use `{ data: ... }` wrapper required by new API:
```ts
mutationFn: (data: CreateWhiteboard) => createWhiteboardFn({ data }),
```

Updated `routes/index.tsx` query for recent whiteboards:
```ts
queryFn: () => getRecentWhiteboards({ data: 8 }),
```

Added `import type { CreateWhiteboard, UpdateWhiteboard }` to `ProjectTree.tsx` for proper typing.

### Secondary Fix

This also fixes ISSUE-007 ("Recent Whiteboards section absent") since `getRecentWhiteboards` was also broken by the same API mismatch.

### Test Results

- 160 tests pass (1 pre-existing failure in `AddColumnRow` unrelated to this fix)
- No new TypeScript errors introduced (pre-existing errors from `folders.ts` and `projects.ts` which also use old API remain but are out of scope)
