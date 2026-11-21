# Known Debt / Deferred Bugs

## FIXED — GH #125 fully closed: table:created now reaches peers live

**Status:** FIXED in `fix/125-table-create-sync` (Phase 7, commit — "broadcast table:created from the
createTable server fn the UI actually calls"). `src/lib/server-functions.ts`'s `createTable` (the
function the UI actually calls) now delegates to `createTableHandler`
(`@/lib/diagram-table/handlers`), which does the permission check + create + `emitToWhiteboard`
broadcast. `e2e/coedit-table-create.spec.ts` passes against the prod build: peer B sees peer A's
toolbar-created table live, no reload. Dev-based `e2e/whiteboard-crud.spec.ts` (single-user
create+persist) still green — no regression. The two duplicate `createTable` functions were NOT
consolidated (`routes/api/tables.ts`'s copy is now dead code, unused by any client import) — flagged
below as a follow-up.

## table:created still doesn't reach peers — createTableFn's broadcast is on the WRONG (unused) function (HISTORICAL — see FIXED entry above)

**Discovered:** 2026-07-09, during Phase 6 verification of GH #125 (after the globalThis bridge fix).
**Status:** confirmed via debug tracing (console.log AND file-based `appendFileSync`, both silent) +
DB inspection (the table WAS persisted) — NOT fixed. This is what's currently blocking #125's e2e
from going green, now that the two earlier bugs (client double-insert, globalThis singleton) are fixed.

**Symptom:** `src/lib/diagram-table/handlers.ts`'s `createTableHandler` (which now correctly calls
`emitToWhiteboard` — see the two fixes below) never executes any of its instrumented lines, not
even in the `catch` block, despite `createDiagramTable` clearly having run (the new row shows up in
`data/app.db` with a real UUID, right after the seed's rows, timestamped to the exact test run).

**Root cause:** `src/routes/whiteboard/$whiteboardId.tsx`'s `createTableMutation.mutationFn` calls:
```ts
import { createTable as createTableFn } from '@/lib/server-functions'
...
mutationFn: async (data: CreateTable) => {
  return await createTableFn({ data })   // <-- this is server-functions.ts's createTable, NOT
}                                         //     routes/api/tables.ts's createTableFn!
```
`src/lib/server-functions.ts` (a large, legacy file of table/relationship/layout server functions)
has its OWN, completely separate `createTable` server function (line ~159) that ALSO calls
`createDiagramTable` directly, inline, with no broadcast:
```ts
export const createTable = createServerFn({ method: 'POST' })
  .inputValidator((data: CreateTable) => data)
  .handler(
    requireAuth(async ({ user }, data) => {
      const projectId = await getWhiteboardProjectId(data.whiteboardId)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
      try {
        const table = await createDiagramTable(data)
        return table                      // <-- no emitToWhiteboard call
      } catch (error) {
        console.error('Error creating table:', error)
        throw error
      }
    }),
  )
```
This is a **different function** than `src/routes/api/tables.ts`'s `createTableFn` (which I fixed in
the #125 Phase 5/6 commits). The tactical plan's `src/routes/api/tables.ts:185` reference — and my
own Phase 5 work — targeted the wrong, unused-by-the-UI copy. `$whiteboardId.tsx` imports the name
`createTableFn` locally but binds it to `server-functions.ts`'s `createTable` via an import alias
(`createTable as createTableFn`), which reads identically to a call into `routes/api/tables.ts` at
a glance — easy to miss without grep'ing the actual import source, which is exactly how this slipped
through two prior "fix createTableFn" passes.

**Fix applied (Phase 7):** `src/lib/server-functions.ts`'s `createTable` handler now delegates to
`createTableHandler` (`@/lib/diagram-table/handlers`) instead of inlining its own
`createDiagramTable` call — `.handler(requireAuth(createTableHandler))`. Same
tree-shaking-safe pattern (import only referenced inside the stripped `.handler(...)` closure).
Confirmed via prod-build e2e: peer receives `table:created` live.

**Still open (follow-ups, deliberately not done here):**
- ~~`routes/api/tables.ts`'s `createTableFn` is now confirmed genuinely unused by any client import —
  it and its sibling CRUD functions in that file may be entirely dead code duplicating
  `server-functions.ts`. Worth an audit + removal in a dedicated cleanup, not bundled into a bugfix.~~
  **RESOLVED (#131):** `src/routes/api/tables.ts` deleted entirely; its one live caller
  (`updateTablePositionFn`, used by `ReactFlowWhiteboard.tsx`) was repointed to
  `server-functions.ts`'s already-present, identical `updateTablePosition`. No behavior change.

## CRITICAL (FIXED): emitToWhiteboard/broadcastToWhiteboard were dead code in the prod build when called from any server function

**Discovered:** 2026-07-09, during Phase 5 of GH #125 (server-side broadcast fix).
**Status:** FIXED in `fix/125-table-create-sync` (commit 0021526, Phase 6 — globalThis bridge).
Verified via built-bundle inspection: `.output/server/_ssr/collaboration-*.mjs` now reads
`globalThis.__lizSocketIO` and calls the real `.of(...).emit(...)`, not the previous 9-line stub.
This unblocks GH #107's `whiteboard:restored` broadcast (single correctly-wired path, no
duplicate-function issue there) but does NOT by itself unblock #125 — see the NEW finding above.

**Symptom:** after fixing the ZodError below (createTableFn now calls
`emitToWhiteboard(whiteboardId, 'table:created', ...)` directly, and the
client's broken re-emit was removed), the prod-build two-context e2e still
shows the peer never receiving the table live. No error is logged anywhere
(not even `emitToWhiteboard`'s own `if (!io) console.error('Socket.IO
server not initialized')` branch fires) — the function body itself has been
silently replaced at build time.

**Root cause:** `server.prod.ts` does:
```ts
import { middleware } from './.output/server/index.mjs'      // Vite/Nitro-BUILT bundle
import { initializeSocketIO } from './src/routes/api/collaboration'  // raw SOURCE, Bun-transpiled live
```
These are TWO SEPARATE JS module instantiations of `collaboration.ts`, each
with its own `let io: SocketIOServer | null = null`. `initializeSocketIO(server)`
sets `io` on the **source-imported** instance. But `middleware` (which
handles ALL HTTP requests, including every `createServerFn`/server-function
RPC call, e.g. `createTableFn`) comes from the **built** `.output` bundle —
a completely different instantiation of `collaboration.ts`.

Nothing in the built SSR/server-functions bundle's own reachable code graph
ever calls `initializeSocketIO` (only `server.prod.ts` does, and Vite's
build has no entry point that traces into that file). Rollup's tree-shaking
therefore proves `io` can **never become non-null** within that bundle, and
dead-code-eliminates the entire `setupWhiteboardNamespace` function (all of
it — `new SocketIOServer(...)`, every `socket.on('table:create', ...)` /
`'table:move'` / etc. handler) since it's only reachable from the unused
`initializeSocketIO` export. What remains,
`.output/server/_ssr/collaboration-*.mjs`, is a **9-line stub**:
```js
function emitToWhiteboard(whiteboardId, event, data) {
  {
    console.error("Socket.IO server not initialized");
    return;
  }
}
export { emitToWhiteboard as e };
```
The `if (!io)` condition itself has been constant-folded away — there is no
branch left that could ever call `namespace.emit(...)`.

**This is NOT new to #125** — `src/lib/history/handlers.ts`'s
`whiteboard:restored` broadcast (GH #107, version history restore) imports
`emitToWhiteboard` from the exact same dead chunk
(`.output/server/_ssr/history-*.mjs:11`). It has presumably never worked
live in prod either; nobody noticed because `playwright.config.ts`'s
version-history suite deliberately asserts restore correctness via reload,
not the live broadcast (its own header comment explains why, but the
underlying assumption that prod fixes it was never verified with a live
two-context test — this build issue means it does not).

**Why not fixed in the #125 branch:** this requires an actual architecture
decision on how server functions share the live `io` singleton with the
custom prod server process — e.g. stashing the `SocketIOServer` instance on
`globalThis` from `server.prod.ts` (shared across module-graph boundaries
since both instantiations run in the same OS process) and having
`emitToWhiteboard`/`getSocketIO` read from `globalThis` instead of a
module-local `let io`, or restructuring `server.prod.ts` to import
`initializeSocketIO` from the SAME built bundle `middleware` comes from. Out
of scope for a "wire the broadcast call" task — flagging for its own fix,
since it blocks not just #125 but the pre-existing `whiteboard:restored`
live-refresh feature too.

## table:create socket handler always rejected the client's redundant re-emit (FIXED — see above bug for why peers still don't get it live)

**Discovered:** 2026-07-09, during implementation of GH #125 (live table-creation sync).
**Status:** FIXED in `fix/125-table-create-sync` (commit 1f69d56) — client no
longer re-emits, `createTableFn` broadcasts directly instead. Kept below for
history; superseded by the CRITICAL finding above as the reason #125 is
still not fully closed.

**Symptom:** even after wiring `table:created` onto the working collaboration-hook
path (`use-whiteboard-collaboration.ts` + `ReactFlowWhiteboard.tsx`, see
`fix/125-table-create-sync`), a peer never receives the live broadcast. The
creating client's own canvas updates fine (via the HTTP `createTableFn` server
function + optimistic cache), but no other connected client ever sees it
without a reload.

**Root cause:** `src/routes/whiteboard/$whiteboardId.tsx`'s
`createTableMutation.onSuccess` does:
```ts
onSuccess: (createdTable) => {
  emit('table:create', createdTable)   // <-- re-emits the ALREADY-CREATED row
  ...
}
```
This re-submits the full persisted table object (id, timestamps,
`description: null`, `width: null`, `height: null`) to the SERVER's
`table:create` socket handler (`src/routes/api/collaboration.ts`), which
treats it as a **fresh creation request**:
```ts
const validated = createTableSchema.parse({ ...data, whiteboardId })
const table = await createDiagramTable(validated)
socket.broadcast.emit('table:created', { ...table, createdBy: userId })
```
`createTableSchema` (`src/data/schema.ts`) uses `.optional()` for
`description`/`width`/`height`, which rejects `null` (Zod: optional ≠
nullable). The round-tripped object always has these fields as `null` (DB
storage, not `undefined`), so `.parse()` throws a `ZodError` every time,
the `catch` block emits a private `error` event back to the sender only, and
`socket.broadcast.emit('table:created', ...)` is **never reached** — the
peer broadcast has probably never worked for toolbar-created tables.
Even if the schema were relaxed to `.nullable()`, this call would then
attempt a **second INSERT with the same name**, violating the
`DiagramTable_whiteboardId_name_key` unique index.

**Confirmed unrelated to #125's client-wiring change:**
`git diff origin/master --quiet -- src/routes/api/collaboration.ts src/data/schema.ts`
returns 0 diff — this bug predates and is independent of the #125 fix.

**Why not fixed in the #125 branch:** fixing it requires an architecture
decision, not a client-wiring tweak. `getSocketIO()` /
`broadcastToWhiteboard()` already exist in `collaboration.ts` — the clean
fix is likely to have `createTableFn` (`src/routes/api/tables.ts`) broadcast
`table:created` directly via `broadcastToWhiteboard()` after persisting, and
**remove** the client's redundant `emit('table:create', createdTable)` in
`$whiteboardId.tsx` entirely. That touches a server function + a client
mutation callback outside this ticket's stated scope, and needs review of
whether anything else (e.g. the MCP integration, which also emits
`table:create` over its own socket connection) depends on the current
`table:create` handler's re-broadcast behavior.

## Canvas table element (2026-11-11, phase 1)

- ~~**`SelectionToolbar` shows text controls for a selected table.**~~ FIXED in phase 4: a lone selected table shows the header toggle, and fill and align when cells/row/col are picked.
- ~~**Delete/Backspace with a table cell, row or column selected still deletes the whole table**~~ FIXED in 8624e65 (phase 3): row/col → remove, cells → clear text, whole table → delete; covered by e2e.


## Relationship routing: gaps under 16 px (2026-11-17, residual)

**Status:** the tight-gap debt is fixed: lines start on the table border (design rule, user 2026-11-17), and each end floors at its own marker (per-end `minStub` = extent + 3 px air, `cardinality-marker.ts`), so a side needs a gap of 14 px (one), 17 px (optional one), 24 px (many) or 31 px (optional many) (was 40 px). On the seeded 26-table "Tight routing board" (gaps 10-70 px) 42 of 60 edges route (32 before); the other 18 have an endpoint whose two gaps are both under its floor, where the cardinality marker itself would overlap the neighbour. Those edges draw the smooth-step path and can cross a table. Not fixable without shrinking the marker; accepted.

## Email invite and signup leftovers (2026-11-21, review of 87cae1e..f8188ae)

- The 200-pending-invite cap in `grantPermissionHandler` is counted outside the insert transaction, so concurrent invites can pass it by a few rows. The per-inviter limits bound it.
- `completeSignup` in `src/routes/api/auth.ts`: if `createUserSession` throws after the commit, the user exists with no session and sees an error. They recover by logging in.
- `/invite/email/$token`: an owner who opens their own invite sees "This invite link is invalid". The send path refuses the owner address, so it arises only after an ownership transfer.
