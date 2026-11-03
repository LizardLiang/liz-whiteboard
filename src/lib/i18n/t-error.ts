// src/lib/i18n/t-error.ts
// Server errors stay English. This maps the exact English text to a key in the
// `errors` namespace and falls back to the original message.

import { en } from './locales/en'
import type { TFunction } from './translate'

const KEY_BY_TEXT = new Map<string, string>(
  Object.entries(en.errors).map(([key, text]) => [text, `errors.${key}`]),
)

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message
    if (typeof m === 'string') return m
  }
  return ''
}

export function tError(t: TFunction, err: unknown): string {
  const message = messageOf(err)
  const key = KEY_BY_TEXT.get(message)
  return key ? t(key) : message
}
