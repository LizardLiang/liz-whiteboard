// @vitest-environment jsdom
// src/components/canvas/CanvasSearch.test.tsx
// Unit tests for the Cmd/Ctrl+K canvas search palette.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CanvasSearch } from './CanvasSearch'
import type { CanvasElement } from '@/lib/canvas-engine/scene'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from '@/lib/canvas-engine/scene'

// cmdk observes its list element via ResizeObserver and scrolls the active
// item into view — neither is implemented by jsdom. No-op stubs suffice.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- lib.dom types scrollIntoView as always-present, but jsdom does not implement it at runtime; this guard avoids clobbering a real implementation if one is ever polyfilled elsewhere.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {}
}

function el(id: string, patch: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...patch,
  }
}

const scene = sceneFrom([
  el('rect-1', { kind: 'rectangle', text: 'alpha crate', zIndex: 0 }),
  el('ellipse-1', { kind: 'ellipse', text: 'beta sphere', zIndex: 1 }),
  el('text-1', { kind: 'text', text: 'alpha note', zIndex: 2 }),
  el('untitled-1', { kind: 'rectangle', text: null, zIndex: 3 }),
  el('conn-1', { kind: 'connector', text: 'alpha link', zIndex: 4 }),
])

function renderSearch(overrides?: {
  onSelectElement?: (id: string) => void
  onOpenChange?: (open: boolean) => void
}) {
  const onSelectElement = overrides?.onSelectElement ?? vi.fn()
  const onOpenChange = overrides?.onOpenChange ?? vi.fn()
  render(
    <CanvasSearch
      open
      onOpenChange={onOpenChange}
      scene={scene}
      onSelectElement={onSelectElement}
    />,
  )
  return { onSelectElement, onOpenChange }
}

describe('CanvasSearch', () => {
  it('renders Shapes, Text and Connectors groups with every labelled element, and none for the unlabelled one', () => {
    renderSearch()
    expect(screen.getByText('Shapes')).toBeTruthy()
    expect(screen.getByText('Text')).toBeTruthy()
    expect(screen.getByText('Connectors')).toBeTruthy()

    // 2 shapes (rect + ellipse) + 1 text + 1 connector = 4. The untitled
    // rectangle (null text) is absent.
    const options = screen.getAllByRole('option')
    expect(options.length).toBe(4)
  })

  it('filters to matching text across groups', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(
      screen.getByPlaceholderText(/Search canvas elements/i),
      'alpha',
    )

    const options = screen.getAllByRole('option')
    const texts = options.map((o) => o.textContent)
    expect(texts).toContain('alpha crate')
    expect(texts).toContain('alpha note')
    expect(texts).toContain('alpha link')
    expect(texts).not.toContain('beta sphere')
  })

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(
      screen.getByPlaceholderText(/Search canvas elements/i),
      'zzznomatch',
    )

    expect(screen.getByText('No matching elements.')).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('selecting a result calls onSelectElement with its id and closes the palette', async () => {
    const user = userEvent.setup()
    const onSelectElement = vi.fn()
    const onOpenChange = vi.fn()
    renderSearch({ onSelectElement, onOpenChange })

    const rectOption = screen
      .getAllByRole('option')
      .find((o) => o.textContent === 'alpha crate')!
    await user.click(rectOption)

    expect(onSelectElement).toHaveBeenCalledWith('rect-1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
