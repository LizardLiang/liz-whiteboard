// src/lib/schema-diff/describe.ts
// What the compare list shows for a diff: the layout filter and one sentence
// per entry. Client-safe (no server imports). The sentences reuse the
// Changes-tab keys, so a compare row reads like a change-log row.

import type { BoardDiff, DiffEntry, DiffField } from './types'
import type { TFunction } from '@/lib/i18n/translate'
import { NAME_CLOSE, NAME_OPEN } from '@/lib/schema-changelog/describe'

const SENTENCE = 'whiteboard.history.changes.sentence'

const mark = (value: unknown): string =>
  `${NAME_OPEN}${value === null || value === undefined ? '?' : String(value)}${NAME_CLOSE}`

export type DiffStatus = 'added' | 'removed' | 'changed'

/** The fields of `entry` to show: layout fields only when `includeLayout`. */
export function visibleFields(
  entry: DiffEntry,
  includeLayout: boolean,
): Array<DiffField> {
  return includeLayout ? entry.fields : entry.fields.filter((f) => !f.layout)
}

/**
 * The diff with layout hidden. A changed entry with no visible field drops
 * out; added and removed entries always stay.
 */
export function visibleDiff(
  diff: BoardDiff,
  includeLayout: boolean,
): BoardDiff {
  if (includeLayout) return diff
  return {
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed.filter(
      (entry) => visibleFields(entry, false).length > 0,
    ),
  }
}

/** Changed entries that only differ in layout: hidden while the switch is off. */
export function hiddenLayoutCount(diff: BoardDiff): number {
  return diff.changed.filter(
    (entry) => visibleFields(entry, false).length === 0,
  ).length
}

const CAPITAL = {
  table: 'table',
  column: 'column',
  relationship: 'relationship',
  area: 'area',
} as const

/** "added column email to User", "renamed table A → B", "changed area Core (members)". */
export function describeDiffEntry(
  entry: DiffEntry,
  status: DiffStatus,
  includeLayout: boolean,
  t: TFunction,
): string {
  const kind = CAPITAL[entry.entityType]
  const name = mark(entry.name)
  const table = mark(entry.tableName)
  if (status === 'added') return t(`${SENTENCE}.${kind}Create`, { name, table })
  if (status === 'removed')
    return t(`${SENTENCE}.${kind}Delete`, { name, table })
  const rename = entry.fields.find((f) => f.field === 'name')
  if (rename && (kind === 'table' || kind === 'column')) {
    return t(`${SENTENCE}.${kind}Rename`, {
      from: mark(rename.before),
      to: mark(rename.after),
      table,
    })
  }
  const type = entry.fields.find((f) => f.field === 'dataType')
  if (kind === 'column' && type) {
    return t(`${SENTENCE}.columnType`, {
      name,
      table,
      from: mark(type.before),
      to: mark(type.after),
    })
  }
  const fields = visibleFields(entry, includeLayout)
    .map((f) => mark(f.field))
    .join(', ')
  return t(`${SENTENCE}.${kind}Update`, { name, table, fields })
}
