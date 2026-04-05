# PRD: Account Authentication

| Field | Value |
|-------|-------|
| **Feature** | Account Authentication |
| **Author** | Athena (PM Agent) |
| **Status** | Draft (Revised) |
| **Created** | 2026-04-03 |
| **Revised** | 2026-04-03 |
| **Priority** | P0 |
| **Revision** | 2 -- Addresses Nemesis review (prd-challenge.md) |

---

## 1. Problem Statement

Liz Whiteboard currently has no authentication system. All projects, whiteboards, and collaboration sessions are accessible to anyone who can reach the server. This means:

- Any user on the LAN can view, edit, or delete any project without accountability.
- There is no concept of ownership, so data created by one person can be modified or removed by another.
- The CollaborationSession model stores a `userId` field as a placeholder string that will need to be converted to a proper foreign key once a User model exists.
- As the application grows beyond a single user, there is no mechanism to control who sees or edits which projects.

Without authentication, the application cannot be safely used in any multi-user environment, even on a trusted LAN.

---

## 2. Users and Personas

### Primary Persona: Project Owner
- Creates and manages ER diagram projects.
- Needs to control who can access their projects.
- First registered user inherits all existing data.

### Secondary Persona: Team Collaborator
- Invited to projects by an owner or granted access through permissions.
- Needs to view and/or edit whiteboards depending on their permission level.
- Should not see projects they have no access to.

### Tertiary Persona: First-Time User on a Fresh Installation
- Arrives at the application for the first time with no existing account.
- Needs clear guidance on whether to register or log in.
- After registration, may see an empty project list if they are not the first user and no projects have been shared with them.

### Tertiary Persona: User Who Has Forgotten Their Password
- Has an existing account but cannot recall their password.
- Password reset is out of scope for this iteration. Workaround: contact the system administrator for a manual database-level password reset until the password recovery feature is implemented.

### Future Persona: Administrator
- Manages user accounts across the system (out of scope for this PRD but the data model should not block this).

---

## 3. Goals and Success Metrics

| Goal | Metric | Baseline | Target | Owner |
|------|--------|----------|--------|-------|
| All routes require authentication | Number of unauthenticated routes reachable | All routes open | 0 unauthenticated routes (excluding /login and /register) | Engineering |
| Registration is reliable | System-caused registration failures (5xx errors, transaction failures) | N/A (no auth exists) | 0 system-caused registration failures per deployment period | Engineering |
| Existing data is preserved after migration | Count of orphaned records post-migration | 0 orphaned records | 0 orphaned records | Engineering |
| Session persistence reduces re-login friction | Average logins per user per 30-day period with "remember me" | N/A | 1 login per 30-day period when "remember me" is active | Engineering |
| Permission system prevents unauthorized access | Unauthorized access attempts blocked | N/A | 100% of requests to non-permitted projects return 403 | Engineering |
| WebSocket connections are authenticated | Unauthenticated Socket.IO connections permitted | All connections open | 0 unauthenticated WebSocket connections | Engineering |

---

## 4. Requirements

### 4.1 User Registration (P0)

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| AUTH-REG-01 | Public registration page accessible without authentication | A user who is not logged in can navigate to /register and see a form with username, email, and password fields. The page includes a "Already have an account? Log in" link to /login. |
| AUTH-REG-02 | Registration creates a new user account with username, email, and hashed password | After submitting valid registration data, a new user record exists in the database with the password stored as a hash (never plaintext). The user is automatically logged in and redirected to the project list. |
| AUTH-REG-03 | Registration validates input: username (3-50 chars, alphanumeric + underscores), email (valid format, unique), password (8-128 characters) | Submitting invalid input shows field-level error messages for format/length violations. Duplicate email returns the same generic success-like response as a new registration: "Registration successful. Please log in." This prevents email enumeration. The user is not auto-logged-in on duplicate email -- they must use /login. |
| AUTH-REG-04 | First registered user automatically becomes the owner of all existing projects, whiteboards, and collaboration sessions | After the first user registers, all previously ownerless Project records have their `ownerId` set to that user's ID. This operation is atomic with user creation (single transaction). |

### 4.2 Login and Session Management (P0)

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| AUTH-LOGIN-01 | Login page accepts email and password | A user can enter their email and password on a login form and submit it. The page includes a "Don't have an account? Register" link to /register. |
| AUTH-LOGIN-02 | Successful login creates a server-side session and sets an HttpOnly cookie | After correct credentials, a session record is created server-side. An HttpOnly, SameSite cookie is set in the response. The user is redirected to the main application (or the URL stored in the `redirect` query parameter). |
| AUTH-LOGIN-03 | Failed login returns a generic error without revealing which field is wrong | Entering incorrect email or password shows "Invalid email or password" -- never "email not found" or "wrong password" separately. |
| AUTH-LOGIN-04 | "Remember me" option extends session to 30 days; default session is 24 hours | When "remember me" is checked, the session/cookie expiry is 30 days. When unchecked, it is 24 hours. |
| AUTH-LOGIN-05 | Logout invalidates the session server-side and clears the cookie | After logout, the session record is deleted from the database and the cookie is removed. Navigating to any protected route redirects to /login. |
| AUTH-LOGIN-06 | Login and registration forms show a loading state during submission | While the server is processing credentials (including password hashing), the submit button is disabled and a loading indicator is visible. This prevents double-submission and provides feedback during the 200-500ms hashing window. |

### 4.3 Route Protection (P0)

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| AUTH-GUARD-01 | All application routes (except /login and /register) require a valid session | Navigating to any protected route without a valid session cookie redirects to /login with a `redirect` query parameter preserving the intended destination. This includes both page routes and server function calls. |
| AUTH-GUARD-02 | Server functions validate session via middleware before executing | Every createServerFn that accesses or modifies data checks the session. An invalid or expired session returns a 401 response. |
| AUTH-GUARD-03 | Client-side navigation checks auth state and redirects if session is expired | Using TanStack Router's `beforeLoad` hook, client-side navigations verify the session is still valid. Expired sessions redirect to /login without rendering the target page. |
| AUTH-GUARD-04 | Socket.IO connections authenticate during the WebSocket handshake | Socket.IO connections must present a valid session cookie during the handshake. Connections without a valid session are rejected before the WebSocket is established. If a session expires while a WebSocket is connected, the server closes the connection with a "session_expired" event. The client receives this event and shows the session-expired modal (same as HTTP 401 handling). |

### 4.4 Project-Level Permissions (P1)

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| AUTH-PERM-01 | Each project has an owner (the user who created it) with immutable ownership | When a user creates a project, their user ID is stored as the project's `ownerId`. The owner has all capabilities listed in the Role Capabilities table below. Ownership cannot be revoked or transferred (future feature). |
| AUTH-PERM-02 | Project owners can grant access to other users with a specific role: viewer, editor, or admin | The owner can assign roles to other users for their project via the project settings page. See Role Capabilities table below for specific permissions per role. |
| AUTH-PERM-03 | Users without any permission on a project cannot see it in their project list or access its whiteboards | Querying the project list filters to only projects where the user is the owner or has an explicit permission entry. Direct URL access to a non-permitted project returns 403 with the message "You do not have access to this project." |
| AUTH-PERM-04 | Permissions are project-level; all whiteboards in a project inherit the project's permissions | There are no whiteboard-level permissions. If a user has "editor" on a project, they can edit all whiteboards in that project. |
| AUTH-PERM-05 | Permission changes are reflected in active sessions within one server request | When a permission is revoked, the user's next server request (HTTP or WebSocket event) is evaluated against the updated permissions. If the user is currently viewing a project and their access is revoked, the client shows a message "Your access to this project has been removed" and redirects the user to the project list within 5 seconds. For WebSocket connections, the server sends a "permission_revoked" event with the project ID, and the client handles the redirect. |

### Role Capabilities Table

| Capability | Owner | Admin | Editor | Viewer |
|-----------|-------|-------|--------|--------|
| View project and all whiteboards | Yes | Yes | Yes | Yes |
| Edit whiteboards, tables, columns, relationships | Yes | Yes | Yes | No |
| Create/delete whiteboards | Yes | Yes | Yes | No |
| Manage permissions (add/change/remove users) | Yes | Yes | No | No |
| Delete the project | Yes | Yes | No | No |
| Remove or demote an admin | Yes | No | No | No |
| Transfer ownership | No (future) | No | No | No |

### 4.5 User Groups -- DEFERRED

User groups (AUTH-GROUP-01 through AUTH-GROUP-03 from v1) are deferred to a separate iteration. Rationale: groups require significant UI (group creation, member management, group picker in permission flow) and a permission resolution engine. These are not needed for the initial authentication release and represent scope drift when bundled with core auth.

The data model should not block future group support. This means the permission system should be designed so that a GroupPermission table can be added later without modifying the existing ProjectPermission structure.

---

## 5. User Flows

### 5.1 First Visit -- Unauthenticated User

1. User opens the application at any URL.
2. TanStack Router's root `beforeLoad` detects no valid session.
3. User is redirected to /login with the original URL in a `redirect` query parameter.
4. /login page shows the login form with a prominent "Don't have an account? Create one" link to /register.

### 5.2 Registration Flow

1. User navigates to /register (via link from /login or direct URL).
2. User fills in username, email, and password.
3. Client-side validation runs (field length, email format, password 8-128 chars).
4. Submit button shows loading state; button is disabled.
5. On submit, a server function validates input, checks for duplicate email, hashes password, creates user record.
6. If the email is already taken: the server returns the same response as a successful registration ("Registration successful. Please log in.") and redirects to /login. No email enumeration is possible.
7. If registration succeeds: a session is created automatically (user does not need to log in after registering). User is redirected to the project list.
8. If this is the first user: all existing projects are assigned to them within the same transaction.

### 5.3 Login Flow

1. User navigates to /login.
2. User enters email, password, and optionally checks "Remember me."
3. Submit button shows loading state; button is disabled.
4. Server function verifies credentials against stored hash.
5. On success: session created, HttpOnly cookie set, redirect to the URL in the `redirect` query parameter (or project list if none).
6. On failure: generic error message "Invalid email or password" displayed.

### 5.4 Returning User Flow

1. User opens the application.
2. TanStack Router's `beforeLoad` on the root route checks for a valid session cookie.
3. If session is valid: user proceeds to the requested page.
4. If session is invalid/expired: redirect to /login with a `redirect` query parameter preserving the intended destination.

### 5.5 Permission Management Flow

1. Project owner or admin clicks a "Share" button (or settings icon) visible on the project header or project list item. This is the primary entry point for permission management.
2. A project settings panel opens showing a list of users with their current roles.
3. Owner/admin can add a user by email, selecting a role (viewer/editor/admin).
4. Owner/admin can change or revoke existing permissions (admin cannot remove/demote the owner or other admins -- only the owner can).
5. Changes take effect immediately on the next server request or WebSocket event for the affected user.
6. If the affected user is currently viewing the project and their access was revoked, they see: "Your access to this project has been removed" and are redirected to the project list.

### 5.6 Session Expiry During Active Editing

1. User is actively editing a whiteboard when their session expires.
2. The next server request (HTTP or WebSocket event) returns 401 / "session_expired."
3. The client shows a "Session expired" modal overlaying the current page. The modal contains a "Log in again" button.
4. The client preserves the current URL in the `redirect` parameter.
5. **Local state handling:** The client holds any unsaved local changes in memory (React state) during re-authentication. This is best-effort -- if the user closes the browser or navigates away, local state is lost and this is expected.
6. User clicks "Log in again," is taken to /login with the redirect parameter.
7. After successful login, the user is redirected back to the original whiteboard URL.
8. The client re-establishes the WebSocket connection for real-time collaboration.
9. If another user modified the same whiteboard during the re-login window, the server's state is authoritative -- the client receives the latest state via the WebSocket sync and renders it. Local unsaved changes that conflict with server state are lost. This is acceptable because the collaboration system is already designed around server-authoritative state.

### 5.7 Logout Flow

1. User clicks "Logout" in the application header/menu.
2. Server function deletes the session record.
3. Cookie is cleared.
4. User is redirected to /login.

### 5.8 Empty States

**Project list -- no projects exist (fresh installation, first user):**
The project list shows an empty state with the message: "No projects yet. Create your first project to get started." with a prominent "Create Project" button.

**Project list -- user has no permissions on any project:**
The project list shows an empty state with the message: "You don't have any projects yet. Create a new project or ask a teammate to share one with you." with a "Create Project" button.

---

## 6. Scope

### In Scope
- User registration with username/email/password (password: 8-128 characters).
- Login/logout with session-based authentication.
- HttpOnly cookie-based session management with configurable expiry (24h default, 30 days with "remember me").
- Route protection for all pages and server function endpoints.
- Server function middleware for session validation.
- Socket.IO/WebSocket handshake authentication using the session cookie.
- WebSocket session expiry handling (server-initiated disconnect with event).
- Project-level ownership and role-based permissions (viewer/editor/admin).
- Permission revocation with defined client-side UX (notification and redirect).
- Migration of existing data to first registered user (atomic transaction).
- Password hashing using a secure algorithm (Argon2id or bcrypt -- technical choice left to engineering, target 200-500ms hash computation time).
- Login/register page cross-linking and default redirect to /login.
- Empty state messaging for project list.
- Loading states on auth forms to prevent double-submission.
- Basic rate limiting on authentication endpoints: after 5 consecutive failed login attempts for the same email, lock that account for 15 minutes. Display message: "Too many failed attempts. Please try again in 15 minutes."

### Out of Scope
- Two-factor authentication (2FA) -- planned for future.
- Email verification -- planned for future.
- Password reset/recovery flow -- planned for future. Workaround: manual DB-level reset by administrator.
- OAuth/social login -- planned for future.
- Whiteboard-level permissions (permissions are project-level only).
- Admin panel for system-wide user management.
- User groups and group-based permissions -- deferred to a separate iteration (see Section 4.5).
- Audit logging of permission changes.
- Setup wizard or admin seed script for first-user bootstrapping.
- Password strength indicator on registration form (nice-to-have for future).
- Ownership transfer between users.

---

## 7. Failure Modes

| Scenario | Expected Behavior |
|----------|------------------|
| User submits registration with an already-taken email | Server returns the same response as a successful registration: "Registration successful. Please log in." User is redirected to /login. No information is leaked about whether the email exists. This is consistent with AUTH-REG-03's anti-enumeration stance. |
| Session cookie is tampered with | Server-side session lookup fails. User is redirected to /login. No data is exposed. |
| Session expires while user is actively editing a whiteboard | Client shows a "Session expired" modal overlaying the current page. Local React state is preserved in memory (best-effort). User clicks "Log in again," re-authenticates, and is redirected back to the same whiteboard URL. WebSocket reconnects and syncs server-authoritative state. See flow 5.6 for full details. |
| User tries to access a project they have no permission for via direct URL | Server returns 403. Client shows "You do not have access to this project." No information about the project's existence or contents is revealed. |
| Permission is revoked while user is actively viewing a project | The user's next server request or WebSocket event is checked against updated permissions. The client displays "Your access to this project has been removed" and redirects to the project list within 5 seconds. For WebSocket connections, the server sends a "permission_revoked" event. |
| Database is unavailable during login attempt | Server returns 500. Client shows "Something went wrong. Please try again." |
| First user registration fails midway (user created but existing data not migrated) | The migration of existing data to the first user is wrapped in a database transaction with user creation. If any step fails, the entire operation rolls back. |
| Multiple users try to register simultaneously as the "first user" | Only one user should inherit existing data. This is handled atomically -- check user count and assign ownership within a single transaction. |
| WebSocket connection attempted without valid session | Connection is rejected during the handshake phase. No WebSocket is established. Client falls back to the same "session expired" handling as HTTP 401. |
| Session expires on an active WebSocket connection | Server sends a "session_expired" event and closes the connection. Client shows the session-expired modal. |
| Account is locked due to failed login attempts | Login returns "Too many failed attempts. Please try again in 15 minutes." The lockout is per-email, not per-IP, and automatically expires after 15 minutes. |
| User forgets their password | No self-service recovery is available in this iteration. The user must contact the system administrator for a manual database-level password reset. This limitation is documented in the application's help text or login page. |

---

## 8. External API Dependencies

No external API dependencies. Authentication is fully self-hosted using server-side session management and password hashing libraries available in the Node.js/Bun ecosystem.

---

## 9. Assumptions

| Assumption | Risk If Wrong | Mitigation |
|------------|---------------|------------|
| The application is accessed over a LAN where HTTPS may not be configured | **High risk.** Session cookies transmitted over HTTP can be intercepted. | Do not set the `Secure` cookie flag so cookies work over HTTP on LAN, but log a warning at startup if HTTPS is not detected. Document that HTTPS is strongly recommended. |
| The first registered user is the legitimate owner of all existing data | **Medium risk.** If someone else registers first on a shared LAN, they inherit all data. | Document that the first registration should be performed by the intended owner. The setup wizard/seed script is out of scope but could be added later. |
| Email addresses are unique identifiers for users | **Low risk.** Standard practice. | If the system later needs to support users without email, a migration would be required. |
| 30-day session duration is acceptable for this use case | **Low risk.** The user explicitly requested long-lived sessions with minimal re-login friction. | Session duration can be reduced without schema changes if security requirements tighten. |
| Rate limiting (5 attempts / 15-minute lockout) is sufficient for LAN threat model | **Low risk.** LAN has near-zero latency making brute-force faster, but the user pool is small and known. | The lockout window and attempt threshold can be adjusted without schema changes. If more sophisticated rate limiting is needed (IP-based, progressive delays), it can be layered on later. |
| Local state preservation during session re-auth is best-effort | **Low risk.** If the browser is closed or memory is cleared, unsaved changes are lost. | The collaboration system is server-authoritative. The primary data loss scenario is edits made between the last successful server sync and session expiry -- typically seconds of work. |

---

## 10. External Research Summary

Research was conducted on authentication patterns for TanStack Start applications and password security best practices.

**TanStack Start Authentication Patterns:**
- TanStack Start supports authentication middleware via `createMiddleware()` that runs before server function handlers, enabling session validation as a cross-cutting concern.
- Route protection uses `beforeLoad` hooks in TanStack Router, which run on both server-side and client-side navigation.
- Server-side sessions with HttpOnly cookies are the recommended pattern for full-stack TanStack Start applications, as they avoid the security pitfalls of localStorage-based token storage.
- Popular auth libraries for TanStack Start include Better Auth, Auth.js, and Clerk, but a custom implementation is viable for username/password auth.

**Password Security (2025 Best Practices):**
- Argon2id is the current gold standard for password hashing (OWASP recommended). Bcrypt with cost factor 12+ remains a valid alternative.
- Target 200-500ms for hash computation to balance security and user experience.
- Bcrypt has a 72-byte password limit; Argon2id does not have this constraint. A maximum password length of 128 characters is recommended regardless of algorithm to prevent denial-of-service via excessively long passwords.
- Session tokens should be stored in HttpOnly cookies, never in localStorage or sessionStorage.

**LAN-Specific Considerations:**
- The user develops and accesses the application over HTTP on a LAN. APIs like `crypto.randomUUID()` require a secure context (HTTPS or localhost) and will fail on LAN over HTTP. Session token generation must use a method that works without a secure context.
- The `Secure` flag on cookies must not be set, as it would prevent cookies from being sent over HTTP.

Sources consulted:
- [TanStack Start Authentication Guide](https://tanstack.com/start/latest/docs/framework/react/guide/authentication)
- [TanStack Start Middleware Guide](https://tanstack.com/start/latest/docs/framework/react/guide/middleware)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Password Hashing Guide 2025: Argon2 vs Bcrypt](https://guptadeepak.com/the-complete-guide-to-password-hashing-argon2-vs-bcrypt-vs-scrypt-vs-pbkdf2-2026/)

---

## 11. Impact on Existing System

### Database Schema Changes Required
- **New models needed:** User, Session, ProjectPermission (exact schema is a technical decision).
- **Modified models:** Project needs an `ownerId` foreign key to User. CollaborationSession's `userId` field should become a proper foreign key to User.
- **Future-proofing:** The permission model should be structured so that Group and GroupPermission tables can be added later without modifying existing tables.
- **Migration script required:** The user explicitly requested that migration scripts be left after schema changes.

### Existing Feature Impact
- **Project list:** Must be filtered by permissions. Users only see projects they own or have been granted access to.
- **Whiteboard access:** Must verify the user has at least "viewer" permission on the parent project.
- **Collaboration sessions:** The `userId` field transitions from an arbitrary string to a real User foreign key.
- **All server functions:** Must be wrapped with authentication middleware.
- **All API routes:** Must validate session before processing requests.
- **Socket.IO connections:** Must authenticate the WebSocket handshake using the session cookie. Must handle session expiry on active connections by sending a "session_expired" event and closing the connection. Must enforce permission checks on WebSocket events (e.g., a user cannot emit edits to a project they lost access to).

### Routes Added
- `/login` -- public, login form. Default redirect target for unauthenticated users.
- `/register` -- public, registration form.
- `/logout` -- authenticated, triggers session invalidation.

### Routes Modified
- All existing routes gain authentication checks via root-level `beforeLoad`.

---

## 12. Accessibility Requirements

Authentication forms are the gateway to the entire application and must meet WCAG 2.1 AA:

- All form fields must have properly associated `<label>` elements.
- Validation error messages must be announced to screen readers (via `aria-live` or `aria-describedby`).
- Focus must move to the first error field when validation fails on submit.
- All interactive elements (inputs, buttons, links) must be keyboard-navigable.
- Loading states must be communicated to assistive technology (e.g., `aria-busy` on the form during submission).
- The session-expired modal must trap focus while visible and be dismissible via keyboard.

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **Session** | A server-side record linking a browser cookie to an authenticated user. |
| **Role** | A named permission level on a project: viewer (read-only), editor (read/write), admin (full control including permission management). See Role Capabilities table in Section 4.4. |
| **Owner** | The user who created a project. Has implicit admin-level access that cannot be revoked or transferred. Can demote/remove admins. |
| **Effective Permission** | The highest role a user has on a project, considering individual assignments. (Group-based resolution deferred to future iteration.) |
| **Account Lockout** | Temporary prevention of login after 5 consecutive failed attempts for the same email. Automatically expires after 15 minutes. |

---

## Appendix B: Nemesis Review Resolution

This section tracks how each blocking and major issue from prd-challenge.md was resolved.

| Issue ID | Summary | Resolution |
|----------|---------|------------|
| DA-B1 | Email enumeration contradiction | Resolved. AUTH-REG-03 and Section 7 now both use the same anti-enumeration approach: duplicate email returns "Registration successful. Please log in." and redirects to /login. No email existence is revealed. |
| DA-B2 | WebSocket/Socket.IO authentication unspecified | Resolved. Added AUTH-GUARD-04 with full acceptance criteria for handshake auth and session expiry on active connections. Added failure modes for WebSocket scenarios. |
| DA-B3 | No maximum password length | Resolved. AUTH-REG-03 now specifies 8-128 characters. Section 10 explains the bcrypt 72-byte limit rationale. |
| UA-B1 | Session expiry during editing has no recovery path | Resolved. Added flow 5.6 with concrete post-re-login recovery steps: URL preserved via redirect param, local state held in memory (best-effort), WebSocket reconnects, server state is authoritative. |
| UA-B2 | Permission revocation has no UX | Resolved. Added AUTH-PERM-05 with specific behavior: "Your access to this project has been removed" message, redirect to project list, WebSocket "permission_revoked" event. |
| DA-M1 | User Groups scope drift | Resolved. Groups deferred to separate iteration (Section 4.5). Data model note added to not block future support. |
| DA-M2 | "Full control" undefined for roles | Resolved. Added Role Capabilities table in Section 4.4 enumerating exact capabilities per role. |
| DA-M3 | CollaborationSession userId assumption | Resolved. Section 1 rephrased to factual statement about the field needing conversion. |
| DA-M4 | Vague registration success metric | Resolved. Metric redefined to "0 system-caused registration failures" -- measures system reliability, not user input quality. |
| DA-M5 | Rate limiting out of scope but needed | Resolved. Basic rate limiting promoted to In Scope: 5 failed attempts triggers 15-minute lockout per email. Risk acceptance documented in Assumptions. |
| UA-M1 | Permission UI discoverability | Resolved. Flow 5.5 now specifies a "Share" button on the project header/list as the entry point. |
| UA-M2 | First-time user / fresh install persona | Resolved. Added persona in Section 2. Added empty states in flow 5.8. |
| UA-M3 | Forgotten password persona | Resolved. Added persona in Section 2. Workaround documented in Section 7. |
| UA-M4 | Empty state for no-permission users | Resolved. Added specific empty-state messages in flow 5.8. |
| UA-M5 | Login/register cross-linking | Resolved. AUTH-REG-01 and AUTH-LOGIN-01 now specify cross-links. Flow 5.1 specifies /login as default redirect. |
| UA-m1 | Accessibility gaps | Resolved. Added Section 12 with WCAG 2.1 AA requirements for auth forms. |
| UA-m2 | Loading states on auth forms | Resolved. Added AUTH-LOGIN-06 and mentioned in flows 5.2/5.3. |
| DA-m1 | Hash timing not in requirements | Resolved. Hash timing (200-500ms) included in Section 6 In Scope. |
| DA-m2 | Setup wizard scope ambiguity | Resolved. "Setup wizard / admin seed script" added to Out of Scope. |
