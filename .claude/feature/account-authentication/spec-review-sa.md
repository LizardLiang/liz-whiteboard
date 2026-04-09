# Spec Review (SA) -- Account Authentication

| Field | Value |
|-------|-------|
| **Reviewer** | Apollo (Architecture Review Agent) |
| **Date** | 2026-04-03 |
| **Spec Version** | tech-spec.md (2026-04-03) |
| **Verdict** | **Sound** |

---

## 1. Verdict Summary

The tech spec is architecturally sound. No critical issues. No high-severity issues. One medium-severity concern identified (session cleanup lacks a scheduled mechanism). The design is well-structured, follows established codebase patterns, correctly implements all locked decisions from context.md, and addresses the PRD requirements comprehensively. The security model is appropriate for the LAN threat profile.

---

## 2. Architecture Soundness

### 2.1 Component Separation -- PASS

The spec cleanly separates concerns across well-defined layers:
- **Data layer** (`src/data/user.ts`, `session.ts`, `permission.ts`): Pure Prisma CRUD, consistent with existing `src/data/project.ts` patterns.
- **Auth services** (`src/lib/auth/*.ts`): Password, session, cookie, rate-limit, and first-user-migration are each in their own module. No circular dependencies.
- **Middleware** (`src/lib/auth/middleware.ts`): The `requireAuth` wrapper pattern is explicit and testable. Each server function opts in, which avoids accidental bypass.
- **Routes and UI**: Login, register, and permission routes are cleanly scoped. The `AuthContext` + `SessionExpiredModal` pattern for global 401 handling is appropriate.

### 2.2 Design Appropriateness -- PASS

The spec matches the requirements without over-engineering:
- Server-side sessions with hashed tokens in the database is the correct choice for a self-hosted app with no external auth provider.
- `ProjectMember` table with a `ProjectRole` enum is the simplest model that satisfies the viewer/editor/admin requirement. The `@@unique([projectId, userId])` constraint prevents duplicate memberships.
- Owner is determined by `Project.ownerId` rather than a role row, which correctly models the immutability of ownership.
- The `ROLE_HIERARCHY` constant with numeric values provides a clean, extensible permission check.

### 2.3 Scalability -- PASS (with notes)

This is a LAN tool, so web-scale concerns are not applicable. Within the stated scope:
- Session lookup is by `tokenHash` with a `@unique` index -- O(1) lookup, no table scan.
- `ProjectMember` has indices on `userId` and `(projectId, userId)` unique constraint -- permission lookups are efficient.
- The `expiresAt` index on `Session` supports the expired-session cleanup query.
- Per-event permission checks on WebSocket mutations call `findEffectiveRole` which queries `ProjectMember` + `Project.ownerId`. For a LAN tool with a small user pool, this is fine. If the user base ever grew significantly, caching effective roles per socket connection would be needed, but that is not a concern at this scale.

### 2.4 Single Points of Failure -- PASS

- Session validation depends on the database, which is already the single point of failure for the entire application. No new SPOFs introduced.
- The `requireAuth` wrapper pattern means a bug in the wrapper affects all protected routes. This is acceptable -- the alternative (per-function auth logic) would be worse because it would be inconsistent. Thorough unit testing of the wrapper mitigates this risk.

---

## 3. Security Analysis

### 3.1 Password Storage -- PASS

- SHA-256 pre-hash before bcrypt is the Dropbox-standard mitigation for bcrypt's 72-byte truncation. Correctly applied.
- bcrypt cost factor 12 targets ~250ms, within the PRD's 200-500ms range.
- The pre-hash uses `createHash('sha256')` from `node:crypto`, which is deterministic and does not require a secure context. Correct.

### 3.2 Session Token Security -- PASS

- 256-bit tokens via `crypto.randomBytes(32)` provide sufficient entropy (2^256 search space).
- `crypto.randomBytes()` is a Node.js built-in that works without a secure context -- correctly avoids `crypto.randomUUID()`. This aligns with the memory note about LAN HTTP development.
- Database stores SHA-256 hash, cookie holds raw token. A database compromise does not expose valid session tokens. Standard practice.
- Cookie flags are correct for the LAN context: `HttpOnly` (prevents XSS theft), `SameSite=Lax` (CSRF mitigation on top-level navigations), no `Secure` flag (HTTP LAN compatibility).

### 3.3 Anti-Enumeration -- PASS

- Registration with duplicate email returns the same success-like message. No timing side-channel is introduced because the bcrypt hash is only computed for genuinely new registrations (duplicate emails short-circuit before hashing). However, the spec returns early for duplicates without hashing, which could create a timing difference between "new user" (~250ms for bcrypt) and "duplicate" (fast return). This is a **low** severity concern for a LAN tool with known users, and the anti-enumeration message itself prevents direct exploitation. Noted but does not affect verdict.
- Login failure messages are generic. Lockout only applies to existing users, and failed attempts against non-existent emails are silently discarded.

### 3.4 Rate Limiting -- PASS

- 5 attempts / 15-minute lockout per email is appropriate for a LAN tool.
- The lazy-expiry approach (check on read, reset counter when lockout period has elapsed) is correctly implemented.
- No IP-based rate limiting. Acceptable for a LAN where the IP pool is small and users are known.

### 3.5 WebSocket Authentication -- PASS

- `io.use()` handshake middleware reads the session cookie, hashes it, and validates against the Session table. Rejected connections receive `next(new Error('UNAUTHORIZED'))`.
- `withCredentials: true` on the client ensures cookies are sent during the handshake.
- Session expiry on active connections is checked per-event via an in-memory timestamp comparison (`socket.data.sessionExpiresAt`). This avoids a database round-trip on every event. Correct trade-off.
- Permission enforcement on mutation events calls `findEffectiveRole` and disconnects with `permission_revoked` if insufficient. This satisfies AUTH-PERM-05.

### 3.6 CSRF -- PASS

- `SameSite=Lax` prevents the session cookie from being sent on cross-origin POST requests, which covers the primary CSRF vector.
- Server functions use POST for state-changing operations. `SameSite=Lax` allows GET navigations but blocks cross-origin form POSTs. Sufficient for this threat model.

---

## 4. Performance Assessment

### 4.1 Auth Overhead Per Request -- PASS

Each authenticated request adds:
1. Cookie parsing (string split, negligible)
2. SHA-256 hash of token (sub-millisecond)
3. Database lookup by indexed `tokenHash` column (sub-millisecond for indexed unique lookup)

Total overhead: <2ms per request. Negligible.

### 4.2 Password Hashing -- PASS

bcrypt at cost factor 12 targets ~250ms. This only occurs on registration and login -- not on every request. The spec correctly identifies this as a one-time cost.

### 4.3 WebSocket Event Overhead -- PASS

Per-event session expiry check is an in-memory comparison (no DB call). Permission checks on mutation events require a DB query, but mutation events are user-initiated and infrequent relative to the query's speed.

### 4.4 Session Cleanup -- MEDIUM CONCERN

The spec mentions "lazily deleted on validation + periodic cleanup job" (Section 9.2) but does not define the periodic cleanup mechanism. The `deleteExpiredSessions()` function exists in the session service, but no caller is specified -- no cron job, no startup interval, no scheduled task. Expired sessions will accumulate in the database until they happen to be individually hit during validation.

**Impact**: For a LAN tool with a small user pool, session table bloat is unlikely to become a practical issue. However, the cleanup mechanism should be defined.

**Recommendation**: Add a `setInterval` in the server initialization (similar to the existing `deleteStaleSession` interval in `collaboration.ts`) or document that `deleteExpiredSessions` should be called periodically.

---

## 5. Maintainability

### 5.1 Pattern Compliance -- PASS

- All new server functions use `createServerFn` from `@tanstack/react-start`, consistent with existing patterns.
- Zod schemas are centralized in `src/data/schema.ts`, using `.uuid()` for ID fields. Correct per codebase convention and memory note.
- Data access functions follow the existing `src/data/*.ts` convention with Prisma + try/catch.
- UI uses shadcn/ui + TailwindCSS exclusively. The `SessionExpiredModal` uses Radix Dialog via shadcn, and the `ProjectSharePanel` uses shadcn Sheet. No external UI libraries introduced.

### 5.2 Extensibility -- PASS

- The `ProjectMember` table design does not block future `GroupProjectMember` additions.
- The `ROLE_HIERARCHY` constant can be extended with new roles without structural changes.
- The `requireAuth` wrapper pattern allows future middleware composition (e.g., adding 2FA checks).
- bcrypt-to-Argon2id migration path is documented (verify with bcrypt, re-hash with Argon2id on successful login).

### 5.3 Complexity -- PASS

- 17 new files and 15 modified files is a large change set, but each file has a single, clear responsibility.
- The 5-phase implementation plan with explicit wave ordering and file-level task breakdown reduces integration risk.
- No unnecessary abstractions. The `requireAuth` wrapper is the only "framework-like" addition, and it is minimal.

---

## 6. Integration Assessment

### 6.1 Existing Codebase Compatibility -- PASS

- The `initializeSocketIO` function in `src/routes/api/collaboration.ts` already accepts an `httpServer` parameter and creates the Socket.IO instance. The spec correctly places the `io.use()` middleware inside this function, before `setupWhiteboardNamespace`. No structural changes to the initialization flow.
- The `Project` model gains a nullable `ownerId` FK. Nullable is correct because existing projects have no owner until the first-user migration runs. The spec's migration strategy (add nullable column, then first-user migration assigns ownership) is sound.
- The `CollaborationSession` migration (delete all rows, add non-nullable FK) is safe because sessions are ephemeral (5-minute expiry). The spec correctly identifies this from the locked decision.

### 6.2 API Contract Clarity -- PASS

- All server function signatures, input schemas, and response shapes are explicitly defined.
- Error response shapes are standardized (401, 403, 400, 429) with consistent structure.
- The `getCurrentUser` function returns `null` for unauthenticated users (does not throw), which is the correct pattern for the root route's `beforeLoad` hook.

### 6.3 Edge Cases -- PASS (with note)

- First-user race condition is handled by the `$transaction` with user count check. Prisma's interactive transactions provide serializable isolation for the count + create sequence.
- The anti-enumeration timing difference on registration (noted in 3.3) is a minor theoretical concern but not exploitable in the LAN context.
- The spec handles the case where a user's permission is revoked while they have an active WebSocket connection (permission check on mutation events + `permission_revoked` event).

---

## 7. PRD Alignment Check

| PRD Requirement | Tech Spec Coverage | Status |
|----------------|-------------------|--------|
| AUTH-REG-01 through AUTH-REG-04 | Registration server function, register route, first-user migration | Covered |
| AUTH-LOGIN-01 through AUTH-LOGIN-06 | Login server function, login route, remember me, loading states | Covered |
| AUTH-GUARD-01 through AUTH-GUARD-04 | Root beforeLoad, requireAuth wrapper, Socket.IO io.use() middleware | Covered |
| AUTH-PERM-01 through AUTH-PERM-05 | ProjectMember table, role hierarchy, permission server functions, revocation events | Covered |
| Rate limiting (5 attempts / 15 min) | rate-limit.ts with lockout fields on User | Covered |
| Empty states | EmptyState component referenced | Covered |
| Accessibility (WCAG 2.1 AA) | Section 10 addresses labels, aria-*, focus management, keyboard nav | Covered |

No PRD requirements are missing from the tech spec.

---

## 8. Issues Summary

| # | Severity | Category | Issue | Recommendation |
|---|----------|----------|-------|---------------|
| 1 | Medium | Performance | Expired session cleanup has no scheduled caller. `deleteExpiredSessions()` is defined but never invoked periodically. | Add a `setInterval` in server initialization (e.g., every 1 hour) to call `deleteExpiredSessions()`, or piggyback on the existing 5-minute collaboration session cleanup interval. |
| 2 | Low | Security | Registration timing side-channel: duplicate email returns faster than new registration (no bcrypt hash). Attacker could distinguish "email exists" from "new email" by measuring response time. | Add a constant-time delay or compute a dummy bcrypt hash on duplicate-email paths. Low priority for LAN context. |
| 3 | Low | Completeness | The file inventory lists 17 new + 15 modified = 32 files, but the Phase 5 section adds `src/hooks/use-whiteboard-collaboration.ts` as a modified file that is not in the Phase 3 table. The total in Section 8 shows 15 modified files but the actual count across all phases is 16-17. | Reconcile the file inventory in Section 8 with the per-phase file tables. Minor bookkeeping. |

---

## 9. Verdict

**SOUND**

The tech spec demonstrates a well-considered architecture that is appropriate for the requirements, follows established codebase patterns, correctly implements all locked decisions, and addresses security concerns within the LAN threat model. The one medium-severity issue (session cleanup scheduling) does not affect correctness or security -- it is a housekeeping gap that can be addressed during implementation without architectural changes.

No blocking issues. The spec is ready to proceed to the test plan phase.
