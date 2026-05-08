# PRD Adversarial Review -- Account Authentication (Re-Review)

## Reviewer

Nemesis (Devil's Advocate + User Advocate) -- 2026-04-03

## Verdict: APPROVED

## Executive Summary

The revised PRD (v2) has resolved all 5 blocking and 8 major issues from the initial review. The email enumeration contradiction is gone, WebSocket authentication has full acceptance criteria (AUTH-GUARD-04), password max length is defined, session expiry recovery is concrete (flow 5.6), and permission revocation has explicit UX (AUTH-PERM-05). Groups are cleanly deferred, rate limiting is in scope, and the Role Capabilities table eliminates role ambiguity. Two minor issues remain: one around the anti-enumeration UX trade-off and one around the rate limiting scope boundary. Neither blocks implementation.

---

## Previous Findings -- Resolution Verification

### BLOCKING Issues (all resolved)

| ID    | Issue                                                             | Status   | Verification                                                                                                                                                                                                                                                                                                                                                     |
| ----- | ----------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DA-B1 | Email enumeration contradiction between AUTH-REG-03 and Section 7 | RESOLVED | AUTH-REG-03 now specifies: duplicate email returns "Registration successful. Please log in." and redirects to /login. Section 7 mirrors this exactly. Consistent anti-enumeration throughout.                                                                                                                                                                    |
| DA-B2 | WebSocket authentication unspecified                              | RESOLVED | AUTH-GUARD-04 added with full acceptance criteria: handshake authentication via session cookie, rejection of invalid sessions, session expiry on active connections via "session_expired" event, client-side handling mirrors HTTP 401. Section 7 adds three WebSocket failure modes. Section 11 details Socket.IO impact including permission checks on events. |
| DA-B3 | No maximum password length                                        | RESOLVED | AUTH-REG-03 now specifies "8-128 characters." Section 10 explains the bcrypt 72-byte truncation risk. Section 6 In Scope confirms the range.                                                                                                                                                                                                                     |
| UA-B1 | Session expiry during editing has no recovery path                | RESOLVED | Flow 5.6 is comprehensive: URL preserved via redirect param, local React state held in memory (best-effort, explicitly documented as lossy if browser closes), WebSocket reconnects after re-login, server state is authoritative, conflicting local changes are lost. This is implementable without guessing.                                                   |
| UA-B2 | Permission revocation has no UX                                   | RESOLVED | AUTH-PERM-05 specifies: message "Your access to this project has been removed," redirect to project list within 5 seconds, WebSocket "permission_revoked" event, next-request enforcement. Flow 5.5 step 6 mirrors this.                                                                                                                                         |

### MAJOR Issues (all resolved)

| ID    | Issue                                   | Status   | Verification                                                                                                                                                                                                            |
| ----- | --------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DA-M1 | Groups scope drift                      | RESOLVED | Section 4.5 explicitly defers groups to a separate iteration with clear rationale. Data model note preserves future extensibility. Out of Scope section confirms.                                                       |
| DA-M2 | "Full control" undefined for roles      | RESOLVED | Role Capabilities table in Section 4.4 enumerates 7 specific capabilities across owner/admin/editor/viewer. Key distinction: only owner can remove/demote admins. Transfer ownership marked as future.                  |
| DA-M3 | CollaborationSession userId assumption  | RESOLVED | Section 1 rephrased to factual: "stores a `userId` field as a placeholder string that will need to be converted to a proper foreign key." No longer asserts design intent.                                              |
| DA-M4 | Vague registration success metric       | RESOLVED | Metric redefined to "0 system-caused registration failures (5xx errors, transaction failures)" with "per deployment period" as the measurement window. Measures system reliability, not user input quality.             |
| DA-M5 | Rate limiting out of scope              | RESOLVED | Promoted to In Scope: "5 consecutive failed login attempts for the same email, lock that account for 15 minutes." Failure mode added for account lockout. Assumption added for risk acceptance of the chosen threshold. |
| UA-M1 | Permission UI discoverability           | RESOLVED | Flow 5.5 step 1 specifies "Share button (or settings icon) visible on the project header or project list item" as the entry point.                                                                                      |
| UA-M2 | First-time user / fresh install persona | RESOLVED | Tertiary persona added: "First-Time User on a Fresh Installation." Flow 5.8 defines two empty states: fresh installation and no-permissions.                                                                            |
| UA-M3 | Forgotten password persona              | RESOLVED | Tertiary persona added: "User Who Has Forgotten Their Password." Workaround documented: manual DB-level reset by administrator. Section 7 failure mode confirms.                                                        |

### MINOR Issues (all resolved)

| ID    | Issue                               | Status   | Verification                                                                                                                                                                         |
| ----- | ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UA-M4 | Empty state for no-permission users | RESOLVED | Flow 5.8 defines specific message: "You don't have any projects yet. Create a new project or ask a teammate to share one with you."                                                  |
| UA-M5 | Login/register cross-linking        | RESOLVED | AUTH-REG-01 specifies "Already have an account? Log in" link. AUTH-LOGIN-01 specifies "Don't have an account? Register" link. Flow 5.1 confirms /login is the default redirect.      |
| UA-m1 | Accessibility gaps                  | RESOLVED | Section 12 added with WCAG 2.1 AA requirements: label associations, aria-live error announcements, focus management, keyboard navigation, loading state aria-busy, modal focus trap. |
| UA-m2 | Loading states on auth forms        | RESOLVED | AUTH-LOGIN-06 added. Flows 5.2 and 5.3 both mention loading state and disabled submit button.                                                                                        |
| DA-m1 | Hash timing not in requirements     | RESOLVED | Section 6 In Scope includes "target 200-500ms hash computation time."                                                                                                                |
| DA-m2 | Setup wizard scope ambiguity        | RESOLVED | "Setup wizard or admin seed script for first-user bootstrapping" added to Out of Scope.                                                                                              |

---

## New Findings from Re-Review

### Devil's Advocate Findings

#### BLOCKING

None.

#### MAJOR

None.

#### MINOR

**DA-m1-v2: [ASSUMPTION] Anti-enumeration on registration creates a UX friction gap [AUTH-REG-03, Flow 5.2]**

- The anti-enumeration approach returns "Registration successful. Please log in." for duplicate emails, then redirects to /login. A user who accidentally uses an existing email gets a success message, goes to /login, tries to log in with whatever password they just typed (which is not their real password), and gets "Invalid email or password." They may not realize they already have an account. This is a known trade-off of anti-enumeration, and the PRD has chosen security over UX here, which is a valid decision. However, this friction path is not acknowledged in the user flows or failure modes.
- Risk: Low. LAN users likely know each other and can resolve confusion quickly.
- Suggested improvement (non-blocking): Add a brief note in Section 7 failure modes acknowledging this UX friction as an accepted trade-off of anti-enumeration.

**DA-m2-v2: [VAGUE_TERM] Rate limiting scope boundary is slightly ambiguous [Section 6, In Scope]**

- "5 consecutive failed login attempts for the same email" -- does "consecutive" mean the counter resets on a successful login? What if the account is locked and the user tries again during the lockout -- does that extend the lockout or is it a fixed 15-minute window from the 5th failure? The failure mode says "automatically expires after 15 minutes" which implies a fixed window, but the interaction between lockout and additional attempts is not stated.
- Risk: Low. Engineering can make a reasonable default (fixed window, counter resets on success).
- Suggested improvement (non-blocking): Clarify in the acceptance criteria or failure mode that the lockout is a fixed 15-minute window from the 5th consecutive failure, and that the counter resets after a successful login.

---

### User Advocate Findings

#### BLOCKING

None.

#### MAJOR

None.

#### MINOR

**UA-m1-v2: [UX_CLARITY] Registration anti-enumeration redirect flow may confuse users [Flow 5.2, step 6]**

- Same finding as DA-m1-v2 from the user perspective. A user who tries to register with an email they already used will be told "Registration successful. Please log in." and sent to /login. They will then fail to log in because the password they just chose is not the password on the existing account. The failure message "Invalid email or password" gives no hint that they already have an account.
- This is an inherent trade-off of anti-enumeration that the PRD has deliberately chosen. Documenting it as an accepted trade-off is sufficient. No design change needed.

**UA-m2-v2: [MISSING_JOURNEY_STAGE] "Share" button placement is described but visual distinction of shared vs. private projects is not [Flow 5.5]**

- Flow 5.5 describes the Share button entry point, which resolves the original discoverability issue. However, there is no mention of how the project list visually indicates whether a project is shared with others or is private. For a project owner managing multiple projects, knowing at a glance which projects are shared is useful.
- Risk: Low. This is a polish item that can be addressed during implementation or a future iteration.
- Suggested improvement (non-blocking): Consider a visual indicator on the project list item (e.g., a people icon or shared badge) to distinguish shared from private projects.

---

## Score

| Category                    | Count |
| --------------------------- | ----- |
| Unvalidated assumptions     | 0     |
| Vague metrics               | 0     |
| Scope drift                 | 0     |
| Missing failure modes       | 0     |
| Missing error states        | 0     |
| Missing personas            | 0     |
| Vague language / UX clarity | 2     |
| Accessibility gaps          | 0     |
| **Total**                   | **2** |

## Previous Review Comparison

| Severity  | Previous | Current |
| --------- | -------- | ------- |
| BLOCKING  | 5        | 0       |
| MAJOR     | 8        | 0       |
| MINOR     | 4        | 4       |
| **Total** | **17**   | **4**   |

All 4 remaining findings are MINOR and informational. None require resolution before proceeding to tech spec.
