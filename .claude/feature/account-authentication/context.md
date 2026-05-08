# Context — Account Authentication

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Scope Boundary
Account authentication adds user registration, login/logout with server-side session management, route protection for all pages and server functions, project-level role-based permissions (viewer/editor/admin), and WebSocket handshake authentication. Password reset, 2FA, email verification, OAuth, and user groups are explicitly out of scope.
</domain>

<decisions>
## Implementation Decisions

### Session Token Storage Strategy

- Cookie holds the raw session token; the database stores the SHA-256 hash of that token.
- The raw token is never persisted to the DB — only compared after hashing on each request.
- This is the modern standard: a compromised DB dump does not expose valid session tokens.
- Session lookup: hash the cookie value with SHA-256, query `Session.tokenHash`.

### Account Lockout Model Placement

- Lockout state lives directly on the `User` model as two columns: `lockedUntil` (DateTime, nullable) and `failedLoginAttempts` (Int, default 0).
- No separate `LoginAttempt` table or join is needed.
- Anti-enumeration policy means failed attempts against unknown emails are silently discarded — no tracking needed for non-existent users. Lockout only applies to confirmed accounts.

### CollaborationSession.userId Migration Strategy

- All existing `CollaborationSession` rows are deleted as part of the migration.
- The `userId` foreign key on `CollaborationSession` is added as non-nullable from day one — no nullable intermediate state.
- Sessions are ephemeral by design; data loss is acceptable and preferred over nullable FK complexity.
- Migration file must: (1) delete all rows from `CollaborationSession`, (2) add `userId` column as non-nullable with FK to `User`.

### TanStack Start + Socket.IO Integration Point

### Themis's Discretion

- User deferred this decision to Hephaestus.
- Recommendation: Before speccing Phase 5 (WebSocket auth), Hephaestus must research the Vinxi plugin API and produce a verified integration proof-of-concept pattern showing how Socket.IO's `io.use()` handshake middleware connects to TanStack Start's server lifecycle. This must be included in the tech spec before any WebSocket auth implementation is described. Do not assume a pattern — verify it.
  </decisions>

<canonical_refs>

## Canonical References

- `src/routes/api/collaboration.ts` — Socket.IO server initialization; integration point for WebSocket handshake middleware
- `src/lib/uuid.ts` — LAN-safe UUID utility; use for all new ID generation (no crypto.randomUUID())
- `src/lib/session-user-id.ts` — Current anonymous session placeholder; will be fully replaced by authenticated session lookup
- `src/lib/server-functions.ts` — Existing createServerFn patterns; all new server functions must follow this convention
- `prisma/schema.prisma` — Current schema; 3 new models (User, Session, ProjectMember) + 1 enum (ProjectRole) + ownerId on Project + userId FK on CollaborationSession
- `src/data/collaboration.ts` — CollaborationSession data access; affected by userId FK migration
- `src/routes/__root.tsx` — Root route; beforeLoad auth check and SessionExpiredModal mount here
- `src/data/schema.ts` — Zod validation schemas; all new input schemas centralized here, using .uuid() not .cuid()
  </canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `src/lib/uuid.ts` — Use for generating session tokens and all new UUIDs; avoids crypto.randomUUID() which requires secure context (HTTPS), incompatible with LAN HTTP development.
- `src/routes/api/collaboration.ts` `initializeSocketIO` — Attach handshake middleware here once Hephaestus confirms the Vinxi integration pattern.
- `src/components/ui/sonner.tsx` `Toaster` — Use for all auth feedback toasts (login errors, session expiry, permission denied).

### Established Patterns

- `createServerFn` pattern from `src/lib/server-functions.ts` — All server-side auth operations (login, logout, register, permission checks) must use this pattern.
- Prisma data access with try/catch — All new data layer functions in `src/data/` follow this convention.
- Zod schema centralization in `src/data/schema.ts` — All input validation schemas live here; use `.uuid()` for ID fields, never `.cuid()`.
- TanStack Query for client data fetching — Session/user state exposed to the client via TanStack Query.
- shadcn/ui + TailwindCSS — All auth UI (login form, registration form, permission dialogs) built exclusively with these.

### Integration Points

- `src/routes/__root.tsx` — `beforeLoad` hook enforces authentication; `SessionExpiredModal` mounts at root level to handle 401 responses globally.
- `src/routes/api/*.ts` — A `requireAuth` wrapper is added to all existing and new server function handlers.
- `src/routes/api/collaboration.ts` — Socket.IO handshake middleware verifies session token before upgrading connection.
- `src/data/project.ts` — Project queries gain a `userId` filter parameter; results are scoped to projects the authenticated user has access to.
- `prisma/schema.prisma` — Schema additions: `User` model, `Session` model, `ProjectMember` model, `ProjectRole` enum; `Project` gains `ownerId`; `CollaborationSession` gains non-nullable `userId`.
- `src/components/layout/Header.tsx` — Gains logout button and authenticated user display (name/avatar or initials).
  </code_context>

<specifics>
## Specific Ideas
- SHA-256 is the specified hashing algorithm for session token storage (not bcrypt, not a keyed HMAC — plain SHA-256 on the raw token).
- Anti-enumeration applies universally: registration, login, and password reset flows all return identical responses regardless of whether the email exists.
- Lockout fields are `lockedUntil` (DateTime, nullable) and `failedLoginAttempts` (Int, default 0) — these exact column names should be used in the Prisma schema.
- Hephaestus is explicitly required to produce a Vinxi plugin API proof-of-concept for the Socket.IO integration before speccing Phase 5; this is a hard prerequisite, not a suggestion.
</specifics>

<deferred>
## Deferred Ideas
None captured during discussion.
</deferred>
