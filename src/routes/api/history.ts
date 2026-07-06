// src/routes/api/history.ts
// Whiteboard version history / snapshot server functions (GH #107):
// save/list/get/restore. Follows src/routes/api/share.ts's exact shape.
//
// This file is deliberately THIN — it only wires up createServerFn +
// requireAuth around handler functions imported from src/lib/history/
// handlers.ts. That module (and its `@/db`/Socket.IO-touching imports) must
// never live in this file directly: src/components/whiteboard/
// WhiteboardHistoryPanel.tsx (a client component) imports the
// createServerFn-wrapped consts below, and TanStack Start's client-bundle
// transform only strips the INLINE closure passed to `.handler(...)` — it
// cannot strip a plain top-level function this file merely references.
// Keeping the handler bodies in a separate, never-client-imported module is
// what lets Rollup tree-shake them out of the browser bundle. (Mirrors
// src/routes/api/share.ts's identical split — see that file's header
// comment for the real `bun run build` failure this pattern avoids.)

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import {
  getSnapshotHandler,
  listSnapshotsHandler,
  restoreSnapshotHandler,
  saveSnapshotHandler,
} from '@/lib/history/handlers'
import {
  getSnapshotSchema,
  listSnapshotsSchema,
  restoreSnapshotSchema,
  saveSnapshotSchema,
} from '@/data/schema'

/**
 * @requires editor
 */
export const saveSnapshot = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => saveSnapshotSchema.parse(data))
  .handler(requireAuth(saveSnapshotHandler))

/**
 * @requires viewer
 */
export const listSnapshots = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => listSnapshotsSchema.parse(data))
  .handler(requireAuth(listSnapshotsHandler))

/**
 * @requires viewer
 */
export const getSnapshot = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => getSnapshotSchema.parse(data))
  .handler(requireAuth(getSnapshotHandler))

/**
 * @requires editor
 */
export const restoreSnapshot = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => restoreSnapshotSchema.parse(data))
  .handler(requireAuth(restoreSnapshotHandler))
