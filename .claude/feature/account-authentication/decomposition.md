# Decomposition: Account Authentication

| Field | Value |
|-------|-------|
| **Feature** | Account Authentication |
| **Agent** | Daedalus (Decomposition Agent) |
| **Status** | Complete |
| **Created** | 2026-04-03 |
| **PRD Version** | 2 (Nemesis-approved) |
| **Phases** | 5 |
| **Total Tasks** | 27 |

---

## Overview

The account-authentication feature adds a complete self-hosted authentication system to Liz Whiteboard. It spans five natural domains: database schema (new models + migration of existing data), authentication core (hashing, session management, rate limiting), route and server function protection, project-level permission system, and WebSocket authentication. Each phase builds on the previous and delivers something independently testable.

No external auth services are used. Session tokens are stored in HttpOnly cookies (no `Secure` flag, as the user develops over HTTP on a LAN). Token generation must avoid `crypto.randomUUID()` — it requires a secure context. All Prisma IDs are UUIDs; Zod schemas use `.uuid()`.

---

## Dependency Map

```
Phase 1: Database Layer
    |
    v
Phase 2: Auth Core (hashing + session service + rate limiting)
    |
    v
Phase 3: Auth Routes + Server Function Middleware
    |         \
    v          v
Phase 4:      Phase 5:
Project       WebSocket
Permissions   Auth

Phase 4 and Phase 5 are parallel after Phase 3 completes.
```

**Critical Path:** Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 5 can begin in parallel with Phase 4 once Phase 3 is complete.

---

## Phase 1: Database Layer

**Depends on:** None (foundation)
**Blocks:** All other phases

### Scope (what IS in this phase)

- New `User` Prisma model (id, username, email, passwordHash, createdAt, updatedAt)
- New `Session` Prisma model (id, userId FK, expiresAt, createdAt)
- New `ProjectPermission` Prisma model (id, projectId FK, userId FK, role enum)
- `ProjectRole` enum (VIEWER, EDITOR, ADMIN)
- Add `ownerId` nullable FK to `Project` model (nullable until data migration runs)
- Migrate `CollaborationSession.userId` from plain string to proper UUID FK to `User`
- Prisma migration script: schema changes only (no data migration in migration file)
- Separate data migration script: assigns all existing projects to the first registered user (this script is invoked at registration time, not as a Prisma migration)
- `AccountLockout` model (email, failedAttempts, lockedUntil, updatedAt) — or represented as fields on User; decision left to Hephaestus
- Zod schemas in `src/data/schema.ts` for all new entities: user registration input, login input, session shape, permission role enum, create/update permission

### Boundaries (what is NOT in this phase)

- Business logic for using these models (Phase 2)
- Route protection or middleware (Phase 3)
- UI components (Phase 3)
- WebSocket-specific changes (Phase 5)

### Tasks

#### Wave 1 — Schema design (no prerequisites)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 1.1 | Add User, Session, ProjectPermission, ProjectRole, AccountLockout models to Prisma schema; add ownerId (nullable) to Project; change CollaborationSession.userId to UUID FK | `prisma/schema.prisma` | M | `bunx prisma validate` exits 0 |
| 1.2 | Add Zod schemas for auth entities: registerInputSchema (username 3-50 chars alphanumeric+undersscores, email, password 8-128 chars), loginInputSchema, projectRoleSchema, createPermissionSchema, updatePermissionSchema | `src/data/schema.ts` | S | `bun run test -- --testPathPattern=schema` passes |

#### Wave 2 — Migration (depends on 1.1)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 1.3 | Generate and commit Prisma migration for schema changes | `prisma/migrations/` | S | `bun run db:migrate` succeeds; migration file exists in `prisma/migrations/` |
| 1.4 | Write data-access functions for User CRUD: `createUser`, `findUserByEmail`, `findUserByUsername`, `findUserById` | `src/data/user.ts` | S | Functions exported; TypeScript compiles with `bunx tsc --noEmit` |
| 1.5 | Write data-access functions for Session CRUD: `createSession`, `findSessionById`, `deleteSession`, `deleteExpiredSessions` | `src/data/session.ts` | S | Functions exported; TypeScript compiles |
| 1.6 | Write data-access functions for ProjectPermission: `createPermission`, `findPermissionsByProject`, `findPermissionsByUser`, `upsertPermission`, `deletePermission`, `findEffectiveRole` (returns highest role including owner) | `src/data/permission.ts` | M | Functions exported; TypeScript compiles |
| 1.7 | Write AccountLockout data-access: `recordFailedAttempt`, `isAccountLocked`, `clearLockout` | `src/data/lockout.ts` | S | Functions exported; TypeScript compiles |

### Technical Notes

- `User.id` uses `@default(uuid())` — consistent with all other models in this codebase.
- `CollaborationSession.userId` currently stores an arbitrary string (placeholder). The migration must preserve existing rows by either: (a) nullifying the field and making it optional FK, or (b) deleting all existing CollaborationSession rows if they contain placeholder data. Hephaestus to decide; document the decision in the tech spec.
- The `AccountLockout` table may alternatively be implemented as fields on `User` (lockedUntil, failedLoginAttempts). Either representation is acceptable; the data-access interface is the same.
- `ownerId` on Project is nullable initially to allow migration of pre-auth data. After the first-user registration migration runs, it should be treated as required. Making it non-nullable is deferred to a post-migration schema fix or handled by application-level enforcement.
- The permission system must be structured so a `GroupPermission` table can be added later without modifying `ProjectPermission`. This means `ProjectPermission` stores only individual user-to-project mappings.
- Session tokens stored in the Session table must be generated without `crypto.randomUUID()`. Use `crypto.randomBytes(32).toString('hex')` from Node's built-in `crypto` module (not Web Crypto API — this runs server-side in Bun/Node and does not require a secure context).

### Acceptance Criteria

- [ ] `bunx prisma validate` passes with no errors
- [ ] Migration file exists in `prisma/migrations/` and applies cleanly to a fresh database
- [ ] All new models appear in `bun run db:studio` with correct fields and relations
- [ ] Zod schemas reject invalid registration input (short username, invalid email, short password)
- [ ] TypeScript compiles with `bunx tsc --noEmit` — no type errors introduced

---

## Phase 2: Auth Core

**Depends on:** Phase 1
**Blocks:** Phase 3

### Scope (what IS in this phase)

- Password hashing service using Argon2id (or bcrypt with cost factor 12 as fallback) targeting 200-500ms computation time
- Session creation service: generates a secure random token (via Node `crypto.randomBytes`), stores hashed or raw token in Session table, returns token for cookie
- Session validation service: reads session by token, checks expiry, returns associated user
- Session deletion service (logout)
- `getSessionFromRequest` utility: extracts session cookie from TanStack Start request context and validates it — returns `{ user, session }` or null
- Rate limiting service: `recordFailedLogin(email)`, `checkLockout(email)` using the AccountLockout data-access from Phase 1; lockout threshold 5 attempts / 15-minute window
- First-user data migration function: atomic transaction that assigns all ownerless Projects to a newly created user's ID
- All code in `src/lib/auth/`

### Boundaries (what is NOT in this phase)

- HTTP handlers or route files (Phase 3)
- UI components (Phase 3)
- Middleware wiring into server functions (Phase 3)
- Permission enforcement (Phase 4)
- WebSocket auth (Phase 5)

### Tasks

#### Wave 1 — Core services (no intra-phase dependencies)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 2.1 | Install password hashing library (Argon2id: `bun add argon2` or bcrypt: `bun add bcryptjs`); implement `hashPassword(plain: string): Promise<string>` and `verifyPassword(plain: string, hash: string): Promise<boolean>` | `src/lib/auth/password.ts` | S | Unit test: `hashPassword("test12345")` returns a non-plaintext string; `verifyPassword("test12345", hash)` returns true; hash time is 100-600ms measured in test |
| 2.2 | Implement session token generation: `generateSessionToken(): string` using `crypto.randomBytes(32).toString('hex')` (no secure context needed); implement `createUserSession(userId, rememberMe)` which creates Session record with 24h or 30-day expiry; implement `validateSessionToken(token)` returning `{ user, session } | null` after checking expiry; implement `invalidateSession(sessionId)` | `src/lib/auth/session.ts` | M | Unit test: `createUserSession` writes to DB; `validateSessionToken` returns user for valid token; returns null for expired token; `invalidateSession` deletes session record |
| 2.3 | Implement `getSessionFromRequest(request: Request): Promise<{ user, session } | null>` — reads cookie named `session_token` from request headers, delegates to `validateSessionToken`; implement `setSessionCookie(response, token, rememberMe)` and `clearSessionCookie(response)` — no `Secure` flag, `HttpOnly: true`, `SameSite: Lax` | `src/lib/auth/cookies.ts` | S | Unit test: parses `Cookie: session_token=<token>` header correctly; returns null for missing cookie |
| 2.4 | Implement rate limiting: `recordFailedLogin(email)` increments counter; `checkLockout(email)` returns `{ locked: boolean, unlocksAt?: Date }`; automatically clears lockout after 15 minutes (lazy expiry check on read) | `src/lib/auth/rate-limit.ts` | S | Unit test: after 5 calls to `recordFailedLogin` for same email, `checkLockout` returns `locked: true`; after 15+ minutes simulated, `checkLockout` returns `locked: false` |

#### Wave 2 — Migration logic (depends on 2.2 for user creation pattern)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 2.5 | Implement `migrateDataToFirstUser(userId: string): Promise<void>` — atomic Prisma transaction: sets `ownerId` on all Projects where `ownerId IS NULL` to the given userId; wraps in `prisma.$transaction()`; safe to call multiple times (idempotent after first user) | `src/lib/auth/first-user-migration.ts` | S | Unit test (with test DB or mock): all Projects with null ownerId have ownerId updated; Projects already owned are untouched |

### Technical Notes

- Do NOT use `crypto.randomUUID()` anywhere — it requires a secure context (HTTPS/localhost) and fails over HTTP on LAN. Use `crypto.randomBytes(32).toString('hex')` for all token generation.
- The cookie `Secure` flag must be omitted (not set to false — just absent). Explicitly setting it to false may still cause issues in some runtimes. Test on LAN HTTP.
- Session tokens: decide in tech spec whether to store the raw token in the DB (simpler, token is the lookup key) or store a hash of the token (more secure but adds complexity). For a LAN deployment, raw token storage is acceptable.
- Argon2id is preferred per OWASP 2025 recommendations. If the argon2 package has installation issues on Bun/Linux, bcryptjs is a pure-JS fallback with no native deps.
- The first-user migration checks `userCount === 0` before invoking `migrateDataToFirstUser`. Both the user count check and the user creation must be in the same transaction to prevent race conditions (two simultaneous registrations both seeing count=0).

### Acceptance Criteria

- [ ] `hashPassword` + `verifyPassword` work correctly and reject wrong passwords
- [ ] Hash computation time is in 100-600ms range (allowance around 200-500ms target)
- [ ] `generateSessionToken()` does not use `crypto.randomUUID()` — verified by code review
- [ ] Sessions expire correctly: token validated within expiry window returns user; expired token returns null
- [ ] After 5 failed login attempts for same email, `checkLockout` returns locked=true
- [ ] Lockout clears automatically after 15 minutes without manual intervention
- [ ] `migrateDataToFirstUser` is atomic — partial failure leaves database unchanged

---

## Phase 3: Auth Routes, Middleware, and UI

**Depends on:** Phase 2
**Blocks:** Phase 4, Phase 5

### Scope (what IS in this phase)

- `/login` route and page component with email, password, "Remember me" checkbox, loading state, cross-link to /register
- `/register` route and page component with username, email, password fields, loading state, cross-link to /login
- Logout server function and header logout button
- Session validation middleware factory: `requireAuth(handler)` wrapper for `createServerFn` handlers that returns 401 if session invalid
- Root route `beforeLoad` hook that checks session and redirects to `/login?redirect=<url>` if unauthenticated (client and server side)
- Session-expired modal component (shown on 401 response from any server function; traps focus; keyboard-dismissible; preserves current URL in redirect param)
- Apply `requireAuth` wrapper to ALL existing server functions in `src/routes/api/`
- Server functions for registration and login
- Registration: validate input, check duplicate email (anti-enumeration: return same "successful" response for duplicate), hash password, create user, run first-user migration if user count was 0, create session, set cookie
- Login: validate input, check lockout, verify password, create session, set cookie; generic error message on failure
- Logout: delete session, clear cookie, redirect to /login
- Empty state components for project list (no projects / no permissions)
- Update existing project list query to filter by owned/permitted projects (stub: show all owned — permissions layer added in Phase 4)

### Boundaries (what is NOT in this phase)

- Project permission management UI (Phase 4)
- Permission enforcement in queries beyond simple ownership (Phase 4)
- WebSocket authentication (Phase 5)
- Password reset or email verification (out of scope entirely)

### Tasks

#### Wave 1 — Server functions and middleware (no intra-phase dependencies)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 3.1 | Implement `requireAuth` middleware factory: `requireAuth<T>(handler: (ctx: { user, session }, input: T) => Promise<R>)` wrapping a `createServerFn` handler; extracts session via `getSessionFromRequest`; returns `{ error: 'UNAUTHORIZED', status: 401 }` if invalid | `src/lib/auth/middleware.ts` | S | Unit test: handler wrapped with `requireAuth` returns 401 for missing/expired session; passes `{ user, session }` to handler for valid session |
| 3.2 | Implement `registerUser` server function: validate input with registerInputSchema, check lockout (unused for register but good hygiene), call `createUser` + `migrateDataToFirstUser` + `createSession` in transaction, set session cookie; for duplicate email return same "Registration successful. Please log in." response | `src/routes/api/auth.ts` | M | POST with valid data creates user in DB and sets `session_token` cookie; duplicate email returns same 200 response as success; password stored as hash not plaintext |
| 3.3 | Implement `loginUser` server function: validate input, `checkLockout` (return lockout message if locked), `findUserByEmail`, `verifyPassword` (constant-time — Argon2/bcrypt handles this), `recordFailedLogin` on failure, `clearLockout` on success, `createSession`, set cookie; always return generic "Invalid email or password" on any failure | `src/routes/api/auth.ts` | M | Correct credentials → session cookie set + redirect; wrong password → generic error, no detail; locked account → lockout message |
| 3.4 | Implement `logoutUser` server function: `invalidateSession`, clear cookie, redirect to /login | `src/routes/api/auth.ts` | S | Calling logoutUser deletes session from DB and response clears cookie |
| 3.5 | Implement `getCurrentUser` server function: validates session, returns `{ user } | null`; used by `beforeLoad` to check auth state client-side | `src/routes/api/auth.ts` | S | Returns user for valid session; returns null for expired/missing session |
| 3.6 | Apply `requireAuth` to all existing server functions in `src/routes/api/`: projects.ts, whiteboards.ts, tables.ts, columns.ts, relationships.ts, folders.ts, collaboration.ts | `src/routes/api/*.ts` | M | Each wrapped function returns 401 when called without a valid session cookie (test with curl or in unit tests) |

#### Wave 2 — Routes and root protection (depends on 3.1, 3.5)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 3.7 | Add `beforeLoad` to root route that calls `getCurrentUser`; redirects to `/login?redirect=<pathname>` if null; skip redirect for /login and /register paths | `src/routes/__root.tsx` | S | Navigating to `/` without session redirects to `/login?redirect=/`; navigating to `/login` without session does not redirect loop |
| 3.8 | Create `/login` route file and `LoginPage` component: email + password fields, "Remember me" checkbox, submit button with loading/disabled state, "Don't have an account? Register" link, calls `loginUser` server function, redirects to `?redirect` param or `/` on success | `src/routes/login.tsx` | M | Login with correct credentials redirects to app; login with wrong credentials shows "Invalid email or password"; "Remember me" unchecked sets 24h session |
| 3.9 | Create `/register` route file and `RegisterPage` component: username + email + password fields, loading state, "Already have an account? Log in" link, calls `registerUser` server function, redirects to `/` on success (or shows "Registration successful. Please log in." if duplicate email) | `src/routes/register.tsx` | M | Registration with valid data redirects to app and user is logged in; duplicate email shows success message and redirects to /login |
| 3.10 | Create `SessionExpiredModal` component: overlays current page on 401 response, "Log in again" button that navigates to `/login?redirect=<currentUrl>`, focus trap, keyboard-dismissible (Escape closes and redirects) | `src/components/auth/SessionExpiredModal.tsx` | M | Modal appears when any TanStack Query mutation or query returns 401; focus is trapped inside modal; pressing Escape or button navigates to /login |
| 3.11 | Wire 401 handling into TanStack Query's global `onError` callback: intercepts responses with status 401 or `error: 'UNAUTHORIZED'`, triggers SessionExpiredModal display (via React context or Zustand atom) | `src/integrations/tanstack-query/client.ts` or query client setup | S | Any failed query/mutation with 401 causes modal to appear without page reload |
| 3.12 | Add Logout button to `Header` component: calls `logoutUser`, clears client query cache (`queryClient.clear()`), navigates to /login | `src/components/layout/Header.tsx` | S | Clicking Logout redirects to /login; subsequent navigation to protected routes redirects back to /login |

#### Wave 3 — Empty states (depends on 3.8, 3.9)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 3.13 | Update project list empty state to use PRD-specified copy: "No projects yet. Create your first project to get started." for first user (total projects = 0); "You don't have any projects yet. Create a new project or ask a teammate to share one with you." for user with no permissions | `src/components/project/EmptyState.tsx` | S | Empty state renders correct message based on project count vs permission count |

### Technical Notes

- `/login` and `/register` must be excluded from the `beforeLoad` redirect in the root route. Match against `pathname.startsWith('/login') || pathname.startsWith('/register')`.
- The `registerUser` function must check whether this is the "first user" and run `migrateDataToFirstUser` inside the same transaction as `createUser`. Use `prisma.$transaction([...])` or the interactive transaction form.
- For the anti-enumeration requirement, the `registerUser` function returns the same response regardless of whether the email was a duplicate. The caller (RegisterPage) interprets any success-shaped response as "Registration successful. Please log in." and redirects to /login. The session cookie is only set on a genuinely new registration.
- Loading states: use React's `useTransition` or a local `isSubmitting` state. Disable the submit button and show a spinner (shadcn Button with loading prop) while the server function is in flight.
- Accessibility: all form fields need `<label>` with `htmlFor`, validation errors on `aria-live` regions, focus moves to first error field on submit, `aria-busy` on form during submission. SessionExpiredModal uses `role="dialog"` with focus trap.
- `Header` currently renders for all routes. After this phase it will need to conditionally show the Logout button only when authenticated. Read the current Header implementation before modifying.

### Acceptance Criteria

- [ ] Unauthenticated request to any route (except /login, /register) redirects to /login with redirect param
- [ ] Login with valid credentials sets HttpOnly session cookie with correct expiry
- [ ] Login with invalid credentials shows generic "Invalid email or password" — never reveals which field is wrong
- [ ] Duplicate email registration returns "Registration successful. Please log in." and redirects to /login without creating a session
- [ ] New registration creates session and redirects to app (user is auto-logged in)
- [ ] All existing server functions return 401 when called without valid session
- [ ] Logout deletes session from DB and clears cookie
- [ ] SessionExpiredModal appears on any 401; focus is trapped; Escape or button navigates to /login with redirect param
- [ ] Auth forms have proper labels, aria-live error regions, aria-busy on submit

---

## Phase 4: Project-Level Permissions

**Depends on:** Phase 3
**Blocks:** Nothing (parallel with Phase 5)

### Scope (what IS in this phase)

- `findEffectiveRole(userId, projectId)` data function: returns the user's role (OWNER, ADMIN, EDITOR, VIEWER) or null if no access; owner check uses `project.ownerId`
- Permission enforcement in all project/whiteboard server functions: each function calls `findEffectiveRole` and returns 403 if role is null (no access) or insufficient for the operation
- `findAllProjectsWithTree` updated to filter by user's effective access (owned + any permission entry)
- `findProjectById` updated to check access, return 403 payload if none
- Project creation: sets `ownerId` to current user's ID
- Permission management server functions: `grantPermission`, `updatePermission`, `revokePermission`, `listProjectPermissions` — all require ADMIN or OWNER effective role
- Project settings / Share panel UI: modal or slide-out panel showing list of users with roles, ability to add user by email, change role, or remove permission; entry point is a "Share" button on project header
- Permission revocation notification: when a permission is revoked, WebSocket layer (Phase 5) sends `permission_revoked` event; HTTP layer returns 403 on next request; client shows "Your access to this project has been removed" and redirects to project list after 5 seconds

### Boundaries (what is NOT in this phase)

- WebSocket permission enforcement (Phase 5)
- Group-based permissions (deferred, out of scope for this iteration)
- Ownership transfer (out of scope)
- Admin panel for system-wide user management (out of scope)

### Tasks

#### Wave 1 — Permission enforcement in data layer (no intra-phase prerequisites)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 4.1 | Implement `findEffectiveRole(userId, projectId)`: checks project.ownerId (returns 'OWNER'), then ProjectPermission table (returns role), else returns null | `src/data/permission.ts` | S | Unit test: owner gets OWNER; user with EDITOR permission gets EDITOR; user with no entry gets null |
| 4.2 | Update `findAllProjectsWithTree` and `findAllProjects` to accept `userId` param and filter to projects where user is owner or has permission entry | `src/data/project.ts` | S | Query only returns projects the specified user can access |
| 4.3 | Update `findProjectById` to accept `userId` param and return null (or throw 403-typed error) if user has no access | `src/data/project.ts` | S | Non-permitted user cannot retrieve project data |

#### Wave 2 — Server function permission gates (depends on 4.1, 4.2, 4.3)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 4.4 | Add permission checks to project server functions: getProjects/getProjectsWithTree (filter by userId), getProjectById (require access), createProject (sets ownerId), deleteProject (require OWNER or ADMIN), updateProject (require OWNER or ADMIN) | `src/routes/api/projects.ts` | M | Non-owner cannot delete project (returns 403); non-member cannot see project in list |
| 4.5 | Add permission checks to whiteboard server functions: all whiteboard reads require VIEWER+; writes (create/update/delete whiteboard) require EDITOR+ | `src/routes/api/whiteboards.ts` | M | VIEWER role cannot create whiteboard (returns 403); EDITOR can |
| 4.6 | Add permission checks to table/column/relationship server functions: reads require VIEWER+; writes require EDITOR+ | `src/routes/api/tables.ts`, `src/routes/api/columns.ts`, `src/routes/api/relationships.ts` | M | VIEWER cannot create table; EDITOR can |
| 4.7 | Implement permission management server functions: `grantPermission(projectId, email, role)`, `updatePermission(projectId, userId, role)`, `revokePermission(projectId, userId)`, `listProjectPermissions(projectId)` — all require effective role ADMIN or OWNER; owner cannot be removed; admin cannot remove owner or other admins (only owner can demote admins) | `src/routes/api/permissions.ts` | M | Admin can add EDITOR; Admin cannot remove owner (returns 403); Owner can demote admin |

#### Wave 3 — Permission management UI (depends on 4.7)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 4.8 | Build `ProjectSharePanel` component: modal/sheet showing current permissions list (user + role), "Add user" form (email + role selector), role change dropdown, remove button per user; opens from "Share" button on project header | `src/components/project/ProjectSharePanel.tsx` | L | Owner can open Share panel; can add user by email; can change role; can remove non-owner user; panel does not show remove for owner row |
| 4.9 | Add "Share" button to project header (visible only to OWNER and ADMIN); wire 403 responses in project routes to show "You do not have access to this project." and redirect to project list | `src/components/project/ProjectHeader.tsx` (or equivalent) | S | Share button only visible to OWNER/ADMIN; accessing a non-permitted project URL shows 403 message |

### Technical Notes

- `findEffectiveRole` must check owner first (via `project.ownerId === userId`), then fall through to `ProjectPermission`. This avoids needing an implicit OWNER row in the permissions table.
- The role hierarchy for "can do action" checks: VIEWER < EDITOR < ADMIN < OWNER. Implement a `hasMinimumRole(effective, required)` helper.
- When revoking permissions: the revocation takes effect on the next HTTP request or WebSocket event. No active connection termination in this phase — that is Phase 5's responsibility.
- The Share panel must not show the owner in the "remove" column (owners cannot be removed). Admin rows can be removed by the owner only, not by other admins.
- 403 responses from server functions should return a structured payload: `{ error: 'FORBIDDEN', message: 'You do not have access to this project.' }` so the client can render the correct message.

### Acceptance Criteria

- [ ] Project list only shows projects the logged-in user owns or has permission on
- [ ] Direct URL to non-permitted project returns 403 and shows "You do not have access to this project."
- [ ] VIEWER cannot edit tables, columns, relationships, or create/delete whiteboards
- [ ] Only OWNER and ADMIN can manage permissions
- [ ] Admin cannot remove or demote the owner; only owner can demote admins
- [ ] Permission grant/revoke takes effect on next request (no stale access)
- [ ] New project creation sets current user as ownerId
- [ ] Share panel is accessible and keyboard-navigable

---

## Phase 5: WebSocket Authentication

**Depends on:** Phase 3
**Blocks:** Nothing (parallel with Phase 4)

### Scope (what IS in this phase)

- Socket.IO handshake authentication: middleware reads session cookie from handshake headers, validates via `validateSessionToken`, rejects connection if invalid (no socket established)
- Active session expiry handling: periodic or event-driven check on established connections; when a session expires, server emits `session_expired` event and closes the socket
- Permission enforcement on incoming WebSocket events: before processing any edit event (table move, column change, etc.), verify the emitting user still has EDITOR+ role on the whiteboard's project; if not, emit `permission_revoked` event with projectId and close connection
- Client-side handling of `session_expired` event: triggers the SessionExpiredModal (reuses Phase 3 component)
- Client-side handling of `permission_revoked` event: shows "Your access to this project has been removed" toast, redirects to project list after 5 seconds
- Pass authenticated `userId` from handshake session through to all collaboration event handlers, replacing the placeholder string currently in `CollaborationSession.userId`

### Boundaries (what is NOT in this phase)

- Session creation or login flows (Phase 3)
- HTTP-layer permission enforcement (Phase 4)
- WebSocket feature changes unrelated to auth (separate feature)

### Tasks

#### Wave 1 — Handshake auth (no intra-phase prerequisites)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 5.1 | Add Socket.IO handshake middleware: reads `Cookie` header from `socket.handshake.headers`, parses `session_token`, calls `validateSessionToken`; calls `next(new Error('UNAUTHORIZED'))` if invalid; attaches `socket.data.userId` and `socket.data.sessionId` on success | `src/server/socket.ts` or equivalent Socket.IO setup file | M | Connecting without a valid session cookie results in connection refused; connecting with valid cookie establishes connection and socket.data.userId is set |
| 5.2 | Update all collaboration event handlers to use `socket.data.userId` instead of any placeholder; update `CollaborationSession` record creation to use the real userId FK | `src/server/socket.ts` or collaboration handlers | S | CollaborationSession records in DB have a valid userId FK that references an existing User record |

#### Wave 2 — Session expiry and permission enforcement on active connections (depends on 5.1)

| # | Task | Target File | Effort | Verify |
|---|------|-------------|--------|--------|
| 5.3 | Implement session expiry check on active connections: on each incoming event from a client, call `validateSessionToken(socket.data.sessionId)` (or compare against cached expiry); if expired, emit `session_expired` to that socket and call `socket.disconnect(true)` | `src/server/socket.ts` | M | When a session is manually expired in DB, the next event from that socket causes `session_expired` emit and disconnect |
| 5.4 | Implement permission check on edit events: before processing any mutating event, call `findEffectiveRole(socket.data.userId, projectId)`; if role is null or VIEWER, emit `permission_revoked` with `{ projectId }` and disconnect that socket | `src/server/socket.ts` | S | Revoking a user's permission while they have an active WebSocket causes `permission_revoked` event on next edit event |
| 5.5 | Client: handle `session_expired` Socket.IO event in `useWhiteboardCollaboration` hook — trigger SessionExpiredModal (reuse Phase 3 component via shared state/context) | `src/hooks/use-whiteboard-collaboration.ts` | S | `session_expired` event from server causes SessionExpiredModal to appear on whiteboard page |
| 5.6 | Client: handle `permission_revoked` Socket.IO event — show toast "Your access to this project has been removed", redirect to project list after 5 seconds; cancel redirect if user navigates away manually | `src/hooks/use-whiteboard-collaboration.ts` | S | `permission_revoked` event causes toast + timed redirect to project list |

### Technical Notes

- The Socket.IO server file location needs to be confirmed by Hephaestus in the tech spec (TanStack Start uses Nitro/Vinxi under the hood; Socket.IO integration pattern must be verified).
- Session expiry check on each event is lightweight if the session's `expiresAt` is cached in `socket.data` at connection time. Compare `Date.now() > socket.data.sessionExpiresAt` instead of a DB round-trip per event.
- `permission_revoked` event should only be sent once per permission loss, not on every subsequent event. Use a flag on the socket data or disconnect immediately after sending.
- The `session_expired` client handler must not interfere with the HTTP-layer `session_expired` modal already in Phase 3. Both should use the same modal. Route the WebSocket event to the same modal trigger.
- On reconnection after `session_expired` (user re-authenticates and returns to whiteboard URL), the client should re-establish the WebSocket connection normally. The collaboration hook's existing reconnection logic should handle this.

### Acceptance Criteria

- [ ] WebSocket connection without valid session cookie is rejected during handshake (no socket established)
- [ ] WebSocket connection with valid session cookie succeeds
- [ ] When session expires, next event from that socket triggers `session_expired` emission and disconnects the socket
- [ ] Client SessionExpiredModal appears on `session_expired` event from WebSocket (same modal as HTTP 401)
- [ ] When permission is revoked, user's next edit event triggers `permission_revoked` and disconnect
- [ ] Client shows toast + redirects to project list within 5 seconds of `permission_revoked`
- [ ] CollaborationSession records in DB reference a real User foreign key (not a placeholder string)

---

## Cross-Cutting Concerns

### Error Handling

All authentication errors must return structured responses, never raw exceptions:
- `{ error: 'UNAUTHORIZED', status: 401 }` — session missing/expired
- `{ error: 'FORBIDDEN', status: 403, message: '...' }` — insufficient permission
- `{ error: 'VALIDATION_ERROR', status: 400, fields: { ... } }` — input validation failure
- `{ error: 'LOCKED', status: 429, unlocksAt: ISO8601 }` — account lockout

All server functions must catch errors and never leak stack traces or internal messages to the client.

### Logging

Log at startup if HTTPS is not detected (check `process.env.NODE_ENV` and request protocol): "WARNING: Application is running over HTTP. Session cookies are not encrypted in transit. HTTPS is strongly recommended for production use."

Log authentication events at INFO level: user registered (no PII beyond user ID), login success, login failure (no email in log to avoid leaking), logout, permission grant/revoke. Never log passwords or session tokens.

### LAN HTTP Compatibility

Every token/random ID generated in this feature must work without a secure context:
- Use Node.js `crypto.randomBytes()` (built-in, no secure context requirement)
- Never use `crypto.randomUUID()`, `window.crypto.getRandomValues()`, or Web Crypto API
- Cookie `Secure` flag must be absent (not present, not set to false)

### Testing Approach

Each phase should have unit tests for data-access functions and service functions. Integration tests should cover:
- Full registration flow (new user, duplicate email)
- Full login flow (success, wrong password, locked account)
- Session expiry (HTTP and WebSocket)
- Permission enforcement at each role level

---

## Effort Summary

| Phase | Tasks | Effort Breakdown | Relative Size |
|-------|-------|-----------------|---------------|
| Phase 1: Database Layer | 7 | 1L, 4M, 2S | Medium |
| Phase 2: Auth Core | 5 | 0L, 2M, 3S | Small-Medium |
| Phase 3: Auth Routes + UI | 13 | 0L, 6M, 5S + 2M | Large |
| Phase 4: Project Permissions | 9 | 1L, 5M, 3S | Large |
| Phase 5: WebSocket Auth | 6 | 0L, 2M, 4S | Medium |
| **Total** | **27** | | |

Effort key: S = ~2h, M = ~4h, L = ~6-8h

---

## Implementation Order

**Strict sequence (cannot parallelize):**
1. Phase 1 (database) → Phase 2 (auth core) → Phase 3 (routes + middleware)

**After Phase 3:**
- Phase 4 and Phase 5 can proceed in parallel if two developers are available
- Phase 4 Wave 1-2 (data layer + server functions) can be done before Phase 4 Wave 3 (UI)

**Recommended single-developer order:**
1. Phase 1 (all waves)
2. Phase 2 (all waves)
3. Phase 3 (Wave 1 → Wave 2 → Wave 3)
4. Phase 4 (Wave 1 → Wave 2 → Wave 3)
5. Phase 5 (Wave 1 → Wave 2)

---

## Risks

| Risk | Phase | Severity | Mitigation |
|------|-------|----------|-----------|
| `CollaborationSession.userId` migration destroys existing session rows | Phase 1 | Medium | Decision: make userId nullable FK initially; existing rows can have userId=null until the next real session is created. Document in migration notes. |
| Argon2 native addon fails to build on Bun/Linux | Phase 2 | Low | Fallback: bcryptjs (pure JS, no native addon, slower but no build issues) |
| TanStack Start Nitro/Vinxi Socket.IO integration is undocumented | Phase 5 | High | Hephaestus must research and document the Socket.IO server setup pattern in the tech spec before Phase 5 implementation starts |
| First-user race condition (two simultaneous registrations) | Phase 2-3 | Medium | Use Prisma interactive transaction with user count check inside the transaction; PostgreSQL serializable isolation or advisory lock if needed |
| Session cookie not sent over LAN HTTP due to SameSite=Strict | Phase 3 | Medium | Use `SameSite=Lax` (not Strict); verify cookie is sent on navigations from external links on LAN |
| `crypto.randomUUID()` accidentally used by a dependency | Phase 2-3 | Low | Code review gate: grep for `randomUUID` before PR merge |
