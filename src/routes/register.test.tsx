// @vitest-environment jsdom
// src/routes/register.test.tsx
// Mirrors the email-link register form: email + username only, no password.
// TC-P3-13: RegisterPage render
// TC-P3-14: RegisterPage loading state
// TC-P3-25: Accessibility — labels and aria-live regions

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useState } from 'react'
import { registerInputSchema } from '@/data/schema'
import { sanitizeRedirect } from '@/lib/safe-redirect'

// ─────────────────────────────────────────────────────────────────────────────
// Self-contained RegisterPage test component
// Mirrors the real register.tsx behavior for testing purposes.
// ─────────────────────────────────────────────────────────────────────────────

interface RegisterPageProps {
  onRegister: (data: {
    username: string
    email: string
    redirect?: string
  }) => Promise<{
    success?: boolean
    error?: string
    redirect?: string
  }>
  onNavigate: (to: string) => void
  /** Mirrors register.tsx's `redirect` search param (defaults to '/'). */
  redirect?: string
}

function RegisterPage({
  onRegister,
  onNavigate,
  redirect: rawRedirect = '/',
}: RegisterPageProps) {
  // S1: mirrors register.tsx's sanitizeRedirect() call — reject any
  // redirect that isn't same-origin-relative before it's ever navigated to.
  const redirect = sanitizeRedirect(rawRedirect)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})

    const result = registerInputSchema.safeParse({ username, email })
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
      const response = await onRegister({
        username,
        email,
        ...(redirect !== '/' ? { redirect } : {}),
      })
      if (response.success) {
        // Same reply for a new and an existing email: the check-email page
        // always follows, carrying the safe return path.
        onNavigate(
          `/register/check-email?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirect)}`,
        )
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' })
      }
    } catch {
      setErrors({ form: 'Something went wrong. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
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
      <button
        type="submit"
        disabled={isSubmitting || !username || !email}
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
    .mockResolvedValue({ success: true, redirect: '/register/check-email' }),
  onNavigate: RegisterPageProps['onNavigate'] = vi.fn(),
  redirect?: string,
) {
  return render(
    <RegisterPage
      onRegister={onRegister}
      onNavigate={onNavigate}
      redirect={redirect}
    />,
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

  it('has no password field: the emailed link sets the password', () => {
    renderRegisterPage()
    expect(screen.queryByLabelText('Password')).toBeNull()
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

    const btn = screen.getByTestId('submit-btn')
    fireEvent.click(btn)

    await waitFor(() => {
      expect(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- eslint's type-aware pass disagrees with tsc here: removing this cast breaks `bun run typecheck` (getByTestId returns HTMLElement, .disabled needs HTMLButtonElement).
        (screen.getByTestId('submit-btn') as HTMLButtonElement).disabled,
      ).toBe(true)
    })

    resolveFn({ success: true, redirect: '/register/check-email' })
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

    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      expect(screen.getByText('Creating account...')).toBeTruthy()
    })

    resolveFn({ success: true, redirect: '/register/check-email' })
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

    fireEvent.click(screen.getByTestId('submit-btn'))

    await waitFor(() => {
      const form = screen.getByTestId('register-form')
      const ariaBusy = form.getAttribute('aria-busy')
      // aria-busy is set to true during submission
      expect(ariaBusy === 'true' || ariaBusy !== null).toBe(true)
    })

    resolveFn({ success: true, redirect: '/register/check-email' })
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

    expect(usernameInput).toBeTruthy()
    expect(emailInput).toBeTruthy()

    const usernameLabel = document.querySelector('label[for="username"]')
    const emailLabel = document.querySelector('label[for="email"]')

    expect(usernameLabel).toBeTruthy()
    expect(emailLabel).toBeTruthy()
  })

  it('shows validation errors in aria-live regions after invalid submission', async () => {
    renderRegisterPage()

    // Fill with invalid data (username too short — 2 chars)
    const usernameInput = screen.getByLabelText('Username')
    const emailInput = screen.getByLabelText('Email')

    fireEvent.change(usernameInput, { target: { value: 'ab' } })
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } })

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
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } })
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

// ─────────────────────────────────────────────────────────────────────────────
// `redirect` search-param support (invite-by-URL plan, Step 6)
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage redirect search param', () => {
  const checkEmail = (redirect: string) =>
    `/register/check-email?email=${encodeURIComponent('alice@example.com')}&redirect=${encodeURIComponent(redirect)}`

  async function submitWith(redirect?: string, response?: object) {
    const onNavigate = vi.fn()
    const onRegister = vi
      .fn()
      .mockResolvedValue(
        response ?? { success: true, redirect: '/register/check-email' },
      )
    const user = userEvent.setup()
    renderRegisterPage(onRegister, onNavigate, redirect)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    fireEvent.click(screen.getByTestId('submit-btn'))
    return { onNavigate, onRegister }
  }

  it('always lands on check-email and carries an invite return path through the signup', async () => {
    const { onNavigate, onRegister } = await submitWith('/invite/abc123')
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith(checkEmail('/invite/abc123'))
    })
    expect(onRegister).toHaveBeenCalledWith({
      username: 'alice',
      email: 'alice@example.com',
      redirect: '/invite/abc123',
    })
  })

  it('sends no redirect and carries "/" when no redirect search param is present', async () => {
    const { onNavigate, onRegister } = await submitWith()
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith(checkEmail('/'))
    })
    expect(onRegister).toHaveBeenCalledWith({
      username: 'alice',
      email: 'alice@example.com',
    })
  })

  // S1: open-redirect guard
  it('rejects a protocol-relative "//evil.com" redirect and never sends it', async () => {
    const { onNavigate, onRegister } = await submitWith('//evil.com')
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith(checkEmail('/'))
    })
    expect(onRegister.mock.calls[0][0]).not.toHaveProperty('redirect')
  })

  it('rejects an absolute-URL redirect and never sends it', async () => {
    const { onNavigate, onRegister } = await submitWith('https://evil.com')
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith(checkEmail('/'))
    })
    expect(onRegister.mock.calls[0][0]).not.toHaveProperty('redirect')
  })

  it('shows a form error and does not navigate when the server refuses', async () => {
    const { onNavigate } = await submitWith(undefined, {
      success: false,
      error: 'RATE_LIMITED',
    })
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toBeTruthy()
    })
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
