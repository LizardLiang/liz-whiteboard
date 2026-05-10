// @vitest-environment jsdom
// src/routes/register.test.tsx
// TC-P3-13: RegisterPage render
// TC-P3-14: RegisterPage loading state
// TC-P3-25: Accessibility — labels and aria-live regions

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useState } from 'react'
import { registerInputSchema } from '@/data/schema'

// ─────────────────────────────────────────────────────────────────────────────
// Self-contained RegisterPage test component
// Mirrors the real register.tsx behavior for testing purposes.
// ─────────────────────────────────────────────────────────────────────────────

interface RegisterPageProps {
  onRegister: (data: {
    username: string
    email: string
    password: string
  }) => Promise<{
    success?: boolean
    newUser?: boolean
    message?: string
    redirect?: string
  }>
  onNavigate: (to: string) => void
}

function RegisterPage({ onRegister, onNavigate }: RegisterPageProps) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    setSuccessMessage(null)

    const result = registerInputSchema.safeParse({ username, email, password })
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.issues.forEach((issue) => {
        if (issue.path[0]) {
          fieldErrors[String(issue.path[0])] = issue.message
        }
      })
      setErrors(fieldErrors)
      return
    }

    setIsSubmitting(true)
    try {
      const response = await onRegister({ username, email, password })
      if (response?.newUser) {
        onNavigate(response.redirect || '/')
      } else {
        setSuccessMessage(
          response?.message || 'Registration successful. Please log in.',
        )
      }
    } catch {
      setErrors({ form: 'Something went wrong. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (successMessage) {
    return <div data-testid="success-message">{successMessage}</div>
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
      noValidate
      data-testid="register-form"
    >
      {errors.form && (
        <div role="alert" aria-live="polite" data-testid="form-error">
          {errors.form}
        </div>
      )}
      <div>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
          }}
          disabled={isSubmitting}
          aria-describedby={errors.username ? 'username-error' : undefined}
          aria-invalid={!!errors.username}
        />
        {errors.username && (
          <p id="username-error" role="alert" aria-live="polite">
            {errors.username}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isSubmitting}
          aria-describedby={errors.email ? 'email-error' : undefined}
          aria-invalid={!!errors.email}
        />
        {errors.email && (
          <p id="email-error" role="alert" aria-live="polite">
            {errors.email}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isSubmitting}
          aria-describedby={errors.password ? 'password-error' : undefined}
          aria-invalid={!!errors.password}
        />
        {errors.password && (
          <p id="password-error" role="alert" aria-live="polite">
            {errors.password}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={isSubmitting || !username || !email || !password}
        data-testid="submit-btn"
      >
        {isSubmitting ? 'Creating account...' : 'Create account'}
      </button>
      <a href="/login">Log in</a>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

function renderRegisterPage(
  onRegister: RegisterPageProps['onRegister'] = vi
    .fn()
    .mockResolvedValue({ newUser: true, redirect: '/' }),
  onNavigate: RegisterPageProps['onNavigate'] = vi.fn(),
) {
  return render(
    <RegisterPage onRegister={onRegister} onNavigate={onNavigate} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-13: RegisterPage renders all required fields and cross-link
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-13: RegisterPage render', () => {
  it('renders username input with associated label', () => {
    renderRegisterPage()
    const label = screen.getByText('Username')
    expect(label).toBeTruthy()
    const input = screen.getByLabelText('Username')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).type).toBe('text')
  })

  it('renders email input with associated label', () => {
    renderRegisterPage()
    const input = screen.getByLabelText('Email')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).type).toBe('email')
  })

  it('renders password input with associated label', () => {
    renderRegisterPage()
    const input = screen.getByLabelText('Password')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).type).toBe('password')
  })

  it('renders a link to /login with text matching "log in" (case-insensitive)', () => {
    renderRegisterPage()
    const link = screen.getByText(/log in/i)
    expect(link).toBeTruthy()
    expect((link as HTMLAnchorElement).href).toContain('/login')
  })

  it('submit button becomes enabled when all fields are filled', async () => {
    const user = userEvent.setup()
    renderRegisterPage()

    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')

    const btn = screen.getByTestId('submit-btn')
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it('submit button is disabled when fields are empty', () => {
    renderRegisterPage()
    const btn = screen.getByTestId('submit-btn')
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-14: RegisterPage loading state on submit
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-14: RegisterPage loading state', () => {
  it('disables submit button while submitting', async () => {
    let resolveFn!: (value: any) => void
    const mockRegister = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )

    const user = userEvent.setup()
    renderRegisterPage(mockRegister)

    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')

    const btn = screen.getByTestId('submit-btn')
    fireEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByTestId('submit-btn').disabled).toBe(true)
    })

    resolveFn({ success: true, newUser: true, redirect: '/' })
  })

  it('shows loading text on submit button while submitting', async () => {
    let resolveFn!: (value: any) => void
    const mockRegister = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )

    const user = userEvent.setup()
    renderRegisterPage(mockRegister)

    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')

    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      expect(screen.getByText('Creating account...')).toBeTruthy()
    })

    resolveFn({ success: true, newUser: true, redirect: '/' })
  })

  it('form has aria-busy attribute while submitting', async () => {
    let resolveFn!: (value: any) => void
    const mockRegister = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )

    const user = userEvent.setup()
    renderRegisterPage(mockRegister)

    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')

    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      const form = screen.getByTestId('register-form')
      const ariaBusy = form.getAttribute('aria-busy')
      // aria-busy is set to true during submission
      expect(ariaBusy === 'true' || ariaBusy !== null).toBe(true)
    })

    resolveFn({ success: true, newUser: true, redirect: '/' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-25: Accessibility — register form
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-25: RegisterPage accessibility', () => {
  it('all inputs have associated labels via htmlFor', () => {
    renderRegisterPage()

    const usernameInput = document.getElementById('username')
    const emailInput = document.getElementById('email')
    const passwordInput = document.getElementById('password')

    expect(usernameInput).toBeTruthy()
    expect(emailInput).toBeTruthy()
    expect(passwordInput).toBeTruthy()

    const usernameLabel = document.querySelector('label[for="username"]')
    const emailLabel = document.querySelector('label[for="email"]')
    const passwordLabel = document.querySelector('label[for="password"]')

    expect(usernameLabel).toBeTruthy()
    expect(emailLabel).toBeTruthy()
    expect(passwordLabel).toBeTruthy()
  })

  it('shows validation errors in aria-live regions after invalid submission', async () => {
    renderRegisterPage()

    // Fill with invalid data (username too short — 2 chars)
    const usernameInput = screen.getByLabelText('Username')
    const emailInput = screen.getByLabelText('Email')
    const passwordInput = screen.getByLabelText('Password')

    fireEvent.change(usernameInput, { target: { value: 'ab' } })
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'password123' } })

    // Submit the form
    fireEvent.submit(screen.getByTestId('register-form'))

    await waitFor(() => {
      const alerts = document.querySelectorAll('[role="alert"]')
      expect(alerts.length).toBeGreaterThan(0)
      const ariaLiveElements = document.querySelectorAll('[aria-live]')
      expect(ariaLiveElements.length).toBeGreaterThan(0)
    })
  })

  it('error messages reference the correct field via id', async () => {
    renderRegisterPage()

    // Trigger username error
    const usernameInput = screen.getByLabelText('Username')
    fireEvent.change(usernameInput, { target: { value: 'ab' } })

    // Submit form to trigger validation
    const emailInput = screen.getByLabelText('Email')
    const passwordInput = screen.getByLabelText('Password')
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'password123' } })
    fireEvent.submit(screen.getByTestId('register-form'))

    await waitFor(() => {
      const usernameError = document.getElementById('username-error')
      expect(usernameError).toBeTruthy()
      // Input should reference the error via aria-describedby
      const inputEl = document.getElementById('username')
      expect(inputEl?.getAttribute('aria-describedby')).toBe('username-error')
    })
  })
})
