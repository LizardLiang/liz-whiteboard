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
import { en } from '@/lib/i18n/locales/en'

// The UI translates server errors by matching their exact English text (see
// src/lib/i18n/t-error.ts), so every message in the `errors` dictionary is an
// intentional user-facing string and passes through untouched.
const KNOWN_TEXTS = new Set<string>()
const KNOWN_TEMPLATES: Array<RegExp> = []
for (const text of Object.values(en.errors)) {
  if (!text.includes('{')) {
    KNOWN_TEXTS.add(text)
    continue
  }
  const pattern = text
    .split(/(\{\w+\})/)
    .map((part) =>
      /^\{\w+\}$/.test(part)
        ? '[\\s\\S]+?'
        : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('')
  KNOWN_TEMPLATES.push(new RegExp(`^${pattern}$`))
}

function isKnownMessage(message: string): boolean {
  return (
    KNOWN_TEXTS.has(message) || KNOWN_TEMPLATES.some((re) => re.test(message))
  )
}

const SAFE_ERROR_NAMES = new Set(['ForbiddenError', 'BatchDeniedError'])

export function isSafeClientError(error: unknown): boolean {
  if (error instanceof ZodError) return true
  if (!(error instanceof Error)) return false
  if (SAFE_ERROR_NAMES.has(error.name)) return true
  if (error.message.startsWith('BATCH_DENIED')) return true
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && !/sqlite/i.test(code)) return true
  if (isKnownMessage(error.message)) return true
  return /^[A-Za-z ]{1,40} not found\.?$/.test(error.message)
}

export function clientErrorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return error instanceof Error ? error.message : fallback
  }
  if (isSafeClientError(error) && error instanceof Error) return error.message
  return fallback
}
