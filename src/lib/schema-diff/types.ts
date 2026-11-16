// src/lib/schema-diff/types.ts
// Client-safe shapes of a board comparison. No server imports here: the
// Versions tab imports this file.

export type DiffEntityType = 'table' | 'column' | 'relationship' | 'area'

/** One field of an entity, as display text. `layout` marks position, size and edge-path fields. */
export interface DiffField {
  field: string
  before: string | null
  after: string | null
  layout: boolean
}

export interface DiffEntry {
  entityType: DiffEntityType
  entityId: string
  name: string
  /** The table a column belongs to; null for the other kinds. */
  tableName: string | null
  /** Changed entry: the fields that differ. Added or removed entry: the row's non-empty fields. */
  fields: Array<DiffField>
}

export interface BoardDiff {
  added: Array<DiffEntry>
  removed: Array<DiffEntry>
  changed: Array<DiffEntry>
}
