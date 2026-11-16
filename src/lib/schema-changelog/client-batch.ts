// src/lib/schema-changelog/client-batch.ts
// Batch fields a client may send with a write. Free of server imports, so
// client code (the SQL import hook) can use it.

import { z } from 'zod'

/**
 * The batch a client groups its requests under. The only kind a client may
 * name is `sql-import`: the server alone decides every other kind.
 */
export const clientBatchSchema = z.object({
  batchId: z.string().min(1).max(64).optional(),
  batchKind: z.literal('sql-import').optional(),
})

export type ClientBatch = z.infer<typeof clientBatchSchema>

/**
 * Mint a batch id for one client action. Not `crypto.randomUUID()`: that
 * needs a secure context, and the app is also served over plain HTTP on a LAN.
 */
export function mintClientBatchId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`
}
