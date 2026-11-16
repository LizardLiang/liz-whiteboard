// src/lib/schema-changelog/types.ts
// Client-safe shapes the change-log read API returns. No server imports here:
// the Changes tab imports this file.

import type { JsonValue } from '@/data/models'

export type ChangeFieldsDto = { [key: string]: JsonValue }

export type ChangeCategoryDto = 'schema' | 'layout'

export interface ChangeEventDto {
  id: string
  batchId: string | null
  batchKind: string | null
  actorUserId: string | null
  actorName: string
  viaAgent: boolean
  category: ChangeCategoryDto
  entityType: string
  action: string
  entityId: string
  entityName: string | null
  tableId: string | null
  tableName: string | null
  before: ChangeFieldsDto | null
  after: ChangeFieldsDto | null
  createdAt: number
}

export interface RestoredVersionDto {
  snapshotId: string
  label: string | null
  createdAt: string
}

export interface BatchCountDto {
  entityType: string
  action: string
  count: number
}

export interface BatchSummaryDto {
  batchId: string
  batchKind: string | null
  actorUserId: string | null
  actorName: string
  viaAgent: boolean
  /** Time of the last event in the batch. */
  createdAt: number
  /** Number of events that matched the filters. */
  total: number
  counts: Array<BatchCountDto>
  restoredVersion: RestoredVersionDto | null
}

export type ChangeListItem =
  | { kind: 'event'; event: ChangeEventDto }
  | { kind: 'batch'; batch: BatchSummaryDto }

export interface ListSchemaChangesResult {
  items: Array<ChangeListItem>
  nextCursor: string | null
}

export interface GetSchemaChangeBatchResult {
  events: Array<ChangeEventDto>
  nextCursor: number | null
}

export interface ChangeLogFacets {
  tables: Array<string>
  actors: Array<{ userId: string; name: string }>
  hasAgentEdits: boolean
}
