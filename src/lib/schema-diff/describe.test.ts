// src/lib/schema-diff/describe.test.ts
import { describe, expect, it } from 'vitest'
import {
  describeDiffEntry,
  hiddenLayoutCount,
  visibleDiff,
  visibleFields,
} from './describe'
import type { BoardDiff, DiffEntry } from './types'
import { stripMarks } from '@/lib/schema-changelog/describe'
import { translate } from '@/lib/i18n/translate'

const t = (key: string, vars?: Record<string, string | number>) =>
  translate('en', key, vars)
const tZh = (key: string, vars?: Record<string, string | number>) =>
  translate('zh-TW', key, vars)

function entry(overrides: Partial<DiffEntry>): DiffEntry {
  return {
    entityType: 'column',
    entityId: 'c1',
    name: 'email',
    tableName: 'User',
    fields: [],
    ...overrides,
  }
}

const layoutOnly = entry({
  entityType: 'table',
  name: 'Order',
  tableName: null,
  fields: [{ field: 'positionX', before: '0', after: '9', layout: true }],
})
const schemaChange = entry({
  fields: [
    { field: 'name', before: 'mail', after: 'email', layout: false },
    { field: 'order', before: '0', after: '1', layout: false },
  ],
})
const diff: BoardDiff = {
  added: [entry({ name: 'age' })],
  removed: [],
  changed: [layoutOnly, schemaChange],
}

describe('layout filter', () => {
  it('drops layout-only changed entries until the switch is on', () => {
    expect(visibleDiff(diff, false).changed).toEqual([schemaChange])
    expect(visibleDiff(diff, true)).toBe(diff)
    expect(hiddenLayoutCount(diff)).toBe(1)
  })

  it('keeps added entries and hides layout fields', () => {
    expect(visibleDiff(diff, false).added).toHaveLength(1)
    expect(visibleFields(layoutOnly, false)).toEqual([])
    expect(visibleFields(layoutOnly, true)).toHaveLength(1)
  })
})

describe('describeDiffEntry', () => {
  it('reads like the Changes tab', () => {
    expect(stripMarks(describeDiffEntry(entry({}), 'added', false, t))).toBe(
      'added column email to User',
    )
    expect(stripMarks(describeDiffEntry(entry({}), 'removed', false, t))).toBe(
      'removed column email from User',
    )
    expect(
      stripMarks(describeDiffEntry(schemaChange, 'changed', false, t)),
    ).toBe('renamed column mail → email on User')
  })

  it('names a column type change old -> new', () => {
    const typed = entry({
      name: 'total',
      tableName: 'orders',
      fields: [
        {
          field: 'dataType',
          before: 'VARCHAR',
          after: 'DECIMAL',
          layout: false,
        },
      ],
    })
    expect(stripMarks(describeDiffEntry(typed, 'changed', false, t))).toBe(
      'changed the type of total on orders: VARCHAR → DECIMAL',
    )
  })

  it('lists the visible fields of a changed entry', () => {
    const rel = entry({
      entityType: 'relationship',
      name: 'A -> B',
      tableName: null,
      fields: [
        { field: 'cardinality', before: 'a', after: 'b', layout: false },
        { field: 'routingPoints', before: null, after: '[]', layout: true },
      ],
    })
    expect(stripMarks(describeDiffEntry(rel, 'changed', false, t))).toBe(
      'changed relationship A -> B (cardinality)',
    )
    expect(stripMarks(describeDiffEntry(rel, 'changed', true, t))).toBe(
      'changed relationship A -> B (cardinality, routingPoints)',
    )
  })

  it('has zh-TW sentences for every kind and status', () => {
    for (const entityType of [
      'table',
      'column',
      'relationship',
      'area',
    ] as const) {
      for (const status of ['added', 'removed', 'changed'] as const) {
        const text = describeDiffEntry(
          entry({ entityType, name: 'X', fields: [] }),
          status,
          false,
          tZh,
        )
        expect(text).not.toContain('whiteboard.history')
      }
    }
  })
})
