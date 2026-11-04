// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { clientErrorMessage } from './client-error'

afterEach(() => vi.unstubAllEnvs())

describe('clientErrorMessage', () => {
  const sqlite = Object.assign(
    new Error('UNIQUE constraint failed: DiagramTable.name'),
    { code: 'ERR_SQLITE_ERROR' },
  )

  it('hides driver detail in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(clientErrorMessage(sqlite, 'Failed to create table')).toBe(
      'Failed to create table',
    )
    expect(
      clientErrorMessage(new Error('boom: /srv/app/x.ts'), 'Unknown'),
    ).toBe('Unknown')
    expect(clientErrorMessage('str', 'Unknown')).toBe('Unknown')
  })

  it('keeps Zod, coded and not-found messages in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const zodErr = z.string().min(3).safeParse('a').error!
    expect(clientErrorMessage(zodErr, 'x')).toBe(zodErr.message)
    expect(
      clientErrorMessage(
        Object.assign(new Error('Not yours'), { code: 'FORBIDDEN' }),
        'x',
      ),
    ).toBe('Not yours')
    expect(clientErrorMessage(new Error('Project not found'), 'x')).toBe(
      'Project not found',
    )
  })

  it('returns the real message outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(clientErrorMessage(sqlite, 'fallback')).toBe(sqlite.message)
  })
})

describe('known translated server messages', () => {
  it('keeps messages the UI maps to i18n keys, including templates', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { en } = await import('@/lib/i18n/locales/en')
    for (const text of Object.values(en.errors)) {
      if (text.includes('{')) continue
      expect(clientErrorMessage(new Error(text), 'fallback')).toBe(text)
    }
    expect(
      clientErrorMessage(
        new Error('Only ADMIN or OWNER can grant permissions'),
        'x',
      ),
    ).toBe('Only ADMIN or OWNER can grant permissions')
  })

  it('no dictionary template is a bare placeholder that would match everything', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(
      clientErrorMessage(new Error('SQLITE_CONSTRAINT: boom'), 'fallback'),
    ).toBe('fallback')
    expect(clientErrorMessage(new Error('anything at all'), 'fallback')).toBe(
      'fallback',
    )
  })
})
