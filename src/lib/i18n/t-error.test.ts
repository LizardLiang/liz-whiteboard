import { describe, expect, it } from 'vitest'
import { tError, tErrorOr } from './t-error'
import { translate } from './translate'

const zh = (key: string, vars?: Record<string, string | number>) =>
  translate('zh-TW', key, vars)
const en = (key: string, vars?: Record<string, string | number>) =>
  translate('en', key, vars)

describe('tError — "Failed to <verb> <noun>: <reason>" prefixes', () => {
  it('translates the prefix and keeps an unknown reason', () => {
    expect(
      tError(zh, new Error('Failed to fetch folders: connection refused')),
    ).toBe('取得資料夾失敗：connection refused')
  })

  it('translates a known reason after the prefix', () => {
    expect(tError(zh, 'Failed to create folder: Unauthorized')).toBe(
      '建立資料夾失敗：未經授權',
    )
    expect(tError(zh, 'Failed to update project: Unknown error')).toBe(
      '更新專案失敗：未知錯誤',
    )
  })

  it('handles multi-word nouns and a prefix without a reason', () => {
    expect(tError(zh, 'Failed to fetch project tree for user: boom')).toBe(
      '取得使用者的專案樹狀結構失敗：boom',
    )
    expect(tError(zh, 'Failed to duplicate column')).toBe('複製欄位失敗')
  })

  it('leaves the English text unchanged in English', () => {
    expect(tError(en, 'Failed to fetch folders: boom')).toBe(
      'Failed to fetch folders: boom',
    )
  })

  it('does not touch an unknown verb or noun', () => {
    expect(tError(zh, 'Failed to frobnicate widgets: x')).toBe(
      'Failed to frobnicate widgets: x',
    )
  })
})

describe('tError — templates keep the variable part', () => {
  it('translates a parser warning with variables', () => {
    expect(
      tError(zh, 'Skipped unsupported statement at line 7: "DROP TABLE a"'),
    ).toBe('已略過第 7 行不支援的陳述式：「DROP TABLE a」')
    expect(
      tError(zh, 'Unrecognized mysql type "geo" — defaulted to text'),
    ).toBe('無法辨識 mysql 類型「geo」，已預設為 text')
  })

  it('translates a reference notice that starts with a variable', () => {
    expect(tError(zh, 'a.b -> c.d (unresolved reference, skipped)')).toBe(
      'a.b -> c.d（無法解析的參照，已略過）',
    )
  })

  it('translates fixed texts such as the not-connected toast', () => {
    expect(tError(zh, 'Not connected. Please wait for reconnection.')).toBe(
      '尚未連線，請等待重新連線。',
    )
  })
})

describe('tErrorOr', () => {
  it('uses the translated fallback when there is no message', () => {
    expect(tErrorOr(zh, undefined, 'hooks.shape.createFailed')).toBe(
      '建立圖形失敗',
    )
    expect(tErrorOr(zh, { message: 'Insufficient permission' }, 'x')).toBe(
      '權限不足',
    )
  })
})
