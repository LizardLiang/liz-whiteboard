// @vitest-environment jsdom
// src/components/whiteboard/column/ConstraintBadges.test.tsx
// TS-03: ConstraintBadges unit tests

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { WhiteboardPermissionsProvider } from '../whiteboard-permissions-context'
import { ConstraintBadges } from './ConstraintBadges'
import type { ReactElement } from 'react'

const defaultProps = {
  isPrimaryKey: false,
  isNullable: true,
  isUnique: false,
  isForeignKey: false,
  onToggle: vi.fn(),
}

// WhiteboardPermissionsContext defaults to canEdit: false (fail-closed).
// This suite exercises the interactive toggle behavior, which requires write
// access, so every render is wrapped with an explicit canEdit: true provider.
function renderEditable(ui: ReactElement) {
  return render(
    <WhiteboardPermissionsProvider value={{ canEdit: true }}>
      {ui}
    </WhiteboardPermissionsProvider>,
  )
}

describe('ConstraintBadges', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('TC-03-01: PK badge always visible; shows active style when isPrimaryKey=true', () => {
    renderEditable(<ConstraintBadges {...defaultProps} isPrimaryKey={true} />)
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    expect(pkBadge).toBeTruthy()
    expect(pkBadge.getAttribute('aria-pressed')).toBe('true')
  })

  it('TC-03-02: PK badge is always rendered; shows inactive style when isPrimaryKey=false', () => {
    renderEditable(<ConstraintBadges {...defaultProps} isPrimaryKey={false} />)
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    expect(pkBadge).toBeTruthy()
    expect(pkBadge.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('PK')).toBeTruthy()
  })

  it('TC-03-03: clicking PK badge (on->off) debounces and calls onToggle with isPrimaryKey=false', () => {
    const onToggle = vi.fn()
    renderEditable(
      <ConstraintBadges
        {...defaultProps}
        isPrimaryKey={true}
        onToggle={onToggle}
      />,
    )
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    fireEvent.click(pkBadge)
    // Before debounce, no call
    expect(onToggle).not.toHaveBeenCalled()
    // Advance timers past 250ms debounce
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // Should be called with isPrimaryKey: false
    const calls = onToggle.mock.calls
    expect(calls.some(([c, v]) => c === 'isPrimaryKey' && v === false)).toBe(
      true,
    )
  })

  it('TC-03-04: clicking PK badge (on->off) calls onToggle with isPrimaryKey=false only', () => {
    const onToggle = vi.fn()
    renderEditable(
      <ConstraintBadges
        {...defaultProps}
        isPrimaryKey={true}
        onToggle={onToggle}
      />,
    )
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    fireEvent.click(pkBadge)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // Should only call with isPrimaryKey=false; not isNullable or isUnique
    const calls = onToggle.mock.calls
    expect(calls.some(([c, v]) => c === 'isPrimaryKey' && v === false)).toBe(
      true,
    )
    expect(calls.every(([c]) => c === 'isPrimaryKey')).toBe(true)
  })

  it('TC-03-04b: clicking PK badge (off->on) cascades: sets nullable=false and unique=true', () => {
    const onToggle = vi.fn()
    renderEditable(
      <ConstraintBadges
        {...defaultProps}
        isPrimaryKey={false}
        isNullable={true}
        isUnique={false}
        onToggle={onToggle}
      />,
    )
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    expect(pkBadge.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(pkBadge)
    // After click, optimistic state updates immediately
    expect(pkBadge.getAttribute('aria-pressed')).toBe('true')
    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const calls = onToggle.mock.calls
    // isPrimaryKey must be set to true
    expect(calls.some(([c, v]) => c === 'isPrimaryKey' && v === true)).toBe(
      true,
    )
    // cascade: isNullable must be set to false
    expect(calls.some(([c, v]) => c === 'isNullable' && v === false)).toBe(true)
    // cascade: isUnique must be set to true
    expect(calls.some(([c, v]) => c === 'isUnique' && v === true)).toBe(true)
  })

  it('TC-03-05: N badge always visible; shows active when isNullable=true', () => {
    renderEditable(<ConstraintBadges {...defaultProps} isNullable={true} />)
    const nBadge = screen.getByRole('button', { name: /toggle nullable/i })
    expect(nBadge).toBeTruthy()
    expect(nBadge.getAttribute('aria-pressed')).toBe('true')
  })

  it('TC-03-06: clicking N badge toggles isNullable independently', () => {
    const onToggle = vi.fn()
    renderEditable(
      <ConstraintBadges
        {...defaultProps}
        isNullable={true}
        onToggle={onToggle}
      />,
    )
    const nBadge = screen.getByRole('button', { name: /toggle nullable/i })
    fireEvent.click(nBadge)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onToggle).toHaveBeenCalledWith('isNullable', false)
  })

  it('TC-03-07: U badge always visible; shows active when isUnique=true', () => {
    renderEditable(<ConstraintBadges {...defaultProps} isUnique={true} />)
    const uBadge = screen.getByRole('button', { name: /toggle unique/i })
    expect(uBadge).toBeTruthy()
    expect(uBadge.getAttribute('aria-pressed')).toBe('true')
  })

  it('TC-03-08: clicking U badge toggles isUnique independently', () => {
    const onToggle = vi.fn()
    renderEditable(
      <ConstraintBadges
        {...defaultProps}
        isUnique={false}
        onToggle={onToggle}
      />,
    )
    const uBadge = screen.getByRole('button', { name: /toggle unique/i })
    fireEvent.click(uBadge)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onToggle).toHaveBeenCalledWith('isUnique', true)
  })

  it('TC-03-09: FK badge visible only when isForeignKey=true', () => {
    const { rerender } = renderEditable(
      <ConstraintBadges {...defaultProps} isForeignKey={false} />,
    )
    expect(screen.queryByText('FK')).toBeNull()

    rerender(
      <WhiteboardPermissionsProvider value={{ canEdit: true }}>
        <ConstraintBadges {...defaultProps} isForeignKey={true} />
      </WhiteboardPermissionsProvider>,
    )
    expect(screen.getByText('FK')).toBeTruthy()
  })

  it('TC-03-10: FK badge is not clickable (has no role=button)', () => {
    renderEditable(<ConstraintBadges {...defaultProps} isForeignKey={true} />)
    const fkBadge = screen.getByText('FK')
    // FK badge should not have a button role or onClick that triggers onToggle
    expect(fkBadge.getAttribute('role')).not.toBe('button')
  })

  it('TC-03-11: debounce — rapid clicks on PK badge emit only once after 250ms', () => {
    const onToggle = vi.fn()
    renderEditable(
      <ConstraintBadges
        {...defaultProps}
        isPrimaryKey={true}
        onToggle={onToggle}
      />,
    )
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })

    // Click 3 times rapidly — each click toggles state, but debounce should batch
    fireEvent.click(pkBadge)
    fireEvent.click(pkBadge)
    fireEvent.click(pkBadge)

    // No calls before debounce resolves
    expect(onToggle).not.toHaveBeenCalled()

    // After 250ms, the isPrimaryKey timer fires once
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // The isPrimaryKey constraint fires exactly once (last scheduled value)
    const pkCalls = onToggle.mock.calls.filter(([c]) => c === 'isPrimaryKey')
    expect(pkCalls.length).toBe(1)
  })

  it('TC-03-12: debounce — PK and N badges debounce independently', () => {
    const onToggle = vi.fn()
    renderEditable(
      <ConstraintBadges
        {...defaultProps}
        isPrimaryKey={true}
        isNullable={true}
        onToggle={onToggle}
      />,
    )
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    const nBadge = screen.getByRole('button', { name: /toggle nullable/i })

    // Click PK then N within 250ms
    fireEvent.click(pkBadge)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.click(nBadge)

    // Advance past both debounces
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // Each constraint fires separately
    const pkCalls = onToggle.mock.calls.filter(([c]) => c === 'isPrimaryKey')
    const nCalls = onToggle.mock.calls.filter(([c]) => c === 'isNullable')
    expect(pkCalls.length).toBeGreaterThanOrEqual(1)
    expect(nCalls.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// canEdit gating (WhiteboardPermissionsContext) — issue #109
// PK/N/U badges must become non-interactive static indicators when the
// viewer has no edit permission, while still conveying the constraint state.
// ============================================================================

describe('ConstraintBadges canEdit gating', () => {
  it('renders PK/N/U as non-interactive (no button role) when canEdit is false', () => {
    render(
      <WhiteboardPermissionsProvider value={{ canEdit: false }}>
        <ConstraintBadges
          {...defaultProps}
          isPrimaryKey={true}
          isNullable={false}
          isUnique={true}
        />
      </WhiteboardPermissionsProvider>,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // Schema info stays visible as static text
    expect(screen.getByText('PK')).toBeTruthy()
    expect(screen.getByText('N')).toBeTruthy()
    expect(screen.getByText('U')).toBeTruthy()
  })

  it('does not call onToggle when a badge is clicked with canEdit false', () => {
    const onToggle = vi.fn()
    render(
      <WhiteboardPermissionsProvider value={{ canEdit: false }}>
        <ConstraintBadges {...defaultProps} onToggle={onToggle} />
      </WhiteboardPermissionsProvider>,
    )

    fireEvent.click(screen.getByText('PK'))
    fireEvent.click(screen.getByText('N'))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('renders PK/N/U as non-interactive when rendered outside any provider (fail-closed default)', () => {
    render(<ConstraintBadges {...defaultProps} isPrimaryKey={true} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('PK')).toBeTruthy()
  })
})
