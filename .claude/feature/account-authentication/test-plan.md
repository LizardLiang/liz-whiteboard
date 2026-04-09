# Test Plan

## Document Info
| Field | Value |
|-------|-------|
| **Feature** | Account Authentication |
| **Author** | Artemis (QA Agent) |
| **Date** | 2026-04-03 |
| **PRD Version** | 2 (Nemesis-approved) |
| **Tech Spec Version** | Complete (Hephaestus) |

---

## 1. Test Overview

### Scope

This test plan covers all five phases of the account-authentication feature:

- **Phase 1 — Database Layer:** Prisma schema changes, Zod schema validation, data-access functions for User, Session, ProjectMember, and lockout fields.
- **Phase 2 — Auth Core:** Password hashing (bcryptjs + SHA-256 pre-hash), session token generation and validation, cookie utilities, rate limiting, first-user data migration.
- **Phase 3 — Auth Routes + Middleware + UI:** Registration server function (including anti-enumeration), login server function (including lockout enforcement), logout, `requireAuth` wrapper, root `beforeLoad` protection, login/register page components, session-expired modal, 401 interception, loading states, accessibility.
- **Phase 4 — Project-Level Permissions:** `findEffectiveRole`, permission-filtered project/whiteboard queries, server-function permission gates, permission management CRUD, Share panel UI, 403 revocation notification.
- **Phase 5 — WebSocket Authentication:** Socket.IO handshake middleware, session expiry handling on active connections, permission enforcement on edit events, client-side `session_expired` and `permission_revoked` event handling.

### Out of Scope

- Two-factor authentication, email verification, OAuth/social login — not implemented in this iteration.
- Password reset / recovery — out of scope; manual DB-level reset only.
- Admin panel for system-wide user management.
- User groups and group-based permissions (deferred).
- Whiteboard-level permissions (all permissions are project-level).
- Audit logging.
- Ownership transfer.

### Test Approach

Tests are organized by decomposition phase to match the implementation order. The framework is **Vitest** (used by the entire existing test suite; `bun run test` executes `vitest run`). Test patterns follow the existing codebase conventions:

- `vi.mock('@/db', ...)` for Prisma mocking in data-layer and service unit tests.
- `@testing-library/react` + `jsdom` for component and route tests.
- `@testing-library/user-event` for form interaction simulations.
- Structured `describe` / `it` blocks with `TC-XX-NN` identifiers matching the test case IDs in this plan.

Every P0 requirement has at least one P0 test case. Security-critical paths (anti-enumeration, cookie flags, token generation method, lockout, WebSocket handshake) are treated as P0 regardless of PRD priority tier.

---

## 2. Requirements Coverage Matrix

| Req ID | Requirement | Test Cases | Priority |
|--------|-------------|------------|----------|
| AUTH-REG-01 | Public registration page accessible without auth | TC-P3-01, TC-P3-02 | P0 |
| AUTH-REG-02 | Registration creates user with hashed password; auto-login | TC-P2-01, TC-P2-02, TC-P3-03, TC-P3-04 | P0 |
| AUTH-REG-03 | Validation + anti-enumeration on duplicate email | TC-P1-02, TC-P3-05, TC-P3-06, TC-P3-07 | P0 |
| AUTH-REG-04 | First user inherits all existing projects (atomic) | TC-P2-09, TC-P2-10 | P0 |
| AUTH-LOGIN-01 | Login page with email/password fields and cross-link | TC-P3-10, TC-P3-11 | P0 |
| AUTH-LOGIN-02 | Successful login creates session + HttpOnly cookie | TC-P2-04, TC-P2-05, TC-P2-06, TC-P3-12 | P0 |
| AUTH-LOGIN-03 | Generic error message — no field enumeration | TC-P3-13, TC-P3-14 | P0 |
| AUTH-LOGIN-04 | "Remember me" extends session to 30 days; default 24h | TC-P2-07, TC-P2-08, TC-P3-15 | P0 |
| AUTH-LOGIN-05 | Logout invalidates session server-side + clears cookie | TC-P3-16, TC-P3-17 | P0 |
| AUTH-LOGIN-06 | Loading state on forms prevents double-submission | TC-P3-18, TC-P3-19 | P0 |
| AUTH-GUARD-01 | All routes except /login, /register require valid session | TC-P3-20, TC-P3-21, TC-P3-22 | P0 |
| AUTH-GUARD-02 | Server functions validate session; return 401 if invalid | TC-P3-23, TC-P3-24 | P0 |
| AUTH-GUARD-03 | Client-side navigation checks auth; redirects on expiry | TC-P3-25, TC-P3-26 | P0 |
| AUTH-GUARD-04 | Socket.IO handshake auth; session_expired on active conn | TC-P5-01, TC-P5-02, TC-P5-03, TC-P5-04 | P0 |
| AUTH-PERM-01 | Project owner is the creating user; immutable | TC-P4-01, TC-P4-06 | P1 |
| AUTH-PERM-02 | Owner can grant viewer/editor/admin roles | TC-P4-07, TC-P4-08, TC-P4-09 | P1 |
| AUTH-PERM-03 | Non-permitted users cannot see or access projects | TC-P4-02, TC-P4-03, TC-P4-10 | P1 |
| AUTH-PERM-04 | All whiteboards inherit project permissions | TC-P4-04, TC-P4-05 | P1 |
| AUTH-PERM-05 | Permission revocation reflected on next request | TC-P4-11, TC-P4-12, TC-P5-06 | P1 |

---

## 3. Test Cases

### Phase 1: Database Layer

---

#### TC-P1-01: Zod registerInputSchema — valid input accepted
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-03 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/data/schema.test.ts` |

**Preconditions**: `registerInputSchema` exported from `src/data/schema.ts`.

**Test Steps**:
1. Call `registerInputSchema.safeParse({ username: 'alice_01', email: 'alice@example.com', password: 'secure123' })`.

**Expected Result**:
- `result.success` is `true`.
- Parsed data matches input values.

---

#### TC-P1-02: Zod registerInputSchema — boundary and invalid inputs rejected
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-03 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/data/schema.test.ts` |

**Test Steps** (parameterised with `it.each`):
1. Username with 2 characters (`"ab"`) — expect failure.
2. Username with 51 characters — expect failure.
3. Username containing a space (`"alice bob"`) — expect failure.
4. Username containing a hyphen (`"alice-bob"`) — expect failure.
5. Invalid email format (`"notanemail"`) — expect failure.
6. Password of 7 characters (`"short12"`) — expect failure.
7. Password of 129 characters — expect failure.
8. Password of exactly 8 characters — expect success.
9. Password of exactly 128 characters — expect success.
10. Username of exactly 3 characters — expect success.
11. Username of exactly 50 characters — expect success.

**Expected Result**: Each case returns `success: false` / `success: true` as described. `error.issues` includes the relevant field name.

---

#### TC-P1-03: Zod loginInputSchema — valid and invalid inputs
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-01 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/data/schema.test.ts` |

**Test Steps**:
1. Valid input `{ email: 'a@b.com', password: 'x', rememberMe: false }` — expect success.
2. Missing password — expect failure.
3. Empty password (`""`) — expect failure (min 1).
4. `rememberMe` absent — expect success with default `false`.

---

#### TC-P1-04: Zod permission schemas — projectRoleSchema values
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-02 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/data/schema.test.ts` |

**Test Steps**:
1. `projectRoleSchema.safeParse('VIEWER')` — success.
2. `projectRoleSchema.safeParse('EDITOR')` — success.
3. `projectRoleSchema.safeParse('ADMIN')` — success.
4. `projectRoleSchema.safeParse('OWNER')` — failure (OWNER is derived, not a stored role).
5. `projectRoleSchema.safeParse('viewer')` — failure (case-sensitive).

---

#### TC-P1-05: User data-access — createUser / findUserByEmail
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-02 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/data/user.test.ts` |

**Preconditions**: `prisma.user` mocked via `vi.mock('@/db', ...)`.

**Test Steps**:
1. Mock `prisma.user.create` to return a user fixture.
2. Call `createUser({ username, email, passwordHash })`.
3. Assert `prisma.user.create` was called with correct fields.
4. Mock `prisma.user.findUnique` to return the fixture.
5. Call `findUserByEmail('alice@example.com')`.
6. Assert result matches fixture.
7. Mock `findUnique` to return `null`.
8. Call `findUserByEmail('notfound@example.com')`.
9. Assert result is `null`.

---

#### TC-P1-06: Session data-access — createSession / findSessionById / deleteSession
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-02, AUTH-LOGIN-05 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/data/session.test.ts` |

**Preconditions**: `prisma.session` mocked.

**Test Steps**:
1. Call `createSession({ tokenHash, userId, expiresAt })` — assert `prisma.session.create` called with correct data.
2. Call `findSessionById('session-uuid')` — assert `prisma.session.findUnique` called with `where: { id }`.
3. Call `deleteSession('session-uuid')` — assert `prisma.session.delete` called.
4. Call `deleteExpiredSessions()` — assert `prisma.session.deleteMany` called with `expiresAt: { lt: new Date() }`.

---

#### TC-P1-07: Permission data-access — findEffectiveRole covers owner case
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-01, AUTH-PERM-03 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/data/permission.test.ts` |

**Test Steps**:
1. Mock `prisma.project.findUnique` to return `{ ownerId: 'user-A' }`.
2. Call `findEffectiveRole('user-A', 'project-1')` — assert returns `'OWNER'`.
3. Mock project with `ownerId: 'user-B'`; mock `ProjectMember.findUnique` to return `{ role: 'EDITOR' }`.
4. Call `findEffectiveRole('user-A', 'project-1')` — assert returns `'EDITOR'`.
5. Mock no project member entry.
6. Call `findEffectiveRole('user-C', 'project-1')` — assert returns `null`.

---

### Phase 2: Auth Core

---

#### TC-P2-01: hashPassword produces non-plaintext output
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-02 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/password.test.ts` |

**Test Steps**:
1. Call `hashPassword('testPassword1!')`.
2. Assert result is a string.
3. Assert result does not equal `'testPassword1!'`.
4. Assert result starts with `$2` (bcrypt hash prefix).

---

#### TC-P2-02: verifyPassword returns true for correct password, false for wrong
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-02, AUTH-LOGIN-02 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/password.test.ts` |

**Test Steps**:
1. `const hash = await hashPassword('correctPassword')`.
2. `await verifyPassword('correctPassword', hash)` — assert `true`.
3. `await verifyPassword('wrongPassword', hash)` — assert `false`.
4. `await verifyPassword('', hash)` — assert `false`.

---

#### TC-P2-03: hashPassword — SHA-256 pre-hash handles long passwords
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-03 (128-char max, bcrypt 72-byte limit) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/password.test.ts` |

**Test Steps**:
1. Create a 128-character ASCII password string.
2. Create a 73-character ASCII password string with identical first 72 chars but different char 73.
3. Hash both with `hashPassword`.
4. Assert the two hashes are different (confirming SHA-256 pre-hash feeds full input to bcrypt).
5. Assert `verifyPassword(128charPwd, hash128char)` returns `true`.
6. Assert `verifyPassword(73charPwd, hash73char)` returns `true`.
7. Assert `verifyPassword(128charPwd, hash73char)` returns `false`.

**Note**: This test confirms the SHA-256 pre-hashing mitigation works correctly.

---

#### TC-P2-04: generateSessionToken does not use crypto.randomUUID
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-02 (LAN HTTP compatibility) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/session.test.ts` |

**Test Steps**:
1. Call `generateSessionToken()`.
2. Assert result is a 64-character hex string (32 bytes * 2 hex chars).
3. Assert result matches `/^[0-9a-f]{64}$/`.
4. Call twice — assert results differ (not deterministic).

**Edge Cases**:
- The token must NOT be a UUID format (8-4-4-4-12 hex) — assert it does not match the UUID pattern. This confirms `randomBytes` is used, not `randomUUID`.

---

#### TC-P2-05: createUserSession stores tokenHash (not raw token) in DB
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-02 (hashed session token in DB) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/session.test.ts` |

**Preconditions**: `prisma.session.create` mocked.

**Test Steps**:
1. Call `createUserSession('user-uuid', false)`.
2. Capture the argument passed to `prisma.session.create`.
3. Assert `data.tokenHash` is a 64-character hex SHA-256 hash.
4. Assert the returned `token` (raw) does NOT equal `data.tokenHash`.
5. Verify that SHA-256 of the returned `token` equals `data.tokenHash`.

---

#### TC-P2-06: validateSessionToken returns null for expired session and deletes it
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-01, AUTH-LOGIN-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/session.test.ts` |

**Preconditions**: `prisma.session.findUnique` and `prisma.session.delete` mocked.

**Test Steps**:
1. Mock `findUnique` to return a session with `expiresAt` in the past (1 hour ago).
2. Call `validateSessionToken('sometoken')`.
3. Assert result is `null`.
4. Assert `prisma.session.delete` was called with the expired session ID.
5. Mock `findUnique` to return `null` (token not found).
6. Call `validateSessionToken('unknowntoken')`.
7. Assert result is `null` and `delete` is NOT called.
8. Mock `findUnique` to return a valid session with `expiresAt` 1 hour from now.
9. Call `validateSessionToken('validtoken')`.
10. Assert result contains `{ user, session }`.

---

#### TC-P2-07: createUserSession — default expiry is 24 hours
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/session.test.ts` |

**Test Steps**:
1. Note `Date.now()` before call.
2. Call `createUserSession('user-uuid', false)` (rememberMe = false).
3. Capture `data.expiresAt` from `prisma.session.create` call args.
4. Assert `expiresAt` is approximately `Date.now() + 86400000` (24h in ms), within a 1-second tolerance.

---

#### TC-P2-08: createUserSession — rememberMe expiry is 30 days
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/session.test.ts` |

**Test Steps**:
1. Call `createUserSession('user-uuid', true)` (rememberMe = true).
2. Capture `data.expiresAt`.
3. Assert `expiresAt` is approximately `Date.now() + 2592000000` (30 days in ms), within a 1-second tolerance.

---

#### TC-P2-09: migrateDataToFirstUser assigns all ownerless projects
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/first-user-migration.test.ts` |

**Preconditions**: `prisma.$transaction` and `prisma.project.updateMany` mocked.

**Test Steps**:
1. Mock `prisma.project.updateMany` to succeed.
2. Mock `prisma.$transaction` to call its callback.
3. Call `migrateDataToFirstUser('first-user-uuid')`.
4. Assert `prisma.project.updateMany` was called with `where: { ownerId: null }, data: { ownerId: 'first-user-uuid' }`.

---

#### TC-P2-10: migrateDataToFirstUser is idempotent — already-owned projects untouched
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/first-user-migration.test.ts` |

**Test Steps**:
1. Call `migrateDataToFirstUser('user-uuid')` twice.
2. Both calls use `where: { ownerId: null }` — verify the condition filters only null ownerId records.
3. Assert the function does not throw on second invocation.

---

#### TC-P2-11: buildSetCookieHeader — no Secure flag, HttpOnly present, SameSite=Lax
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-02 (LAN HTTP compatibility) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/cookies.test.ts` |

**Test Steps**:
1. Call `buildSetCookieHeader('sometoken', false)`.
2. Assert header string contains `HttpOnly`.
3. Assert header string contains `SameSite=Lax`.
4. Assert header string does NOT contain `Secure`.
5. Assert header string contains `session_token=sometoken`.
6. Assert header string contains `Max-Age=86400` (24h).
7. Call `buildSetCookieHeader('sometoken', true)`.
8. Assert `Max-Age=2592000` (30 days).

---

#### TC-P2-12: parseSessionCookie — extracts token from Cookie header
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-01 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/cookies.test.ts` |

**Test Steps** (parameterised):
1. `Cookie: session_token=abc123; other=xyz` — assert returns `'abc123'`.
2. `Cookie: other=xyz` — assert returns `null`.
3. `null` header — assert returns `null`.
4. `Cookie: session_token=` (empty value) — assert returns `''` or `null` (implementation-defined, document choice).
5. `Cookie: SESSION_TOKEN=abc` (wrong case) — assert returns `null`.

---

#### TC-P2-13: buildClearCookieHeader — Max-Age=0
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-05 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/cookies.test.ts` |

**Test Steps**:
1. Call `buildClearCookieHeader()`.
2. Assert result contains `Max-Age=0`.
3. Assert result contains `session_token=`.
4. Assert result does NOT contain `Secure`.

---

#### TC-P2-14: checkLockout — locked after 5 failed attempts
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-03 (rate limiting), PRD Section 7 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/rate-limit.test.ts` |

**Preconditions**: `prisma.user.update` and `prisma.user.findUnique` mocked.

**Test Steps**:
1. Mock user with `failedLoginAttempts: 4, lockedUntil: null`.
2. Call `recordFailedLogin('alice@example.com')`.
3. Assert `prisma.user.update` was called with `failedLoginAttempts: { increment: 1 }` and `lockedUntil` set to approximately `Date.now() + 900000` (15 min).
4. Mock user with `lockedUntil` set to 10 minutes in the future.
5. Call `checkLockout('alice@example.com')`.
6. Assert returns `{ locked: true, unlocksAt: <Date> }`.

---

#### TC-P2-15: checkLockout — lockout expires automatically after 15 minutes
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-03 (rate limiting) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/rate-limit.test.ts` |

**Test Steps**:
1. Mock user with `lockedUntil` set to 1 minute in the past (expired lockout).
2. Call `checkLockout('alice@example.com')`.
3. Assert returns `{ locked: false }`.

---

#### TC-P2-16: recordFailedLogin — no attempt recorded for non-existent email
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-03 (anti-enumeration), AUTH-REG-03 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/rate-limit.test.ts` |

**Test Steps**:
1. Mock `prisma.user.findUnique` to return `null` (user not found).
2. Call `recordFailedLogin('notexist@example.com')`.
3. Assert `prisma.user.update` was NOT called (no lockout state recorded for non-existent accounts).

---

### Phase 3: Auth Routes, Middleware, and UI

---

#### TC-P3-01: requireAuth wrapper — returns 401 for missing session
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-02 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/middleware.test.ts` |

**Preconditions**: `getSessionFromCookie` mocked to return `null`.

**Test Steps**:
1. Create a handler wrapped with `requireAuth`.
2. Call the wrapped handler with no session cookie.
3. Assert response equals `{ error: 'UNAUTHORIZED', status: 401 }`.
4. Assert the inner handler function was NOT called.

---

#### TC-P3-02: requireAuth wrapper — passes user and session to handler for valid session
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-02 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/lib/auth/middleware.test.ts` |

**Test Steps**:
1. Mock `getSessionFromCookie` to return `{ user: mockUser, session: mockSession }`.
2. Wrap a handler that captures its `ctx` argument.
3. Call the wrapped handler.
4. Assert inner handler was called with `{ user: mockUser, session: mockSession }`.

---

#### TC-P3-03: registerUser server function — new registration creates user + session
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-02 |
| **Type** | Integration |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Components Tested**: `registerUser` server function, `hashPassword`, `createUserSession`, `migrateDataToFirstUser`.

**Preconditions**: Prisma mocked; `findUserByEmail` returns `null` (new user); user count mock returns 0 (first user).

**Test Steps**:
1. Call `registerUser` with valid `{ username, email, password }`.
2. Assert `hashPassword` was called (verify stored hash is not plaintext).
3. Assert `prisma.user.create` was called.
4. Assert `migrateDataToFirstUser` was called (first user scenario).
5. Assert response contains `{ success: true }` and a redirect to `'/'`.
6. Assert `Set-Cookie` header is set in response.

---

#### TC-P3-04: registerUser — password is stored as hash, never plaintext
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-02 |
| **Type** | Integration |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Test Steps**:
1. Call `registerUser` with `password: 'mySecret123'`.
2. Capture argument to `prisma.user.create`.
3. Assert `data.passwordHash` does NOT equal `'mySecret123'`.
4. Assert `data.passwordHash` matches bcrypt hash format (`/^\$2[aby]\$.+/`).
5. Assert `data` does NOT contain a `password` field.

---

#### TC-P3-05: registerUser — duplicate email returns anti-enumeration response
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-03 |
| **Type** | Integration |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Preconditions**: `findUserByEmail` mocked to return an existing user.

**Test Steps**:
1. Call `registerUser` with an already-registered email.
2. Assert response is `{ success: true, message: 'Registration successful. Please log in.', redirect: '/login' }`.
3. Assert `prisma.user.create` was NOT called.
4. Assert no `Set-Cookie` header is set (no auto-login for duplicate email).

---

#### TC-P3-06: registerUser — duplicate email response is identical to success response shape
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-03 (anti-enumeration) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Test Steps**:
1. Call `registerUser` with a new email; capture response body.
2. Call `registerUser` with a duplicate email; capture response body.
3. Assert the response shapes are identical in structure (both contain `success: true` and `message` and `redirect` fields).
4. Assert the HTTP status codes are identical (both 200).

---

#### TC-P3-07: registerUser — input validation errors returned as VALIDATION_ERROR
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-03 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Test Steps** (parameterised):
1. Submit `username: 'ab'` (too short) — assert `{ error: 'VALIDATION_ERROR', fields: { username: ... } }`.
2. Submit `email: 'notanemail'` — assert `{ error: 'VALIDATION_ERROR', fields: { email: ... } }`.
3. Submit `password: 'short'` (7 chars) — assert validation error on `password`.

---

#### TC-P3-08: loginUser — correct credentials create session and set cookie
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-02 |
| **Type** | Integration |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Preconditions**: `findUserByEmail` returns user with known hash; `verifyPassword` returns `true`; `checkLockout` returns `{ locked: false }`.

**Test Steps**:
1. Call `loginUser({ email, password, rememberMe: false })`.
2. Assert `createUserSession` was called.
3. Assert response `Set-Cookie` contains `session_token=` with `HttpOnly` and `SameSite=Lax` and no `Secure`.
4. Assert response contains `{ success: true, redirect: '/' }`.
5. Assert `failedLoginAttempts` was reset (`clearLockout` called).

---

#### TC-P3-09: loginUser — wrong password returns generic error, no field detail
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-03 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Test Steps**:
1. Mock `verifyPassword` to return `false`.
2. Call `loginUser({ email: 'a@b.com', password: 'wrongpass', rememberMe: false })`.
3. Assert response contains `message: 'Invalid email or password'`.
4. Assert response does NOT contain words like `"email"`, `"password"`, `"not found"`, `"wrong"` beyond the exact generic string.
5. Assert no `Set-Cookie` header is set.
6. Assert `recordFailedLogin` was called.

---

#### TC-P3-10: loginUser — non-existent email returns generic error (no attempt recorded)
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-03, AUTH-REG-03 (anti-enumeration) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Test Steps**:
1. Mock `findUserByEmail` to return `null`.
2. Call `loginUser` with the non-existent email.
3. Assert response is `{ message: 'Invalid email or password' }`.
4. Assert `recordFailedLogin` was NOT called.

---

#### TC-P3-11: loginUser — locked account returns lockout message
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-03 (rate limiting), PRD Section 7 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Test Steps**:
1. Mock `checkLockout` to return `{ locked: true, unlocksAt: futureDate }`.
2. Call `loginUser`.
3. Assert response contains `{ error: 'LOCKED', message: 'Too many failed attempts. Please try again in 15 minutes.', unlocksAt: ... }`.
4. Assert `verifyPassword` was NOT called (short-circuit before checking password).

---

#### TC-P3-12: logoutUser — deletes session and clears cookie
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-05 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Preconditions**: `getSessionFromCookie` mocked to return a valid session.

**Test Steps**:
1. Call `logoutUser`.
2. Assert `invalidateSession` was called with the session ID.
3. Assert response `Set-Cookie` contains `Max-Age=0` (cookie cleared).
4. Assert response redirects to `/login`.

---

#### TC-P3-13: RegisterPage — renders all required fields and cross-link
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-REG-01 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/register.test.tsx` |

**Test Steps**:
1. Render `<RegisterPage />`.
2. Assert `<label>` for username input exists and is associated via `htmlFor`.
3. Assert `<label>` for email input exists.
4. Assert `<label>` for password input exists.
5. Assert a link to `/login` with text matching `"log in"` (case-insensitive) is present.
6. Assert submit button is present and enabled initially.

---

#### TC-P3-14: RegisterPage — shows loading state on submit, disables button
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-06 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/register.test.tsx` |

**Test Steps**:
1. Mock `registerUser` to return a pending promise.
2. Fill in valid form fields.
3. Click submit.
4. Assert submit button is disabled.
5. Assert a loading indicator is visible (spinner, aria-busy attribute, or disabled state).
6. Assert the form has `aria-busy="true"` or equivalent.

---

#### TC-P3-15: LoginPage — renders all required fields, cross-link, and Remember Me
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-01 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/login.test.tsx` |

**Test Steps**:
1. Render `<LoginPage />`.
2. Assert email input with associated label.
3. Assert password input with associated label.
4. Assert "Remember me" checkbox with associated label.
5. Assert link to `/register` with text matching `"register"` (case-insensitive).
6. Assert submit button present and enabled.

---

#### TC-P3-16: LoginPage — redirect param is passed on successful login
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-02, AUTH-GUARD-01 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/login.test.tsx` |

**Test Steps**:
1. Render `<LoginPage />` with URL search param `?redirect=/project/abc`.
2. Mock `loginUser` to return `{ success: true, redirect: '/project/abc' }`.
3. Fill in credentials and submit.
4. Assert router navigates to `/project/abc` (not `/`).

---

#### TC-P3-17: LoginPage — shows generic error message on failure, no field enumeration
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-03 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/login.test.tsx` |

**Test Steps**:
1. Mock `loginUser` to return `{ message: 'Invalid email or password' }`.
2. Submit form.
3. Assert error message "Invalid email or password" is visible in the DOM.
4. Assert the error message appears in an `aria-live` region.
5. Assert no additional detail mentioning "email" or "password" separately.

---

#### TC-P3-18: SessionExpiredModal — renders, traps focus, dismissible by keyboard
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-03, PRD Section 12 (accessibility) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/components/auth/SessionExpiredModal.test.tsx` |

**Test Steps**:
1. Render `<SessionExpiredModal isOpen={true} redirectUrl="/whiteboard/abc" />`.
2. Assert modal has `role="dialog"`.
3. Assert "Log in again" button is present and navigates to `/login?redirect=/whiteboard/abc`.
4. Focus an element outside the modal; Tab from it — assert focus stays inside modal (focus trap).
5. Press Escape — assert modal triggers navigation to `/login?redirect=...`.
6. Assert modal does not render when `isOpen={false}`.

---

#### TC-P3-19: 401 interception — SessionExpiredModal shown on any query/mutation 401
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-03 |
| **Type** | Integration |
| **Priority** | P0 |
| **File** | `src/integrations/tanstack-query/client.test.ts` or `src/routes/index.test.tsx` |

**Test Steps**:
1. Configure TanStack Query client with the global `onError` 401 handler.
2. Mock a query to throw/return `{ error: 'UNAUTHORIZED', status: 401 }`.
3. Assert the SessionExpiredModal visibility state is set to `true`.
4. Assert the current URL is preserved as the redirect parameter.

---

#### TC-P3-20: Root beforeLoad — unauthenticated request redirects to /login with redirect param
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-01 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/__root.test.tsx` |

**Preconditions**: `getCurrentUser` mocked to return `null`.

**Test Steps**:
1. Trigger `beforeLoad` with pathname `/projects`.
2. Assert a redirect to `/login?redirect=%2Fprojects` is thrown.

---

#### TC-P3-21: Root beforeLoad — /login path does not cause redirect loop
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-01 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/__root.test.tsx` |

**Test Steps**:
1. Trigger `beforeLoad` with pathname `/login` and `getCurrentUser` returning `null`.
2. Assert NO redirect is thrown.
3. Repeat for pathname `/register`.
4. Assert NO redirect is thrown.

---

#### TC-P3-22: Root beforeLoad — valid session allows navigation through
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-01 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/__root.test.tsx` |

**Test Steps**:
1. Mock `getCurrentUser` to return a valid user.
2. Trigger `beforeLoad` with pathname `/projects`.
3. Assert no redirect is thrown.

---

#### TC-P3-23: Existing server functions wrapped with requireAuth — return 401 without session
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-02 |
| **Type** | Integration |
| **Priority** | P0 |
| **File** | `src/routes/api/projects.test.ts` (extend existing) |

**Test Steps** (for each wrapped function: getProjects, createProject, deleteProject):
1. Mock `getSessionFromCookie` to return `null`.
2. Call the wrapped server function.
3. Assert response matches `{ error: 'UNAUTHORIZED', status: 401 }`.

---

#### TC-P3-24: Logout — session deleted from DB; protected routes redirect after logout
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-LOGIN-05 |
| **Type** | Integration |
| **Priority** | P0 |
| **File** | `src/routes/api/auth.test.ts` |

**Test Steps**:
1. Create a valid session.
2. Call `logoutUser` — assert session deleted from DB and cookie cleared.
3. Call any `requireAuth`-wrapped server function with the former session token.
4. Assert returns `{ error: 'UNAUTHORIZED', status: 401 }`.

---

#### TC-P3-25: Accessibility — auth form fields have labels and aria-live error regions
| Field | Value |
|-------|-------|
| **Requirement** | PRD Section 12 (WCAG 2.1 AA) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/routes/register.test.tsx`, `src/routes/login.test.tsx` |

**Test Steps**:
1. Render each form.
2. Assert every `<input>` has an associated `<label>` (either `htmlFor` or `aria-label`).
3. Submit with invalid data.
4. Assert error messages appear in an `aria-live="polite"` or `aria-live="assertive"` region.
5. Assert focus moves to the first invalid field after failed submission.
6. Assert `aria-busy="true"` is set on form or submit button during submission.

---

### Phase 4: Project-Level Permissions

---

#### TC-P4-01: createProject sets ownerId to current user
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-01 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/routes/api/projects.test.ts` |

**Test Steps**:
1. Mock `requireAuth` to inject `{ user: { id: 'user-uuid' } }`.
2. Mock `prisma.project.create`.
3. Call `createProject({ name: 'My Project' })`.
4. Assert `prisma.project.create` was called with `data.ownerId === 'user-uuid'`.

---

#### TC-P4-02: findAllProjectsForUser — filters to owned + permitted projects only
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-03 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/data/project.test.ts` |

**Test Steps**:
1. Mock Prisma to return a mixed list: projects owned by the user, projects with a permission entry, projects with neither.
2. Call `findAllProjectsForUser('user-uuid')`.
3. Assert only owned + permitted projects are returned.
4. Assert projects with no access are excluded.

---

#### TC-P4-03: getProjectById — returns 403 for non-permitted user
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-03 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/routes/api/projects.test.ts` |

**Test Steps**:
1. Mock `findEffectiveRole` to return `null` (no access).
2. Call `getProjectById({ projectId: 'proj-uuid' })` with an authenticated user.
3. Assert response is `{ error: 'FORBIDDEN', status: 403, message: 'You do not have access to this project.' }`.

---

#### TC-P4-04: Whiteboard read requires VIEWER or above
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-04 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/routes/api/whiteboards.test.ts` |

**Test Steps**:
1. Mock `findEffectiveRole` to return `null`.
2. Call `getWhiteboard({ whiteboardId })`.
3. Assert 403 response.
4. Mock `findEffectiveRole` to return `'VIEWER'`.
5. Call `getWhiteboard`.
6. Assert success response.

---

#### TC-P4-05: Whiteboard write requires EDITOR or above; VIEWER gets 403
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-04, Role Capabilities table |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/routes/api/whiteboards.test.ts` |

**Test Steps**:
1. Mock `findEffectiveRole` to return `'VIEWER'`.
2. Call `createWhiteboard`.
3. Assert 403 response.
4. Mock `findEffectiveRole` to return `'EDITOR'`.
5. Call `createWhiteboard`.
6. Assert success.

---

#### TC-P4-06: deleteProject — only OWNER or ADMIN succeeds; EDITOR gets 403
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-01, Role Capabilities table |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/routes/api/projects.test.ts` |

**Test Steps**:
1. Mock `findEffectiveRole` to return `'EDITOR'`.
2. Call `deleteProject`.
3. Assert 403.
4. Mock `findEffectiveRole` to return `'ADMIN'`.
5. Call `deleteProject`.
6. Assert success.
7. Mock `findEffectiveRole` to return `'OWNER'`.
8. Call `deleteProject`.
9. Assert success.

---

#### TC-P4-07: grantPermission — ADMIN can add EDITOR; ADMIN cannot add ADMIN (only OWNER can)
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-02, Role Capabilities table |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/routes/api/permissions.test.ts` |

**Test Steps**:
1. Mock caller as ADMIN; call `grantPermission({ email: 'x@y.com', role: 'EDITOR' })`.
2. Assert success.
3. Mock caller as ADMIN; call `grantPermission({ email: 'x@y.com', role: 'ADMIN' })`.
4. Assert 403 (only OWNER can grant ADMIN role).
5. Mock caller as OWNER; call `grantPermission({ email: 'x@y.com', role: 'ADMIN' })`.
6. Assert success.

---

#### TC-P4-08: updatePermission — admin cannot demote owner; only owner can demote admin
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-02, Role Capabilities table |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/routes/api/permissions.test.ts` |

**Test Steps**:
1. Mock caller as ADMIN; target user is OWNER; call `updatePermission({ userId: ownerUserId, role: 'VIEWER' })`.
2. Assert 403 (cannot change owner).
3. Mock caller as ADMIN; target user is another ADMIN; call `updatePermission({ userId: adminUserId, role: 'EDITOR' })`.
4. Assert 403 (only OWNER can demote admins).
5. Mock caller as OWNER; call `updatePermission({ userId: adminUserId, role: 'EDITOR' })`.
6. Assert success.

---

#### TC-P4-09: revokePermission — owner cannot be removed
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-02 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/routes/api/permissions.test.ts` |

**Test Steps**:
1. Attempt `revokePermission({ userId: ownerUserId })` as ADMIN.
2. Assert 403 with message indicating owner cannot be removed.

---

#### TC-P4-10: listProjectPermissions — non-ADMIN/OWNER gets 403
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-03 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/routes/api/permissions.test.ts` |

**Test Steps**:
1. Mock caller as VIEWER.
2. Call `listProjectPermissions({ projectId })`.
3. Assert 403.
4. Mock caller as EDITOR.
5. Call `listProjectPermissions`.
6. Assert 403.
7. Mock caller as ADMIN.
8. Call `listProjectPermissions`.
9. Assert success with array of members.

---

#### TC-P4-11: Permission revocation — next server request returns 403
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-05 |
| **Type** | Integration |
| **Priority** | P1 |
| **File** | `src/routes/api/projects.test.ts` |

**Test Steps**:
1. Set up a user with EDITOR access to a project.
2. Call `getProjectById` — assert success.
3. Revoke the user's permission (delete ProjectMember record).
4. Call `getProjectById` again with same user.
5. Assert 403 response.

---

#### TC-P4-12: ProjectSharePanel — renders member list, hides remove button for owner row
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-02, AUTH-PERM-05 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/components/project/ProjectSharePanel.test.tsx` |

**Test Steps**:
1. Render `<ProjectSharePanel projectId="proj-1" />` with mocked `listProjectPermissions` returning owner + two members.
2. Assert owner row does not have a "Remove" button.
3. Assert non-owner rows have a "Remove" button.
4. Assert role selector is present for non-owner rows.
5. Assert "Add user" form has email input and role selector.

---

#### TC-P4-13: Share button — only visible to OWNER and ADMIN
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-02 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/components/project/ProjectHeader.test.tsx` |

**Test Steps**:
1. Render header with effective role = VIEWER — assert "Share" button is absent.
2. Render with effective role = EDITOR — assert "Share" button absent.
3. Render with effective role = ADMIN — assert "Share" button present.
4. Render with effective role = OWNER — assert "Share" button present.

---

### Phase 5: WebSocket Authentication

---

#### TC-P5-01: Socket.IO handshake — connection without session cookie is rejected
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/server/socket.test.ts` or `src/routes/api/collaboration.test.ts` |

**Preconditions**: Socket.IO handshake middleware extracted and testable in isolation; `validateSessionToken` mocked.

**Test Steps**:
1. Create a mock socket with `handshake.headers = {}` (no Cookie header).
2. Call the handshake middleware with the mock socket and a `next` spy.
3. Assert `next` was called with an `Error` instance.
4. Assert the error message is `'UNAUTHORIZED'` or similar.
5. Assert `socket.data.userId` is NOT set.

---

#### TC-P5-02: Socket.IO handshake — valid session cookie accepted, userId attached
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/server/socket.test.ts` or `src/routes/api/collaboration.test.ts` |

**Test Steps**:
1. Mock `validateSessionToken` to return `{ user: { id: 'user-uuid' }, session: { id: 'sess-id', expiresAt: futureDate } }`.
2. Create a mock socket with `handshake.headers.cookie = 'session_token=validtoken'`.
3. Call the handshake middleware.
4. Assert `next` was called with no error.
5. Assert `socket.data.userId === 'user-uuid'`.
6. Assert `socket.data.sessionId === 'sess-id'`.

---

#### TC-P5-03: Session expiry on active connection — emits session_expired and disconnects
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/server/socket.test.ts` |

**Preconditions**: Per-event session check logic extracted and testable.

**Test Steps**:
1. Set up a socket with `socket.data.sessionExpiresAt` in the past.
2. Simulate an incoming event on this socket.
3. Assert `socket.emit('session_expired')` was called.
4. Assert `socket.disconnect(true)` was called.
5. Assert the event handler did NOT process the event (early return).

---

#### TC-P5-04: Session expiry on active connection — valid session allows event processing
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/server/socket.test.ts` |

**Test Steps**:
1. Set up socket with `socket.data.sessionExpiresAt` 1 hour in the future.
2. Simulate an incoming event.
3. Assert the event handler processes the event.
4. Assert `socket.emit('session_expired')` was NOT called.

---

#### TC-P5-05: Permission check on edit events — VIEWER emitting edit receives permission_revoked
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-04, AUTH-PERM-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/server/socket.test.ts` |

**Test Steps**:
1. Mock `findEffectiveRole` to return `'VIEWER'`.
2. Simulate a mutating WebSocket event (e.g., `table:move`) from a socket.
3. Assert `socket.emit('permission_revoked', { projectId })` was called.
4. Assert `socket.disconnect(true)` was called.
5. Assert the event was not processed (whiteboard state unchanged).

---

#### TC-P5-06: Permission revocation on active WebSocket — client receives permission_revoked event
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-PERM-05 |
| **Type** | Unit |
| **Priority** | P1 |
| **File** | `src/hooks/use-whiteboard-collaboration.test.ts` |

**Test Steps**:
1. Render the whiteboard collaboration hook with a mocked socket.
2. Emit `'permission_revoked'` from the mocked socket with `{ projectId: 'proj-1' }`.
3. Assert a toast notification "Your access to this project has been removed" is triggered.
4. Assert a redirect to the project list is scheduled (e.g., via setTimeout or router navigation after 5 seconds).

---

#### TC-P5-07: session_expired socket event — triggers SessionExpiredModal
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-04 |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/hooks/use-whiteboard-collaboration.test.ts` |

**Test Steps**:
1. Render the whiteboard collaboration hook.
2. Emit `'session_expired'` from the mocked socket.
3. Assert the SessionExpiredModal is shown (same modal as HTTP 401 path).
4. Assert the current whiteboard URL is preserved in the redirect parameter.

---

#### TC-P5-08: CollaborationSession records use real userId FK
| Field | Value |
|-------|-------|
| **Requirement** | AUTH-GUARD-04 (tech spec locked decision — non-nullable FK) |
| **Type** | Unit |
| **Priority** | P0 |
| **File** | `src/server/socket.test.ts` |

**Test Steps**:
1. Mock `prisma.collaborationSession.create`.
2. Simulate a connection join event on a socket with `socket.data.userId = 'user-uuid'`.
3. Assert `prisma.collaborationSession.create` was called with `data.userId === 'user-uuid'`.
4. Assert the call does NOT include any placeholder string or `'anonymous'`.

---

## 4. Edge Cases & Boundaries

| Category | Test Case | Input | Expected |
|----------|-----------|-------|----------|
| Boundary | Min password length | 8 chars | Accepted |
| Boundary | Max password length | 128 chars | Accepted |
| Boundary | Password 1 char over max | 129 chars | VALIDATION_ERROR on password |
| Boundary | Min username length | 3 chars | Accepted |
| Boundary | Max username length | 50 chars | Accepted |
| Boundary | Username over max | 51 chars | VALIDATION_ERROR on username |
| Boundary | SHA-256 pre-hash at 73 bytes | 73-char password | Full password contributes to hash |
| Boundary | Exactly 5 failed login attempts | 5 consecutive failures | Account locked on 5th |
| Boundary | 4 failed attempts | 4 consecutive failures | Not yet locked |
| Invalid | Empty username | `""` | VALIDATION_ERROR |
| Invalid | Username with spaces | `"alice bob"` | VALIDATION_ERROR |
| Invalid | Username with hyphens | `"alice-bob"` | VALIDATION_ERROR |
| Invalid | Email without TLD | `"a@b"` | VALIDATION_ERROR |
| Invalid | Null session cookie | No cookie header | 401 |
| Invalid | Tampered session cookie | Modified token | 401 (hash lookup fails) |
| Invalid | Expired session cookie | Valid format, expired | 401 + session deleted from DB |
| Edge | Duplicate email registration | Email already taken | Anti-enumeration: success-shaped response |
| Edge | First user with existing projects | 0 existing users, N projects | All projects assigned atomically |
| Edge | Two simultaneous first registrations | Race condition | Only one user inherits projects (transaction isolation) |
| Edge | Direct URL to non-permitted project | User has no ProjectMember entry | 403 "You do not have access" |
| Edge | Lockout expiry check (lazy) | Lockout time passed | `checkLockout` returns `locked: false` without manual reset |
| Edge | WebSocket connect without cookie | No Cookie header in handshake | Connection refused, no socket established |
| Edge | WebSocket connect with expired session | Valid cookie, expired DB session | Connection refused at handshake |
| Edge | Session expires during whiteboard editing | Active socket, session expires | `session_expired` emitted, socket disconnected |
| Edge | crypto.randomUUID not used | Any token generation call | Token is 64-char hex, not UUID format |

---

## 5. Security Tests

| Test | Description | Expected |
|------|-------------|----------|
| Password plaintext storage | Register user; inspect DB passwordHash | Value is bcrypt hash (`$2b$12$...`), never plaintext |
| Session token raw storage | Create session; inspect DB tokenHash | Value is SHA-256 hex, not the raw cookie token |
| Cookie Secure flag absent | Create session on HTTP | `Set-Cookie` header does not contain `Secure` |
| Cookie HttpOnly present | Create session | `Set-Cookie` header contains `HttpOnly` |
| Cookie SameSite set | Create session | `Set-Cookie` header contains `SameSite=Lax` |
| Email enumeration — registration | Register with taken email | Response identical to new registration (same status, same shape) |
| Email enumeration — login | Login with non-existent email | Response identical to wrong-password response |
| Route bypass — direct URL | Navigate to `/projects` without session | Redirect to `/login?redirect=%2Fprojects` |
| Server function bypass | Call `getProjects` without session cookie | `{ error: 'UNAUTHORIZED', status: 401 }` |
| Permission escalation | VIEWER calls `createWhiteboard` | 403 FORBIDDEN |
| Permission escalation | EDITOR calls `deleteProject` | 403 FORBIDDEN |
| Admin targeting owner | ADMIN calls `revokePermission` on owner | 403 FORBIDDEN |
| Admin demoting admin | ADMIN calls `updatePermission` on another ADMIN | 403 FORBIDDEN |
| WebSocket bypass | Connect without session cookie | Connection refused at handshake |
| Account brute force | 5 rapid login failures for same email | Account locked; further attempts return LOCKED |
| Session after logout | Use old session token after logout | 401 (session deleted from DB) |
| crypto.randomUUID absence | Code review / grep check | No `randomUUID()` call in any auth file |
| Stack trace leakage | Trigger server error | Response contains no stack trace or internal path |
| SQL injection via Zod | Submit `'; DROP TABLE users; --` as email | Zod validation rejects before DB query |

---

## 6. Performance Tests

| Test | Scenario | Threshold |
|------|----------|-----------|
| Password hashing time | Hash a 64-character password with `hashPassword` | 100ms–600ms (target 200–500ms per PRD) |
| Session validation time | `validateSessionToken` on a valid token | < 10ms (single DB lookup + sub-ms SHA-256) |
| Login endpoint response | `loginUser` with correct credentials | < 700ms total (dominated by hashing) |
| Token generation | `generateSessionToken()` called 1000 times | Each call < 1ms |
| Session cookie parsing | `parseSessionCookie` with a multi-cookie header | < 1ms |
| Lockout check | `checkLockout` DB read per login | < 5ms |

---

## 7. Test Data Requirements

| Data Set | Purpose | Source |
|----------|---------|--------|
| Valid user fixture | Unit tests for data functions | Hardcoded in test files with UUID IDs |
| Known bcrypt hash | Verify `verifyPassword` against precomputed hash | Computed once in test setup, stored as constant |
| Mock session fixtures | Session validation tests | Inline mocks with `expiresAt` relative to `Date.now()` |
| Multi-cookie header string | Cookie parsing edge cases | Inline strings in test cases |
| 128-char password string | SHA-256 pre-hash boundary test | Generated with `'a'.repeat(128)` |
| 73-char password string (differing at char 73) | bcrypt truncation proof test | Two inline strings in test file |
| Empty project list | First-user migration test | Mock `prisma.project.updateMany` |
| Mock ProjectMember entries | Permission enforcement tests | Inline mock objects with role enum values |
| Mock socket object | WebSocket middleware tests | `{ handshake: { headers: {} }, data: {}, emit: vi.fn(), disconnect: vi.fn() }` |

---

## 8. Test Environment

| Environment | Purpose | Config |
|-------------|---------|--------|
| Unit (local) | Data functions, services, Zod schemas | `vitest run`; Prisma mocked via `vi.mock('@/db')`; no DB required |
| Component (local) | React components and routes | `vitest run`; `jsdom`; `@testing-library/react`; server functions mocked |
| Integration (local) | Cross-layer flows (register → session → route access) | `vitest run`; Prisma mocked at module boundary; no external services |
| LAN HTTP validation | Cookie behavior over HTTP (no HTTPS) | Manual verification that `Secure` flag is absent and cookies are sent over HTTP on LAN |

Note: There is no separate staging environment defined for this feature. All automated tests run in the same Vitest environment as the existing test suite. The test command is `bun run test`.

---

## 9. Acceptance Criteria Verification

| AC ID | Acceptance Criteria | Test Cases | Pass Criteria |
|-------|---------------------|------------|---------------|
| AUTH-REG-01 | Public /register page accessible without auth | TC-P3-01, TC-P3-13 | Page renders with all fields; no redirect for unauthenticated user |
| AUTH-REG-02 | Registration creates user with hashed password; auto-login | TC-P2-01, TC-P2-02, TC-P3-03, TC-P3-04 | DB stores bcrypt hash; session cookie set; redirect to `/` |
| AUTH-REG-03 | Input validation; anti-enumeration on duplicate email | TC-P1-01, TC-P1-02, TC-P3-05, TC-P3-06, TC-P3-07 | Invalid inputs rejected; duplicate email returns success-shaped response |
| AUTH-REG-04 | First user inherits all existing projects atomically | TC-P2-09, TC-P2-10 | `project.updateMany` called with `ownerId: null` filter; wrapped in transaction |
| AUTH-LOGIN-01 | Login page with cross-link to /register | TC-P3-15 | Cross-link present; all fields labeled |
| AUTH-LOGIN-02 | Successful login creates session + HttpOnly cookie | TC-P2-04, TC-P2-05, TC-P2-06, TC-P3-08 | Session in DB; `Set-Cookie` with `HttpOnly`; no `Secure` flag |
| AUTH-LOGIN-03 | Generic error message; no field enumeration | TC-P3-09, TC-P3-10, TC-P3-17 | Message is exactly "Invalid email or password"; no field-specific detail |
| AUTH-LOGIN-04 | Remember me: 30d vs 24h session | TC-P2-07, TC-P2-08, TC-P3-15 | `expiresAt` matches expected duration; `Max-Age` in cookie matches |
| AUTH-LOGIN-05 | Logout invalidates session and clears cookie | TC-P3-12, TC-P3-24 | Session deleted from DB; `Max-Age=0` in response; subsequent requests 401 |
| AUTH-LOGIN-06 | Loading state on forms; prevents double-submit | TC-P3-14, TC-P3-18 | Submit button disabled during submission; `aria-busy` set |
| AUTH-GUARD-01 | All routes (except /login, /register) require valid session | TC-P3-20, TC-P3-21, TC-P3-22 | Redirect to `/login?redirect=...` for unauth; no loop on /login, /register |
| AUTH-GUARD-02 | Server functions return 401 without valid session | TC-P3-01, TC-P3-02, TC-P3-23 | All wrapped functions return `{ error: 'UNAUTHORIZED', status: 401 }` |
| AUTH-GUARD-03 | Client-side navigation checks auth; redirects on expiry | TC-P3-19, TC-P3-25 | SessionExpiredModal shown on 401; current URL preserved in redirect |
| AUTH-GUARD-04 | WebSocket handshake auth; session_expired event on expiry | TC-P5-01, TC-P5-02, TC-P5-03, TC-P5-07 | No valid cookie = connection refused; expired session = `session_expired` event + disconnect |
| AUTH-PERM-01 | Project owner is creating user; immutable | TC-P4-01, TC-P4-06 | `ownerId` set on create; owner cannot be removed or have role changed |
| AUTH-PERM-02 | Owner grants viewer/editor/admin roles | TC-P4-07, TC-P4-08, TC-P4-09 | OWNER can grant all roles; ADMIN cannot grant ADMIN role |
| AUTH-PERM-03 | Non-permitted users cannot see or access projects | TC-P4-02, TC-P4-03, TC-P4-10 | Filtered project list; direct URL returns 403 |
| AUTH-PERM-04 | Whiteboards inherit project permissions | TC-P4-04, TC-P4-05 | VIEWER cannot write; EDITOR can write; no whiteboard-level override |
| AUTH-PERM-05 | Permission revocation reflected on next request | TC-P4-11, TC-P4-12, TC-P5-06 | Next HTTP request returns 403; next WebSocket edit triggers `permission_revoked` |

---

## 10. Test Summary

| Type | Count | P0 | P1 | P2 |
|------|-------|----|----|----|
| Unit | 32 | 24 | 8 | 0 |
| Integration | 6 | 5 | 1 | 0 |
| Component/UI | 8 | 5 | 3 | 0 |
| WebSocket | 8 | 7 | 1 | 0 |
| **Total** | **54** | **41** | **13** | **0** |

**Requirements coverage:**
- P0 requirements covered: 14/14 (100%)
- P1 requirements covered: 5/5 (100%)
- Total requirements: 19/19 (100%)

**Phase breakdown:**
- Phase 1 (Database Layer): TC-P1-01 through TC-P1-07 (7 test cases)
- Phase 2 (Auth Core): TC-P2-01 through TC-P2-16 (16 test cases)
- Phase 3 (Routes + Middleware + UI): TC-P3-01 through TC-P3-25 (25 test cases)
- Phase 4 (Permissions): TC-P4-01 through TC-P4-13 (13 test cases)
- Phase 5 (WebSocket Auth): TC-P5-01 through TC-P5-08 (8 test cases)
