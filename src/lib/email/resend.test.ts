// src/lib/email/resend.test.ts
// Unit tests for the Resend mailer wrapper. Mocks global
// fetch — no real network call to the Resend API.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendEmail } from './resend'

const ORIGINAL_ENV = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM: process.env.RESEND_FROM,
  NODE_ENV: process.env.NODE_ENV,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

beforeEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.RESEND_FROM
})

afterEach(() => {
  vi.unstubAllGlobals()
  restoreEnv()
})

const PARAMS = {
  to: 'user@example.com',
  subject: 'Reset your password',
  html: '<p>link</p>',
  text: 'https://example.test/reset-password?token=abc123',
}

describe('sendEmail', () => {
  it('dev fallback: logs the email and makes no fetch call when RESEND_API_KEY is unset', async () => {
    process.env.NODE_ENV = 'test'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await sendEmail(PARAMS)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    const loggedText = logSpy.mock.calls[0]?.join(' ') ?? ''
    expect(loggedText).toContain(PARAMS.to)
    expect(loggedText).toContain(PARAMS.text)

    logSpy.mockRestore()
  })

  it('logs an error and makes no fetch call when RESEND_API_KEY is unset in production', async () => {
    process.env.NODE_ENV = 'production'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await sendEmail(PARAMS)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(1)

    errorSpy.mockRestore()
  })

  it('posts to the Resend API when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 'test-api-key'
    process.env.RESEND_FROM = 'noreply@example.test'
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendEmail(PARAMS)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-api-key',
    )
    const body = JSON.parse(init.body as string) as {
      from: string
      to: string
      subject: string
    }
    expect(body.from).toBe('noreply@example.test')
    expect(body.to).toBe(PARAMS.to)
    expect(body.subject).toBe(PARAMS.subject)
  })

  it('never throws — a non-2xx response is logged instead', async () => {
    process.env.RESEND_API_KEY = 'test-api-key'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('bad request', { status: 400 })),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendEmail(PARAMS)).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('never throws — a network failure is logged instead', async () => {
    process.env.RESEND_API_KEY = 'test-api-key'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendEmail(PARAMS)).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('sends an AbortSignal so a slow Resend response cannot hang forever', async () => {
    process.env.RESEND_API_KEY = 'test-api-key'
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendEmail(PARAMS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('never throws — a request that times out is logged instead', async () => {
    process.env.RESEND_API_KEY = 'test-api-key'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          new DOMException('The operation timed out.', 'TimeoutError'),
        ),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendEmail(PARAMS)).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })
})
