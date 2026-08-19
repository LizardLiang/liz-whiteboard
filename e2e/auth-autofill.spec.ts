// e2e/auth-autofill.spec.ts
// End-to-end coverage for the autofill dead-end on /login and /register.
//
// Bug: both forms gated their submit button on React state
// (`disabled={isSubmitting || !email || !password}`). A browser or password
// manager writes an input's DOM value directly, and the fill usually lands
// BEFORE hydration, so React's onChange never fires and state stays ''. The
// result was a dead page: credentials visible in the fields, submit button
// permanently disabled, and the Enter key dead too — HTML blocks implicit
// submission when the default submit button is disabled. No error text, no
// recovery short of retyping a character.
//
// The fix has three layers; this spec drives the two that Playwright can
// reach:
//   L1 mount sync   — useAutofillSync reads the DOM value after hydration.
//                     Covered by the "pre-hydration autofill" tests below.
//   L2 animation    — `input:-webkit-autofill` fires the `autofill-start`
//                     keyframe. A genuine password-manager fill cannot be
//                     triggered from automation, so the "post-hydration
//                     autofill" test stubs ONLY the browser-internal trigger
//                     (write value + dispatch animationstart) and drives the
//                     real handler through React's real event system. That the
//                     CSS rule itself binds the keyframe stays manually
//                     verified.
//   L3 submit read  — handleSubmit reads the form, not state. Covered by the
//                     "submit backstop" tests, which desync state on purpose.
//
// This spec must start UNAUTHENTICATED — it exercises the auth forms
// themselves — so it overrides the shared storageState from global-setup.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { E2E_AUTOFILL_USER, E2E_USER } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

/**
 * Simulates the real failure timing: the browser writes input values as soon
 * as the elements exist in the parsed HTML, which is before React hydrates and
 * attaches any listener. A MutationObserver installed via addInitScript runs
 * ahead of every page script, so it fills each field the instant it appears.
 *
 * Values are set through the property, and no event is dispatched — exactly
 * what React cannot observe.
 */
async function installPreHydrationAutofill(
  page: Page,
  values: Record<string, string>,
) {
  await page.addInitScript((fields: Record<string, string>) => {
    const pending = new Set(Object.keys(fields))

    const fill = () => {
      for (const id of [...pending]) {
        const el = document.getElementById(id) as HTMLInputElement | null
        if (!el) continue
        el.value = fields[id]
        pending.delete(id)
      }
      if (pending.size === 0) observer.disconnect()
    }

    // Observe `document`, NOT `document.documentElement`: an init script runs
    // before the document element exists, so observing it throws and silently
    // kills the rest of this script — the fill never happens and the test
    // "fails" against working code.
    const observer = new MutationObserver(fill)
    observer.observe(document, { childList: true, subtree: true })
    fill()
  }, values)
}

/**
 * Writes values with no event dispatched AFTER hydration, leaving React state
 * empty on purpose, then submits the form directly. This is the L3 assertion:
 * submission must succeed on the form's own values even when state never
 * caught up.
 */
async function desyncedSubmit(page: Page, values: Record<string, string>) {
  await page.evaluate((fields: Record<string, string>) => {
    for (const [id, value] of Object.entries(fields)) {
      const el = document.getElementById(id) as HTMLInputElement | null
      if (!el) throw new Error(`missing input #${id}`)
      el.value = value
    }
    const form = document.querySelector('form')
    if (!form) throw new Error('missing form')
    form.requestSubmit()
  }, values)
}

test.describe('Login — browser autofill', () => {
  test('pre-hydration autofill enables Sign in and signs the user in', async ({
    page,
    context,
  }) => {
    await installPreHydrationAutofill(page, {
      email: E2E_USER.email,
      password: E2E_USER.password,
    })

    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // The regression: the fields show credentials...
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(
      E2E_USER.email,
    )
    // ...and the button must be usable. Before the fix it stayed disabled
    // forever because React state was still ''.
    const signIn = page.getByRole('button', { name: 'Sign in' })
    await expect(signIn).toBeEnabled()

    await signIn.click()

    // A real session, not just an enabled button.
    await expect
      .poll(
        async () =>
          (await context.cookies()).some((c) => c.name === 'session_token'),
        { timeout: 15_000 },
      )
      .toBe(true)
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  test('submit backstop: desynced state still submits the real values', async ({
    page,
    context,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // No autofill hook fires here — state stays empty by construction, so a
    // handler reading state would POST '' and fail the login.
    await desyncedSubmit(page, {
      email: E2E_USER.email,
      password: E2E_USER.password,
    })

    await expect
      .poll(
        async () =>
          (await context.cookies()).some((c) => c.name === 'session_token'),
        { timeout: 15_000 },
      )
      .toBe(true)
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  test('post-hydration autofill syncs via the autofill-start keyframe', async ({
    page,
    context,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // Real `:-webkit-autofill` cannot be triggered from automation, but
    // Chromium's entire contribution is "write the value, then fire
    // animationstart for the bound keyframe" — both of which are reproducible.
    // Only the browser-internal trigger is stubbed here; the handler under test
    // is the real one, reached through React's real event system.
    await page.evaluate(
      ({ email, password }: { email: string; password: string }) => {
        const fields: Record<string, string> = { email, password }
        for (const [id, value] of Object.entries(fields)) {
          const el = document.getElementById(id) as HTMLInputElement
          el.value = value
          el.dispatchEvent(
            new AnimationEvent('animationstart', {
              animationName: 'autofill-start',
              bubbles: true,
            }),
          )
        }
      },
      { email: E2E_USER.email, password: E2E_USER.password },
    )

    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect
      .poll(
        async () =>
          (await context.cookies()).some((c) => c.name === 'session_token'),
        { timeout: 15_000 },
      )
      .toBe(true)
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  test('empty submit reports an error instead of failing silently', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // Dropping the emptiness gate means a blank submit now reaches
    // handleSubmit; it must say something rather than no-op.
    const signIn = page.getByRole('button', { name: 'Sign in' })
    await expect(signIn).toBeEnabled()
    await signIn.click()

    await expect(page.getByRole('alert')).toContainText(
      'Enter your email and password.',
    )
  })
})

test.describe('Register — browser autofill', () => {
  test.beforeEach(() => {
    // The account must be absent: this spec proves it can be CREATED through
    // an autofilled form. Playwright's runner is Node, so shell out to Bun.
    execFileSync('bun', ['run', 'e2e/seed-autofill.ts'], { stdio: 'inherit' })
  })

  test('pre-hydration autofill enables Create account and registers', async ({
    page,
    context,
  }) => {
    await installPreHydrationAutofill(page, {
      username: E2E_AUTOFILL_USER.username,
      email: E2E_AUTOFILL_USER.email,
      password: E2E_AUTOFILL_USER.password,
    })

    await page.goto('/register')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('textbox', { name: 'Username' })).toHaveValue(
      E2E_AUTOFILL_USER.username,
    )
    const createAccount = page.getByRole('button', { name: 'Create account' })
    await expect(createAccount).toBeEnabled()

    await createAccount.click()

    await expect
      .poll(
        async () =>
          (await context.cookies()).some((c) => c.name === 'session_token'),
        { timeout: 15_000 },
      )
      .toBe(true)
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  test('submit backstop: desynced state still registers the real values', async ({
    page,
    context,
  }) => {
    await page.goto('/register')
    await page.waitForLoadState('networkidle')

    await desyncedSubmit(page, {
      username: E2E_AUTOFILL_USER.username,
      email: E2E_AUTOFILL_USER.email,
      password: E2E_AUTOFILL_USER.password,
    })

    await expect
      .poll(
        async () =>
          (await context.cookies()).some((c) => c.name === 'session_token'),
        { timeout: 15_000 },
      )
      .toBe(true)
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  test('empty submit surfaces field errors instead of failing silently', async ({
    page,
  }) => {
    await page.goto('/register')
    await page.waitForLoadState('networkidle')

    const createAccount = page.getByRole('button', { name: 'Create account' })
    await expect(createAccount).toBeEnabled()
    await createAccount.click()

    // registerInputSchema rejects the blanks and the existing per-field error
    // UI renders them — no new error branch was added for this path.
    await expect(page.getByRole('alert').first()).toBeVisible()
  })
})
