# Implementation Notes: Account Authentication

| Field | Value |
|-------|-------|
| **Feature** | Account Authentication |
| **Agent** | Ares (Implementation Agent) |
| **Status** | In Progress |
| **Started** | 2026-04-03 |
| **Tech Spec** | tech-spec.md (Hephaestus, 2026-04-03) |
| **Test Plan** | test-plan.md (Artemis, 2026-04-03) |

---

## Summary

Implementing a complete self-hosted authentication system across 5 phases: database layer, auth core services, auth routes + UI, project-level permissions, and WebSocket authentication.

---

## Progress

### Phase 1: Database Layer
- [x] 1.1 Updated `prisma/schema.prisma` — added User, Session, ProjectMember, ProjectRole enum; modified Project (ownerId), CollaborationSession (userId FK)
- [x] 1.2 Added Zod schemas to `src/data/schema.ts` — registerInputSchema, loginInputSchema, projectRoleSchema, permission schemas
- [x] 1.3 Generated Prisma migration
- [x] 1.4 Created `src/data/user.ts` — createUser, findUserByEmail, findUserByUsername, findUserById
- [x] 1.5 Created `src/data/session.ts` — createAuthSession, findAuthSessionByTokenHash, deleteAuthSession, deleteExpiredAuthSessions (using Auth prefix to avoid collision with existing collaboration session names)
- [x] 1.6 Created `src/data/permission.ts` — createProjectMember, findProjectMembers, findProjectMembersByUser, upsertProjectMember, deleteProjectMember, findEffectiveRole
- [x] 1.7 Lockout functions moved to rate-limit.ts in Phase 2 (fields are on User model per tech spec)

### Phase 2: Auth Core
- [x] 2.1 Created `src/lib/auth/password.ts` — hashPassword, verifyPassword (bcryptjs + SHA-256 pre-hash)
- [x] 2.2 Created `src/lib/auth/session.ts` — generateSessionToken, hashToken, createUserSession, validateSessionToken, invalidateSession, deleteExpiredSessions
- [x] 2.3 Created `src/lib/auth/cookies.ts` — parseSessionCookie, getSessionFromCookie, buildSetCookieHeader, buildClearCookieHeader
- [x] 2.4 Created `src/lib/auth/rate-limit.ts` — checkLockout, recordFailedLogin, clearLockout
- [x] 2.5 Created `src/lib/auth/first-user-migration.ts` — migrateDataToFirstUser

### Phase 3: Auth Routes, Middleware, UI
- [x] 3.1 Created `src/lib/auth/middleware.ts` — requireAuth wrapper
- [x] 3.2-3.5 Created `src/routes/api/auth.ts` — registerUser, loginUser, logoutUser, getCurrentUser
- [x] 3.6 Applied requireAuth to all existing server function files
- [x] 3.7 Updated `src/routes/__root.tsx` — beforeLoad auth check, AuthContext, SessionExpiredModal
- [x] 3.8 Created `src/routes/login.tsx` — LoginPage
- [x] 3.9 Created `src/routes/register.tsx` — RegisterPage
- [x] 3.10 Created `src/components/auth/SessionExpiredModal.tsx`
- [x] 3.11 Created `src/components/auth/AuthContext.tsx`
- [x] 3.12 Updated `src/components/layout/Header.tsx` — logout button
- [x] 3.13 Updated `src/integrations/tanstack-query/root-provider.tsx` — global 401 interception

### Phase 4: Project-Level Permissions
- [x] 4.1 Implemented findEffectiveRole in `src/data/permission.ts`
- [x] 4.2-4.3 Updated `src/data/project.ts` — userId filtering
- [x] 4.4 Updated `src/routes/api/projects.ts` — permission gates
- [x] 4.5 Updated `src/routes/api/whiteboards.ts` — permission gates
- [x] 4.6 Updated `src/routes/api/tables.ts`, columns.ts, relationships.ts — permission gates
- [x] 4.7 Created `src/routes/api/permissions.ts` — grantPermission, updatePermission, revokePermission, listProjectPermissions
- [x] 4.8 Created `src/components/project/ProjectSharePanel.tsx`
- [x] 4.9 Created `src/lib/auth/permissions.ts` — hasMinimumRole helper

### Phase 5: WebSocket Authentication
- [x] 5.1 Updated `src/routes/api/collaboration.ts` — io.use() handshake middleware
- [x] 5.2 Updated collaboration event handlers to use socket.data.userId
- [x] 5.3 Added session expiry check on active connections
- [x] 5.4 Added permission check on mutating WebSocket events
- [x] 5.5 Updated `src/hooks/use-collaboration.ts` — withCredentials, session_expired handler
- [x] 5.6 Updated `src/hooks/use-whiteboard-collaboration.ts` — permission_revoked handler

---

## Deviations from Spec

1. **Data-access naming conflict**: `src/data/session.ts` would conflict conceptually with `collaboration.ts` (which already manages `CollaborationSession`). Named the auth session functions with `AuthSession` prefix in the data layer to avoid confusion. The Prisma model is still `Session`.

2. **lockout.ts skipped**: The decomposition mentioned creating `src/data/lockout.ts` but the tech spec uses fields directly on the User model. Rate-limit functions are in `src/lib/auth/rate-limit.ts` as specified by tech spec section 5.4.

3. **EmptyState component**: The existing `src/components/project/EmptyState.tsx` was updated with the new copy per spec rather than creating a new file.

---

## Files Created

- `src/data/user.ts`
- `src/data/session.ts` (auth session data access)
- `src/data/permission.ts`
- `src/lib/auth/password.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/cookies.ts`
- `src/lib/auth/rate-limit.ts`
- `src/lib/auth/first-user-migration.ts`
- `src/lib/auth/middleware.ts`
- `src/lib/auth/permissions.ts`
- `src/routes/api/auth.ts`
- `src/routes/login.tsx`
- `src/routes/register.tsx`
- `src/components/auth/SessionExpiredModal.tsx`
- `src/components/auth/AuthContext.tsx`
- `src/routes/api/permissions.ts`
- `src/components/project/ProjectSharePanel.tsx`

---

## Files Modified

- `prisma/schema.prisma`
- `src/data/schema.ts`
- `src/data/project.ts`
- `src/routes/__root.tsx`
- `src/routes/api/projects.ts`
- `src/routes/api/whiteboards.ts`
- `src/routes/api/tables.ts`
- `src/routes/api/columns.ts`
- `src/routes/api/relationships.ts`
- `src/routes/api/folders.ts`
- `src/lib/server-functions.ts`
- `src/routes/api/collaboration.ts`
- `src/hooks/use-collaboration.ts`
- `src/hooks/use-whiteboard-collaboration.ts`
- `src/components/layout/Header.tsx`
- `src/integrations/tanstack-query/root-provider.tsx`
- `src/components/project/EmptyState.tsx`

---

## Dependencies Added

- `bcryptjs` — password hashing (pure JS, no native addon)
- `@types/bcryptjs` — TypeScript types

---

## Technical Debt

None introduced. All locked decisions respected.
