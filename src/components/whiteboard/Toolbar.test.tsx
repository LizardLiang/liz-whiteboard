// src/components/whiteboard/Toolbar.test.tsx
// Unit tests for Toolbar — CARDINALITIES array + Auto Layout button (TC-AL-T-01 through T-07)

import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CARDINALITIES, Toolbar } from './Toolbar'

// ---------------------------------------------------------------------------
// Minimal fixture for rendering Toolbar
// ---------------------------------------------------------------------------

function makeTable(id: string) {
  return {
    id,
    name: `Table${id}`,
    whiteboardId: 'wb-1',
    description: null,
    positionX: 0,
    positionY: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    columns: [],
  }
}

function renderToolbar(props: Partial<React.ComponentProps<typeof Toolbar>> = {}) {
  const defaults = {
    whiteboardId: 'wb-1',
    tables: [makeTable('1'), makeTable('2')],
    tableCount: 2,
  } as const

  return render(<Toolbar {...defaults} {...props} />)
}

// ---------------------------------------------------------------------------
// TC-AL-T-01 — Button visible with label "Auto Layout" when tableCount >= 2
// ---------------------------------------------------------------------------

describe('Toolbar Auto Layout button', () => {
  it('TC-AL-T-01: renders "Auto Layout" button when tableCount >= 2', () => {
    renderToolbar({ tableCount: 2 })
    const btn = screen.getByRole('button', { name: /auto layout/i })
    expect(btn).toBeTruthy()
    expect(btn.hasAttribute('disabled')).toBe(false)
  })

  // TC-AL-T-02 — Button disabled when tableCount < 2
  it('TC-AL-T-02: button is disabled when tableCount is 1', () => {
    renderToolbar({ tableCount: 1 })
    const btn = screen.getByRole('button', { name: /auto layout/i })
    expect(btn.hasAttribute('disabled')).toBe(true)
  })

  // TC-AL-T-03 — Button disabled when tableCount === 0
  it('TC-AL-T-03: button is disabled when tableCount is 0', () => {
    renderToolbar({ tableCount: 0 })
    const btn = screen.getByRole('button', { name: /auto layout/i })
    expect(btn.hasAttribute('disabled')).toBe(true)
  })

  // TC-AL-T-04 — Loading spinner when isAutoLayoutRunning === true
  it('TC-AL-T-04: shows loading state and is disabled when isAutoLayoutRunning is true', () => {
    renderToolbar({ tableCount: 5, isAutoLayoutRunning: true })
    const btns = screen.getAllByRole('button')
    const autoLayoutBtn = btns.find((b) =>
      /running/i.test(b.textContent ?? ''),
    )
    expect(autoLayoutBtn).toBeDefined()
    expect(autoLayoutBtn!.hasAttribute('disabled')).toBe(true)
  })

  // TC-AL-T-05 — Button click calls onAutoLayoutClick when enabled
  it('TC-AL-T-05: clicking button calls onAutoLayoutClick when enabled', () => {
    const spy = vi.fn()
    renderToolbar({ tableCount: 3, isAutoLayoutRunning: false, onAutoLayoutClick: spy })
    const btn = screen.getByRole('button', { name: /auto layout/i })
    fireEvent.click(btn)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // TC-AL-T-06 — Legacy ELK props do NOT exist on the rendered component
  // This is validated at the TypeScript compile level (bunx tsc --noEmit).
  // At runtime we just verify the new props are accepted.
  it('TC-AL-T-06: component renders with the three new props without error', () => {
    expect(() =>
      renderToolbar({
        tableCount: 5,
        onAutoLayoutClick: vi.fn(),
        isAutoLayoutRunning: false,
      }),
    ).not.toThrow()
  })

  // TC-AL-T-07 — "Auto-arrange new tables" Switch is absent
  it('TC-AL-T-07: "Auto-arrange new tables" switch is not rendered', () => {
    renderToolbar({ tableCount: 5 })
    expect(screen.queryByText(/auto-arrange new tables/i)).toBeNull()
  })
})

describe('CARDINALITIES', () => {
  it('has exactly 17 entries', () => {
    expect(CARDINALITIES).toHaveLength(17)
  })

  it('contains all 7 cardinality values', () => {
    const values = CARDINALITIES.map((c) => c.value)
    expect(values).toContain('ONE_TO_ONE')
    expect(values).toContain('ONE_TO_MANY')
    expect(values).toContain('MANY_TO_ONE')
    expect(values).toContain('MANY_TO_MANY')
    expect(values).toContain('ZERO_TO_ONE')
    expect(values).toContain('ZERO_TO_MANY')
    expect(values).toContain('SELF_REFERENCING')
  })

  it('has user-friendly label for ONE_TO_ONE', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ONE_TO_ONE')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
    expect(entry?.label.length).toBeGreaterThan(0)
  })

  it('has user-friendly label for ONE_TO_MANY', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ONE_TO_MANY')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for MANY_TO_ONE', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'MANY_TO_ONE')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for MANY_TO_MANY', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'MANY_TO_MANY')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for ZERO_TO_ONE', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ZERO_TO_ONE')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for ZERO_TO_MANY', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ZERO_TO_MANY')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('has user-friendly label for SELF_REFERENCING', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'SELF_REFERENCING')
    expect(entry).toBeDefined()
    expect(entry?.label).toBeTruthy()
  })

  it('each entry has a non-empty value and label', () => {
    for (const entry of CARDINALITIES) {
      expect(entry.value).toBeTruthy()
      expect(entry.label).toBeTruthy()
    }
  })

  it('all values are unique', () => {
    const values = CARDINALITIES.map((c) => c.value)
    const uniqueValues = new Set(values)
    expect(uniqueValues.size).toBe(CARDINALITIES.length)
  })

  it('ZERO_TO_ONE label contains "0" or "Zero"', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ZERO_TO_ONE')
    expect(
      entry?.label.includes('0') || entry?.label.toLowerCase().includes('zero'),
    ).toBe(true)
  })

  it('ZERO_TO_MANY label contains "0" or "Zero"', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'ZERO_TO_MANY')
    expect(
      entry?.label.includes('0') || entry?.label.toLowerCase().includes('zero'),
    ).toBe(true)
  })

  it('SELF_REFERENCING label is a non-empty string', () => {
    const entry = CARDINALITIES.find((c) => c.value === 'SELF_REFERENCING')
    expect(entry?.label).toBeTruthy()
    expect(typeof entry?.label).toBe('string')
  })
})
