import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { INVITE_DENIAL_MESSAGES } from '@/lib/invite/denial-reasons'
import { SHARE_DENIAL_MESSAGES } from '@/lib/share/denial-reasons'

describe('denial messages have a translation key', () => {
  it('every invite and share denial message is a value of en.errors', () => {
    const known = new Set<string>(Object.values(en.errors))
    for (const m of [
      ...Object.values(INVITE_DENIAL_MESSAGES),
      ...Object.values(SHARE_DENIAL_MESSAGES),
    ]) {
      expect(known.has(m)).toBe(true)
    }
  })
})
