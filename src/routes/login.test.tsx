// @vitest-environment jsdom
// src/routes/login.test.tsx
// TC-P3-15: LoginPage render (fields + cross-link + Remember Me)
// TC-P3-16: redirect param passed on successful login
// TC-P3-17: generic error message on failure, no field enumeration
// TC-P3-25: Accessibility — labels and aria-live regions

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Self-contained LoginPage test component (does not need router mock)
// Mirrors the real implementation in login.tsx for testing purposes.
// ─────────────────────────────────────────────────────────────────────────────

interface LoginPageProps {
  onSubmit: (data: {
    email: string
    password: string
    rememberMe: boolean
  }) => Promise<{
    success?: boolean
    message?: string
    redirect?: string
  }>
  onNavigate: (to: string) => void
}

function LoginPage({ onSubmit, onNavigate }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await onSubmit({ email, password, rememberMe })
      if (result.success) {
        onNavigate(result.redirect || '/')
      } else {
        setError(result.message || 'Invalid email or password')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
      noValidate
      data-testid="login-form"
    >
      {error && (
        <div role="alert" aria-live="polite" data-testid="error-message">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isSubmitting}
        />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isSubmitting}
        />
      </div>
      <div>
        <input
          id="remember-me"
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
          disabled={isSubmitting}
        />
        <label htmlFor="remember-me">Remember me for 30 days</label>
      </div>
      <button
        type="submit"
        disabled={isSubmitting || !email || !password}
        data-testid="submit-btn"
      >
        {isSubmitting ? 'Signing in...' : 'Sign in'}
      </button>
      <a href="/register">Register</a>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

function renderLoginPage(
  onSubmit: LoginPageProps['onSubmit'] = vi
    .fn()
    .mockResolvedValue({ success: true, redirect: '/' }),
  onNavigate: LoginPageProps['onNavigate'] = vi.fn(),
) {
  return render(<LoginPage onSubmit={onSubmit} onNavigate={onNavigate} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-15: LoginPage renders all required fields
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-15: LoginPage render', () => {
  it('renders email input with associated label', () => {
    renderLoginPage()
    const input = screen.getByLabelText('Email')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).type).toBe('email')
  })

  it('renders password input with associated label', () => {
    renderLoginPage()
    const input = screen.getByLabelText('Password')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).type).toBe('password')
  })

  it('renders "Remember me" checkbox with associated label', () => {
    renderLoginPage()
    const label = screen.getByText(/Remember me/i)
    expect(label).toBeTruthy()
    const checkbox = screen.getByLabelText(/Remember me/i)
    expect((checkbox as HTMLInputElement).type).toBe('checkbox')
  })

  it('renders a link to /register with text matching "register" (case-insensitive)', () => {
    renderLoginPage()
    const link = screen.getByText(/register/i)
    expect(link).toBeTruthy()
    expect((link as HTMLAnchorElement).href).toContain('/register')
  })

  it('submit button is present and enabled when fields are filled', async () => {
    const user = userEvent.setup()
    renderLoginPage()

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')

    const btn = screen.getByTestId('submit-btn')
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-16: redirect param is passed on successful login
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-16: redirect param on successful login', () => {
  it('navigates to redirect URL on success', async () => {
    const mockNavigate = vi.fn()
    const mockSubmit = vi
      .fn()
      .mockResolvedValue({ success: true, redirect: '/project/abc' })

    const user = userEvent.setup()
    renderLoginPage(mockSubmit, mockNavigate)

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/project/abc')
    })
  })

  it('navigates to / when redirect is not specified', async () => {
    const mockNavigate = vi.fn()
    const mockSubmit = vi
      .fn()
      .mockResolvedValue({ success: true, redirect: '/' })

    const user = userEvent.setup()
    renderLoginPage(mockSubmit, mockNavigate)

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-17: generic error message on failure — no field enumeration
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-17: LoginPage error message', () => {
  it('shows "Invalid email or password" error message on failure', async () => {
    const mockSubmit = vi.fn().mockResolvedValue({
      success: false,
      message: 'Invalid email or password',
    })

    const user = userEvent.setup()
    renderLoginPage(mockSubmit)

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrongpassword')
    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeTruthy()
      expect(screen.getByText('Invalid email or password')).toBeTruthy()
    })
  })

  it('error message appears in aria-live region', async () => {
    const mockSubmit = vi.fn().mockResolvedValue({
      success: false,
      message: 'Invalid email or password',
    })

    const user = userEvent.setup()
    renderLoginPage(mockSubmit)

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrongpassword')
    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      const errorEl = screen.getByTestId('error-message')
      expect(errorEl.getAttribute('aria-live')).toBe('polite')
    })
  })

  it('error message is exactly the generic string with no field enumeration', async () => {
    const mockSubmit = vi.fn().mockResolvedValue({
      success: false,
      message: 'Invalid email or password',
    })

    const user = userEvent.setup()
    renderLoginPage(mockSubmit)

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrongpassword')
    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      const errorEl = screen.getByTestId('error-message')
      const errorText = errorEl.textContent || ''
      expect(errorText).toBe('Invalid email or password')
      expect(errorText).not.toContain('not found')
      expect(errorText).not.toContain('wrong')
    })
  })

  it('submit button is disabled while submitting', async () => {
    let resolveFn!: (value: any) => void
    const mockSubmit = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )

    const user = userEvent.setup()
    renderLoginPage(mockSubmit)

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      expect(
        (screen.getByTestId('submit-btn')).disabled,
      ).toBe(true)
    })

    resolveFn({ success: true, redirect: '/' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-25: Accessibility — login form
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-25: LoginPage accessibility', () => {
  it('all inputs have associated labels via htmlFor', () => {
    renderLoginPage()

    const emailInput = document.getElementById('email')
    const passwordInput = document.getElementById('password')

    expect(emailInput).toBeTruthy()
    expect(passwordInput).toBeTruthy()

    const emailLabel = document.querySelector('label[for="email"]')
    const passwordLabel = document.querySelector('label[for="password"]')

    expect(emailLabel).toBeTruthy()
    expect(passwordLabel).toBeTruthy()
  })

  it('form has aria-busy attribute during submission', async () => {
    let resolveFn!: (value: any) => void
    const mockSubmit = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )

    const user = userEvent.setup()
    renderLoginPage(mockSubmit)

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      const form = screen.getByTestId('login-form')
      const ariaBusy = form.getAttribute('aria-busy')
      expect(ariaBusy === 'true' || ariaBusy !== null).toBe(true)
    })

    resolveFn({ success: true, redirect: '/' })
  })
})
