// src/routes/api/schema-changes.ts
// Change-log read API (server functions). Thin on purpose: the handler bodies
// live in src/lib/schema-changelog/handlers.ts so the client bundle never
// pulls in `@/db` (same split as src/routes/api/history.ts).

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from '@/lib/auth/middleware'
import {
  getSchemaChangeBatchHandler,
  listChangeLogFacetsHandler,
  listSchemaChangesHandler,
} from '@/lib/schema-changelog/handlers'
import {
  getSchemaChangeBatchSchema,
  listChangeLogFacetsSchema,
  listSchemaChangesSchema,
} from '@/data/schema'

/**
 * @requires viewer
 */
export const listSchemaChanges = createServerFn({ method: 'GET' })
  .validator((data: unknown) => listSchemaChangesSchema.parse(data))
  .handler(requireAuth(listSchemaChangesHandler))

/**
 * @requires viewer
 */
export const getSchemaChangeBatch = createServerFn({ method: 'GET' })
  .validator((data: unknown) => getSchemaChangeBatchSchema.parse(data))
  .handler(requireAuth(getSchemaChangeBatchHandler))

/**
 * @requires viewer
 */
export const listChangeLogFacets = createServerFn({ method: 'GET' })
  .validator((data: unknown) => listChangeLogFacetsSchema.parse(data))
  .handler(requireAuth(listChangeLogFacetsHandler))
