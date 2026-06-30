// src/lib/server-functions.test.ts
// Suite 13 — Integration: RBAC Per-Tier Denial (SEC-RBAC-05)
// TC-RBAC-01 through TC-RBAC-04
//
// Tests RBAC enforcement using the requireRole/requireServerFnRole helpers directly.
// Mirrors the approach from whiteboards.test.ts — tests business logic, not the
// TanStack Start server-function wrapper.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/permission', () => ({
  findEffectiveRole: vi.fn(),
}))

vi.mock('@/lib/auth/log-sample', () => ({
  logSampledError: vi.fn(),
}))

// eslint-disable-next-line import/first
import { findEffectiveRole } from '@/data/permission'
// eslint-disable-next-line import/first
import { ForbiddenError, requireServerFnRole } from '@/lib/auth/require-role'

const mockFindEffectiveRole = vi.mocked(findEffectiveRole)

const USER_ID = 'user-rbac-test-001'
const PROJECT_ID = 'project-rbac-test-001'

// ─────────────────────────────────────────────────────────────────────────────
// SEC-RBAC-05: Per-tier denial regression
// ─────────────────────────────────────────────────────────────────────────────

// NOTE (2026-06-30): requireServerFnRole is currently a no-op stub. RBAC was intentionally
// removed in commit 75e8f38 ("fix(auth): remove project-level RBAC from WebSocket and server
// functions") and the deferral is tracked in:
//   .claude/feature/auth-security-hardening/DEFERRED-websocket-rbac.md
//
// All tests below verify the CURRENT behaviour (always resolves for any authenticated user).
// When RBAC is restored, revert these tests to the enforcement assertions they were originally
// written with.

describe('requireServerFnRole — per-tier denial (SEC-RBAC-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // TC-RBAC-01: VIEWER on EDITOR-required — resolves (RBAC deferred)
  it('TC-RBAC-01 (Regression): VIEWER role — resolves because RBAC is deferred', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'EDITOR'),
    ).resolves.toBeUndefined()
  })

  // TC-RBAC-02: EDITOR on ADMIN-required — resolves (RBAC deferred)
  it('TC-RBAC-02 (Regression): EDITOR role — resolves because RBAC is deferred', async () => {
    mockFindEffectiveRole.mockResolvedValue('EDITOR')
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'ADMIN'),
    ).resolves.toBeUndefined()
  })

  // TC-RBAC-03: ADMIN on OWNER-required — resolves (RBAC deferred)
  it('TC-RBAC-03 (Regression): ADMIN role — resolves because RBAC is deferred', async () => {
    mockFindEffectiveRole.mockResolvedValue('ADMIN')
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'OWNER'),
    ).resolves.toBeUndefined()
  })

  // TC-RBAC-04: null role on VIEWER-required — resolves (RBAC deferred)
  it('TC-RBAC-04 (Regression): null role — resolves because RBAC is deferred', async () => {
    mockFindEffectiveRole.mockResolvedValue(null)
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'VIEWER'),
    ).resolves.toBeUndefined()
  })

  // Role hierarchy: OWNER satisfies EDITOR
  it('OWNER role satisfies EDITOR minimum — resolves', async () => {
    mockFindEffectiveRole.mockResolvedValue('OWNER')
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'EDITOR'),
    ).resolves.toBeUndefined()
  })

  // Role hierarchy: ADMIN satisfies EDITOR
  it('ADMIN role satisfies EDITOR minimum — resolves', async () => {
    mockFindEffectiveRole.mockResolvedValue('ADMIN')
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'EDITOR'),
    ).resolves.toBeUndefined()
  })

  // null projectId — resolves (RBAC deferred; anti-enumeration check removed with RBAC)
  it('null projectId → resolves (RBAC deferred, findEffectiveRole not called)', async () => {
    await expect(requireServerFnRole(USER_ID, null, 'VIEWER')).resolves.toBeUndefined()
    expect(mockFindEffectiveRole).not.toHaveBeenCalled()
  })
})
