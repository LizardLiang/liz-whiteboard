// src/lib/schema-changelog/describe.test.ts
// Sentences and summaries the Changes tab shows. Names are wrapped in mark
// characters so the view can style them; stripMarks gives the plain text.

import { describe, expect, it } from 'vitest'
import {
  describeBatch,
  describeEvent,
  detailFields,
  formatRelativeTime,
  splitMarked,
  stripMarks,
} from './describe'
import type { BatchSummaryDto, ChangeEventDto } from './types'
import { translate } from '@/lib/i18n/translate'

const t = (key: string, vars?: Record<string, string | number>) =>
  translate('en', key, vars)
const tZh = (key: string, vars?: Record<string, string | number>) =>
  translate('zh-TW', key, vars)

function event(overrides: Partial<ChangeEventDto>): ChangeEventDto {
  return {
    id: 'e1',
    batchId: null,
    batchKind: null,
    actorUserId: 'u1',
    actorName: 'alice',
    viaAgent: false,
    category: 'schema',
    entityType: 'column',
    action: 'update',
    entityId: 'c1',
    entityName: 'email',
    tableId: 't1',
    tableName: 'User',
    before: null,
    after: null,
    createdAt: 0,
    ...overrides,
  }
}

const plain = (e: ChangeEventDto, translator = t) =>
  stripMarks(describeEvent(e, translator))

describe('describeEvent', () => {
  it('names a column rename', () => {
    expect(
      plain(event({ before: { name: 'mail' }, after: { name: 'email' } })),
    ).toBe('renamed column mail → email on User')
  })

  it('names a type change', () => {
    expect(
      plain(
        event({ before: { dataType: 'int' }, after: { dataType: 'bigint' } }),
      ),
    ).toBe('changed the type of email on User: int → bigint')
  })

  it('lists the changed fields of any other column update', () => {
    expect(
      plain(
        event({ before: { isNullable: true }, after: { isNullable: false } }),
      ),
    ).toBe('changed column email on User (isNullable)')
  })

  it('covers create, delete and reorder of a column', () => {
    expect(plain(event({ action: 'create' }))).toBe(
      'added column email to User',
    )
    expect(plain(event({ action: 'delete' }))).toBe(
      'removed column email from User',
    )
    expect(plain(event({ action: 'reorder' }))).toBe(
      'reordered column email on User',
    )
  })

  it('covers tables', () => {
    const base = { entityType: 'table', entityName: 'Order' }
    expect(plain(event({ ...base, action: 'create' }))).toBe(
      'created table Order',
    )
    expect(
      plain(
        event({
          ...base,
          before: { name: 'Orders' },
          after: { name: 'Order' },
        }),
      ),
    ).toBe('renamed table Orders → Order')
    expect(plain(event({ ...base, category: 'layout', action: 'move' }))).toBe(
      'moved table Order',
    )
  })

  it('covers relationships, references, areas and the restore marker', () => {
    expect(
      plain(
        event({
          entityType: 'relationship',
          action: 'create',
          entityName: 'a.b -> c.d',
        }),
      ),
    ).toBe('created relationship a.b -> c.d')
    expect(plain(event({ entityType: 'reference', action: 'delete' }))).toBe(
      'removed reference email',
    )
    expect(plain(event({ entityType: 'area', action: 'move' }))).toBe(
      'moved area email',
    )
    expect(
      plain(
        event({
          entityType: 'board',
          after: {
            restoredVersion: { snapshotId: 's', label: 'v1', createdAt: '' },
          },
        }),
      ),
    ).toBe('restored version v1')
  })

  it('falls back to a generic sentence for an unknown pair', () => {
    expect(plain(event({ entityType: 'widget', action: 'create' }))).toBe(
      'created widget email',
    )
  })

  it('keeps CJK names whole and translates the frame', () => {
    expect(
      plain(
        event({
          entityName: '電子郵件',
          tableName: '使用者資料表',
          before: { name: '郵件' },
          after: { name: '電子郵件' },
        }),
        tZh,
      ),
    ).toBe('將 使用者資料表 的欄位 郵件 重新命名為 電子郵件')
  })

  it('marks names so the view can style them', () => {
    const parts = splitMarked(
      describeEvent(
        event({ before: { name: 'mail' }, after: { name: 'email' } }),
        t,
      ),
    )
    expect(parts.filter((p) => p.name).map((p) => p.text)).toEqual([
      'mail',
      'email',
      'User',
    ])
    expect(parts.map((p) => p.text).join('')).toBe(
      'renamed column mail → email on User',
    )
  })
})

function batch(overrides: Partial<BatchSummaryDto>): BatchSummaryDto {
  return {
    batchId: 'b1',
    batchKind: 'sql-import',
    actorUserId: 'u1',
    actorName: 'alice',
    viaAgent: false,
    createdAt: 0,
    total: 3,
    counts: [
      { entityType: 'table', action: 'create', count: 1 },
      { entityType: 'column', action: 'create', count: 2 },
    ],
    restoredVersion: null,
    subject: null,
    ...overrides,
  }
}

describe('describeBatch', () => {
  it('summarises an SQL import with counts', () => {
    expect(describeBatch(batch({}), t, 'en')).toEqual({
      title: 'imported SQL',
      counts: '1 table created, 2 columns created',
    })
  })

  it('joins the counts with a full-width comma in zh-TW', () => {
    const { counts } = describeBatch(batch({}), tZh, 'zh-TW')
    expect(counts).toContain('、')
    expect(counts).not.toContain(', ')
    expect(describeBatch(batch({}), t, 'en').counts).toContain(', ')
  })

  it('reads the restored version label from the marker', () => {
    expect(
      stripMarks(
        describeBatch(
          batch({
            batchKind: 'restore',
            restoredVersion: {
              snapshotId: 's',
              label: 'Before launch',
              createdAt: '',
            },
          }),
          t,
          'en',
        ).title,
      ),
    ).toBe('restored version Before launch')
  })

  it('falls back to the version date when it has no label', () => {
    const title = stripMarks(
      describeBatch(
        batch({
          batchKind: 'restore',
          restoredVersion: {
            snapshotId: 's',
            label: null,
            createdAt: '2026-01-02T03:04:05.000Z',
          },
        }),
        t,
        'en',
      ).title,
    )
    expect(title).toBe(
      `restored version ${new Date('2026-01-02T03:04:05.000Z').toLocaleString('en')}`,
    )
  })

  it('names the subject of a table delete', () => {
    expect(
      stripMarks(
        describeBatch(
          batch({ batchKind: 'table-delete', subject: 'Order' }),
          t,
          'en',
        ).title,
      ),
    ).toBe('deleted table Order with its columns and relationships')
  })

  it('counts unknown kinds', () => {
    expect(
      describeBatch(batch({ batchKind: null, total: 7 }), t, 'en').title,
    ).toBe('made 7 changes')
  })
})

describe('detailFields', () => {
  it('pairs before and after of an update', () => {
    expect(
      detailFields(
        event({
          before: { dataType: 'int', isNullable: true },
          after: { dataType: 'bigint', isNullable: false },
        }),
      ),
    ).toEqual([
      { field: 'dataType', before: 'int', after: 'bigint' },
      { field: 'isNullable', before: 'true', after: 'false' },
    ])
  })

  it('shows the row of a create or delete and hides ids', () => {
    expect(
      detailFields(
        event({
          action: 'create',
          after: {
            id: 'x',
            tableId: 't',
            whiteboardId: 'w',
            name: 'a',
            note: null,
          },
        }),
      ),
    ).toEqual([{ field: 'name', before: null, after: 'a' }])
    expect(
      detailFields(event({ action: 'delete', before: { id: 'x', name: 'a' } })),
    ).toEqual([{ field: 'name', before: 'a', after: null }])
  })

  it('clips a long value', () => {
    const [row] = detailFields(
      event({
        before: { description: 'x' },
        after: { description: 'y'.repeat(500) },
      }),
    )
    expect(row.after!.length).toBeLessThanOrEqual(201)
  })
})

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 10, 16, 12, 0, 0)
  it('uses a relative phrase within a week', () => {
    expect(formatRelativeTime(now - 5_000, now, 'en')).toBe('now')
    expect(formatRelativeTime(now - 5 * 60_000, now, 'en')).toBe(
      '5 minutes ago',
    )
    expect(formatRelativeTime(now - 3 * 3_600_000, now, 'en')).toBe(
      '3 hours ago',
    )
    expect(formatRelativeTime(now - 2 * 86_400_000, now, 'en')).toBe(
      '2 days ago',
    )
  })
  it('uses a date after a week', () => {
    expect(formatRelativeTime(now - 30 * 86_400_000, now, 'en')).toBe(
      new Date(now - 30 * 86_400_000).toLocaleDateString('en'),
    )
  })
  it('does not go negative when the clock steps back', () => {
    expect(formatRelativeTime(now + 15_000, now, 'en')).toBe('now')
  })
})
