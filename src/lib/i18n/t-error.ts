// src/lib/i18n/t-error.ts
// Server errors stay English. This maps the exact English text to a key in the
// `errors` namespace and falls back to the original message. Entries that hold
// {name} placeholders match as templates and keep the variable part. A
// "Failed to <verb> <noun>: <reason>" message translates the prefix, keeps the
// reason, and translates the reason when it is itself a known message.

import { en } from './locales/en'
import type { TFunction } from './translate'

const KEY_BY_TEXT = new Map<string, string>()
const TEMPLATES: Array<{ key: string; re: RegExp; names: Array<string> }> = []

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

for (const [key, text] of Object.entries(en.errors)) {
  if (!text.includes('{')) {
    KEY_BY_TEXT.set(text, `errors.${key}`)
    continue
  }
  const names: Array<string> = []
  const pattern = text
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part)
      if (!m) return escapeRegExp(part)
      names.push(m[1])
      return '([\\s\\S]+?)'
    })
    .join('')
  TEMPLATES.push({
    key: `errors.${key}`,
    re: new RegExp(`^${pattern}$`),
    names,
  })
}

const VERB_KEYS = new Set(Object.keys(en.errorParts.verb))
const NOUN_KEY_BY_TEXT = new Map<string, string>(
  Object.entries(en.errorParts.noun).map(([key, text]) => [text, key]),
)
const FAILED_RE = /^Failed to (\w+) ([a-z ]+?)(?:: ([\s\S]*))?$/

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const m = err.message
    if (typeof m === 'string') return m
  }
  return ''
}

function translateMessage(t: TFunction, message: string): string {
  const exact = KEY_BY_TEXT.get(message)
  if (exact) return t(exact)

  for (const { key, re, names } of TEMPLATES) {
    const m = re.exec(message)
    if (!m) continue
    const vars: Record<string, string> = {}
    names.forEach((name, i) => {
      vars[name] = m[i + 1]
    })
    return t(key, vars)
  }

  const failed = FAILED_RE.exec(message)
  if (failed) {
    const [, verb, nounText] = failed
    const reason = failed[3] as string | undefined
    const noun = NOUN_KEY_BY_TEXT.get(nounText)
    if (VERB_KEYS.has(verb) && noun) {
      const vars = {
        verb: t(`errorParts.verb.${verb}`),
        noun: t(`errorParts.noun.${noun}`),
      }
      return reason === undefined
        ? t('errorParts.failedTo', vars)
        : t('errorParts.failedWithReason', {
            ...vars,
            reason: translateMessage(t, reason),
          })
    }
  }

  return message
}

export function tError(t: TFunction, err: unknown): string {
  return translateMessage(t, messageOf(err))
}

/** Translated error text, or the translated fallback key when there is none. */
export function tErrorOr(
  t: TFunction,
  err: unknown,
  fallbackKey: string,
): string {
  return tError(t, err) || t(fallbackKey)
}
