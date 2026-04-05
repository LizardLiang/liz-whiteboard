# Tech Spec Review (PM Perspective): Account Authentication

| Field | Value |
|-------|-------|
| **Feature** | Account Authentication |
| **Reviewer** | Athena (PM Agent) |
| **Spec Author** | Hephaestus |
| **PRD Version Reviewed Against** | v2 (Nemesis-approved) |
| **Date** | 2026-04-03 |
| **Verdict** | **Approved** |

---

## 1. P0 Requirement Coverage

Every P0 requirement from the PRD is traced below. A requirement is "covered" if the tech spec describes a concrete implementation that satisfies all acceptance criteria.

### 4.1 User Registration (P0)

| Requirement | Covered | Spec Reference | Notes |
|-------------|---------|----------------|-------|
| AUTH-REG-01: Public registration page | Yes | Section 6.3 (Register Route) | Public route, form fields match PRD (username, email, password), cross-link to /login present. |
| AUTH-REG-02: Account creation with hashed password | Yes | Sections 4.1 (registerUser), 5.1 (Password Service) | bcryptjs + SHA-256 pre-hash. Auto-login after registration. Redirect to project list. |
| AUTH-REG-03: Input validation + anti-enumeration | Yes | Section 3.4 (Zod schemas), Section 4.1 (registerUser logic) | Field-level Zod validation (username 3-50 alphanumeric+underscore, email, password 8-128). Duplicate email returns generic success and redirects to /login. |
| AUTH-REG-04: First user inherits existing projects | Yes | Section 5.5 (First-User Migration) | Atomic transaction: user count check + project ownership assignment in same prisma.$transaction(). |

### 4.2 Login and Session Management (P0)

| Requirement | Covered | Spec Reference | Notes |
|-------------|---------|----------------|-------|
| AUTH-LOGIN-01: Login page with email/password | Yes | Section 6.2 (Login Route) | Form fields, cross-link to /register. |
| AUTH-LOGIN-02: Server-side session + HttpOnly cookie | Yes | Sections 5.2 (Session Service), 5.3 (Cookie Utilities) | HttpOnly, SameSite=Lax, no Secure flag (LAN). Redirect to intended URL or /. |
| AUTH-LOGIN-03: Generic error on failure | Yes | Section 4.1 (loginUser), Section 9.3 (Anti-Enumeration) | "Invalid email or password" always. |
| AUTH-LOGIN-04: Remember me (30d) vs default (24h) | Yes | Section 5.2 (SESSION_EXPIRY constants) | 24h default, 30d with rememberMe. Cookie Max-Age matches. |
| AUTH-LOGIN-05: Logout invalidates session + clears cookie | Yes | Section 4.1 (logoutUser) | Deletes session from DB, clears cookie, redirects to /login. |
| AUTH-LOGIN-06: Loading states on forms | Yes | Sections 6.2, 6.3 | Submit button disabled with spinner during submission. |

### 4.3 Route Protection (P0)

| Requirement | Covered | Spec Reference | Notes |
|-------------|---------|----------------|-------|
| AUTH-GUARD-01: All routes require session (except /login, /register) | Yes | Section 6.1 (Root beforeLoad) | publicPaths array excludes /login, /register. Redirect preserves intended URL. |
| AUTH-GUARD-02: Server functions validate session | Yes | Section 4.3 (requireAuth wrapper) | All listed server function files wrapped. Pattern shown with example. |
| AUTH-GUARD-03: Client-side auth check | Yes | Section 6.1 | beforeLoad on root route calls getCurrentUser. |
| AUTH-GUARD-04: Socket.IO handshake auth + session expiry | Yes | Section 7.5 (Phase 5) | io.use() middleware validates cookie. Session expiry checked in-memory per event. "session_expired" event emitted before disconnect. |

### 4.4 Project-Level Permissions (P1)

| Requirement | Covered | Spec Reference | Notes |
|-------------|---------|----------------|-------|
| AUTH-PERM-01: Project has immutable owner | Yes | Section 3.2 (Project.ownerId), Section 2.7 | Owner on Project model, not in ProjectMember. |
| AUTH-PERM-02: Role assignment (viewer/editor/admin) | Yes | Sections 4.2 (Permission Server Functions), 7.4 (Phase 4) | grantPermission, updatePermission with role enum. Owner-only rule for admin demotion covered in revokePermission. |
| AUTH-PERM-03: No access = invisible + 403 | Yes | Section 7.4 | findAllProjectsForUser filters by access. Direct URL returns 403. |
| AUTH-PERM-04: Project-level inheritance to whiteboards | Yes | Section 7.4 | All whiteboard/table/column/relationship endpoints check project-level permission. |
| AUTH-PERM-05: Permission revocation reflected immediately | Yes | Section 7.5 (permission enforcement on edit events) | WebSocket: "permission_revoked" event + disconnect. HTTP: next request checked against updated permissions. |

---

## 2. User Flow Alignment

| PRD Flow | Spec Coverage | Assessment |
|----------|---------------|------------|
| 5.1 First Visit (unauthenticated) | Section 6.1 (beforeLoad redirect to /login with redirect param) | Fully aligned. |
| 5.2 Registration Flow | Section 4.1 (registerUser) + Section 6.3 (Register Route) | Fully aligned. Steps 1-8 all addressed including anti-enumeration and first-user migration. |
| 5.3 Login Flow | Section 4.1 (loginUser) + Section 6.2 (Login Route) | Fully aligned. Remember me, generic errors, redirect all covered. |
| 5.4 Returning User Flow | Section 6.1 (beforeLoad) | Fully aligned. Valid session proceeds; invalid redirects. |
| 5.5 Permission Management Flow | Section 7.4 (ProjectSharePanel) + Section 4.2 (Permission Server Functions) | Fully aligned. "Share" button entry point, role management, owner-only admin demotion. |
| 5.6 Session Expiry During Editing | Section 6.5 (SessionExpiredModal) + Section 6.6 (Global 401 Interception) + Section 7.5 (WebSocket session_expired) | Fully aligned. Modal with focus trap, URL preserved in redirect, WebSocket reconnect, server-authoritative state. |
| 5.7 Logout Flow | Section 4.1 (logoutUser) | Fully aligned. |
| 5.8 Empty States | Section 7.3 mentions EmptyState.tsx component | Partially aligned -- see finding F-03 below. |

---

## 3. Scope Alignment

| PRD Scope Item | In Tech Spec | Notes |
|----------------|-------------|-------|
| User registration (username/email/password) | Yes | |
| Login/logout with session auth | Yes | |
| HttpOnly cookie (24h default, 30d remember) | Yes | |
| Route protection (pages + server functions) | Yes | |
| Server function middleware | Yes | requireAuth wrapper |
| Socket.IO handshake auth | Yes | io.use() pattern verified |
| WebSocket session expiry handling | Yes | In-memory check + event |
| Project-level ownership + roles | Yes | ProjectMember table |
| Permission revocation UX | Yes | permission_revoked event + client handling |
| First-user data migration (atomic) | Yes | prisma.$transaction() |
| Password hashing (200-500ms) | Yes | bcryptjs cost 12, ~250ms target |
| Login/register cross-linking | Yes | Both routes |
| Empty state messaging | Partial | Component file listed but specific messages not detailed in spec |
| Loading states on auth forms | Yes | |
| Rate limiting (5 attempts / 15-min lockout) | Yes | Fields on User model |

**Out-of-scope items correctly excluded from spec:** 2FA, email verification, password reset, OAuth, whiteboard-level permissions, admin panel, user groups, audit logging, setup wizard, password strength indicator, ownership transfer. Confirmed -- none of these appear in the tech spec.

---

## 4. Findings

### F-01: Empty State Messages Not Specified in Detail (Minor)

**PRD Reference:** Flow 5.8
**Issue:** The PRD defines two distinct empty-state messages:
1. "No projects yet. Create your first project to get started." (fresh installation, first user)
2. "You don't have any projects yet. Create a new project or ask a teammate to share one with you." (user with no permissions)

The tech spec lists `src/components/project/EmptyState.tsx` in the file inventory (Section 7.3) but does not specify these exact messages or the logic to distinguish between the two states (first user with no projects vs. user with no permissions).

**Impact:** Low. The messages are clearly defined in the PRD. An implementer reading the PRD alongside the spec would get it right. This is a documentation gap, not a design gap.

**Recommendation:** No revision required. The PRD is the source of truth for copy/messaging.

### F-02: Role Capabilities Table Not Explicitly Mapped in Spec (Minor)

**PRD Reference:** Section 4.4, Role Capabilities Table
**Issue:** The PRD has a detailed Role Capabilities table (9 capabilities x 4 roles). The tech spec defines a `ROLE_HIERARCHY` and `hasMinimumRole` helper (Section 7.4), and describes per-endpoint permission checks, but does not provide a single mapping table showing which spec-level checks enforce which PRD capabilities.

**Impact:** Low. The spec's endpoint-level permission descriptions (OWNER/ADMIN for delete, EDITOR+ for write, VIEWER+ for read) align with the Role Capabilities table when cross-referenced manually. The hierarchy model is correct. No capability is missed.

**Recommendation:** No revision required. The spec's approach (hierarchy-based checks per endpoint) is a valid implementation of the PRD's capability table.

### F-03: Forgotten Password Help Text Location Not Specified (Minor)

**PRD Reference:** Section 7, Failure Mode "User forgets their password"
**Issue:** The PRD states: "This limitation is documented in the application's help text or login page." The tech spec does not mention where the "contact your administrator" message appears in the UI.

**Impact:** Low. This is a minor UX detail. The login page is the natural location.

**Recommendation:** No revision required. Implementation can place this on the login page as a small text note below the form.

### F-04: Session Cleanup Job Not Fully Specified (Informational)

**Issue:** The spec mentions "periodic cleanup job" for expired sessions (Section 9.2) and provides a `deleteExpiredSessions` function (Section 5.2), but does not specify the trigger mechanism (cron, startup routine, interval timer).

**Impact:** None for correctness. Expired sessions are lazily cleaned on validation. The periodic cleanup is an optimization to prevent table bloat.

**Recommendation:** No revision required. This is an implementation detail that does not affect PRD requirements.

### F-05: HTTPS Detection Warning (Informational)

**PRD Reference:** Assumption A1 (LAN without HTTPS)
**Issue:** The PRD asks for "log a warning at startup if HTTPS is not detected." The tech spec mentions this in Section 9.5 ("Startup warning logged if HTTPS is not detected") but does not specify where this check runs or what the warning says.

**Impact:** None for functionality.

**Recommendation:** No revision required. Implementer can add a console.warn in the server startup path.

---

## 5. Locked Decision Compliance

The tech spec was checked against all locked decisions from context.md (Themis, 2026-04-03):

| Locked Decision | Spec Compliance | Notes |
|----------------|-----------------|-------|
| Session token: cookie raw, DB SHA-256 hash | Compliant | Section 2.2, Section 5.2 |
| Lockout fields on User model (lockedUntil, failedLoginAttempts) | Compliant | Section 2.3, Section 3.1 |
| CollaborationSession: delete all rows, non-nullable FK | Compliant | Section 2.4, Section 3.3 |
| Socket.IO integration: verified pattern required | Compliant | Section 2.5 provides verified pattern with code |

---

## 6. Accessibility Alignment

| PRD Accessibility Requirement | Spec Coverage |
|------------------------------|---------------|
| Associated label elements | Section 10: Label with htmlFor |
| Validation errors announced (aria-live/aria-describedby) | Section 10: aria-describedby + aria-live="polite" |
| Focus moves to first error field | Section 10: Confirmed |
| Keyboard-navigable interactive elements | Section 10: Confirmed |
| Loading states communicated (aria-busy) | Section 10: aria-busy="true" on form |
| Session-expired modal focus trap + keyboard dismissal | Section 6.5: Radix Dialog (shadcn) provides this |

All accessibility requirements from PRD Section 12 are addressed.

---

## 7. Verdict

**APPROVED**

The tech spec comprehensively covers all P0 and P1 requirements from the PRD. Every user flow has a corresponding implementation design. All locked decisions from the discuss phase are respected. The 5-phase decomposition aligns with the spec's implementation plan. Security considerations (anti-enumeration, LAN HTTP compatibility, session hashing) correctly implement the PRD's requirements and assumptions.

The 5 findings are all minor or informational. None represent a gap that would cause a PRD requirement to be unmet. The spec is ready for the next pipeline stage.

---

## 8. Summary

| Dimension | Assessment |
|-----------|------------|
| P0 requirement coverage | 14/14 covered |
| P1 requirement coverage | 5/5 covered |
| User flow alignment | 8/8 aligned (1 partial -- empty state copy detail) |
| Scope match | Full match, no scope creep, no missing items |
| Locked decision compliance | 4/4 compliant |
| Accessibility coverage | 6/6 addressed |
| Findings requiring revision | 0 |
| Findings informational | 5 |
