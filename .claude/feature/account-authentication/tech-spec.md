# Technical Specification: Account Authentication

| Field                | Value                           |
| -------------------- | ------------------------------- |
| **Feature**          | Account Authentication          |
| **Author**           | Hephaestus (Tech Spec Agent)    |
| **Status**           | Complete                        |
| **Created**          | 2026-04-03                      |
| **Based On**         | prd.md v2 (Nemesis-approved)    |
| **Locked Decisions** | context.md (Themis, 2026-04-03) |

---

## 1. Overview

This specification defines the technical design for adding user authentication, session management, route protection, project-level permissions, and WebSocket authentication to Liz Whiteboard. The system is self-hosted with no external auth providers. All decisions follow the locked context from the discuss phase and align with the 5-phase decomposition.

---

## 2. Architecture Decisions

### 2.1 Password Hashing: bcryptjs (not Argon2id)

**What:** Use `bcryptjs` (pure JavaScript) with cost factor 12 for password hashing.

**Why:** Argon2id is the OWASP gold standard, but the `argon2` npm package requires native compilation (node-gyp, C toolchain). Bun's compatibility with native addons is inconsistent, and build failures on the developer's environment would block the entire auth feature. `bcryptjs` is a pure-JS implementation with zero native dependencies, guaranteed to work on any Bun/Node runtime. Cost factor 12 targets ~250ms hash time, within the PRD's 200-500ms range.

**Trade-off:** Bcrypt has a 72-byte password input limit. With the PRD's 128-character max and UTF-8 encoding, some multi-byte passwords near the limit could be silently truncated. Mitigation: the 128-character limit makes this a theoretical edge case. If Argon2id support in Bun stabilizes, migration is straightforward (verify old hash with bcrypt, re-hash with Argon2id on successful login).

**Decision: pre-hash long passwords.** To avoid bcrypt's 72-byte truncation, passwords longer than 72 bytes are SHA-256 hashed before being passed to bcrypt. This is the standard mitigation (used by Dropbox et al.) and ensures all 128 characters contribute to the hash.

### 2.2 Session Token: Hashed Storage (SHA-256)

**What:** The raw session token (64 hex characters from `crypto.randomBytes(32)`) is stored in the HttpOnly cookie. The database `Session.tokenHash` column stores the SHA-256 hash of the raw token. The raw token is never persisted to the database.

**Why:** Locked decision from context.md. If the database is compromised, session tokens cannot be used directly. Lookup is by `tokenHash` column with a unique index.

**Trade-off:** Adds one SHA-256 hash per request for session validation. SHA-256 is sub-millisecond, so the overhead is negligible.

### 2.3 Account Lockout: Fields on User Model

**What:** `lockedUntil` (DateTime, nullable) and `failedLoginAttempts` (Int, default 0) live directly on the `User` model.

**Why:** Locked decision from context.md. No separate table needed. Anti-enumeration means failed attempts against non-existent emails are silently discarded -- lockout only applies to confirmed accounts.

**Trade-off:** Lockout state is per-user, not per-IP. An attacker could lock out a legitimate user. Acceptable for a LAN tool with known users.

### 2.4 CollaborationSession Migration: Delete All Rows

**What:** The Prisma migration deletes all existing `CollaborationSession` rows, then adds a non-nullable `userId` FK to `User`.

**Why:** Locked decision from context.md. Collaboration sessions are ephemeral (5-minute expiry). No data loss of value. Avoids nullable FK complexity.

### 2.5 Socket.IO Authentication: Cookie-Based Handshake Middleware

**What:** Socket.IO's `io.use()` middleware reads the `Cookie` header from `socket.handshake.headers`, parses the `session_token` cookie, SHA-256 hashes it, and validates against the `Session` table. Rejected connections receive `next(new Error('UNAUTHORIZED'))`.

**Why:** Socket.IO connections include cookies in the handshake HTTP request when `withCredentials: true` is set on the client. This reuses the existing session mechanism with no separate token.

**Verified Integration Pattern:** The Socket.IO server is initialized via a Vite plugin (`socketIOPlugin` in `vite.config.ts`) that attaches to the dev server's `httpServer`. The `initializeSocketIO` function in `src/routes/api/collaboration.ts` receives the `httpServer` and creates the Socket.IO server instance. The handshake middleware is added via `io.use()` or `namespace.use()` inside `initializeSocketIO`, BEFORE the connection event handlers. No Vinxi/Nitro plugin API is needed -- Socket.IO attaches directly to the underlying Node.js HTTP server, and cookie parsing happens in user-space within the middleware. See Section 7.5 for the detailed pattern.

### 2.6 Server Function Auth: Wrapper Pattern (not TanStack Middleware)

**What:** A `requireAuth` higher-order function wraps `createServerFn` handlers. It extracts the session cookie from the request, validates it, and passes `{ user, session }` to the handler. If invalid, it returns a structured 401 response.

**Why:** TanStack Start's `createMiddleware()` API exists but is relatively new and has limited documentation for request/response cookie manipulation. A simple wrapper function achieves the same result with explicit control and is consistent with how the codebase already structures server functions. The wrapper pattern is also easier to test in isolation.

**Trade-off:** Each server function must explicitly use the wrapper (not automatic). Enforced by code review.

### 2.7 Project Permission Model: ProjectMember Table

**What:** The permission table is named `ProjectMember` (not `ProjectPermission`) to align with the user-facing concept of project membership.

**Why:** The PRD speaks of "granting access" and "sharing projects." `ProjectMember` better communicates intent. The table stores `{ id, projectId, userId, role }` where `role` is the `ProjectRole` enum (VIEWER, EDITOR, ADMIN). Owner is NOT stored in this table -- ownership is determined by `Project.ownerId`.

**Trade-off:** Future group permissions will need a separate `GroupProjectMember` table, but the current `ProjectMember` table needs no modification.

---

## 3. Database Schema

### 3.1 New Models

```prisma
enum ProjectRole {
  VIEWER
  EDITOR
  ADMIN
}

model User {
  id                  String   @id @default(uuid())
  username            String   @unique @db.VarChar(50)
  email               String   @unique @db.VarChar(255)
  passwordHash        String   @db.Text
  failedLoginAttempts Int      @default(0)
  lockedUntil         DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  sessions             Session[]
  ownedProjects        Project[]             @relation("ProjectOwner")
  projectMemberships   ProjectMember[]
  collaborationSessions CollaborationSession[]

  @@index([email])
}

model Session {
  id        String   @id @default(uuid())
  tokenHash String   @unique @db.VarChar(64)
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}

model ProjectMember {
  id        String      @id @default(uuid())
  projectId String
  userId    String
  role      ProjectRole
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId])
  @@index([userId])
}
```

### 3.2 Modified Models

```prisma
model Project {
  // Existing fields unchanged
  id          String      @id @default(uuid())
  name        String      @db.VarChar(255)
  description String?     @db.Text
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  // NEW: nullable FK to User (nullable until first-user migration runs)
  ownerId     String?

  // Existing relations
  folders     Folder[]
  whiteboards Whiteboard[]

  // NEW relations
  owner       User?           @relation("ProjectOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  members     ProjectMember[]

  @@index([createdAt])
  @@index([ownerId])
}

model CollaborationSession {
  id             String   @id @default(uuid())
  whiteboardId   String
  userId         String   // CHANGED: now a proper FK to User
  socketId       String   @unique
  cursor         Json?
  lastActivityAt DateTime @updatedAt
  createdAt      DateTime @default(now())

  whiteboard Whiteboard @relation(fields: [whiteboardId], references: [id], onDelete: Cascade)
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([whiteboardId])
  @@index([lastActivityAt])
  @@index([userId])
}
```

### 3.3 Migration Strategy

The Prisma migration must be applied in this order within a single migration file:

1. Create `User` model
2. Create `Session` model
3. Create `ProjectRole` enum
4. Create `ProjectMember` model
5. Add `ownerId` nullable column to `Project` with FK to `User`
6. Delete all rows from `CollaborationSession` (SQL: `DELETE FROM "CollaborationSession"`)
7. Add `userId` FK constraint on `CollaborationSession` referencing `User(id)` as non-nullable

The migration uses `prisma migrate dev` with a custom SQL block for step 6. The migration file is committed to the repository.

### 3.4 Zod Schemas (additions to `src/data/schema.ts`)

```typescript
// Auth schemas
export const registerInputSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username must be alphanumeric with underscores only',
    ),
  email: z.string().email('Invalid email address').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
})

export const loginInputSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().default(false),
})

// Permission schemas
export const projectRoleSchema = z.nativeEnum(ProjectRole)

export const grantPermissionSchema = z.object({
  projectId: z.string().uuid(),
  email: z.string().email(),
  role: projectRoleSchema,
})

export const updatePermissionSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  role: projectRoleSchema,
})

export const revokePermissionSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
})
```

---

## 4. API Design

### 4.1 Auth Server Functions (`src/routes/api/auth.ts`)

All auth server functions use `createServerFn` from `@tanstack/react-start`.

#### `registerUser`

- **Method:** POST
- **Input:** `registerInputSchema`
- **Logic:**
  1. Validate input
  2. Check if email already exists
  3. If duplicate email: return `{ success: true, message: 'Registration successful. Please log in.', redirect: '/login' }` (anti-enumeration)
  4. If new email: hash password (SHA-256 pre-hash + bcrypt), create User in transaction
  5. Inside same transaction: count users. If count was 0 before this insert, call `migrateDataToFirstUser(userId)` to set `ownerId` on all existing Projects
  6. Create Session, set HttpOnly cookie, return `{ success: true, redirect: '/' }`
- **Response shape:** `{ success: boolean, message?: string, redirect: string }`

#### `loginUser`

- **Method:** POST
- **Input:** `loginInputSchema`
- **Logic:**
  1. Validate input
  2. Find user by email. If not found: return generic error (do NOT record failed attempt for non-existent user)
  3. Check lockout: if `lockedUntil > now`, return `{ error: 'LOCKED', message: 'Too many failed attempts. Please try again in 15 minutes.', unlocksAt: lockedUntil }`
  4. Verify password. If wrong: increment `failedLoginAttempts`, set `lockedUntil` if attempts >= 5, return generic error
  5. On success: clear lockout fields, create Session (24h or 30d based on `rememberMe`), set cookie, return redirect
- **Response shape:** `{ success: boolean, error?: string, message?: string, redirect?: string }`

#### `logoutUser`

- **Method:** POST
- **Input:** None (session from cookie)
- **Logic:** Delete Session from DB, clear cookie, return redirect to `/login`
- **Requires auth:** Yes

#### `getCurrentUser`

- **Method:** GET
- **Input:** None (session from cookie)
- **Logic:** Validate session, return `{ user: { id, username, email } }` or `null`
- **Requires auth:** No (returns null if unauthenticated, does not throw)

### 4.2 Permission Server Functions (`src/routes/api/permissions.ts`)

All require auth via `requireAuth` wrapper.

#### `listProjectPermissions`

- **Method:** GET
- **Input:** `{ projectId: string }`
- **Requires:** ADMIN or OWNER effective role on project
- **Returns:** Array of `{ user: { id, username, email }, role: ProjectRole }` plus owner info

#### `grantPermission`

- **Method:** POST
- **Input:** `grantPermissionSchema`
- **Requires:** ADMIN or OWNER
- **Logic:** Find user by email (return error if not found), create ProjectMember entry. If user already has a membership, update role instead.

#### `updatePermission`

- **Method:** POST
- **Input:** `updatePermissionSchema`
- **Requires:** ADMIN or OWNER. Additional rule: only OWNER can change an ADMIN's role.

#### `revokePermission`

- **Method:** POST
- **Input:** `revokePermissionSchema`
- **Requires:** ADMIN or OWNER. Rules: owner cannot be removed (ownership is on Project.ownerId, not in ProjectMember). Only OWNER can remove an ADMIN.

### 4.3 Existing Server Functions: Auth Wrapping

Every server function in these files gets wrapped with `requireAuth`:

- `src/routes/api/projects.ts`
- `src/routes/api/whiteboards.ts`
- `src/routes/api/tables.ts`
- `src/routes/api/columns.ts`
- `src/routes/api/relationships.ts`
- `src/routes/api/folders.ts`
- `src/lib/server-functions.ts`

The `requireAuth` wrapper pattern:

```typescript
// src/lib/auth/middleware.ts
import { getWebRequest } from '@tanstack/react-start'
import { getSessionFromCookie } from './cookies'

export function requireAuth<TInput, TResult>(
  handler: (
    ctx: { user: AuthUser; session: AuthSession },
    input: TInput,
  ) => Promise<TResult>,
) {
  return async ({
    data,
  }: {
    data: TInput
  }): Promise<TResult | AuthErrorResponse> => {
    const request = getWebRequest()
    const authResult = await getSessionFromCookie(request)
    if (!authResult) {
      return { error: 'UNAUTHORIZED', status: 401 } as any
    }
    return handler({ user: authResult.user, session: authResult.session }, data)
  }
}
```

Example usage on an existing function:

```typescript
// Before
export const getProjects = createServerFn({ method: 'GET' }).handler(
  async () => {
    const projects = await findAllProjects()
    return projects
  },
)

// After
export const getProjects = createServerFn({ method: 'GET' }).handler(
  requireAuth(async ({ user }) => {
    const projects = await findAllProjectsForUser(user.id)
    return projects
  }),
)
```

### 4.4 Error Response Shapes

All auth-related errors follow these structured shapes:

| Status | Shape                                                                        | When                       |
| ------ | ---------------------------------------------------------------------------- | -------------------------- |
| 401    | `{ error: 'UNAUTHORIZED', status: 401 }`                                     | Missing or expired session |
| 403    | `{ error: 'FORBIDDEN', status: 403, message: string }`                       | Insufficient permission    |
| 400    | `{ error: 'VALIDATION_ERROR', status: 400, fields: Record<string, string> }` | Input validation failure   |
| 429    | `{ error: 'LOCKED', status: 429, message: string, unlocksAt: string }`       | Account lockout            |

---

## 5. Auth Core Services

### 5.1 Password Service (`src/lib/auth/password.ts`)

```typescript
import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'

const BCRYPT_ROUNDS = 12

/**
 * Pre-hash with SHA-256 to avoid bcrypt's 72-byte truncation,
 * then hash with bcrypt at cost factor 12.
 */
export async function hashPassword(password: string): Promise<string> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.hash(sha256, BCRYPT_ROUNDS)
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.compare(sha256, hash)
}
```

### 5.2 Session Service (`src/lib/auth/session.ts`)

```typescript
import { randomBytes, createHash } from 'node:crypto'
import { prisma } from '@/db'

const SESSION_EXPIRY_DEFAULT = 24 * 60 * 60 * 1000 // 24 hours
const SESSION_EXPIRY_REMEMBER = 30 * 24 * 60 * 60 * 1000 // 30 days

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createUserSession(userId: string, rememberMe: boolean) {
  const token = generateSessionToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(
    Date.now() +
      (rememberMe ? SESSION_EXPIRY_REMEMBER : SESSION_EXPIRY_DEFAULT),
  )

  const session = await prisma.session.create({
    data: { tokenHash, userId, expiresAt },
  })

  return { session, token } // token goes to cookie, session.tokenHash stays in DB
}

export async function validateSessionToken(token: string): Promise<{
  user: AuthUser
  session: { id: string; expiresAt: Date }
} | null> {
  const tokenHash = hashToken(token)
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, username: true, email: true } } },
  })

  if (!session) return null
  if (session.expiresAt < new Date()) {
    // Expired: delete and return null
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }

  return {
    user: session.user,
    session: { id: session.id, expiresAt: session.expiresAt },
  }
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {})
}

export async function deleteExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count
}
```

### 5.3 Cookie Utilities (`src/lib/auth/cookies.ts`)

```typescript
import { validateSessionToken } from './session'

const COOKIE_NAME = 'session_token'

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
  return match ? match.split('=')[1] : null
}

export async function getSessionFromCookie(request: Request) {
  const cookieHeader = request.headers.get('cookie')
  const token = parseSessionCookie(cookieHeader)
  if (!token) return null
  return validateSessionToken(token)
}

export function buildSetCookieHeader(
  token: string,
  rememberMe: boolean,
): string {
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}
```

Note: The `Secure` flag is intentionally absent. The developer accesses the app over HTTP on a LAN. Adding `Secure` would prevent cookies from being sent.

### 5.4 Rate Limiting (`src/lib/auth/rate-limit.ts`)

```typescript
import { prisma } from '@/db'

const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

export async function checkLockout(
  email: string,
): Promise<{ locked: boolean; unlocksAt?: Date }> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { lockedUntil: true },
  })
  if (!user) return { locked: false } // Unknown user: no lockout (anti-enumeration)
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { locked: true, unlocksAt: user.lockedUntil }
  }
  return { locked: false }
}

export async function recordFailedLogin(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, failedLoginAttempts: true, lockedUntil: true },
  })
  if (!user) return // Unknown user: silently discard (anti-enumeration)

  // If lockout has expired, reset counter
  const currentAttempts =
    user.lockedUntil && user.lockedUntil <= new Date()
      ? 1
      : user.failedLoginAttempts + 1

  const updates: any = { failedLoginAttempts: currentAttempts }
  if (currentAttempts >= MAX_ATTEMPTS) {
    updates.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS)
  }

  await prisma.user.update({ where: { id: user.id }, data: updates })
}

export async function clearLockout(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  })
}
```

### 5.5 First-User Migration (`src/lib/auth/first-user-migration.ts`)

```typescript
import { prisma } from '@/db'

/**
 * Assigns all existing ownerless Projects to the given user.
 * Called inside the registration transaction when the user count was 0.
 * Idempotent: only updates Projects where ownerId IS NULL.
 */
export async function migrateDataToFirstUser(userId: string): Promise<void> {
  await prisma.project.updateMany({
    where: { ownerId: null },
    data: { ownerId: userId },
  })
}
```

This function is called inside the same `prisma.$transaction()` that creates the user. The transaction checks user count at the start:

```typescript
await prisma.$transaction(async (tx) => {
  const userCount = await tx.user.count()
  const user = await tx.user.create({ data: { ... } })
  if (userCount === 0) {
    await tx.project.updateMany({
      where: { ownerId: null },
      data: { ownerId: user.id },
    })
  }
  return user
})
```

---

## 6. Route Protection

### 6.1 Root Route `beforeLoad` (`src/routes/__root.tsx`)

The root route's `beforeLoad` hook calls `getCurrentUser` to check auth state. If null, redirects to `/login?redirect=<pathname>`. Public routes (`/login`, `/register`) are excluded.

```typescript
export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async ({ location }) => {
    const publicPaths = ['/login', '/register']
    if (publicPaths.some((p) => location.pathname.startsWith(p))) {
      return
    }
    const result = await getCurrentUser()
    if (!result) {
      throw redirect({
        to: '/login',
        search: { redirect: location.pathname },
      })
    }
    return { user: result.user }
  },
  // ... rest unchanged
})
```

The router context is extended to include `user`:

```typescript
interface MyRouterContext {
  queryClient: QueryClient
  user?: { id: string; username: string; email: string }
}
```

### 6.2 Login Route (`src/routes/login.tsx`)

- Public route (no auth required)
- Form fields: email, password, "Remember me" checkbox
- Submit calls `loginUser` server function
- On success: redirect to `search.redirect` or `/`
- On failure: show generic "Invalid email or password" error
- On lockout: show "Too many failed attempts. Please try again in 15 minutes."
- Loading state: submit button disabled with spinner during submission
- Cross-link: "Don't have an account? Register" link to `/register`
- Built with shadcn/ui: `Input`, `Label`, `Button`, existing `Checkbox` (or `Switch`)

### 6.3 Register Route (`src/routes/register.tsx`)

- Public route (no auth required)
- Form fields: username, email, password
- Client-side validation with Zod (field-level errors)
- Submit calls `registerUser` server function
- On genuine success: auto-logged in, redirect to `/`
- On duplicate email (anti-enumeration): show "Registration successful. Please log in." and redirect to `/login`
- Loading state: submit button disabled with spinner
- Cross-link: "Already have an account? Log in" link to `/login`

### 6.4 Shell Component Changes

The `RootDocument` shell component in `__root.tsx` conditionally renders `Header` and `Sidebar` only on authenticated routes. On `/login` and `/register`, only the `<main>` content is rendered (no header, no sidebar).

### 6.5 SessionExpiredModal (`src/components/auth/SessionExpiredModal.tsx`)

- Overlays the current page when a 401 is detected
- Contains "Your session has expired" message and "Log in again" button
- Focus trap: uses `Dialog` from shadcn/ui (built on Radix Dialog) for automatic focus trapping
- Keyboard: Escape key triggers the same redirect as the button
- Preserves current URL in `redirect` query parameter
- Mounted at root level in `__root.tsx`
- Triggered by a shared React context (`AuthContext`) that both HTTP 401 responses and WebSocket `session_expired` events write to

### 6.6 Global 401 Interception

TanStack Query's `QueryClient` is configured with a global `onError` callback that checks for 401 responses and triggers the `SessionExpiredModal` via `AuthContext`. This is set up in `src/integrations/tanstack-query/root-provider.tsx`.

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isUnauthorizedError(error)) return false
        return failureCount < 3
      },
    },
    mutations: {
      onError: (error) => {
        if (isUnauthorizedError(error)) {
          // Signal AuthContext to show SessionExpiredModal
        }
      },
    },
  },
})
```

---

## 7. Implementation Plan (Aligned with Decomposition)

### 7.1 Phase 1: Database Layer

**Files to create:**
| File | Purpose |
|------|---------|
| `prisma/schema.prisma` (modify) | Add User, Session, ProjectMember, ProjectRole; modify Project and CollaborationSession |
| `prisma/migrations/YYYYMMDD_account_auth/` | Generated migration + custom SQL for CollaborationSession cleanup |
| `src/data/user.ts` | User CRUD: createUser, findUserByEmail, findUserByUsername, findUserById |
| `src/data/session.ts` | Auth Session CRUD (not CollaborationSession): create, findByTokenHash, delete, deleteExpired |
| `src/data/permission.ts` | ProjectMember CRUD: create, findByProject, findByUser, upsert, delete, findEffectiveRole |
| `src/data/schema.ts` (modify) | Add registerInputSchema, loginInputSchema, projectRoleSchema, permission schemas |

**Files to modify:**
| File | Change |
|------|--------|
| `src/data/collaboration.ts` | Update types to reflect non-nullable userId FK |

**Sequence:**

1. Schema changes + Zod schemas (Wave 1: tasks 1.1, 1.2)
2. Generate migration (Wave 2: task 1.3)
3. Data access functions (Wave 2: tasks 1.4-1.7, parallel)

### 7.2 Phase 2: Auth Core

**Files to create:**
| File | Purpose |
|------|---------|
| `src/lib/auth/password.ts` | hashPassword, verifyPassword (bcryptjs + SHA-256 pre-hash) |
| `src/lib/auth/session.ts` | generateSessionToken, hashToken, createUserSession, validateSessionToken, invalidateSession |
| `src/lib/auth/cookies.ts` | parseSessionCookie, getSessionFromCookie, buildSetCookieHeader, buildClearCookieHeader |
| `src/lib/auth/rate-limit.ts` | checkLockout, recordFailedLogin, clearLockout |
| `src/lib/auth/first-user-migration.ts` | migrateDataToFirstUser |

**New dependency:** `bun add bcryptjs` and `bun add -d @types/bcryptjs`

**Sequence:**

1. Password, session, cookie, rate-limit services (Wave 1: tasks 2.1-2.4, parallel)
2. First-user migration (Wave 2: task 2.5)

### 7.3 Phase 3: Auth Routes, Middleware, and UI

**Files to create:**
| File | Purpose |
|------|---------|
| `src/lib/auth/middleware.ts` | requireAuth wrapper for createServerFn handlers |
| `src/routes/api/auth.ts` | registerUser, loginUser, logoutUser, getCurrentUser server functions |
| `src/routes/login.tsx` | Login page route and component |
| `src/routes/register.tsx` | Registration page route and component |
| `src/components/auth/SessionExpiredModal.tsx` | 401 modal with focus trap |
| `src/components/auth/AuthContext.tsx` | React context for auth state + session expired trigger |
| `src/components/project/EmptyState.tsx` | Empty state messaging for project list |

**Files to modify:**
| File | Change |
|------|--------|
| `src/routes/__root.tsx` | Add beforeLoad auth check, wrap shell in AuthContext, mount SessionExpiredModal, conditionally hide Header/Sidebar on public routes |
| `src/routes/api/projects.ts` | Wrap all handlers with requireAuth, filter by user access |
| `src/routes/api/whiteboards.ts` | Wrap all handlers with requireAuth |
| `src/routes/api/tables.ts` | Wrap all handlers with requireAuth |
| `src/routes/api/columns.ts` | Wrap all handlers with requireAuth |
| `src/routes/api/relationships.ts` | Wrap all handlers with requireAuth |
| `src/routes/api/folders.ts` | Wrap all handlers with requireAuth |
| `src/lib/server-functions.ts` | Wrap all handlers with requireAuth |
| `src/components/layout/Header.tsx` | Add Logout button, display username |
| `src/integrations/tanstack-query/root-provider.tsx` | Add global 401 error interception |

**Sequence:**

1. Server functions + middleware (Wave 1: tasks 3.1-3.6)
2. Routes + root protection + modal + header (Wave 2: tasks 3.7-3.12)
3. Empty states (Wave 3: task 3.13)

### 7.4 Phase 4: Project-Level Permissions

**Files to create:**
| File | Purpose |
|------|---------|
| `src/routes/api/permissions.ts` | grantPermission, updatePermission, revokePermission, listProjectPermissions |
| `src/components/project/ProjectSharePanel.tsx` | Share panel UI (Sheet/Dialog with user list, role management) |

**Files to modify:**
| File | Change |
|------|--------|
| `src/data/permission.ts` | Implement findEffectiveRole with owner check + ProjectMember lookup |
| `src/data/project.ts` | Add userId filtering to findAllProjects, findAllProjectsWithTree, findProjectPageContent |
| `src/routes/api/projects.ts` | Add permission checks (OWNER/ADMIN for delete, EDITOR+ for write) |
| `src/routes/api/whiteboards.ts` | Add permission checks (VIEWER+ for read, EDITOR+ for write) |
| `src/routes/api/tables.ts` | Add permission checks via project lookup |
| `src/routes/api/columns.ts` | Add permission checks via project lookup |
| `src/routes/api/relationships.ts` | Add permission checks via project lookup |
| Project header component | Add "Share" button visible only to OWNER/ADMIN |

**Permission check helper:**

```typescript
// src/lib/auth/permissions.ts
const ROLE_HIERARCHY = { VIEWER: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 } as const

type EffectiveRole = keyof typeof ROLE_HIERARCHY

export function hasMinimumRole(
  effective: EffectiveRole | null,
  required: EffectiveRole,
): boolean {
  if (!effective) return false
  return ROLE_HIERARCHY[effective] >= ROLE_HIERARCHY[required]
}
```

**Sequence:**

1. Permission enforcement in data layer (Wave 1: tasks 4.1-4.3)
2. Server function permission gates (Wave 2: tasks 4.4-4.7)
3. Permission management UI (Wave 3: tasks 4.8-4.9)

### 7.5 Phase 5: WebSocket Authentication

**Verified Integration Pattern:**

The Socket.IO server is initialized via the Vite `socketIOPlugin` in `vite.config.ts`. This plugin's `configureServer` hook imports `src/routes/api/collaboration.ts` through the SSR environment runner and calls `initializeSocketIO(httpServer)`. Socket.IO attaches directly to the underlying Node.js HTTP server -- no Vinxi/Nitro plugin API is involved.

The handshake middleware is added inside `initializeSocketIO` before any namespace handlers:

```typescript
// Inside initializeSocketIO, after creating the SocketIOServer instance:
export function initializeSocketIO(httpServer: HTTPServer): SocketIOServer {
  if (io) return io

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true, // Required for cookies to be sent
    },
    transports: ['websocket', 'polling'],
  })

  // Auth middleware: runs on EVERY connection attempt, before 'connection' event
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie || ''
      const token = parseSessionCookie(cookieHeader)
      if (!token) {
        return next(new Error('UNAUTHORIZED'))
      }

      const authResult = await validateSessionToken(token)
      if (!authResult) {
        return next(new Error('UNAUTHORIZED'))
      }

      // Attach auth data to socket for use in event handlers
      socket.data.userId = authResult.user.id
      socket.data.sessionId = authResult.session.id
      socket.data.sessionExpiresAt = authResult.session.expiresAt.getTime()
      next()
    } catch (error) {
      next(new Error('UNAUTHORIZED'))
    }
  })

  // Also add per-namespace middleware for dynamic namespaces:
  io.of(/^\/whiteboard\/[\w-]+$/).use(async (socket, next) => {
    // Same cookie-based auth as above (or reuse from io.use if already validated)
    // The global io.use() runs first, so socket.data is already populated
    next()
  })

  setupWhiteboardNamespace(io)
  // ... rest unchanged
}
```

**Client-side change:** The `useCollaboration` hook currently passes `auth: { userId }` in the Socket.IO connect options. After this phase, it no longer needs to pass `userId` explicitly -- the server reads it from the session cookie. However, the `withCredentials` option must be set to ensure cookies are included:

```typescript
const socket = io(`/whiteboard/${whiteboardId}`, {
  // auth: { userId },  -- REMOVED: server gets userId from session cookie
  withCredentials: true, // ADDED: ensures cookies are sent with handshake
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: maxReconnectionAttempts,
  transports: ['websocket', 'polling'],
})
```

**Session expiry on active connections:**

On each incoming event, check `socket.data.sessionExpiresAt` against `Date.now()`. This is an in-memory comparison (no DB round-trip) and costs nothing:

```typescript
// In event handlers, before processing:
if (Date.now() > socket.data.sessionExpiresAt) {
  socket.emit('session_expired')
  socket.disconnect(true)
  return
}
```

**Permission enforcement on edit events:**

Before processing any mutating event (table:create, table:move, column:create, etc.), call `findEffectiveRole(socket.data.userId, projectId)` where `projectId` is resolved from the whiteboard. If role is null or VIEWER:

```typescript
socket.emit('permission_revoked', { projectId })
socket.disconnect(true)
return
```

**Files to modify:**
| File | Change |
|------|--------|
| `src/routes/api/collaboration.ts` | Add `io.use()` handshake middleware, update event handlers to use `socket.data.userId`, add session expiry check, add permission check on mutation events |
| `src/hooks/use-collaboration.ts` | Remove `auth: { userId }`, add `withCredentials: true`, add `session_expired` and `permission_revoked` event handlers |
| `src/hooks/use-whiteboard-collaboration.ts` | Handle `permission_revoked` with toast + redirect |

**Sequence:**

1. Handshake auth middleware + update event handlers (Wave 1: tasks 5.1-5.2)
2. Session expiry + permission enforcement + client handlers (Wave 2: tasks 5.3-5.6)

---

## 8. File Inventory

### Files to Create (17 files)

| File                                                    | Phase |
| ------------------------------------------------------- | ----- |
| `src/data/user.ts`                                      | 1     |
| `src/data/session.ts`                                   | 1     |
| `src/data/permission.ts`                                | 1     |
| `prisma/migrations/YYYYMMDD_account_auth/migration.sql` | 1     |
| `src/lib/auth/password.ts`                              | 2     |
| `src/lib/auth/session.ts`                               | 2     |
| `src/lib/auth/cookies.ts`                               | 2     |
| `src/lib/auth/rate-limit.ts`                            | 2     |
| `src/lib/auth/first-user-migration.ts`                  | 2     |
| `src/lib/auth/middleware.ts`                            | 3     |
| `src/lib/auth/permissions.ts`                           | 3     |
| `src/routes/api/auth.ts`                                | 3     |
| `src/routes/login.tsx`                                  | 3     |
| `src/routes/register.tsx`                               | 3     |
| `src/components/auth/SessionExpiredModal.tsx`           | 3     |
| `src/components/auth/AuthContext.tsx`                   | 3     |
| `src/routes/api/permissions.ts`                         | 4     |
| `src/components/project/ProjectSharePanel.tsx`          | 4     |

### Files to Modify (15 files)

| File                                                | Phase |
| --------------------------------------------------- | ----- |
| `prisma/schema.prisma`                              | 1     |
| `src/data/schema.ts`                                | 1     |
| `src/data/collaboration.ts`                         | 1     |
| `src/data/project.ts`                               | 3, 4  |
| `src/routes/__root.tsx`                             | 3     |
| `src/routes/api/projects.ts`                        | 3, 4  |
| `src/routes/api/whiteboards.ts`                     | 3, 4  |
| `src/routes/api/tables.ts`                          | 3, 4  |
| `src/routes/api/columns.ts`                         | 3, 4  |
| `src/routes/api/relationships.ts`                   | 3, 4  |
| `src/routes/api/folders.ts`                         | 3     |
| `src/lib/server-functions.ts`                       | 3     |
| `src/components/layout/Header.tsx`                  | 3     |
| `src/integrations/tanstack-query/root-provider.tsx` | 3     |
| `src/routes/api/collaboration.ts`                   | 5     |
| `src/hooks/use-collaboration.ts`                    | 5     |
| `src/hooks/use-whiteboard-collaboration.ts`         | 5     |

---

## 9. Security Considerations

### 9.1 Password Storage

- Passwords are SHA-256 pre-hashed (to avoid bcrypt 72-byte truncation) then bcrypt-hashed at cost factor 12
- Plaintext passwords are never logged, stored, or transmitted beyond the initial HTTP request body

### 9.2 Session Security

- Session tokens: 256-bit random (32 bytes hex = 64 characters), generated via `crypto.randomBytes(32)` (server-side Node.js, no secure context required)
- Database stores SHA-256 hash of token, never the raw token
- Cookie flags: `HttpOnly` (no JS access), `SameSite=Lax` (CSRF mitigation), `Path=/` (all routes). No `Secure` flag (HTTP LAN compatibility)
- Session cleanup: expired sessions are lazily deleted on validation + periodic cleanup job

### 9.3 Anti-Enumeration

- Login failure: always returns "Invalid email or password" regardless of whether email exists
- Registration with duplicate email: returns "Registration successful. Please log in." and redirects to /login (no session created)
- Lockout: only applies to existing users. Failed attempts against non-existent emails are silently discarded

### 9.4 Rate Limiting

- 5 consecutive failed login attempts per email triggers 15-minute lockout
- Lockout is lazy-expiry: checked on read, counter resets after lockout period
- Not IP-based (acceptable for LAN where IP pools are small)

### 9.5 LAN HTTP Compatibility

- No `crypto.randomUUID()` anywhere (requires secure context)
- No `Secure` cookie flag (would break HTTP)
- Startup warning logged if HTTPS is not detected
- `crypto.randomBytes()` is used for all token generation (Node.js built-in, no secure context requirement)

---

## 10. Accessibility

All auth UI follows WCAG 2.1 AA:

- Form fields: `<Label>` with `htmlFor` on every input
- Validation errors: `aria-describedby` linking input to error message, `aria-live="polite"` on error container
- Focus management: focus moves to first error field on submit validation failure
- Loading states: `aria-busy="true"` on form during submission, button shows spinner and text "Logging in..." / "Creating account..."
- SessionExpiredModal: uses Radix Dialog (shadcn `Dialog`) which provides focus trap, `role="dialog"`, `aria-modal="true"`, Escape key dismissal
- Keyboard navigation: all interactive elements (inputs, buttons, links, checkboxes) are keyboard-accessible
- Permission panel: uses shadcn `Sheet` with Radix Dialog underneath, inheriting focus trap and keyboard support

---

## 11. Testing Strategy

### Unit Tests

- `src/lib/auth/password.test.ts`: hash/verify correctness, timing (200-500ms), wrong password rejection
- `src/lib/auth/session.test.ts`: token generation uniqueness, session creation/validation/expiry/deletion
- `src/lib/auth/rate-limit.test.ts`: lockout after 5 attempts, auto-unlock after 15 minutes
- `src/lib/auth/cookies.test.ts`: cookie parsing, header building
- `src/data/permission.test.ts`: effective role resolution (owner > admin > editor > viewer > null)

### Integration Tests

- Registration flow: new user, duplicate email, first-user migration
- Login flow: success, wrong password, locked account, non-existent email
- Session: create, validate, expire, logout
- Permission: grant, update, revoke, enforcement at each role level
- Route protection: unauthenticated redirect, authenticated access

### Manual Testing

- LAN HTTP: verify cookies are sent and received over non-HTTPS LAN connection
- Session expiry modal: let session expire while editing, verify modal appears
- WebSocket: connect without cookie, verify rejection; connect with expired session, verify disconnect

---

## 12. Dependencies

### New Packages

| Package           | Version | Purpose                                    |
| ----------------- | ------- | ------------------------------------------ |
| `bcryptjs`        | ^3.0.2  | Password hashing (pure JS, no native deps) |
| `@types/bcryptjs` | ^3.0.0  | TypeScript types (dev dependency)          |

### Existing Packages (no changes)

- `socket.io` / `socket.io-client` ^4.8.1 (already installed)
- `zod` (already installed, Zod 4.1)
- `@prisma/client` / `prisma` ^6.16.3 (already installed)
- `@tanstack/react-start` ^1.132.0 (already installed)

No other new dependencies are required. The Node.js built-in `crypto` module is used for all cryptographic operations (randomBytes, createHash).

---

## 13. Open Questions

None. All gray areas were resolved in the discuss phase (context.md). The Vinxi/Socket.IO integration pattern has been verified against the existing `vite.config.ts` implementation.
