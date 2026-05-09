# PRD: Auth Security Hardening

| Field        | Value                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Feature**  | Auth Security Hardening                                                                                                   |
| **Author**   | Athena (PM Agent)                                                                                                         |
| **Status**   | Draft (Revision 2 — addresses Nemesis REVISIONS verdict 2026-05-09)                                                       |
| **Version**  | 2.0                                                                                                                       |
| **Created**  | 2026-05-09                                                                                                                |
| **Revised**  | 2026-05-09                                                                                                                |
| **Priority** | P0 (Critical)                                                                                                             |
| **Type**     | Security bug-fix sprint                                                                                                   |
| **Source**   | Code review of PR #97 (account-authentication) — 5 unresolved findings                                                    |

---

## Revision Notes (v2.0)

This revision addresses all 4 BLOCKING and 6 MAJOR findings from Nemesis's prd-challenge.md (2026-05-09), plus 7 MINOR findings:

- **BLOCKING-1 (SEC-RBAC-01 "mutating" undefined)** — resolved by dropping the qualifier; every export in `server-functions.ts` now requires either an explicit RBAC call or an explicit `// Requires: authenticated` annotation. See §4.5.
- **BLOCKING-2 (Batch UX contract)** — resolved by adding §4.3a "Client UX Contract for All-or-Nothing Batch" and §5.3 expanded recovery flow.
- **BLOCKING-3 (SEC-RBAC-04 must be AST-level)** — resolved by narrowing acceptable forms to ESLint custom rule or AST-equivalent semantic analysis. Meta-tests reading annotation strings explicitly rejected. See §4.5 SEC-RBAC-04.
- **BLOCKING-4 (Pre-merge superpassword lockout action item)** — resolved by adding §13 "Pre-Merge Migration Plan" with named owners, communication window, and lockout-recovery path.
- **MAJOR (vague metric, assumption escalation, UX clarity, modal/state preservation, log explosion, MODAL-02 manual gate)** — see §3 metric redefinition, §9 mitigation tightening, §4.4/§5.1 unsaved-state handling, §7 log dedup, §4.4 SEC-MODAL-02 automated check.
- **MINOR (WS-03 counter, persona, batch risk grade, "standard" message definition, accessibility focus assertion, RBAC-03 form, ERR-01 canonical decision)** — addressed throughout.

---

## 1. Problem Statement

PR #97 ships the account authentication system, but a code review surfaced 5 security defects that contradict the security guarantees AUTH-GUARD-01 through AUTH-GUARD-04 and AUTH-PERM-03 promise in the original auth PRD. Each defect makes the system either unsafe to merge or silently broken in user-facing behavior:

1. **Superpassword bypass** — a hardcoded password in the auth code grants access regardless of the user's actual credentials. This is a backdoor that defeats the entire authentication system.
2. **WebSocket IDOR — `column:create` handler** — the handler omits the whiteboard ownership/role check, so any authenticated user can create columns on whiteboards that belong to projects they have no permission on. This violates AUTH-PERM-03 and AUTH-GUARD-04.
3. **Batch column RBAC gap** — batch column operations check RBAC against only the first item in the batch (or skip per-item checks entirely), letting a caller smuggle unauthorized targets through alongside one authorized one.
4. **Session-expired modal unwired** — the server emits the `session_expired` Socket.IO event correctly, but the client never connects that event to `triggerSessionExpired()`. The `SessionExpiredModal` therefore never renders. Flow 5.6 of the original auth PRD is broken end-to-end.
5. **Missing RBAC on server functions** — `findEffectiveRole` and `hasMinimumRole` are absent from every server function in `src/lib/server-functions.ts`. Server functions validate session (authentication) but skip permission checks (authorization), so any logged-in user can invoke them against resources they do not own.

These are not theoretical risks. Each defect is reachable by an authenticated user from the normal client API surface. PR #97 cannot merge until all five are fixed.

---

## 2. Users and Personas

This feature has no new user-facing surface. All five fixes restore behavior that the existing personas were already promised in the auth PRD.

### Primary Persona: Project Owner

- Expects that resources they own are not modifiable by other users.
- Currently broken by: column:create IDOR, batch column RBAC gap, missing RBAC on server functions.

### Primary Persona: Team Collaborator (with limited role)

- A Viewer expects they cannot edit. An Editor expects they cannot manage permissions or delete the project.
- Currently broken by: missing RBAC on server functions (Viewers can call write server functions), batch RBAC gap.

### Primary Persona: Authenticated User on a Long-Running Session

- Expects to see the session-expired modal when their session ends mid-edit, per flow 5.6.
- Currently broken by: session-expired modal is never wired up on the client.

### Primary Persona: Any User (security boundary)

- Expects that there is no master password that bypasses authentication.
- Currently broken by: superpassword backdoor.

### Primary Persona: Existing Logged-In User With an Open WebSocket at Deploy Time (NEW — added in v2)

- They will receive whatever the new error contract is (SEC-ERR-02) for any in-flight action that now denies. If they are mid-edit when the fix deploys, their next mutating action may surface a denial they would not have received pre-fix (because pre-fix they had silent bypass).
- Behavior: client must not crash on the new error event. If the user's pre-deploy session is on a project they no longer have permission for (because they never had it — they had the superpassword bypass), they receive the standard denial; their unsaved local edits are preserved (see §4.4 SEC-MODAL-05) so they can recover them after re-auth as a legitimate user.
- Deploy-window guidance: deploy during a low-traffic window; the client error handler from SEC-ERR-02 ensures graceful degradation rather than crash.

### Secondary Persona: Security Reviewer / Auditor

- Needs evidence (tests, code search, AST guards) that each defect is fixed and cannot regress silently.

### Secondary Persona: Developer Who Authenticated via Superpassword During PR #97 Development (NEW — added in v2)

- May have a real user account in their dev DB but never set a real password (they used the superpassword for every login).
- Post-fix, they cannot log in unless they set a real password before merge or run the manual DB-reset workaround.
- See §13 Pre-Merge Migration Plan for owner, communication window, and recovery steps.

---

## 3. Goals and Success Metrics

| Goal                                                              | Metric                                                                                                                                              | Baseline                                              | Target                                                                                | Owner       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------- |
| Superpassword removed entirely (REVISED in v2)                    | Number of branches in `verifyPassword` (or its equivalent — the function that returns true/false for "is this submitted password valid?") that can return `true` without invoking `bcrypt.compare` (or the equivalent hash comparator) against the stored per-user hash | ≥ 1 (the hardcoded backdoor branch)                   | 0 — every truthy return path of `verifyPassword` must flow through hash comparison    | Engineering |
| WebSocket `column:create` enforces whiteboard authorization       | Percentage of `column:create` events from a non-permitted user that are rejected                                                                    | 0% (all accepted)                                     | 100% rejected with the standard authorization-denied response                          | Engineering |
| Batch column operations enforce RBAC per item                     | Percentage of items in a batch that are individually authorization-checked                                                                          | First item only (or none)                             | 100% per-item check; batch denied or partial-deny per the policy chosen in Section 4 | Engineering |
| Session-expired modal renders when the server says session expired | Percentage of `session_expired` socket events that result in the SessionExpiredModal rendering                                                      | 0% (event never propagates to `triggerSessionExpired`) | 100%                                                                                  | Engineering |
| Every server function in `server-functions.ts` enforces auth      | Number of `createServerFn` exports in `src/lib/server-functions.ts` that do not flow through `findEffectiveRole`/`hasMinimumRole` (or the documented `requiresAuthenticated` middleware for any-authenticated-user functions), as verified by the AST guard from SEC-RBAC-04 | All of them                                           | 0                                                                                     | Engineering |
| Regression coverage exists for all five fixes                     | Number of fixes without an automated test that fails before the fix and passes after                                                                | 0 of 5                                                | 5 of 5                                                                                | Engineering |
| Batch-failure regression detector (NEW — added in v2)             | Non-blocking: count of batch operations failing with `BATCH_DENIED` per day, post-deploy, surfaced via existing log aggregation                     | n/a                                                   | Tracked, no hard target — used to detect UX regression where legitimate users are repeatedly batch-denied | Engineering |

**Measurement methodology for row 1 (revised):** The metric is verified by inspecting the AST of `verifyPassword` (or the equivalent function) and asserting every code path that returns truthy passes through `bcrypt.compare(submitted, storedHash)`. This is *not* a literal-string `rg` search, because a backdoor could be encoded via env var, header, feature flag, or alternate function. The AST inspection is performed as part of the SEC-SP-04 regression test or SEC-RBAC-04 guard, whichever covers `verifyPassword`.

---

## 4. Requirements

### 4.1 Remove Superpassword Backdoor (P0)

| ID         | Requirement                                                                                          | Acceptance Criteria                                                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-SP-01  | All hardcoded password values are deleted from authentication code                                   | After the change, a repository-wide search for the literal value, any string-comparison shortcut, or any environment variable that bypasses the password-hash check returns no matches in production code paths. Test fixtures may continue to use known-plaintext test passwords, but only in test files.   |
| SEC-SP-02  | Password verification depends solely on the per-user stored hash                                     | Submitting any password except the user's actual password (hash-verified) results in the standard "Invalid email or password" response. There is no string, env var, header, or feature flag that overrides this check. Verified at AST level: every truthy return of `verifyPassword` flows through `bcrypt.compare` against the stored hash. |
| SEC-SP-03  | Removal does not lock anyone out who relies on a legitimate password                                 | All accounts created during PR #97 development that have a real password set continue to work. There are no migration steps required for legitimate users. Developers who relied on the superpassword follow the §13 pre-merge migration plan; if they miss the window, the documented manual DB-reset workaround is available.                                                                                                                  |
| SEC-SP-04  | A regression test asserts the backdoor is gone                                                       | An automated test attempts login with the previously-hardcoded password against a user whose actual password is different and asserts that login fails with the generic invalid-credentials response. The test would fail today and pass after the fix.                                                       |

**Out of scope for this requirement:** Adding a separate admin-recovery mechanism. Password reset is already deferred in the original auth PRD (manual DB reset by administrator). This sprint does not introduce a replacement backdoor of any kind.

### 4.2 WebSocket `column:create` Authorization (P0)

| ID         | Requirement                                                                                                                                                                                                                                       | Acceptance Criteria                                                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-WS-01  | The `column:create` handler resolves the target whiteboard's project and verifies the authenticated user has at least the Editor role on that project before creating any column                                                                  | A user with no permission, or with only Viewer permission, on the project that owns the target whiteboard receives an authorization-denied response and no column is created. A user with Editor, Admin, or Owner permission succeeds as before.                                                          |
| SEC-WS-02  | The authorization check uses the same role-resolution function used by HTTP server functions (e.g., `findEffectiveRole` + `hasMinimumRole`)                                                                                                       | Code inspection shows the WebSocket handler delegates to the same permission helper(s) as the equivalent HTTP path, so a single source of truth exists for "who can edit columns on a whiteboard."                                                                                                       |
| SEC-WS-03  | Denied attempts emit a standard authorization-error event the client already understands; the server logs the attempt at WARN level with user ID, project ID, and event name; **and a per-user, per-event denial counter is incremented** so flood-of-denials patterns are detectable post-hoc (REVISED in v2) | Client receives the standard error event (the same one used for any other unauthorized WebSocket action — see §4.6 for the canonical error contract). Server log contains a single WARN entry per denial that an auditor can grep for. No PII beyond user ID is logged. **Additionally**, an in-process counter (or existing log-aggregation field) increments per `(userId, eventName)` tuple so a future alerting layer can detect floods. The counter implementation may be as simple as a structured-log field; no new metrics infra is required.                                                |
| SEC-WS-04  | A regression test fails before the fix and passes after                                                                                                                                                                                            | An automated test simulates a Socket.IO client with a session belonging to a user who has no permission on a target whiteboard, emits `column:create`, and asserts (a) no column row is written, (b) the standard authorization-error event is received, (c) authorized users still succeed.            |

### 4.3 Batch Column RBAC — All Items Checked (P0)

| ID           | Requirement                                                                                                                                                  | Acceptance Criteria                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-BATCH-01 | Every batch column operation runs the RBAC check against every item in the batch, not just the first                                                         | Code inspection shows the per-item permission check is inside the batch loop (or applied via map-then-validate), with no early-return after item 0. Equivalent server functions and WebSocket handlers both follow this rule.                                                                                                                                  |
| SEC-BATCH-02 | The batch's authorization policy is **all-or-nothing**: if any item in the batch fails authorization, the entire batch is rejected and no items are written  | Submitting a batch where item N (N ≥ 0) targets a resource the user is not authorized to modify results in zero database writes for the entire batch and a single authorization-denied response. This avoids partial-state confusion and matches the "fail closed" stance of the rest of the auth system.                                                     |
| SEC-BATCH-03 | The denied response identifies the batch as denied without leaking which specific item caused the denial                                                     | The error response says the batch was rejected for an authorization reason. It does **not** list which item index triggered the denial, because doing so would leak information about which whiteboards/projects the requester has no access to.                                                                                                                |
| SEC-BATCH-04 | A regression test fails before the fix and passes after                                                                                                      | An automated test submits a batch with mixed authorized + unauthorized items and asserts (a) no rows are written for any item, (b) the response is authorization-denied, (c) a fully-authorized batch still succeeds, (d) a fully-unauthorized batch still fails.                                                                                              |

### 4.3a Client UX Contract for All-or-Nothing Batch Rejection (P0 — NEW in v2)

This sub-section resolves BLOCKING-2 from the prd-challenge: anti-enumeration is the right server policy, but it must be paired with a user-side recovery path so users are not stranded with no way forward.

| ID           | Requirement                                                                                                                                                  | Acceptance Criteria                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-BATCH-UX-01 | Batch input is preserved client-side on a `BATCH_DENIED` response                                                                                          | When the client receives the canonical batch-denied error, the UI does **not** clear the user's batch input (the column rows they typed/configured). The user sees their original input still on screen with an error banner above it. They do not have to re-enter data.                                                                                       |
| SEC-BATCH-UX-02 | The user-facing message is action-specific without leaking item identity                                                                                      | The error banner reads: **"This batch could not be saved. One or more items target a resource you no longer have access to. Try removing items added in the last few minutes, or save items individually to find which one is blocked."** This tells the user *what* the failure category is and *what action* to take (split the batch), without telling them which item index failed. |
| SEC-BATCH-UX-03 | A "split into smaller batches / save individually" recovery path exists in the UI                                                                              | The UI exposes (a) a per-row "save this row only" button **or** (b) a "save half of these" affordance that resubmits the first ⌈N/2⌉ rows. Both let the user bisect to the offending row themselves without the server identifying it. Engineering may pick either UX; PRD requires *some* bisection affordance.                                                  |
| SEC-BATCH-UX-04 | The error event from SEC-ERR-02's WebSocket shape carries `code: "BATCH_DENIED"` (a sub-code of `FORBIDDEN`) so the client can distinguish batch-denial UX from single-item denial UX | Single-item `column:create` denial shows the standard "you don't have access" toast (SEC-ERR-02 mapping). Batch denial routes through the SEC-BATCH-UX-02 banner with the bisection affordance. The client switches on the `code` field, not the original event name.                                                                                              |
| SEC-BATCH-UX-05 | A regression test asserts the UX contract                                                                                                                    | A component test mounts the batch-column UI, simulates a `BATCH_DENIED` response, and asserts (a) batch input is still rendered in the form, (b) the SEC-BATCH-UX-02 message is visible, (c) the bisection affordance is reachable via keyboard.                                                                                                                |

**Information-leak audit:** The SEC-BATCH-UX-03 bisection happens entirely client-side. The server only ever sees individual single-item submissions, each of which returns the standard single-item denial (which is already not enumeration-leaking by SEC-ERR-03). The server's batch endpoint cannot be used to enumerate; the user discovers the offending item by re-submitting smaller subsets they already chose to send. This preserves anti-enumeration: an attacker submitting batches gains no more information than they would by submitting the items individually.

### 4.4 Session-Expired Modal Wiring (P0)

| ID           | Requirement                                                                                       | Acceptance Criteria                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-MODAL-01 | The client subscribes to the `session_expired` Socket.IO event and invokes `triggerSessionExpired()` when received | After the fix, when the server emits `session_expired`, `SessionExpiredModal` becomes visible within one render cycle. The modal's "Log in again" button works as specified in flow 5.6 of the original auth PRD: redirects to `/login` with a `redirect` query parameter set to the current URL. **Unsaved-state preservation: see SEC-MODAL-05.**                                |
| SEC-MODAL-02 | The wiring lives in the same module that owns the rest of the Socket.IO client lifecycle (single source of truth), enforced by an automated check (REVISED in v2) | Code inspection shows there is one place that registers Socket.IO event handlers; `session_expired` is registered there alongside other lifecycle events. **Additionally, an automated guard (test or AST-level lint rule) asserts that `session_expired` is registered in exactly one module across the codebase.** The same SEC-RBAC-04 ESLint rule infrastructure may host this assertion; manual code inspection alone is not sufficient. |
| SEC-MODAL-03 | The modal also triggers when an HTTP response returns 401 / session-expired, matching existing behavior | This is already promised by the original PRD; the fix must not regress it. After the fix, both transports (HTTP 401 and WebSocket `session_expired`) reach `triggerSessionExpired()`. A test asserts both paths.                                                                                                                                                              |
| SEC-MODAL-04 | A regression test fails before the fix and passes after                                           | An automated test mounts the relevant client module, simulates the server emitting `session_expired`, and asserts that `triggerSessionExpired` is invoked exactly once and the modal becomes visible. **Accessibility extension:** the test additionally asserts focus moves to the modal (or to the modal's first focusable element) when it renders. Bonus: an integration test against a real Socket.IO loopback proves the wire-level event reaches the client handler. |
| SEC-MODAL-05 (NEW in v2) | Unsaved whiteboard state is preserved through the session-expired flow                  | Before the modal redirects to `/login`, the client persists in-flight unsaved edits (e.g., locally-typed column edits, drafted relationships) to a recovery store (sessionStorage, localStorage, or the existing draft state — engineering picks the persistence layer). After the user re-authenticates and returns to the original URL, those edits are surfaced to them with an option to apply or discard. **PRD-level:** this requirement defers implementation details to the original auth PRD's flow 5.6 unsaved-work handling if that section already addresses this; if it does not, this sprint adds the minimum viable persistence (sessionStorage of the in-flight form values, restored on the post-login route). |

### 4.5 RBAC on All Server Functions in `server-functions.ts` (P0)

**Terminology note (REVISED in v2):** Earlier drafts used the qualifier "mutating server function." That qualifier is dropped. Every export in `src/lib/server-functions.ts` requires an explicit auth gate, regardless of whether it reads or writes. Read-only functions either filter by the caller's effective permissions (returning empty results for resources they cannot see) or return 403; write functions enforce a minimum role. Functions that intentionally accept any logged-in user use the explicit `// Requires: authenticated` JSDoc annotation (see SEC-RBAC-03 for the exact form).

| ID           | Requirement                                                                                                                                                                                  | Acceptance Criteria                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-RBAC-01 (REVISED in v2) | Every server function exported from `src/lib/server-functions.ts` (read or write) performs both authentication (session check) and authorization (role check via `findEffectiveRole` + `hasMinimumRole`, or an equivalent middleware that wraps both) before touching the database. The qualifier "mutating" is intentionally **not** used, because the slipped-defect class includes read functions that returned data the caller had no permission to see. | Code inspection enumerates every `createServerFn` export in the file. Each one either (a) calls the permission helpers explicitly in its handler, (b) is composed with a middleware/wrapper that does, **or** (c) carries the explicit JSDoc annotation `@requires authenticated` (the only acceptable form for "any logged-in user" functions; see SEC-RBAC-03). There are zero exports that skip both options.                |
| SEC-RBAC-02  | Read-only server functions that return user-specific or project-scoped data also enforce authorization (a Viewer's read of a project they have no role on must return an empty result or 403, matching AUTH-PERM-03) | Each read function either filters by the caller's effective permissions (so a non-permitted user sees nothing) or returns the standard 403 response. There are no public-read mutating-write asymmetries. |
| SEC-RBAC-03 (REVISED in v2) | The minimum role required for each function is documented as a **JSDoc comment** with a structured `@requires` tag immediately preceding the function/export declaration | Every server function in the file has a JSDoc block with one of: `@requires authenticated` (any logged-in user), `@requires viewer`, `@requires editor`, `@requires admin`, `@requires owner`. The form is `@requires <role>` on its own line in the JSDoc, where `<role>` is one of the five lowercase strings. This is both a documentation requirement and the unambiguous static target for SEC-RBAC-04. Decorators, single-line comments, and other forms are **not** acceptable — the form is fixed so the AST guard can rely on it. |
| SEC-RBAC-04 (REVISED in v2 — BLOCKING-3 fix) | An **AST-level static guard** (ESLint custom rule or equivalent semantic analysis) exists that fails CI when (a) any `createServerFn(...)` call site does not have its handler body invoke `hasMinimumRole` (or pass through a wrapper that does) **and** does not carry the `@requires authenticated` JSDoc tag, **or** (b) any new file under `src/lib/` (and `src/server/` for handlers) introduces a `createServerFn` export that is not detected and verified by the same rule | **Acceptable form (only):** an ESLint custom rule (or equivalent AST-based static analysis tool — e.g., a TypeScript compiler API check, or a Babel plugin used in CI) that operates on the syntax tree of the codebase and asserts the permission call reaches the handler body of every server-function export. The rule must: (1) detect new `createServerFn(...)` exports across the entire `src/` tree, not just `src/lib/server-functions.ts` — including future files like a hypothetical `src/lib/admin-functions.ts`; (2) inspect the handler body or its wrapping HOFs to confirm a real call to `hasMinimumRole`, `findEffectiveRole`, or the documented permission middleware reaches the database call — comments and annotations alone are **insufficient unless** the function is annotated `@requires authenticated`, in which case the rule still asserts the JSDoc tag exists; (3) catch "gutted wrappers" — a `withAuth(fn)` that no longer calls `hasMinimumRole` must fail the rule, by either resolving the wrapper definition or requiring wrappers to live in an allowlisted file whose contents the rule verifies. **Explicitly rejected forms:** a meta-test that imports the module and reads annotation strings (cannot detect new files; cannot detect gutted wrappers); a CI grep step (string-level only, fooled by comments); manual review (already failed once). |
| SEC-RBAC-05  | A regression test demonstrates a non-permitted caller is denied for at least one representative function from each role tier (Viewer-required, Editor-required, Admin-required, Owner-required) | Four end-to-end (or unit-with-mock-context) tests, one per tier, fail before the fix and pass after. Each test uses a session belonging to a user one role below the required tier and asserts the standard authorization-denied response.                                                                                                                                                                                  |

### 4.6 Canonical Authorization-Error Contract (P0 — cross-cutting)

| ID         | Requirement                                                                                                                                                       | Acceptance Criteria                                                                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-ERR-01 (REVISED in v2 — MINOR-7 fix) | HTTP authorization denials return **HTTP 403** with body shape `{ error: "FORBIDDEN", message: "You do not have access to this resource." }`. This is the canonical shape for this sprint. If PR #97 already shipped a different shape, the sprint **standardizes on this one** and migrates any inconsistent existing usage to it. The decision is made at the PRD layer, not deferred to engineering. | All five fixes use this exact HTTP shape. Any existing PR #97 endpoints returning a different shape are updated as part of this sprint's scope. The body is a JSON object with the two named fields; no additional fields beyond `error` and `message` are required, but if engineering needs an extra field for client routing (e.g., `code: "BATCH_DENIED"` per SEC-BATCH-UX-04) they may add it without changing the existing two. |
| SEC-ERR-02 (REVISED in v2 — MAJOR-3 fix) | WebSocket authorization denials emit a standard error event named `error` with payload `{ code: "FORBIDDEN" \| "BATCH_DENIED", event: "<original_event_name>", message: "<user-facing string>" }`. The `event` field is for **both logging and user-facing message customization**. The `message` field is what the client surfaces to the user verbatim. | All five fixes use this exact shape. The client has (or gains as part of this work) a single handler that switches on `code` to route between toast UX (FORBIDDEN single-item) and banner UX (BATCH_DENIED — see §4.3a). The `event` field carries the original event name (e.g., `column:create`) so the client can pick a contextual message. The mapping table from `event` to user-facing message is defined in **Appendix C**. The `message` field is server-authoritative — the client uses it as fallback when no entry exists in the mapping table. |
| SEC-ERR-03 | The error response **never** indicates whether the resource exists, only that the requester is not authorized                                                       | A non-permitted user calling `column:create` against a non-existent whiteboard ID and against an existing-but-unauthorized whiteboard ID receives indistinguishable responses. This is consistent with the AUTH-PERM-03 anti-enumeration stance.                                |

---

## 5. User Flows

This sprint introduces no new user-facing flows. It restores three flows from the original auth PRD that are currently broken, and prevents one (superpassword) that was never intended.

### 5.1 Restored: Session Expiry on Active WebSocket (REVISED in v2)

1. User is editing a whiteboard. WebSocket is connected. They have unsaved local edits (e.g., a column they just added but not saved).
2. Their session expires server-side.
3. Server emits `session_expired` and closes the connection.
4. **Fix (SEC-MODAL-01 + SEC-MODAL-05):** Client's `session_expired` handler invokes `triggerSessionExpired()`. **Before the modal mounts**, the client persists in-flight unsaved edits to the recovery store (sessionStorage of the form-state object; key includes the route).
5. `SessionExpiredModal` renders. Focus moves to the modal's first focusable element (per the accessibility extension to SEC-MODAL-04). User clicks "Log in again."
6. Browser navigates to `/login?redirect=<currentUrl>`.
7. User re-authenticates with their real password (no superpassword path exists post-fix).
8. Browser returns to the original URL. The route handler reads the recovery-store entry and surfaces the unsaved edits with an "apply / discard" prompt.
9. Standard re-auth flow proceeds (see flow 5.6 of the original auth PRD).

### 5.2 Restored: Authorization Denial on `column:create`

1. User A (no permission on Project X) opens a Socket.IO connection (they are authenticated).
2. User A emits `column:create` targeting a whiteboard inside Project X.
3. **Fix:** Server runs `findEffectiveRole` on User A for Project X, finds `null` (or below Editor), and rejects.
4. Server emits the canonical authorization-error event (§4.6) with `code: "FORBIDDEN"`, `event: "column:create"`, and `message: "You do not have access to edit this whiteboard."` (per Appendix C mapping). No row is written.
5. Client receives the error and shows the standard "you do not have access" toast — the `message` field is rendered verbatim. (See Appendix C for the canonical message-mapping table.)

### 5.3 Restored: Authorization Denial on Batch Column Operations (REVISED in v2)

1. User A submits a batch of column operations. Items 1–4 target resources they can edit; item 5 targets a resource they cannot (e.g., they were just removed from a project, but their UI hasn't updated).
2. **Fix (SEC-BATCH-01):** Server runs the per-item authorization check. Item 5 fails.
3. Server rolls back the batch (no items written) and returns the canonical authorization-error response (§4.6) with `code: "BATCH_DENIED"` and a generic `message`. The response does **not** identify which item failed (SEC-BATCH-03).
4. **Client UX (SEC-BATCH-UX-01..05):** Client retains the original batch input on screen. An error banner above the form reads: "This batch could not be saved. One or more items target a resource you no longer have access to. Try removing items added in the last few minutes, or save items individually to find which one is blocked."
5. The user sees a "save individually" or "save half" affordance and uses it to bisect their batch. Each individual submission either succeeds or returns the standard single-item denial (whose `event`-based message tells them *what* category of action was denied — e.g., "you don't have access to edit this whiteboard").
6. When the user finds the offending item, they can remove it from their input. The remaining items can be batched again.

**Anti-enumeration check:** The bisection happens client-side using the user's own input. The server's batch endpoint never reveals item indices, and per-item submissions return SEC-ERR-03–compliant indistinguishable responses for "not found" vs. "unauthorized." The user discovers which of *their own* items they cannot access, not which arbitrary items exist in the system.

### 5.4 Restored: Authorization Denial on Server Functions

1. A logged-in user invokes a server function that requires Editor or higher on a project they only have Viewer (or no) access to.
2. **Fix:** The function's RBAC layer rejects with HTTP 403 and body `{ error: "FORBIDDEN", message: "You do not have access to this resource." }` (per SEC-ERR-01) before any database mutation.

### 5.5 Prevented: Superpassword Login Attempt

1. Anyone (legitimate user typing the wrong password, or attacker who knows the previously-hardcoded value) submits a password that does not match the stored hash for the email.
2. **Fix:** No code path accepts this. Response is the generic "Invalid email or password," same as any other wrong-password attempt. Rate-limit counter increments per AUTH-LOGIN's existing rate-limit rule.

---

## 6. Scope

### In Scope

- Removal of the hardcoded superpassword from authentication code.
- Adding the whiteboard-ownership / role check to the WebSocket `column:create` handler.
- Restructuring batch column operations so RBAC is applied to every item, with all-or-nothing rejection.
- **Client UX contract for batch denial: input preservation, banner message, bisection affordance** (§4.3a — added in v2).
- Wiring the client's `session_expired` Socket.IO event handler to invoke `triggerSessionExpired()`.
- **Persisting unsaved whiteboard state through the session-expired flow** (SEC-MODAL-05 — added in v2).
- Adding `findEffectiveRole` + `hasMinimumRole` (or equivalent middleware) to every server function in `src/lib/server-functions.ts` (read or write).
- One automated regression test per fix (SEC-SP-04, SEC-WS-04, SEC-BATCH-04, SEC-BATCH-UX-05, SEC-MODAL-04, SEC-RBAC-05).
- **An AST-level static guard (ESLint custom rule or equivalent)** for SEC-RBAC-04 — meta-tests are explicitly insufficient.
- **An automated check that `session_expired` is registered in exactly one place** (SEC-MODAL-02).
- Documentation comments (specifically: structured JSDoc `@requires` tags) on each server function indicating the minimum role required (SEC-RBAC-03).
- **§13 Pre-Merge Migration Plan** — communication, real-password-set window, and lockout recovery for developers who relied on the superpassword.
- **Standardizing on the canonical error shape from SEC-ERR-01** — migrating any existing PR #97 endpoints with a different shape.

### Out of Scope

- Auditing every WebSocket handler beyond `column:create` for similar IDOR. Hephaestus's tech spec for SEC-RBAC-04 will produce a written enumeration appendix (see §9 mitigation); any defect found beyond the original five enters a triage decision before tech spec is approved (in-scope / new-feature / accepted-risk).
- Auditing every batch endpoint beyond column operations. Same disposition as above.
- Adding password reset / recovery (still deferred per original auth PRD).
- Adding 2FA, OAuth, or any new auth mechanism.
- Refactoring the broader auth architecture (we are patching defects, not redesigning).
- Centralized audit logging beyond the WARN-level log entry plus per-user-per-event counter on denied WebSocket attempts (SEC-WS-03). Full audit logging is a separate future feature.
- Per-IP rate limiting or progressive delays beyond the existing AUTH-LOGIN rate-limit behavior.
- Backfilling tests for existing already-correct server functions. New tests only need to cover the five defects.

### Explicitly NOT replaced

The superpassword is removed with no replacement. There is no "admin override," no "support backdoor," no environment-flag bypass. Forgotten passwords still follow the manual DB-reset workaround documented in the original auth PRD.

---

## 7. Failure Modes

| Scenario                                                                                                                                                  | Expected Behavior                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A legitimate developer previously logged in with the superpassword (e.g., during PR #97 testing) tries again post-fix without having set a real password | They receive the generic "Invalid email or password" response. They must either (a) have set a real password during the §13 pre-merge window, or (b) have an administrator reset their password via the documented manual DB-reset workaround. The §13 plan owner is responsible for ensuring no developer is locked out by surprise. |
| A user is mid-batch-column-operation when their permission is revoked                                                                                     | The next batch operation fails with `BATCH_DENIED` and the client surfaces the SEC-BATCH-UX-02 banner with bisection affordance. Per AUTH-PERM-05, the client also receives the `permission_revoked` event and redirects to the project list — that takes precedence over the batch banner if both fire simultaneously.                                          |
| The `session_expired` event fires but `triggerSessionExpired()` errors                                                                                    | The Socket.IO handler must catch the error and at minimum log it; falling back to a hard navigation to `/login?redirect=<currentUrl>` is acceptable. The user must not be left in a stuck UI with a closed socket and no modal. **Unsaved-state persistence (SEC-MODAL-05) still runs in this fallback path.**                                                    |
| An RBAC check throws (e.g., database unreachable while resolving role) — REVISED in v2                                                                    | Treat as denial. The server returns 403 (HTTP) or the canonical authorization-error event (WebSocket) and logs at ERROR level. **Log dedup/rate-limit:** ERROR logs from this branch are sampled at one log line per `(userId, errorClass)` per 60-second window (or via an existing logger sample-rate config). This prevents log explosions when the DB is unreachable for thousands of concurrent requests. Failing closed is required — never default to allow. |
| A new server function is merged that forgets the RBAC annotation/check                                                                                    | The AST-level static guard from SEC-RBAC-04 fails CI. The PR cannot merge until the function is annotated/wrapped. Comments alone do not satisfy the guard — the AST check verifies the permission call reaches the handler body, except for `@requires authenticated` functions where the guard verifies the explicit JSDoc tag exists.                          |
| Existing legitimate WebSocket clients (already-connected sessions) receive the new error event format                                                     | The client must not crash on the new error event. If the existing PR #97 client does not yet handle this event, adding a default handler is part of the fix scope.                                                                                                                                                                                              |
| Batch with one item that targets a non-existent whiteboard                                                                                                | The batch fails with the canonical authorization-denied response (per SEC-ERR-03, "exists but unauthorized" and "does not exist" are indistinguishable). This is intentional anti-enumeration behavior, not a bug.                                                                                                                                                |
| Test that asserts "superpassword fails" still passes if developers later re-introduce a different backdoor                                                | The regression test from SEC-SP-04 catches the exact known string. The structural defenses are SEC-RBAC-04 (AST guard for server-function authz) **plus** the SEC-SP-02 AST-level assertion that every truthy return of `verifyPassword` flows through `bcrypt.compare`. Together these catch backdoors via env var, header, or alternate function — three of the four enumerated bypass mechanisms. We accept the residual limitation: a sufficiently creative bypass (e.g., a separate `verifyPasswordV2` function) requires code review discipline. |
| Hephaestus's enumeration discovers a sixth defect (added in v2)                                                                                            | Hephaestus produces a written defect-list appendix to the tech spec. Each new defect is triaged: **in-scope** (added to this sprint), **new-feature** (filed as a separate PRD), or **accepted-risk** (documented with rationale). Tech spec cannot be approved by Apollo (stage 7) until every newly-found defect has an explicit triage outcome. See §9 mitigation. |

---

## 8. External API Dependencies

No external APIs. All five fixes are purely internal to the `liz-whiteboard` codebase.

---

## 9. Assumptions

| Assumption                                                                                                                          | Risk If Wrong                                                                                                                                                                                | Mitigation                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The five defects are the *only* security defects in PR #97                                                                          | **High risk.** If reviewers missed a sixth defect, this sprint will not catch it.                                                                                                            | **(REVISED in v2)** Hephaestus's tech spec for SEC-RBAC-04 must include a one-time enumeration of all WebSocket handlers and all server functions. **The enumeration produces a written defect-list appendix to the tech spec.** Every defect found is triaged as in-scope / new-feature / accepted-risk before tech spec is approved by Apollo (stage 7). The enumeration is not just informational — it is gating. |
| The existing `findEffectiveRole` + `hasMinimumRole` helpers are correctly implemented                                               | **Medium risk.** If those helpers themselves have a bug, every fix that depends on them inherits it.                                                                                         | Add at least one test that exercises the helpers directly (correct role mapping, correct comparison) as part of SEC-RBAC-05.                                                                            |
| The all-or-nothing batch policy (Section 4.3) is preferable to partial-success — REVISED in v2                                      | **Medium risk** (escalated from low). Users who routinely submit batches of 10+ columns and one is unauthorized due to stale UI lose their entire batch. Bisecting via the UI is tedious. The security stance is right; the UX cost is real. | §4.3a defines the client UX contract (input preservation + bisection affordance) so users have a recovery path. Additionally, the `BATCH_DENIED` log/counter from SEC-WS-03 lets us observe the rate of batch-failure post-deploy; a non-blocking metric tracks this for product-quality regression detection. If the rate is high, partial-success can be re-litigated in a future PRD. |
| Removing the superpassword does not lock out any in-progress development workflow — REVISED in v2                                   | **Medium risk** (escalated from low). Some developers may have *only* used the superpassword and never set a real password.                                                                  | **§13 Pre-Merge Migration Plan** — named owner, communication window of 7 calendar days minimum before merge, and a documented lockout-recovery path. The original "communicate before merge" was too soft; the §13 plan is now an explicit pre-merge action item. |
| One automated regression test per fix is sufficient coverage                                                                        | **Low risk.** A single test can miss edge cases.                                                                                                                                             | Artemis (test plan agent, stage 8) will expand coverage as they see fit. The PRD only requires one test as the minimum bar — more is welcome.                                                          |
| Existing PR #97 client code can be modified to handle the new wired-up `session_expired` event without breaking other client logic | **Low risk.** The wiring is additive; it adds a handler that was missing.                                                                                                                    | If integration with the existing client lifecycle proves complex, the fix should still complete in this sprint — the test from SEC-MODAL-04 will catch any wiring regression.                          |

---

## 10. External Research Summary

No external research was conducted for this PRD. All five defects are concrete, reproducible code-review findings with named symbols and file locations in the `liz-whiteboard` codebase. Best-practice references are inherited from the original auth PRD (OWASP password-storage guidance, TanStack Start auth patterns, etc.) — those references already informed the original design and are not re-litigated here.

What is *new* is the AST-level structural guard requirement (SEC-RBAC-04). The motivation for that requirement is the OWASP "broken access control" pattern: access control failures are the most common web app vulnerability class precisely because they recur whenever a new endpoint is added without a check. A CI-level AST guard converts the defect class from "humans must remember" to "machines enforce." A pure meta-test that reads annotation strings is **not** sufficient because (a) it cannot detect new server-function files added outside the canonical module, (b) it relies on the marker being honest — a developer can add `@requires editor` without invoking `hasMinimumRole`, and (c) it does not catch wrappers that no-op (a `withAuth(fn)` HOF that's been gutted). The AST rule must inspect the actual handler-body call graph.

---

## 11. Impact on Existing System

### Code Files Touched (expected, not prescriptive)

The following list reflects where the defects live based on the symbols named in the requirements. Hephaestus's tech spec will confirm or refine. PRD-level intent is *what* changes, not *how*.

- Authentication module(s) under `src/lib/auth/` — superpassword removal.
- WebSocket handler module(s) under `src/server/` (the `socket.test.ts` neighborhood) — `column:create` authorization check + batch column RBAC restructure.
- Client-side Socket.IO bootstrap module — `session_expired` → `triggerSessionExpired()` wiring + unsaved-state persistence.
- `src/lib/server-functions.ts` — auth gate added to every export (read or write); structured `@requires` JSDoc tags.
- Batch-column UI module(s) — input preservation + error banner + bisection affordance (§4.3a).
- One new (or extended) test file per fix.
- One new ESLint custom rule (or AST-equivalent) implementing SEC-RBAC-04, plus configuration to apply it across `src/`.
- One new automated check for SEC-MODAL-02 (single-registration assertion).
- Recovery-store module for unsaved-state persistence (SEC-MODAL-05) — engineering may use existing draft state if it already has one.
- Any PR #97 endpoint with a non-canonical error shape — migrated to SEC-ERR-01 shape.

### Database Schema Changes

None. All five fixes are application-layer.

### Behavior Changes Visible to Existing Users

- Users who somehow authenticated via the superpassword can no longer do so. Developers in this category follow §13.
- Users who somehow caused a column to be created on a whiteboard they didn't own can no longer do so.
- Users with Viewer-only roles will receive 403 on server function calls that they were previously able to invoke. This is the correct behavior per the original auth PRD; the existing UI should not surface those calls to Viewers, but if it does, those UI affordances are bugs to fix in a follow-up — they are out of scope here.
- Session-expired modal will start appearing for users who previously had silent socket disconnects. **Their unsaved edits will be preserved through the re-auth flow** (SEC-MODAL-05).
- Users submitting batches that contain an item they cannot edit will see a `BATCH_DENIED` banner with bisection affordance instead of a generic toast.

### Routes Added / Modified

None.

---

## 12. Accessibility Requirements

No new UI is introduced. The `SessionExpiredModal` is already covered by Section 12 of the original auth PRD (focus trap, keyboard dismissal). This sprint must not regress those guarantees — the wiring fix should connect the existing accessible modal to the existing event source.

**Additionally added in v2:**

- SEC-MODAL-04's regression test asserts that focus moves to the modal (or its first focusable element) when it renders, so screen-reader users are notified the modal appeared.
- The batch-denial banner (SEC-BATCH-UX-02) and the bisection affordance (SEC-BATCH-UX-03) must be reachable via keyboard navigation and announced by screen readers (`role="alert"` or equivalent live region for the banner). SEC-BATCH-UX-05's test asserts keyboard reachability.

---

## 13. Pre-Merge Migration Plan (NEW in v2 — BLOCKING-4 fix)

The superpassword's removal will lock out any developer who relied on it without ever setting a real password. This section is the explicit pre-merge action item, with named owner and recovery path.

### 13.1 Owner and Responsibilities

- **Owner:** the engineer designated as PR #97 lead (or, if unassigned, the team-lead-of-record at the time the fix lands).
- **Responsibilities:**
  1. Identify every developer with an account in any shared dev/staging DB created during PR #97 development.
  2. Communicate the removal at least **7 calendar days** before the fix lands on `master`.
  3. Provide each affected developer with a one-time path to set a real password (see §13.3).
  4. Confirm zero "still using superpassword" sessions in the staging logs for at least 24 hours before merge.

### 13.2 Communication

- Channel: project communication channel (Slack / equivalent) **plus** direct message to each developer with a known account.
- Subject: "ACTION REQUIRED: Set a real password before [date] — superpassword bypass is being removed."
- Content: link to this PRD's §13.3, the cutoff date, and the lockout-recovery path.

### 13.3 Pre-Merge Real-Password-Set Path

Engineering selects one of the following (whichever is faster to implement and verify):

- **Option A — Time-bounded password-set helper:** a one-time admin-run server function that lets each developer submit a new password against their existing account, available only on dev/staging environments and removed before the fix merges to `master`.
- **Option B — Manual DB-set:** the §13 owner runs the documented manual DB-reset workaround for each affected developer, sets a temporary known password, and communicates it via secure channel. Each developer logs in and changes it via the existing change-password flow (if AUTH-CHGPW-01 from the original PRD is shipped) or accepts the temporary as their working password.

Both options must be **fully removed/disabled** before the fix lands on `master`. The PR description includes a checklist line confirming this.

### 13.4 Lockout Recovery (Post-Merge)

If a developer misses the §13.2 communication window and is locked out post-merge:

- They contact the §13 owner (or team-lead-of-record).
- The owner runs the manual DB-reset workaround documented in the original auth PRD.
- Estimated time to recovery: same business day, assuming the owner is reachable.

### 13.5 Verification Before Merge

The PR for this sprint cannot be approved until:

- [ ] §13.2 communication has been sent and at least 7 calendar days have elapsed.
- [ ] Either Option A is fully implemented and used, or Option B has been completed for every known affected developer.
- [ ] Staging logs show zero successful logins via the superpassword for the 24 hours preceding merge.
- [ ] Option A's time-bounded helper (if used) has been deleted from the codebase.

---

## Appendix A: Verification Plan (PRD-level)

This is *not* a substitute for Artemis's test plan in stage 8. It is the minimum the PRD considers "done":

1. **Superpassword removed:** ripgrep across `src/` for the previously-hardcoded value returns zero hits in non-test code. AST inspection confirms every truthy return of `verifyPassword` flows through `bcrypt.compare`. Manual login attempt with the literal value fails.
2. **column:create authorized:** integration test in the Socket.IO test suite simulates an unauthorized user emitting `column:create` and asserts denial + zero DB writes.
3. **Batch RBAC fixed:** integration test submits a mixed batch and asserts all-or-nothing rejection. **Component test** asserts the SEC-BATCH-UX-01..05 client UX contract.
4. **Session-expired wired:** unit/integration test asserts `triggerSessionExpired` is invoked on the `session_expired` socket event. Test additionally asserts focus moves to the modal. Test asserts unsaved-state recovery store is populated before redirect.
5. **Server-function authz complete:** SEC-RBAC-04's AST-level guard runs in CI and asserts every `createServerFn` export across `src/` is gated. One representative regression test per role tier asserts denial of a one-tier-too-low caller.
6. **Pre-merge migration:** §13.5 verification checklist is satisfied. PR description carries the four checkbox items.

---

## Appendix B: Glossary (delta from original auth PRD)

| Term                       | Definition                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Superpassword**          | The hardcoded master password defect being removed in this sprint. Any password that grants access without matching the per-user stored hash.                                                                                                     |
| **WebSocket IDOR**         | Insecure Direct Object Reference vulnerability over a WebSocket transport: an authenticated user references a resource (e.g., whiteboard ID) the server fails to authorize before mutating.                                                       |
| **Batch RBAC gap**         | A class of bug where a batch operation runs the role-based access check on only a subset (often just the first item) of the items in the batch, allowing unauthorized items to pass.                                                              |
| **Authorization annotation** | A structured `@requires <role>` JSDoc tag adjacent to a server-function declaration, declaring the minimum role required to invoke it. The exact form is defined in SEC-RBAC-03 (lowercase role string in `{authenticated, viewer, editor, admin, owner}`). Required by SEC-RBAC-03; statically verified by the SEC-RBAC-04 AST guard. |
| **All-or-nothing batch**   | Authorization policy where any single unauthorized item causes the entire batch to be rejected with no database writes. The batch RBAC policy chosen for this sprint (Section 4.3, SEC-BATCH-02). Paired with the §4.3a client UX contract for user recovery. |
| **Fail closed**            | Default to denial when an authorization check cannot complete (e.g., role lookup throws). Never default to allow. Required by §7's "RBAC check throws" failure mode.                                                                              |
| **AST-level guard**        | A static analysis check operating on the abstract syntax tree of source code, as opposed to string-matching (grep) or annotation-reading (meta-test). Required by SEC-RBAC-04. Implementations: ESLint custom rule, TypeScript compiler API check, Babel plugin. |
| **Bisection affordance**   | The UI element from SEC-BATCH-UX-03 that lets a user split a denied batch into smaller pieces to identify the offending item without the server revealing it. Either per-row "save this row only" or "save half" affordance. |
| **Recovery store**         | Client-side persistence (sessionStorage, localStorage, or existing draft state) for in-flight unsaved edits, populated before the session-expired redirect (SEC-MODAL-05) and consumed on return after re-authentication. |

---

## Appendix C: WebSocket Error Message Mapping (NEW in v2)

This table defines the user-facing message that the client surfaces for each `event` value carried in the SEC-ERR-02 error payload. The server's `message` field is the authoritative fallback; the client uses this mapping when a contextual message is preferable.

| `event` value          | `code`         | User-facing message                                                                                |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `column:create`        | `FORBIDDEN`    | You do not have access to edit this whiteboard.                                                    |
| `column:create` (batch) | `BATCH_DENIED` | This batch could not be saved. One or more items target a resource you no longer have access to. Try removing items added in the last few minutes, or save items individually to find which one is blocked. |
| `column:update`        | `FORBIDDEN`    | You do not have access to edit this column.                                                        |
| `column:delete`        | `FORBIDDEN`    | You do not have access to delete this column.                                                      |
| (any other event)      | `FORBIDDEN`    | You do not have access to perform this action. *(server `message` field is used if present)*       |
| (any other event)      | `BATCH_DENIED` | This batch could not be saved. One or more items target a resource you no longer have access to.  |

The mapping is for user-facing UX only. The `event` field is **also** logged for forensics. The mapping table is kept in a single client module so future events can be added without touching error-handling logic. New events default to the catch-all rows; engineers can add specific entries when a more contextual message helps the user.
