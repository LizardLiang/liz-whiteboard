// @vitest-environment jsdom
// src/components/whiteboard/column/ConstraintBadges.test.tsx
// TS-03: ConstraintBadges unit tests

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ConstraintBadges } from './ConstraintBadges'

const defaultProps = {
  isPrimaryKey: false,
  isNullable: true,
  isUnique: false,
  isForeignKey: false,
  onToggle: vi.fn(),
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
    render(<ConstraintBadges {...defaultProps} isPrimaryKey={true} />)
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    expect(pkBadge).toBeTruthy()
    expect(pkBadge.getAttribute('aria-pressed')).toBe('true')
  })

  it('TC-03-02: PK badge is always rendered; shows inactive style when isPrimaryKey=false', () => {
    render(<ConstraintBadges {...defaultProps} isPrimaryKey={false} />)
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    expect(pkBadge).toBeTruthy()
    expect(pkBadge.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('PK')).toBeTruthy()
  })

  it('TC-03-03: clicking PK badge (on->off) debounces and calls onToggle with isPrimaryKey=false', () => {
    const onToggle = vi.fn()
    render(<ConstraintBadges {...defaultProps} isPrimaryKey={true} onToggle={onToggle} />)
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    fireEvent.click(pkBadge)
    // Before debounce, no call
    expect(onToggle).not.toHaveBeenCalled()
    // Advance timers past 250ms debounce
    act(() => { vi.advanceTimersByTime(300) })
    // Should be called with isPrimaryKey: false
    const calls = onToggle.mock.calls
    expect(calls.some(([c, v]) => c === 'isPrimaryKey' && v === false)).toBe(true)
  })

  it('TC-03-04: clicking PK badge (on->off) calls onToggle with isPrimaryKey=false only', () => {
    const onToggle = vi.fn()
    render(<ConstraintBadges {...defaultProps} isPrimaryKey={true} onToggle={onToggle} />)
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })
    fireEvent.click(pkBadge)
    act(() => { vi.advanceTimersByTime(300) })
    // Should only call with isPrimaryKey=false; not isNullable or isUnique
    const calls = onToggle.mock.calls
    expect(calls.some(([c, v]) => c === 'isPrimaryKey' && v === false)).toBe(true)
    expect(calls.every(([c]) => c === 'isPrimaryKey')).toBe(true)
  })

  it('TC-03-04b: clicking PK badge (off->on) cascades: sets nullable=false and unique=true', () => {
    const onToggle = vi.fn()
    render(
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
    act(() => { vi.advanceTimersByTime(300) })
    const calls = onToggle.mock.calls
    // isPrimaryKey must be set to true
    expect(calls.some(([c, v]) => c === 'isPrimaryKey' && v === true)).toBe(true)
    // cascade: isNullable must be set to false
    expect(calls.some(([c, v]) => c === 'isNullable' && v === false)).toBe(true)
    // cascade: isUnique must be set to true
    expect(calls.some(([c, v]) => c === 'isUnique' && v === true)).toBe(true)
  })

  it('TC-03-05: N badge always visible; shows active when isNullable=true', () => {
    render(<ConstraintBadges {...defaultProps} isNullable={true} />)
    const nBadge = screen.getByRole('button', { name: /toggle nullable/i })
    expect(nBadge).toBeTruthy()
    expect(nBadge.getAttribute('aria-pressed')).toBe('true')
  })

  it('TC-03-06: clicking N badge toggles isNullable independently', () => {
    const onToggle = vi.fn()
    render(<ConstraintBadges {...defaultProps} isNullable={true} onToggle={onToggle} />)
    const nBadge = screen.getByRole('button', { name: /toggle nullable/i })
    fireEvent.click(nBadge)
    act(() => { vi.advanceTimersByTime(300) })
    expect(onToggle).toHaveBeenCalledWith('isNullable', false)
  })

  it('TC-03-07: U badge always visible; shows active when isUnique=true', () => {
    render(<ConstraintBadges {...defaultProps} isUnique={true} />)
    const uBadge = screen.getByRole('button', { name: /toggle unique/i })
    expect(uBadge).toBeTruthy()
    expect(uBadge.getAttribute('aria-pressed')).toBe('true')
  })

  it('TC-03-08: clicking U badge toggles isUnique independently', () => {
    const onToggle = vi.fn()
    render(<ConstraintBadges {...defaultProps} isUnique={false} onToggle={onToggle} />)
    const uBadge = screen.getByRole('button', { name: /toggle unique/i })
    fireEvent.click(uBadge)
    act(() => { vi.advanceTimersByTime(300) })
    expect(onToggle).toHaveBeenCalledWith('isUnique', true)
  })

  it('TC-03-09: FK badge visible only when isForeignKey=true', () => {
    const { rerender } = render(<ConstraintBadges {...defaultProps} isForeignKey={false} />)
    expect(screen.queryByText('FK')).toBeNull()

    rerender(<ConstraintBadges {...defaultProps} isForeignKey={true} />)
    expect(screen.getByText('FK')).toBeTruthy()
  })

  it('TC-03-10: FK badge is not clickable (has no role=button)', () => {
    render(<ConstraintBadges {...defaultProps} isForeignKey={true} />)
    const fkBadge = screen.getByText('FK')
    // FK badge should not have a button role or onClick that triggers onToggle
    expect(fkBadge.getAttribute('role')).not.toBe('button')
  })

  it('TC-03-11: debounce — rapid clicks on PK badge emit only once after 250ms', () => {
    const onToggle = vi.fn()
    render(<ConstraintBadges {...defaultProps} isPrimaryKey={true} onToggle={onToggle} />)
    const pkBadge = screen.getByRole('button', { name: /toggle primary key/i })

    // Click 3 times rapidly — each click toggles state, but debounce should batch
    fireEvent.click(pkBadge)
    fireEvent.click(pkBadge)
    fireEvent.click(pkBadge)

    // No calls before debounce resolves
    expect(onToggle).not.toHaveBeenCalled()

    // After 250ms, the isPrimaryKey timer fires once
    act(() => { vi.advanceTimersByTime(300) })

    // The isPrimaryKey constraint fires exactly once (last scheduled value)
    const pkCalls = onToggle.mock.calls.filter(([c]) => c === 'isPrimaryKey')
    expect(pkCalls.length).toBe(1)
  })

  it('TC-03-12: debounce — PK and N badges debounce independently', () => {
    const onToggle = vi.fn()
    render(
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
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.click(nBadge)

    // Advance past both debounces
    act(() => { vi.advanceTimersByTime(300) })

    // Each constraint fires separately
    const pkCalls = onToggle.mock.calls.filter(([c]) => c === 'isPrimaryKey')
    const nCalls = onToggle.mock.calls.filter(([c]) => c === 'isNullable')
    expect(pkCalls.length).toBeGreaterThanOrEqual(1)
    expect(nCalls.length).toBeGreaterThanOrEqual(1)
  })
})
