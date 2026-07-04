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

// NOTE: RBAC was restored per the "Project & Whiteboard Authorization Enforcement"
// tactical plan — requireServerFnRole once again enforces the minimum role and
// throws ForbiddenError on denial. These tests assert the restored enforcement
// behavior (previously deferred per commit 75e8f38).

describe('requireServerFnRole — per-tier denial (SEC-RBAC-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // TC-RBAC-01: VIEWER on EDITOR-required — rejects with ForbiddenError
  it('TC-RBAC-01: VIEWER role on EDITOR-required — rejects with ForbiddenError', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'EDITOR'),
    ).rejects.toThrow(ForbiddenError)
  })

  // TC-RBAC-02: EDITOR on ADMIN-required — rejects with ForbiddenError
  it('TC-RBAC-02: EDITOR role on ADMIN-required — rejects with ForbiddenError', async () => {
    mockFindEffectiveRole.mockResolvedValue('EDITOR')
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'ADMIN'),
    ).rejects.toThrow(ForbiddenError)
  })

  // TC-RBAC-03: ADMIN on OWNER-required — rejects with ForbiddenError
  it('TC-RBAC-03: ADMIN role on OWNER-required — rejects with ForbiddenError', async () => {
    mockFindEffectiveRole.mockResolvedValue('ADMIN')
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'OWNER'),
    ).rejects.toThrow(ForbiddenError)
  })

  // TC-RBAC-04: null role on VIEWER-required — rejects with ForbiddenError
  it('TC-RBAC-04: null role on VIEWER-required — rejects with ForbiddenError', async () => {
    mockFindEffectiveRole.mockResolvedValue(null)
    await expect(
      requireServerFnRole(USER_ID, PROJECT_ID, 'VIEWER'),
    ).rejects.toThrow(ForbiddenError)
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

  // null projectId — rejects with ForbiddenError (SEC-ERR-03 anti-enumeration);
  // findEffectiveRole must not be called
  it('null projectId → rejects with ForbiddenError, findEffectiveRole not called', async () => {
    await expect(requireServerFnRole(USER_ID, null, 'VIEWER')).rejects.toThrow(
      ForbiddenError,
    )
    expect(mockFindEffectiveRole).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getWhiteboardWithDiagram viewerRole field (authorization-denial-ux-gaps plan, D.1)
//
// createServerFn-wrapped handlers can't be invoked directly outside a real
// request context, so — mirroring the established pattern in
// routes/api/whiteboards.test.ts (getWhiteboardHandler) — this exercises the
// same sequence getWhiteboardWithDiagram's handler runs: requireServerFnRole
// then findEffectiveRole, asserting the resolved role is what the handler
// attaches as `viewerRole` on its success return value.
// ─────────────────────────────────────────────────────────────────────────────

describe('getWhiteboardWithDiagram viewerRole (mirrors src/lib/server-functions.ts handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function getWhiteboardWithDiagramHandlerMirror(
    userId: string,
    projectId: string | null,
  ) {
    await requireServerFnRole(userId, projectId, 'VIEWER')
    // projectId is guaranteed non-null past this point — requireServerFnRole
    // throws above when it is null (SEC-ERR-03).
    const viewerRole = await findEffectiveRole(userId, projectId!)
    return { viewerRole }
  }

  it('VIEWER role — resolves with viewerRole: VIEWER', async () => {
    mockFindEffectiveRole.mockResolvedValue('VIEWER')
    const result = await getWhiteboardWithDiagramHandlerMirror(
      USER_ID,
      PROJECT_ID,
    )
    expect(result.viewerRole).toBe('VIEWER')
  })

  it('OWNER role — resolves with viewerRole: OWNER', async () => {
    mockFindEffectiveRole.mockResolvedValue('OWNER')
    const result = await getWhiteboardWithDiagramHandlerMirror(
      USER_ID,
      PROJECT_ID,
    )
    expect(result.viewerRole).toBe('OWNER')
  })

  it('no access — rejects with ForbiddenError before viewerRole is computed', async () => {
    mockFindEffectiveRole.mockResolvedValue(null)
    await expect(
      getWhiteboardWithDiagramHandlerMirror(USER_ID, PROJECT_ID),
    ).rejects.toThrow(ForbiddenError)
  })
})
