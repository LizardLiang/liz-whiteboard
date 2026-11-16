// src/lib/schema-changelog/describe.ts
// Turns change-log rows into the sentences the Changes tab shows. Client-safe:
// no server imports. Names are wrapped in NAME_OPEN/NAME_CLOSE so the view can
// style them without splitting the translated sentence itself.

import type {
  BatchSummaryDto,
  ChangeEventDto,
  ChangeFieldsDto,
  RestoredVersionDto,
} from './types'
import type { TFunction } from '@/lib/i18n/translate'

export const NAME_OPEN = ''
export const NAME_CLOSE = ''

const SENTENCE = 'whiteboard.history.changes.sentence'
const BATCH = 'whiteboard.history.changes.batch'
const CHANGES = 'whiteboard.history.changes'

const mark = (value: unknown): string =>
  `${NAME_OPEN}${value === null || value === undefined ? '?' : String(value)}${NAME_CLOSE}`

/** Remove the name marks, leaving plain text. */
export function stripMarks(text: string): string {
  return text.replaceAll(NAME_OPEN, '').replaceAll(NAME_CLOSE, '')
}

/** Split a marked sentence into runs; `name` runs are entity or field names. */
export function splitMarked(
  text: string,
): Array<{ text: string; name: boolean }> {
  const runs: Array<{ text: string; name: boolean }> = []
  let rest = text
  while (rest.length > 0) {
    const open = rest.indexOf(NAME_OPEN)
    if (open === -1) {
      runs.push({ text: rest, name: false })
      break
    }
    if (open > 0) runs.push({ text: rest.slice(0, open), name: false })
    const close = rest.indexOf(NAME_CLOSE, open)
    if (close === -1) {
      runs.push({ text: rest.slice(open + 1), name: false })
      break
    }
    runs.push({ text: rest.slice(open + 1, close), name: true })
    rest = rest.slice(close + 1)
  }
  return runs
}

function restoredVersionOf(event: ChangeEventDto): RestoredVersionDto | null {
  const version = event.after?.restoredVersion
  if (version === null || typeof version !== 'object' || Array.isArray(version))
    return null
  return version as unknown as RestoredVersionDto
}

function changedKeys(event: ChangeEventDto): string {
  return Object.keys(event.after ?? event.before ?? {})
    .map((k) => mark(k))
    .join(', ')
}

/** The sentence for one event, e.g. "renamed column mail → email on User". */
export function describeEvent(event: ChangeEventDto, t: TFunction): string {
  const { entityType, action } = event
  const name = mark(event.entityName)
  const table = mark(event.tableName)
  const renamed =
    action === 'update' &&
    typeof event.after?.name === 'string' &&
    event.before?.name !== undefined

  if (entityType === 'board') {
    const version = restoredVersionOf(event)
    if (version) {
      return t(`${SENTENCE}.boardRestored`, {
        version: mark(version.label ?? event.entityName ?? ''),
      })
    }
  }
  if (entityType === 'table') {
    if (renamed) {
      return t(`${SENTENCE}.tableRename`, {
        from: mark(event.before?.name),
        to: mark(event.after?.name),
      })
    }
    if (action === 'update')
      return t(`${SENTENCE}.tableUpdate`, { name, fields: changedKeys(event) })
    if (['create', 'delete', 'move', 'resize'].includes(action))
      return t(
        `${SENTENCE}.table${action[0].toUpperCase()}${action.slice(1)}`,
        {
          name,
        },
      )
  }
  if (entityType === 'column') {
    if (renamed) {
      return t(`${SENTENCE}.columnRename`, {
        from: mark(event.before?.name),
        to: mark(event.after?.name),
        table,
      })
    }
    if (action === 'update' && event.after && 'dataType' in event.after) {
      return t(`${SENTENCE}.columnType`, {
        name,
        table,
        from: mark(event.before?.dataType),
        to: mark(event.after.dataType),
      })
    }
    if (action === 'update')
      return t(`${SENTENCE}.columnUpdate`, {
        name,
        table,
        fields: changedKeys(event),
      })
    if (['create', 'delete', 'reorder'].includes(action))
      return t(
        `${SENTENCE}.column${action[0].toUpperCase()}${action.slice(1)}`,
        {
          name,
          table,
        },
      )
  }
  if (entityType === 'relationship') {
    if (action === 'update')
      return t(`${SENTENCE}.relationshipUpdate`, {
        name,
        fields: changedKeys(event),
      })
    if (['create', 'delete', 'move'].includes(action))
      return t(
        `${SENTENCE}.relationship${action[0].toUpperCase()}${action.slice(1)}`,
        { name },
      )
  }
  if (entityType === 'reference') {
    if (['create', 'update', 'delete', 'move', 'resize'].includes(action))
      return t(
        `${SENTENCE}.reference${action[0].toUpperCase()}${action.slice(1)}`,
        { name },
      )
  }
  if (entityType === 'area') {
    if (action === 'update')
      return t(`${SENTENCE}.areaUpdate`, { name, fields: changedKeys(event) })
    if (['create', 'delete', 'move', 'resize'].includes(action))
      return t(`${SENTENCE}.area${action[0].toUpperCase()}${action.slice(1)}`, {
        name,
      })
  }
  return t(`${SENTENCE}.generic`, {
    action: t(`${CHANGES}.actionPast.${action}`),
    entity: entityType,
    name,
  })
}

/** "1 table created, 2 columns created" for a batch's counts. */
function describeCounts(batch: BatchSummaryDto, t: TFunction): string {
  return batch.counts
    .filter((c) => c.entityType !== 'board')
    .map((c) =>
      t(`${CHANGES}.countPart`, {
        count: c.count,
        entity: t(
          `${CHANGES}.entity.${c.entityType}${c.count === 1 ? 'One' : 'Other'}`,
        ),
        action: t(`${CHANGES}.actionPast.${c.action}`),
      }),
    )
    .join(', ')
}

/** Title and counts of a collapsed batch row. */
export function describeBatch(
  batch: BatchSummaryDto,
  t: TFunction,
  locale: string,
): { title: string; counts: string } {
  const subject = mark(batch.subject ?? '?')
  let title: string
  switch (batch.batchKind) {
    case 'sql-import':
      title = t(`${BATCH}.sqlImport`)
      break
    case 'restore': {
      const version = batch.restoredVersion
      title = version
        ? t(`${BATCH}.restore`, {
            version: mark(
              version.label && version.label.trim().length > 0
                ? version.label
                : new Date(version.createdAt).toLocaleString(locale),
            ),
          })
        : t(`${BATCH}.restoreUnknown`)
      break
    }
    case 'auto-layout':
      title = t(`${BATCH}.autoLayout`)
      break
    case 'bulk-move':
      title = t(`${BATCH}.bulkMove`)
      break
    case 'area-move':
      title = t(`${BATCH}.areaMove`, { name: subject })
      break
    case 'table-delete':
      title = t(`${BATCH}.tableDelete`, { name: subject })
      break
    case 'reference':
      title = t(`${BATCH}.reference`)
      break
    case 'agent-batch':
      title = t(`${BATCH}.agentBatch`)
      break
    default:
      title = t(`${BATCH}.other`, { count: batch.total })
  }
  return { title, counts: describeCounts(batch, t) }
}

export interface DetailField {
  field: string
  before: string | null
  after: string | null
}

const HIDDEN_FIELDS = new Set(['id', 'whiteboardId', 'tableId'])
const MAX_VALUE_LENGTH = 200

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH)}…`
    : text
}

/** The fields an expanded event row lists: before → after, or the whole row. */
export function detailFields(event: ChangeEventDto): Array<DetailField> {
  const before: ChangeFieldsDto = event.before ?? {}
  const after: ChangeFieldsDto = event.after ?? {}
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const oneSided = event.action === 'create' || event.action === 'delete'
  return keys
    .filter((k) => !HIDDEN_FIELDS.has(k))
    .map((field) => ({
      field,
      before: formatValue(before[field]),
      after: formatValue(after[field]),
    }))
    .filter((row) => !oneSided || row.before !== null || row.after !== null)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "5 minutes ago" within a week, the date after that. */
export function formatRelativeTime(
  at: number,
  now: number,
  locale: string,
): string {
  const age = Math.max(0, now - at)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (age < MINUTE) return rtf.format(0, 'second')
  if (age < HOUR) return rtf.format(-Math.floor(age / MINUTE), 'minute')
  if (age < DAY) return rtf.format(-Math.floor(age / HOUR), 'hour')
  if (age < 7 * DAY) return rtf.format(-Math.floor(age / DAY), 'day')
  return new Date(at).toLocaleDateString(locale)
}
