# Decisions Log -- Account Authentication

## Product Decisions (Athena -- PRD Creation)

| Decision | Rationale | Trade-offs Considered |
|----------|-----------|----------------------|
| Self-registration with no admin approval | User explicitly requested "anyone can create an account via a public sign-up page." Simplest flow for a LAN-based team tool. | Admin-approval flow considered -- rejected because it adds friction and the user wants low-barrier access. Can be layered on later. |
| Project-level permissions only (no whiteboard-level) | User explicitly chose "project-level only -- all whiteboards in a project inherit permissions." Reduces permission complexity significantly. | Whiteboard-level permissions would allow finer control but adds UI complexity and query overhead. The user decided this is unnecessary for their use case. |
| First registered user inherits all existing data | User chose "assign to first admin" strategy for existing data migration. This avoids orphaned data and is simple to implement. | Alternative: leave data unowned and let users claim it. Rejected because it requires a claim flow and risks data being inaccessible. Alternative: delete all existing data. Rejected because it destroys work. |
| 30-day sessions with "remember me" / 24-hour default | User explicitly requested "long-lived 30-day sessions with remember me option; minimal re-login friction." | Shorter sessions (e.g., 8 hours) are more secure but conflict with the user's stated preference for minimal re-login. 30 days is acceptable for a LAN tool. |
| Email as the unique identifier for login | Standard practice. Username is for display; email is for authentication. Avoids the "which identifier do I log in with?" confusion. | Username-based login considered -- rejected because emails are globally unique and support future features like password reset and email verification. |
| Generic error messages for auth failures | Security best practice to prevent user enumeration. "Invalid email or password" instead of specific field errors. | Specific errors ("email not found") are more user-friendly but reveal account existence to attackers. Given the LAN context the risk is lower, but the security practice costs nothing to implement. |
| No email verification in this iteration | User explicitly deferred email verification to a future release. | Risk: users can register with fake emails. Acceptable for LAN use where users are known. Email verification can be added without schema changes. |
| No 2FA in this iteration | User explicitly deferred two-factor authentication to a future release. | Risk: accounts are protected by password only. Acceptable for LAN use. The auth system should be designed so 2FA can be added later without breaking changes. |
| Permission roles: viewer / editor / admin | Three-tier model covers the common access patterns: read-only, read-write, and full control. Owner is implicit (creator), not a stored role. | Two-tier (viewer/editor) considered -- rejected because it lacks a way to delegate permission management without giving project ownership. Five-tier or custom roles considered -- rejected as over-engineering for this use case. |
| Effective permission = highest role across all grants | Simple resolution rule. If a user has viewer individually and editor via a group, they get editor. No deny rules. | Deny-overrides model (where explicit deny trumps any grant) is more powerful but significantly more complex. Not needed for the team-scale use case. |
| HttpOnly cookie for session token (not localStorage) | Security best practice -- HttpOnly cookies are not accessible to JavaScript, preventing XSS-based session theft. | localStorage is easier to work with from the client but is vulnerable to XSS attacks. JWT-in-localStorage considered and rejected for the same reason. |
| No `Secure` cookie flag | User develops over HTTP on a LAN. The `Secure` flag would prevent cookies from being sent, breaking authentication entirely. | This means session cookies are transmitted in plaintext on the network. Acceptable for trusted LAN but should be documented as a risk. |
| Avoid `crypto.randomUUID()` for token generation | This API requires a secure context (HTTPS or localhost). The user accesses the app over LAN via HTTP, so it would fail. | Must use an alternative like `crypto.randomBytes()` or a UUID library that does not require secure context. |
| Atomic first-user registration with data migration | The "first user gets all data" operation must be transactional to prevent race conditions where two simultaneous registrations both try to claim ownership. | Non-transactional approach risks orphaned or double-owned data. The transaction adds slight complexity but prevents a real data integrity issue. |

## Revision Decisions (Athena -- PRD v2, Nemesis Review Response)

| Decision | Rationale | Trade-offs Considered |
|----------|-----------|----------------------|
| Anti-enumeration on registration: return generic success for duplicate email | Nemesis correctly identified contradiction between AUTH-REG-03 and Section 7. Chose consistent anti-enumeration because it costs nothing to implement and is security best practice. | Alternative: show "email already exists" (more user-friendly but leaks account info). Rejected because the LAN context does not eliminate the risk -- any LAN user could enumerate accounts. |
| Maximum password length of 128 characters | Bcrypt silently truncates at 72 bytes, which could cause two different passwords to hash identically. 128 chars is generous while preventing DoS via megabyte-length passwords. | Alternative: no limit with Argon2id. Rejected because the algorithm choice is left to engineering and we need a safe ceiling regardless. |
| WebSocket authentication via session cookie in handshake | Socket.IO connections bypass HTTP middleware, so they need explicit auth. The session cookie is already present in the browser and can be read during the handshake. | Alternative: separate WebSocket auth token. Rejected as unnecessary complexity when cookies are already available. |
| Session expiry recovery: best-effort local state, server-authoritative | Nemesis demanded concrete recovery criteria. "Preserve local state" was too vague. Defined: hold React state in memory, redirect back after re-login, WebSocket reconnects and syncs server state. Conflicting local changes are lost (server wins). | Alternative: persist unsaved changes to localStorage. Rejected as over-engineering -- the window between last sync and expiry is typically seconds. |
| Permission revocation UX: message + redirect to project list | Nemesis identified that raw 403 is unacceptable UX. Defined explicit message and redirect behavior for both HTTP and WebSocket paths. | Alternative: real-time push notification before access is cut. Rejected as over-engineering for v1 -- the next-request check is sufficient. |
| Defer User Groups to separate iteration | Nemesis flagged scope drift. Groups require significant UI (creation, member management, picker) and a permission resolution engine. Bundling with core auth risks delays. | Alternative: keep groups at P1 in this PRD. Rejected because groups are not needed for initial multi-user access control and add complexity to an already large feature. |
| Promote basic rate limiting to In Scope | Nemesis correctly identified that "rate limiting as implementation detail" is a category error when brute-force is a real vector on low-latency LAN. 5 attempts / 15-min lockout is minimal but effective. | Alternative: keep out of scope and accept risk. Rejected because the implementation cost is low and the security benefit is meaningful. Alternative: IP-based rate limiting. Deferred as the per-email approach is simpler and sufficient. |
| Add Role Capabilities table | Nemesis flagged "full control" as undefined. Enumerated every capability per role to eliminate ambiguity for engineering. | No real alternative -- this was a documentation gap, not a design choice. |

## Revision Requests
<!-- Reviewers (Apollo, Hermes) append here when requesting changes -->

## Final Resolution (PM Review -- Athena)

The tech spec (Hephaestus, 2026-04-03) is approved from a product perspective. All P0 and P1 requirements from PRD v2 have corresponding implementation designs. All locked decisions from the discuss phase (context.md) are respected. No revision requests were issued.

Key alignments confirmed:
- Anti-enumeration behavior is consistent across registration, login, and lockout paths.
- Session management (24h default / 30d remember me) matches PRD exactly.
- WebSocket authentication follows the verified io.use() pattern with session expiry and permission revocation events.
- ProjectMember table correctly implements the Role Capabilities table from the PRD (OWNER > ADMIN > EDITOR > VIEWER hierarchy).
- First-user data migration is atomic (prisma.$transaction) as required.
- All accessibility requirements (WCAG 2.1 AA) from PRD Section 12 are addressed.

5 minor/informational findings documented in spec-review-pm.md -- none block implementation.
