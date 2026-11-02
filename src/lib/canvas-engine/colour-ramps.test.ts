import { describe, expect, it } from 'vitest'
import { contrastRatio } from './card-style'
import {
  LEGACY_FILLS,
  PRESET_IDS,
  PRESET_RAMPS,
  parseColourWithAlpha,
  rampFor,
} from './colour-ramps'
import { DEFAULT_ELEMENT_STYLE } from './scene'

describe('rampFor presets', () => {
  it('maps each preset value to its Radix dark ramp', () => {
    const expected: Record<string, string> = {
      '#0090ff': '#1c5fa2',
      '#6e56cf': '#584892',
      '#30a46c': '#286a4b',
      '#00a2c7': '#0b6a82',
      '#e54d2e': '#8d3b2d',
    }
    for (const [value, body] of Object.entries(expected)) {
      const resolved = rampFor(value, 'dark')
      expect(resolved?.ramp.body).toBe(body)
      expect(resolved?.ramp.border).toBe(value)
      expect(resolved?.ramp.line).toBe(value)
      expect(resolved?.bodyAlpha).toBe(1)
    }
  })

  it('uses Radix light step 4 for the light body', () => {
    expect(rampFor('#00a2c7', 'light')?.ramp.body).toBe('#caf1f6')
    expect(rampFor('#696e77', 'light')?.ramp.body).toBe('#e8e8ec')
  })

  it('has slate verified against the Radix source', () => {
    expect(PRESET_RAMPS.slate.value).toBe('#696e77')
    expect(PRESET_RAMPS.slate.dark.body).toBe('#484e54')
  })

  it('has no amber or yellow preset', () => {
    expect(PRESET_IDS).toHaveLength(11)
    expect(PRESET_IDS).not.toContain('amber')
    expect(PRESET_IDS).not.toContain('yellow')
  })

  it('keeps every title readable on its body in both themes', () => {
    for (const id of PRESET_IDS) {
      for (const theme of ['dark', 'light'] as const) {
        const ramp = PRESET_RAMPS[id][theme]
        expect(contrastRatio(ramp.title, ramp.body)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(ramp.bodyText, ramp.body)).toBeGreaterThanOrEqual(
          4.5,
        )
      }
    }
  })
})

describe('rampFor legacy, default and custom fills', () => {
  it('returns null for none', () => {
    expect(rampFor('none', 'dark')).toBeNull()
  })

  it('maps the default fill to slate', () => {
    expect(rampFor(DEFAULT_ELEMENT_STYLE.fill, 'dark')?.ramp).toBe(
      PRESET_RAMPS.slate.dark,
    )
  })

  it('maps the legacy amber swatch to the orange ramp', () => {
    expect(rampFor('rgba(245, 158, 11, 0.10)', 'dark')).toEqual({
      ramp: PRESET_RAMPS.orange.dark,
      bodyAlpha: 1,
    })
    expect(LEGACY_FILLS.size).toBe(8)
  })

  it('derives a green-hued ramp with alpha for a custom rgba', () => {
    const resolved = rampFor('rgba(18, 171, 52, 0.6)', 'dark')
    expect(resolved?.bodyAlpha).toBe(0.6)
    const body = parseColourWithAlpha(resolved?.ramp.body ?? '')
    expect(body).not.toBeNull()
    expect(body!.g).toBeGreaterThan(body!.r)
    expect(body!.g).toBeGreaterThan(body!.b)
    expect(resolved?.ramp.title).toBe('#ffffff')
  })

  it('gives a near-grey custom colour the slate ramp', () => {
    expect(rampFor('#888888', 'dark')?.ramp).toBe(PRESET_RAMPS.slate.dark)
  })

  it('gives an unparseable colour the slate ramp', () => {
    expect(rampFor('not-a-colour', 'light')?.ramp).toBe(
      PRESET_RAMPS.slate.light,
    )
  })

  it('keeps every derived dark title readable on its body', () => {
    for (const fill of [
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#ff00ff',
      '#ffee00',
    ]) {
      const ramp = rampFor(fill, 'dark')!.ramp
      expect(ramp.body).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrastRatio(ramp.title, ramp.body)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps every derived light title readable on its body', () => {
    for (const fill of [
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#ff00ff',
      '#ffee00',
    ]) {
      const ramp = rampFor(fill, 'light')!.ramp
      expect(contrastRatio(ramp.title, ramp.body)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('returns the same object on repeat calls', () => {
    expect(rampFor('#123456', 'dark')).toBe(rampFor('#123456', 'dark'))
  })
})

describe('parseColourWithAlpha', () => {
  it('reads alpha from rgba, hex8 and percentages', () => {
    expect(parseColourWithAlpha('rgba(1, 2, 3, 0.5)')?.a).toBe(0.5)
    expect(parseColourWithAlpha('#ff000080')?.a).toBeCloseTo(0.502, 2)
    expect(parseColourWithAlpha('rgb(1 2 3 / 25%)')?.a).toBe(0.25)
    expect(parseColourWithAlpha('#abc')?.a).toBe(1)
    expect(parseColourWithAlpha('nope')).toBeNull()
  })
})

describe('parseColourWithAlpha leading-dot numbers', () => {
  it('accepts .6 as an alpha', () => {
    expect(parseColourWithAlpha('rgba(18, 171, 52, .6)')?.a).toBe(0.6)
  })
})
