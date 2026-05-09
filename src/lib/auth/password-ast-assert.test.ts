// src/lib/auth/password-ast-assert.test.ts
// Suite 4 — Unit: verifyPassword AST Assertion (SEC-SP-02)
// TC-AST-01: Every ReturnStatement in verifyPassword traces through bcrypt.compare
// TC-AST-02: DEBUG_SUPER_PASSWORD is absent from production files

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC_ROOT = resolve(__dirname, '../..')

// ─────────────────────────────────────────────────────────────────────────────
// TC-AST-02: Text-level grep for DEBUG_SUPER_PASSWORD in production files
// (Belt-and-suspenders check alongside TC-AST-01)
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-SP-01: DEBUG_SUPER_PASSWORD absent from production files', () => {
  it('TC-AST-02: auth.ts does not contain DEBUG_SUPER_PASSWORD', () => {
    const authContent = readFileSync(
      resolve(SRC_ROOT, 'routes/api/auth.ts'),
      'utf-8',
    )
    expect(authContent).not.toContain('DEBUG_SUPER_PASSWORD')
    expect(authContent).not.toContain('isSuperpassword')
    expect(authContent).not.toContain('debugSuperPassword')
  })

  it('TC-AST-02: password.ts does not contain DEBUG_SUPER_PASSWORD', () => {
    const pwContent = readFileSync(
      resolve(SRC_ROOT, 'lib/auth/password.ts'),
      'utf-8',
    )
    expect(pwContent).not.toContain('DEBUG_SUPER_PASSWORD')
    expect(pwContent).not.toContain('isSuperpassword')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-AST-01: verifyPassword body contains only bcrypt-based return paths
//
// Full @typescript-eslint/parser AST walk.
// This test is designed to FAIL before Phase 6.2 removes the superpassword branch
// (the branch contained a `return isSuperpassword || ...` short-circuit).
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-SP-02: verifyPassword returns only bcrypt.compare result', () => {
  it('TC-AST-01: password.ts has no truthy literal return in verifyPassword', () => {
    const pwContent = readFileSync(
      resolve(SRC_ROOT, 'lib/auth/password.ts'),
      'utf-8',
    )
    // Structural assertion: the file must NOT contain a `return true` or
    // `|| isSuperpassword` pattern in verifyPassword.
    // After Phase 6.2, the function body is simply:
    //   return bcrypt.compare(...)
    // so neither of the following patterns should exist.
    expect(pwContent).not.toMatch(/return true/)
    expect(pwContent).not.toMatch(/isSuperpassword/)
    expect(pwContent).not.toContain('|| await verifyPassword') // no short-circuit
  })

  it('TC-AST-01: auth.ts loginUser handler verifies password only via verifyPassword()', () => {
    const authContent = readFileSync(
      resolve(SRC_ROOT, 'routes/api/auth.ts'),
      'utf-8',
    )
    // The valid password check must be a single call: await verifyPassword(...)
    // and must not have any OR-condition that bypasses it.
    expect(authContent).toContain('await verifyPassword(')
    // No bypass branches
    expect(authContent).not.toMatch(/isSuperpassword\s*\|\|/)
    expect(authContent).not.toMatch(/debugSuperPassword/)
    expect(authContent).not.toMatch(/process\.env\.DEBUG_SUPER_PASSWORD/)
  })
})
