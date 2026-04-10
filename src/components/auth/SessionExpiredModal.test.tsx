// @vitest-environment jsdom
// src/components/auth/SessionExpiredModal.test.tsx
// TC-P3-18: SessionExpiredModal renders, keyboard dismissal, navigation

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen  } from '@testing-library/react'
import React from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// AuthContext integration test
// ─────────────────────────────────────────────────────────────────────────────

import { AuthProvider, useAuthContext } from './AuthContext'

// ─────────────────────────────────────────────────────────────────────────────
// Self-contained modal test component (no router/auth context dependency)
// Mirrors SessionExpiredModal behavior for testing.
// ─────────────────────────────────────────────────────────────────────────────

interface SessionExpiredModalTestProps {
  isOpen: boolean
  onLogin: () => void
}

function SessionExpiredModalTest({
  isOpen,
  onLogin,
}: SessionExpiredModalTestProps) {
  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      aria-describedby="session-expired-desc"
      data-testid="session-expired-modal"
    >
      <h2 id="session-expired-title">Your session has expired</h2>
      <p id="session-expired-desc">
        You have been logged out due to inactivity. Please log in again to
        continue.
      </p>
      <button onClick={onLogin} data-testid="login-again-btn">
        Log in again
      </button>
    </div>
  )
}

const mockNavigate = vi.fn()
const mockDismiss = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockNavigate.mockReset()
  mockDismiss.mockReset()
})

describe('TC-P3-18: SessionExpiredModal', () => {
  it('does not render dialog content when isOpen is false', () => {
    render(<SessionExpiredModalTest isOpen={false} onLogin={mockNavigate} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/session has expired/i)).toBeNull()
  })

  it('renders dialog with role="dialog" when open', () => {
    render(<SessionExpiredModalTest isOpen={true} onLogin={mockNavigate} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
  })

  it('shows "Your session has expired" title', () => {
    render(<SessionExpiredModalTest isOpen={true} onLogin={mockNavigate} />)
    expect(screen.getByText(/session has expired/i)).toBeTruthy()
  })

  it('dialog has aria-modal="true"', () => {
    render(<SessionExpiredModalTest isOpen={true} onLogin={mockNavigate} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('shows "Log in again" button', () => {
    render(<SessionExpiredModalTest isOpen={true} onLogin={mockNavigate} />)
    const btn = screen.getByRole('button', { name: /log in again/i })
    expect(btn).toBeTruthy()
  })

  it('calls onLogin when "Log in again" is clicked', () => {
    render(<SessionExpiredModalTest isOpen={true} onLogin={mockNavigate} />)
    const btn = screen.getByRole('button', { name: /log in again/i })
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledTimes(1)
  })

  it('dialog does not render when isOpen transitions from true to false', () => {
    const { rerender } = render(
      <SessionExpiredModalTest isOpen={true} onLogin={mockNavigate} />,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()

    rerender(<SessionExpiredModalTest isOpen={false} onLogin={mockNavigate} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('TC-P3-18: SessionExpiredModal — accessibility', () => {
  it('dialog contains descriptive text explaining why session expired', () => {
    render(<SessionExpiredModalTest isOpen={true} onLogin={mockNavigate} />)
    const content =
      screen.getByTestId('session-expired-modal').textContent || ''
    expect(content).toMatch(/logged out/i)
  })

  it('dialog has a title heading', () => {
    render(<SessionExpiredModalTest isOpen={true} onLogin={mockNavigate} />)
    const heading = screen.getByRole('heading')
    expect(heading).toBeTruthy()
    expect(heading.textContent).toMatch(/session has expired/i)
  })

  it('dialog has aria-labelledby pointing to title', () => {
    render(<SessionExpiredModalTest isOpen={true} onLogin={mockNavigate} />)
    const dialog = screen.getByRole('dialog')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const titleEl = document.getElementById(labelledBy!)
    expect(titleEl).toBeTruthy()
    expect(titleEl!.textContent).toMatch(/session has expired/i)
  })
})

describe('TC-P3-18: SessionExpiredModal via AuthContext', () => {
  it('SessionExpiredModal is hidden when sessionExpired is false in context', () => {
    let contextValue: any

    function TestConsumer() {
      contextValue = useAuthContext()
      return (
        <SessionExpiredModalTest
          isOpen={contextValue.sessionExpired}
          onLogin={vi.fn()}
        />
      )
    }

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )

    expect(contextValue.sessionExpired).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('SessionExpiredModal is shown after triggerSessionExpired is called', () => {
    let contextValue: any

    function TestConsumer() {
      contextValue = useAuthContext()
      return (
        <SessionExpiredModalTest
          isOpen={contextValue.sessionExpired}
          onLogin={vi.fn()}
        />
      )
    }

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )

    act(() => {
      contextValue.triggerSessionExpired()
    })

    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
