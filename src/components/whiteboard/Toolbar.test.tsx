// src/components/whiteboard/Toolbar.test.tsx
// Unit tests for Toolbar — CARDINALITIES array + Auto Layout button (TC-AL-T-01 through T-07)

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function renderToolbar(
  props: Partial<React.ComponentProps<typeof Toolbar>> = {},
) {
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
    const autoLayoutBtn = btns.find((b) => /running/i.test(b.textContent ?? ''))
    expect(autoLayoutBtn).toBeDefined()
    expect(autoLayoutBtn!.hasAttribute('disabled')).toBe(true)
  })

  // TC-AL-T-05 — Button click calls onAutoLayoutClick when enabled
  it('TC-AL-T-05: clicking button calls onAutoLayoutClick when enabled', () => {
    const spy = vi.fn()
    renderToolbar({
      tableCount: 3,
      isAutoLayoutRunning: false,
      onAutoLayoutClick: spy,
    })
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

// ---------------------------------------------------------------------------
// authorization-denial-ux-gaps plan, step D.3: Add Table/Add Relationship
// disabled when viewerRole is below EDITOR.
// ---------------------------------------------------------------------------

describe('Toolbar write affordances gated by viewerRole', () => {
  it('Add Table and Add Relationship are enabled when viewerRole is omitted (backward compat)', () => {
    renderToolbar({})
    expect(
      screen
        .getByRole('button', { name: /add table/i })
        .hasAttribute('disabled'),
    ).toBe(false)
    expect(
      screen
        .getByRole('button', { name: /add relationship/i })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('Add Table and Add Relationship are enabled for EDITOR', () => {
    renderToolbar({ viewerRole: 'EDITOR' })
    expect(
      screen
        .getByRole('button', { name: /add table/i })
        .hasAttribute('disabled'),
    ).toBe(false)
    expect(
      screen
        .getByRole('button', { name: /add relationship/i })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('Add Table and Add Relationship are enabled for OWNER', () => {
    renderToolbar({ viewerRole: 'OWNER' })
    expect(
      screen
        .getByRole('button', { name: /add table/i })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('Add Table and Add Relationship are disabled for VIEWER', () => {
    renderToolbar({ viewerRole: 'VIEWER' })
    expect(
      screen
        .getByRole('button', { name: /add table/i })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: /add relationship/i })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('Add Table and Add Relationship are disabled for null viewerRole (no access)', () => {
    renderToolbar({ viewerRole: null })
    expect(
      screen
        .getByRole('button', { name: /add table/i })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// authorization-denial-ux-gaps plan, step C.1: the table-create dialog must
// stay open (not optimistically close) when onCreateTable rejects, so the
// user doesn't lose their input and the mutation's onError toast is visible
// against the still-open dialog.
// ---------------------------------------------------------------------------

describe('Toolbar dialog stays open on create failure', () => {
  it('Add Table dialog stays open and form is preserved when onCreateTable rejects', async () => {
    const onCreateTable = vi.fn().mockRejectedValue(new Error('Forbidden'))
    renderToolbar({ onCreateTable })

    fireEvent.click(screen.getByRole('button', { name: /^add table$/i }))
    const nameInput = screen.getByLabelText(/table name/i)
    fireEvent.change(nameInput, { target: { value: 'Users' } })
    fireEvent.click(screen.getByRole('button', { name: /create table/i }))

    await waitFor(() => expect(onCreateTable).toHaveBeenCalledTimes(1))

    // Dialog is still open — the Create Table button is still present.
    expect(screen.getByRole('button', { name: /create table/i })).toBeTruthy()
    // Form input value was not reset.
    expect(screen.getByLabelText<HTMLInputElement>(/table name/i).value).toBe(
      'Users',
    )
  })

  it('Add Table dialog closes and form resets when onCreateTable resolves', async () => {
    const onCreateTable = vi.fn().mockResolvedValue(undefined)
    renderToolbar({ onCreateTable })

    fireEvent.click(screen.getByRole('button', { name: /^add table$/i }))
    const nameInput = screen.getByLabelText(/table name/i)
    fireEvent.change(nameInput, { target: { value: 'Users' } })
    fireEvent.click(screen.getByRole('button', { name: /create table/i }))

    await waitFor(() => expect(onCreateTable).toHaveBeenCalledTimes(1))

    // Dialog closed — Create Table button no longer in the document.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /create table/i }),
      ).toBeNull(),
    )
  })
})

// ---------------------------------------------------------------------------
// image-export tactical plan (Issue #104): Toolbar Export button + dialog
// ---------------------------------------------------------------------------

describe('Toolbar Export button', () => {
  it('is not rendered when onExport is omitted', () => {
    renderToolbar({})
    expect(
      screen.queryByRole('button', { name: /export as image/i }),
    ).toBeNull()
  })

  it('renders when onExport is provided', () => {
    renderToolbar({ onExport: vi.fn(), canExport: true })
    expect(
      screen.getByRole('button', { name: /export as image/i }),
    ).toBeTruthy()
  })

  it('is disabled when canExport is false', () => {
    renderToolbar({ onExport: vi.fn(), canExport: false })
    const btn = screen.getByRole('button', { name: /export as image/i })
    expect(btn.hasAttribute('disabled')).toBe(true)
  })

  it('is enabled when canExport is true', () => {
    renderToolbar({ onExport: vi.fn(), canExport: true })
    const btn = screen.getByRole('button', { name: /export as image/i })
    expect(btn.hasAttribute('disabled')).toBe(false)
  })

  it('opens the export dialog when clicked', () => {
    renderToolbar({ onExport: vi.fn(), canExport: true })
    fireEvent.click(screen.getByRole('button', { name: /export as image/i }))
    expect(screen.getByText(/export as image/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^export$/i })).toBeTruthy()
  })

  it('calls onExport with the default format/background when confirmed', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    renderToolbar({ onExport, canExport: true })
    fireEvent.click(screen.getByRole('button', { name: /export as image/i }))
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }))

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
    expect(onExport).toHaveBeenCalledWith({
      format: 'png',
      background: 'solid',
    })
  })

  it('shows an error toast and keeps working when onExport rejects', async () => {
    const onExport = vi.fn().mockRejectedValue(new Error('boom'))
    renderToolbar({ onExport, canExport: true })
    fireEvent.click(screen.getByRole('button', { name: /export as image/i }))
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }))

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
    // Dialog closes regardless of success/failure — the rejection is caught
    // by Toolbar's onExport wrapper (toast), not re-thrown to the dialog.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^export$/i })).toBeNull(),
    )
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
