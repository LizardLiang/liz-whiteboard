// Cross-frame text caches: a hit on unchanged text, a miss on every layout
// input, a clear on font load, and a bound on size.
import { describe, expect, it } from 'vitest'
import {
  LAYOUT_CACHE_LIMIT,
  TextCaches,
  clearTextCaches,
  textCachesFor,
} from './text-cache'
import { fontSpecOf, layoutElementText, measurerFor } from './render'
import { DEFAULT_ELEMENT_STYLE } from './scene'
import type { CanvasElement } from './scene'

function countingCtx() {
  const calls: Array<string> = []
  let font = ''
  const ctx = {
    get font() {
      return font
    },
    set font(value: string) {
      font = value
    },
    measureText(text: string) {
      calls.push(`${font}|${text}`)
      return { width: text.length * 8 }
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

function textEl(patch: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: 't',
    kind: 'text',
    x: 0,
    y: 0,
    width: 160,
    height: 60,
    rotation: 0,
    zIndex: 0,
    text: 'hello wrapped world of text',
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...patch,
  }
}

function layoutCalls(element: CanvasElement, ctx: CanvasRenderingContext2D) {
  return layoutElementText(
    element,
    measurerFor(ctx, fontSpecOf(element.style)),
    undefined,
    textCachesFor(ctx),
  )
}

describe('width cache', () => {
  it('measures a string once per font and serves repeats from the cache', () => {
    const { ctx, calls } = countingCtx()
    const measure = measurerFor(ctx, {
      fontSize: 16,
      fontWeight: 'normal',
      fontStyle: 'normal',
    })
    expect(measure('abc')).toBe(24)
    expect(measure('abc')).toBe(24)
    expect(calls).toHaveLength(1)
  })

  it('misses when the font changes', () => {
    const { ctx, calls } = countingCtx()
    const spec = { fontSize: 16, fontWeight: 'normal', fontStyle: 'normal' }
    const measure = measurerFor(ctx, spec as never)
    measure('abc')
    measure('abc', { ...spec, fontSize: 20 } as never)
    measure('abc', { ...spec, fontWeight: 'bold' } as never)
    measure('abc', { ...spec, fontStyle: 'italic' } as never)
    expect(calls).toHaveLength(4)
  })

  it('does not share entries between contexts', () => {
    const a = countingCtx()
    const b = countingCtx()
    const spec = { fontSize: 16, fontWeight: 'normal', fontStyle: 'normal' }
    measurerFor(a.ctx, spec as never)('abc')
    measurerFor(b.ctx, spec as never)('abc')
    expect(a.calls).toHaveLength(1)
    expect(b.calls).toHaveLength(1)
  })

  it('stays within its bound however many strings are measured', () => {
    const caches = new TextCaches(50)
    for (let i = 0; i < 1000; i += 1) {
      caches.width('font', `string ${i}`, () => i)
    }
    expect(caches.sizes.widths).toBeLessThanOrEqual(100)
  })

  it('keeps the recently used entry when the cache turns over', () => {
    const caches = new TextCaches(10)
    let measured = 0
    const measure = () => {
      measured += 1
      return 1
    }
    caches.width('f', 'keep', measure)
    for (let i = 0; i < 8; i += 1) caches.width('f', `a${i}`, measure)
    caches.width('f', 'keep', measure)
    for (let i = 0; i < 8; i += 1) caches.width('f', `b${i}`, measure)
    const before = measured
    caches.width('f', 'keep', measure)
    expect(measured).toBe(before)
  })

  it('is emptied when a web font finishes loading', () => {
    const { ctx, calls } = countingCtx()
    const measure = measurerFor(ctx, {
      fontSize: 16,
      fontWeight: 'normal',
      fontStyle: 'normal',
    })
    measure('abc')
    clearTextCaches()
    measure('abc')
    expect(calls).toHaveLength(2)
  })
})

describe('layout cache', () => {
  it('reuses the layout of unchanged text without measuring again', () => {
    const { ctx, calls } = countingCtx()
    const element = textEl()
    const first = layoutCalls(element, ctx)
    const measured = calls.length
    const second = layoutCalls({ ...element }, ctx)
    expect(second).toBe(first)
    expect(calls).toHaveLength(measured)
  })

  it.each<[string, Partial<CanvasElement>, (e: CanvasElement) => void]>([
    ['text', { text: 'hello wrapped world of text!' }, () => {}],
    ['width', { width: 90 }, () => {}],
    ['font size', {}, (e) => (e.style = { ...e.style, fontSize: 22 })],
    ['font weight', {}, (e) => (e.style = { ...e.style, fontWeight: 'bold' })],
    ['font style', {}, (e) => (e.style = { ...e.style, fontStyle: 'italic' })],
    ['alignment', {}, (e) => (e.style = { ...e.style, textAlign: 'center' })],
  ])('misses when the %s changes', (_name, patch, mutate) => {
    const { ctx } = countingCtx()
    const base = textEl()
    const first = layoutCalls(base, ctx)
    const changed = textEl(patch)
    mutate(changed)
    const second = layoutCalls(changed, ctx)
    expect(second).not.toBe(first)
  })

  it('misses when runs change the font of part of the text', () => {
    const { ctx } = countingCtx()
    const base = textEl()
    const first = layoutCalls(base, ctx)
    const runs = textEl({
      style: {
        ...DEFAULT_ELEMENT_STYLE,
        textRuns: [{ start: 0, end: 5, fontWeight: 'bold' }],
      },
    })
    expect(layoutCalls(runs, ctx)).not.toBe(first)
  })

  it('is emptied when a web font finishes loading', () => {
    const { ctx } = countingCtx()
    const element = textEl()
    const first = layoutCalls(element, ctx)
    clearTextCaches()
    expect(layoutCalls(element, ctx)).not.toBe(first)
  })

  it('stays within its bound', () => {
    const { ctx } = countingCtx()
    for (let i = 0; i < LAYOUT_CACHE_LIMIT * 3; i += 1) {
      layoutCalls(textEl({ text: `text ${i}` }), ctx)
    }
    expect(textCachesFor(ctx).sizes.layouts).toBeLessThanOrEqual(
      LAYOUT_CACHE_LIMIT * 2,
    )
  })

  it('gives the same lines cached or not', () => {
    const { ctx } = countingCtx()
    const element = textEl()
    const measure = measurerFor(ctx, fontSpecOf(element.style))
    const cached = layoutCalls(element, ctx)
    const fresh = layoutElementText(element, measure)
    expect(cached.lines.map((l) => l.text)).toEqual(
      fresh.lines.map((l) => l.text),
    )
    expect(cached.height).toBe(fresh.height)
  })
})

describe('font load', () => {
  it('clears the caches on document.fonts loadingdone', async () => {
    const fonts = new EventTarget()
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: fonts,
    })
    try {
      const { vi } = await import('vitest')
      vi.resetModules()
      const fresh = await import('./text-cache')
      const caches = fresh.textCachesFor({})
      let measured = 0
      caches.width('f', 'abc', () => (measured += 1))
      caches.width('f', 'abc', () => (measured += 1))
      expect(measured).toBe(1)
      fonts.dispatchEvent(new Event('loadingdone'))
      caches.width('f', 'abc', () => (measured += 1))
      expect(measured).toBe(2)
    } finally {
      Reflect.deleteProperty(document, 'fonts')
    }
  })
})
