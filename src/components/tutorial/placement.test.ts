import { describe, expect, it } from 'vitest'
import { CARD_GAP, CARD_GUTTER, padRect, placeCard } from './placement'
import type { Rect, Size } from './placement'

const desktop: Size = { width: 1600, height: 1000 }
const phone: Size = { width: 390, height: 844 }

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  )
}

function inside(p: { left: number; top: number }, c: Size, v: Size): boolean {
  return (
    p.left >= CARD_GUTTER &&
    p.top >= CARD_GUTTER &&
    p.left + c.width <= v.width - CARD_GUTTER &&
    p.top + c.height <= v.height - CARD_GUTTER
  )
}

describe('padRect', () => {
  it('grows every side by the padding', () => {
    expect(padRect({ left: 10, top: 20, width: 30, height: 40 }, 6)).toEqual({
      left: 4,
      top: 14,
      width: 42,
      height: 52,
    })
  })
})

describe('placeCard', () => {
  const card: Size = { width: 352, height: 180 }

  it('centres when there is no cutout', () => {
    const p = placeCard(null, card, desktop)
    expect(p.side).toBe('center')
    expect(p.left).toBe((1600 - 352) / 2)
    expect(p.top).toBe((1000 - 180) / 2)
  })

  it('places below when it fits', () => {
    const cutout = { left: 400, top: 100, width: 200, height: 100 }
    const p = placeCard(cutout, card, desktop)
    expect(p.side).toBe('below')
    expect(p.top).toBe(200 + CARD_GAP)
  })

  it('places above when below does not fit', () => {
    const cutout = { left: 400, top: 700, width: 200, height: 250 }
    const p = placeCard(cutout, card, desktop)
    expect(p.side).toBe('above')
    expect(p.top + card.height + CARD_GAP).toBe(700)
  })

  it('places to the right when neither below nor above fits', () => {
    const cutout = { left: 100, top: 20, width: 300, height: 960 }
    const p = placeCard(cutout, card, desktop)
    expect(p.side).toBe('right')
    expect(p.left).toBe(400 + CARD_GAP)
  })

  it('places to the left when right does not fit', () => {
    const cutout = { left: 1200, top: 20, width: 380, height: 960 }
    const p = placeCard(cutout, card, desktop)
    expect(p.side).toBe('left')
    expect(p.left + card.width + CARD_GAP).toBe(1200)
  })

  it('falls back to centre when no side fits', () => {
    const cutout = { left: 10, top: 10, width: 370, height: 820 }
    const c: Size = { width: 358, height: 180 }
    const p = placeCard(cutout, c, phone)
    expect(p.side).toBe('center')
  })

  it('clamps horizontally inside the viewport at 1600x1000', () => {
    const cutout = { left: 1560, top: 100, width: 30, height: 30 }
    const p = placeCard(cutout, card, desktop)
    expect(inside(p, card, desktop)).toBe(true)
    const left = placeCard(
      { left: 0, top: 100, width: 30, height: 30 },
      card,
      desktop,
    )
    expect(left.left).toBe(CARD_GUTTER)
  })

  it('stays inside the viewport and off the cutout at 390x844', () => {
    const c: Size = { width: 390 - 32, height: 200 }
    const cutouts: Array<Rect> = [
      { left: 20, top: 100, width: 100, height: 40 },
      { left: 300, top: 700, width: 80, height: 100 },
      { left: 150, top: 400, width: 90, height: 60 },
    ]
    for (const cutout of cutouts) {
      const p = placeCard(cutout, c, phone)
      expect(inside(p, c, phone)).toBe(true)
      expect(overlaps({ ...p, width: c.width, height: c.height }, cutout)).toBe(
        false,
      )
    }
  })
})
