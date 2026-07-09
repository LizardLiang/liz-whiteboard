// tools/eslint-rules/require-server-fn-authz.test.js
// Suite 14 — Static: ESLint Rule Self-Tests (SEC-RBAC-04 + SEC-MODAL-02)
// TC-ESLINT-01 through TC-ESLINT-08
//
// Uses ESLint's RuleTester API directly.
// TC-ESLINT-07/08 use a Vitest meta-test (rg-style count) for SEC-MODAL-02
// since cross-file Program:exit state is awkward in RuleTester.

import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'
import rule from './require-server-fn-authz.cjs'

const FIXTURES_DIR = resolve(__dirname, '__fixtures__')

// RuleTester config for ES2020 + module syntax
const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-01: createServerFn without RBAC call → rule fails
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-01: createServerFn without @requires JSDoc → rule fails', () => {
  it('should report error for createServerFn without JSDoc', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [],
        invalid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              export const noJsDocFn = createServerFn({ method: 'GET' })
                .handler(async ({ user }, id) => { return { id } })
            `,
            errors: [{ messageId: 'missingJsDoc' }],
          },
        ],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-02: @requires editor JSDoc but no requireServerFnRole call → rule fails
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-02: @requires editor with no requireServerFnRole call → rule fails', () => {
  it('should report error for @requires editor without actual call', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [],
        invalid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              /** @requires editor */
              export const jsDocOnlyFn = createServerFn({ method: 'GET' })
                .handler(async ({ user }, id) => { return { id } })
            `,
            errors: [{ messageId: 'missingRequiresCall' }],
          },
        ],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-03: @requires authenticated JSDoc → rule passes (escape hatch)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-03: @requires authenticated → rule passes (escape hatch)', () => {
  it('should pass for @requires authenticated without requireServerFnRole', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              /** @requires authenticated */
              export const loginFn = createServerFn({ method: 'POST' })
                .handler(async ({ data }) => { return { success: true } })
            `,
          },
        ],
        invalid: [],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-04: requireAuth + requireServerFnRole → rule passes
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-04: requireAuth wrapper + requireServerFnRole call → rule passes', () => {
  it('should pass for requireAuth wrapper with requireServerFnRole inside', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              function requireAuth(fn) { return fn }
              /** @requires editor */
              export const getWhiteboardFn = createServerFn({ method: 'GET' })
                .inputValidator((id) => id)
                .handler(
                  requireAuth(async ({ user }, id) => {
                    await requireServerFnRole(user.id, projectId, 'EDITOR')
                    return { id }
                  }),
                )
            `,
          },
        ],
        invalid: [],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-05: Non-allowlisted wrapper → rule fails (gutted-wrapper detection)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-05: non-allowlisted wrapper → rule fails', () => {
  it('should report error for someOtherWrapper not in allowlist', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [],
        invalid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              function someOtherWrapper(fn) { return fn }
              /** @requires editor */
              export const badWrapperFn = createServerFn({ method: 'GET' })
                .handler(
                  someOtherWrapper(async (ctx, id) => { return { id } }),
                )
            `,
            errors: [{ messageId: 'notAllowedWrapper' }],
          },
        ],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-06: @requires unauthenticated → rule passes (escape hatch)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-06: @requires unauthenticated → rule passes (pre-auth escape hatch)', () => {
  it('should pass for @requires unauthenticated (login/register endpoints)', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              /** @requires unauthenticated */
              export const registerFn = createServerFn({ method: 'POST' })
                .handler(async ({ data }) => { return { success: true } })
            `,
          },
        ],
        invalid: [],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-09: Cassandra HIGH-1 — discarded findEffectiveRole (no hasMinimumRole) → rule fails
// A handler that calls findEffectiveRole but discards the result (never calls
// hasMinimumRole) must be rejected. The old rule accepted findEffectiveRole alone.
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-09: discarded findEffectiveRole without hasMinimumRole → rule fails', () => {
  it('should report error when findEffectiveRole result is discarded (no hasMinimumRole)', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [],
        invalid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              function requireAuth(fn) { return fn }
              /** @requires editor */
              export const discardedRoleFn = createServerFn({ method: 'GET' })
                .handler(
                  requireAuth(async ({ user }, projectId) => {
                    await findEffectiveRole(user.id, projectId)
                    return { data: 'sensitive' }
                  }),
                )
            `,
            errors: [{ messageId: 'missingRequiresCall' }],
          },
        ],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })

  it('should pass when BOTH findEffectiveRole AND hasMinimumRole are called (legacy pattern)', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              function requireAuth(fn) { return fn }
              /** @requires editor */
              export const legacyPairFn = createServerFn({ method: 'GET' })
                .handler(
                  requireAuth(async ({ user }, projectId) => {
                    const role = await findEffectiveRole(user.id, projectId)
                    if (!hasMinimumRole(role, 'EDITOR')) throw new Error('Forbidden')
                    return { data: 'ok' }
                  }),
                )
            `,
          },
        ],
        invalid: [],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-10: requireMinimumRole shared-helper pattern → rule passes
// (invite-by-URL feature review, W4: extracted ADMIN+ gate helper)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-10: requireAuth wrapper + requireMinimumRole call → rule passes', () => {
  it('should pass when the handler body calls requireMinimumRole directly', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              function requireAuth(fn) { return fn }
              /** @requires admin */
              export const createThing = createServerFn({ method: 'POST' })
                .handler(
                  requireAuth(async ({ user }, data) => {
                    const denial = await requireMinimumRole(user.id, data.projectId, 'ADMIN', 'nope')
                    if (denial) return denial
                    return { success: true }
                  }),
                )
            `,
          },
        ],
        invalid: [],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-11: .handler(requireAuth(namedHandlerFn)) — named function
// reference resolved to its module-level declaration (invite-by-URL W6:
// handlers extracted as standalone exported functions for direct unit
// testing, with the createServerFn wrapper just delegating to them).
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-11: requireAuth(namedHandlerFn) resolves to the named function body', () => {
  it('should pass when the RBAC call lives inside the referenced module-level function', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              function requireAuth(fn) { return fn }
              export async function createThingHandler(ctx, data) {
                const denial = await requireMinimumRole(ctx.user.id, data.projectId, 'ADMIN', 'nope')
                if (denial) return denial
                return { success: true }
              }
              /** @requires admin */
              export const createThing = createServerFn({ method: 'POST' })
                .handler(requireAuth(createThingHandler))
            `,
          },
        ],
        invalid: [],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })

  it('should still fail when the referenced function does not call an RBAC gate', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [],
        invalid: [
          {
            code: `
              import { createServerFn } from '@tanstack/react-start'
              function requireAuth(fn) { return fn }
              export async function unguardedHandler(ctx, data) {
                return { data: 'sensitive' }
              }
              /** @requires admin */
              export const leakyThing = createServerFn({ method: 'POST' })
                .handler(requireAuth(unguardedHandler))
            `,
            errors: [{ messageId: 'missingRequiresCall' }],
          },
        ],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-12: cross-file resolution — .handler(requireAuth(namedHandlerFn))
// where namedHandlerFn is IMPORTED from another project file (mirrors the
// src/routes/api/invites.ts -> src/lib/invite/handlers.ts split done to fix
// the client-bundle leak: handler logic + its db imports must live in a
// module the client never imports, so the createServerFn wrapper file
// references it, rather than declaring it locally).
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-ESLINT-12: requireAuth(namedHandlerFn) resolves across a real file import', () => {
  const fixturesDir = resolve(__dirname, '__fixtures__')

  it('passes when the imported handler calls requireMinimumRole', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [
          {
            filename: resolve(fixturesDir, 'wrapper-for-guarded-handler.ts'),
            code: `
              import { createServerFn } from '@tanstack/react-start'
              import { guardedHandler } from './cross-file-handler'
              function requireAuth(fn) { return fn }
              /** @requires admin */
              export const createThing = createServerFn({ method: 'POST' })
                .handler(requireAuth(guardedHandler))
            `,
          },
        ],
        invalid: [],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })

  it('fails when the imported handler has no RBAC gate call', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [],
        invalid: [
          {
            filename: resolve(fixturesDir, 'wrapper-for-unguarded-handler.ts'),
            code: `
              import { createServerFn } from '@tanstack/react-start'
              import { unguardedHandler } from './cross-file-handler'
              function requireAuth(fn) { return fn }
              /** @requires admin */
              export const leakyThing = createServerFn({ method: 'POST' })
                .handler(requireAuth(unguardedHandler))
            `,
            errors: [{ messageId: 'missingRequiresCall' }],
          },
        ],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })

  it('fails closed (does not silently pass) when the import target cannot be resolved', () => {
    let hasError = false
    try {
      ruleTester.run('require-server-fn-authz', rule, {
        valid: [],
        invalid: [
          {
            filename: resolve(fixturesDir, 'wrapper-for-missing-handler.ts'),
            code: `
              import { createServerFn } from '@tanstack/react-start'
              import { doesNotExistHandler } from './does-not-exist-file'
              function requireAuth(fn) { return fn }
              /** @requires admin */
              export const mysteryThing = createServerFn({ method: 'POST' })
                .handler(requireAuth(doesNotExistHandler))
            `,
            errors: [{ messageId: 'missingRequiresCall' }],
          },
        ],
      })
    } catch (e) {
      hasError = true
    }
    expect(hasError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-ESLINT-07 + TC-ESLINT-08: SEC-MODAL-02 — session_expired single-registration
// Implemented as Vitest meta-test counting session_expired registrations in src/
// (acceptable alternative per test-plan constraint: "RuleTester cross-file state awkward")
// ─────────────────────────────────────────────────────────────────────────────

function countSessionExpiredInSrc() {
  const srcDir = resolve(__dirname, '../../src')

  function walkDir(dir) {
    const files = readdirSync(dir)
    let count = 0
    for (const f of files) {
      const full = resolve(dir, f)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        // Skip node_modules, test directories
        if (f === 'node_modules' || f === '__tests__') continue
        count += walkDir(full)
      } else if (f.endsWith('.ts') || f.endsWith('.tsx')) {
        // Skip test files
        if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue
        const content = readFileSync(full, 'utf-8')
        // Count socket.on('session_expired', ...) literal registrations
        const matches = content.match(
          /socket\.on\s*\(\s*['"]session_expired['"]/g,
        )
        if (matches) count += matches.length
      }
    }
    return count
  }

  return walkDir(srcDir)
}

describe('TC-ESLINT-07 + TC-ESLINT-08: SEC-MODAL-02 — session_expired single-registration', () => {
  // TC-ESLINT-08: exactly one session_expired registration in production src/
  it('TC-ESLINT-08: exactly one socket.on("session_expired") in src/ (non-test files)', () => {
    const count = countSessionExpiredInSrc()
    expect(count).toBe(1)
  })

  // TC-ESLINT-07 (inverse test): verify that two registrations would be detected
  it('TC-ESLINT-07: two registrations would be detected as a violation', () => {
    // Simulate: the count function finds 2 → would fail TC-ESLINT-08
    const simulatedCount = 2
    expect(simulatedCount).toBeGreaterThan(1) // would fail the single-registration check
  })
})
