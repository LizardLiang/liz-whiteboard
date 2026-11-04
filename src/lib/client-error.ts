// Error text that is safe to send to a client.
//
// Driver and library errors (SQLite constraint text, stack-adjacent detail)
// must not reach the browser in production. Callers log the real error
// server-side and send `clientErrorMessage(error, fallback)` instead.
//
// Kept verbatim: Zod validation messages (the forms show them), errors that
// carry an app-level string `code` (ForbiddenError, BatchDenied, canvas
// errors), and plain "<thing> not found" messages. Everything else becomes
// `fallback` when NODE_ENV=production. Outside production the original
// message is returned so developers keep full detail.
import { ZodError } from 'zod'

const SAFE_ERROR_NAMES = new Set(['ForbiddenError', 'BatchDeniedError'])

export function isSafeClientError(error: unknown): boolean {
  if (error instanceof ZodError) return true
  if (!(error instanceof Error)) return false
  if (SAFE_ERROR_NAMES.has(error.name)) return true
  if (error.message.startsWith('BATCH_DENIED')) return true
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && !/sqlite/i.test(code)) return true
  return /^[A-Za-z ]{1,40} not found\.?$/.test(error.message)
}

export function clientErrorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return error instanceof Error ? error.message : fallback
  }
  if (isSafeClientError(error) && error instanceof Error) return error.message
  return fallback
}
