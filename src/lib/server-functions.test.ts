// src/lib/server-functions.test.ts
// Suite 13 — Integration: RBAC Per-Tier Denial (SEC-RBAC-05)
// TC-RBAC-01 through TC-RBAC-04
//
// Tests RBAC enforcement using the requireRole/requireServerFnRole helpers directly.
// Mirrors the approach from whiteboards.test.ts — tests business logic, not the
// TanStack Start server-function wrapper.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ForbiddenError,
  requireServerFnRole,
} from '@/lib/auth/require-role'

vi.mock('@/data/permission', () => ({
  findEffectiveRole: vi.fn(),
}))

vi.mock('@/lib/auth/log-sample', () => ({
  logSampledError: vi.fn(),
}))

import { findEffectiveRole } from '@/data/permission'

const mockFindEffectiveRole = vi.mocked(findEffectiveRole)

const USER_ID = 'user-rbac-test-001'
const PROJECT_ID = 'project-rbac-test-001'

// ─────────────────────────────────────────────────────────────────────────────
// SEC-RBAC-05: Per-tier denial regression
// ─────────────────────────────────────────────────────────────────────────────

describe('requireServerFnRole — per-tier denial (SEC-RBAC-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // TC-RBAC-01 (Regression): VIEWER denied on EDITOR-required function
  it('TC-RBAC-01 (Regression): VIEWER role denied on EDITOR-required function → ForbiddenError', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    await expect(requireServerFnRole(USER_ID, PROJECT_ID, 'EDITOR')).rejects.toThrow(ForbiddenError)
    const err = await requireServerFnRole(USER_ID, PROJECT_ID, 'EDITOR').catch((e) => e)
    expect(err.status).toBe(403)
    expect(err.errorCode).toBe('FORBIDDEN')
  })

  // TC-RBAC-02 (Regression): EDITOR denied on ADMIN-required function
  it('TC-RBAC-02 (Regression): EDITOR role denied on ADMIN-required function → ForbiddenError', async () => {
    mockFindEffectiveRole.mockResolvedValue('EDITOR')
    await expect(requireServerFnRole(USER_ID, PROJECT_ID, 'ADMIN')).rejects.toThrow(ForbiddenError)
  })

  // TC-RBAC-03 (Regression): ADMIN denied on OWNER-required function (e.g., deleteProjectFn)
  it('TC-RBAC-03 (Regression): ADMIN role denied on OWNER-required function → ForbiddenError', async () => {
    mockFindEffectiveRole.mockResolvedValue('ADMIN')
    await expect(requireServerFnRole(USER_ID, PROJECT_ID, 'OWNER')).rejects.toThrow(ForbiddenError)
  })

  // TC-RBAC-04 (Regression): null role (no membership) denied on VIEWER-required read function
  it('TC-RBAC-04 (Regression): null role denied on VIEWER-required function → ForbiddenError', async () => {
    mockFindEffectiveRole.mockResolvedValue(null)
    await expect(requireServerFnRole(USER_ID, PROJECT_ID, 'VIEWER')).rejects.toThrow(ForbiddenError)
  })

  // Role hierarchy: OWNER satisfies EDITOR
  it('OWNER role satisfies EDITOR minimum — resolves', async () => {
    mockFindEffectiveRole.mockResolvedValue('OWNER')
    await expect(requireServerFnRole(USER_ID, PROJECT_ID, 'EDITOR')).resolves.toBeUndefined()
  })

  // Role hierarchy: ADMIN satisfies EDITOR
  it('ADMIN role satisfies EDITOR minimum — resolves', async () => {
    mockFindEffectiveRole.mockResolvedValue('ADMIN')
    await expect(requireServerFnRole(USER_ID, PROJECT_ID, 'EDITOR')).resolves.toBeUndefined()
  })

  // null projectId → ForbiddenError regardless of role (anti-enumeration)
  it('null projectId → ForbiddenError without calling findEffectiveRole', async () => {
    await expect(requireServerFnRole(USER_ID, null, 'VIEWER')).rejects.toThrow(ForbiddenError)
    expect(mockFindEffectiveRole).not.toHaveBeenCalled()
  })
})
