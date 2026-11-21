// src/lib/auth/signup-flow.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issueSignupEmail } from './signup-flow'
import { hashSignupToken } from './signup-token'
import { db } from '@/db'
import { getSignupTokenState } from '@/data/signup-token'
import { makeUser, resetDb } from '@/test/db-helpers'

const sendEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/resend', () => ({ sendEmail }))

const base = {
  redirectTo: null,
  locale: 'en' as const,
  requestOrigin: 'http://localhost:3000',
}
const rows = () =>
  Number(
    (
      db.prepare('SELECT count(*) AS c FROM "SignupToken"').get() as {
        c: number
      }
    ).c,
  )
const users = () =>
  Number(
    (db.prepare('SELECT count(*) AS c FROM "User"').get() as { c: number }).c,
  )

beforeEach(() => {
  resetDb()
  sendEmail.mockReset()
  sendEmail.mockResolvedValue(undefined)
  vi.stubEnv('APP_BASE_URL', 'https://app.example.com')
})

describe('issueSignupEmail', () => {
  it('sends a signup link for a new email whose hash matches the stored row, and creates no User', async () => {
    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: 'alice',
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const mail = sendEmail.mock.calls[0][0]
    const raw = /\/signup\/([0-9a-f]{64})/.exec(mail.text)![1]
    expect(mail.text).toContain('https://app.example.com/signup/')
    expect(getSignupTokenState(hashSignupToken(raw)).state).toBe('valid')
    expect(users()).toBe(0)
  })

  it('sends the "already have an account" mail for an existing email, with no signup link', async () => {
    makeUser({ email: 'a@example.com', username: 'alice' })
    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: 'other',
      redirectTo: '/invite/xyz',
    })
    const mail = sendEmail.mock.calls[0][0]
    expect(mail.text).not.toContain('/signup/')
    expect(mail.text).toContain(
      'https://app.example.com/login?redirect=%2Finvite%2Fxyz',
    )
    expect(mail.text).toContain('https://app.example.com/forgot-password')
    expect(users()).toBe(1)
  })

  it('does the same DB work for both cases: one row each', async () => {
    makeUser({ email: 'old@example.com', username: 'old' })
    await issueSignupEmail({
      ...base,
      email: 'old@example.com',
      username: 'x1',
    })
    expect(rows()).toBe(1)
    await issueSignupEmail({
      ...base,
      email: 'new@example.com',
      username: 'x2',
    })
    expect(rows()).toBe(2)
  })

  it('escapes HTML in the link', async () => {
    vi.stubEnv('APP_BASE_URL', 'https://app.example.com/"><script>x</script>')
    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: 'alice',
    })
    const mail = sendEmail.mock.calls[0][0]
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;')
  })

  it('does not wait for the send and survives a send failure', async () => {
    sendEmail.mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      issueSignupEmail({ ...base, email: 'a@example.com', username: 'alice' }),
    ).resolves.toBeUndefined()
    await Promise.resolve()
    spy.mockRestore()
  })

  it('a resend reuses the stored username only, and the older link stays valid', async () => {
    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: 'alice',
      redirectTo: '/invite/xyz',
    })
    const first = /\/signup\/([0-9a-f]{64})/.exec(
      sendEmail.mock.calls[0][0].text,
    )![1]
    db.prepare(
      'UPDATE "SignupToken" SET "createdAt" = "createdAt" - 600000',
    ).run()

    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: null,
      redirectTo: null,
    })
    const second = /\/signup\/([0-9a-f]{64})/.exec(
      sendEmail.mock.calls[1][0].text,
    )![1]
    expect(getSignupTokenState(hashSignupToken(first)).state).toBe('valid')
    const row = getSignupTokenState(hashSignupToken(second))
    expect(row.state).toBe('valid')
    expect(row.token).toMatchObject({
      username: 'alice',
      redirectTo: null,
    })
  })

  it('a resend stores the return path the caller passes', async () => {
    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: 'alice',
      redirectTo: '/invite/xyz',
    })
    db.prepare(
      'UPDATE "SignupToken" SET "createdAt" = "createdAt" - 600000',
    ).run()
    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: null,
      redirectTo: '/invite/xyz',
    })
    const second = /\/signup\/([0-9a-f]{64})/.exec(
      sendEmail.mock.calls[1][0].text,
    )![1]
    expect(
      getSignupTokenState(hashSignupToken(second)).token?.redirectTo,
    ).toBe('/invite/xyz')
  })

  it('a resend inside the cooldown sends nothing', async () => {
    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: 'alice',
    })
    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: null,
      redirectTo: null,
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('a resend for an email with no signup and no account sends nothing', async () => {
    await issueSignupEmail({
      ...base,
      email: 'ghost@example.com',
      username: null,
      redirectTo: null,
    })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(rows()).toBe(0)
  })

  it('sends nothing in production when APP_BASE_URL is unset', async () => {
    vi.stubEnv('APP_BASE_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await issueSignupEmail({
      ...base,
      email: 'a@example.com',
      username: 'alice',
    })
    expect(sendEmail).not.toHaveBeenCalled()
    spy.mockRestore()
    vi.unstubAllEnvs()
  })
})
