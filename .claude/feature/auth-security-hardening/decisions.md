# Decisions Log — Auth Security Hardening

## Product Decisions (Athena — PRD Creation)

### D1: Frame as a security bug-fix sprint, not a feature

- **Decision:** Treat this as a P0 patch sprint with no new user-facing surface, not a "security hardening feature."
- **Rationale:** All five defects are concrete code-review findings with named symbols and file locations. They each violate guarantees the original auth PRD already promised. Inventing new requirements would be scope creep; the work is to restore behavior PR #97 already claimed.
- **Rejected:** "Comprehensive security overhaul" framing. Why: would invite scope drift into auth refactoring, password policy changes, 2FA, audit logging — none of which are needed to close the five defects.

### D2: Remove the superpassword with no replacement backdoor

- **Decision:** Delete the hardcoded password and add no admin-recovery / support-override mechanism in its place.
- **Rationale:** The original auth PRD already deferred password reset to a future iteration with the explicit workaround "manual DB-level password reset by administrator." Adding any new bypass mechanism in this sprint would re-introduce the same defect class under a different name.
- **Rejected:** "Add an admin-recovery override behind a feature flag." Why: feature flags are not a security boundary; defaults drift; reviewers (and the original code review) missed the existing backdoor, so a new one would likely also slip through.
- **Rejected:** "Add a setup-recovery endpoint that's only enabled before first user is registered." Why: not in scope for this sprint, and adds new code to audit at a moment when the goal is to remove unsafe code.

### D3: Batch column operations use all-or-nothing rejection, not partial-success

- **Decision:** If any item in a batch fails authorization, reject the entire batch with no database writes.
- **Rationale:** Two reasons. (a) Anti-enumeration: partial-success leaks which items the requester is/isn't authorized for. The original auth PRD's AUTH-PERM-03 already commits to anti-enumeration. (b) Simpler client UX: a single error is easier to handle than a partial-success response with per-item statuses.
- **Rejected:** "Partial success — write the authorized items, return per-item authorization errors for the rest." Why: leaks authorization-sensitive information about the unauthorized items (existence, project membership), and creates more client-side complexity. Can be revisited if user feedback demands it.

### D4: Authorization-error response does not identify the offending item

- **Decision:** When a batch is rejected for authorization reasons, the response says "batch rejected" without naming the item index.
- **Rationale:** Same anti-enumeration logic as D3. Knowing which item triggered the denial tells the requester something about resources they don't have access to.
- **Rejected:** "Return the offending item index so the client can highlight it in the UI." Why: information leak. UI can show a generic "your batch contains a resource you don't have access to" message.

### D5: Require an automated structural guard (SEC-RBAC-04), not just a one-time fix

- **Decision:** The fix to `src/lib/server-functions.ts` must come with a CI-enforced check (lint rule, test, or grep step) that catches any future server function added without an authorization annotation.
- **Rationale:** This defect already slipped past human code review once. The fix needs to be repeatable. Without a structural guard, the defect class returns the next time a server function is added under time pressure. OWASP consistently ranks broken access control as the #1 web app vulnerability for exactly this reason.
- **Rejected:** "Add the checks now and rely on code review going forward." Why: that's exactly what failed the first time. A machine-enforced rule is the only durable defense.
- **Open:** Engineering picks the form (ESLint rule vs. a meta-test that imports the module and asserts every export is annotated vs. a CI grep). PRD specifies _that_ a guard exists, not _how_.

### D6: Each fix requires a regression test that fails before and passes after

- **Decision:** Every defect (SEC-SP, SEC-WS, SEC-BATCH, SEC-MODAL, SEC-RBAC) has a corresponding test that proves the bug existed and is fixed.
- **Rationale:** Without a "fails before / passes after" test, we cannot prove the fix actually addresses the reported defect — we can only prove the new code compiles. The auth code review already showed that "looks plausible" is not the same as "actually correct."
- **Rejected:** "Manual verification suffices for visual fixes like the session-expired modal." Why: the modal wiring is exactly the kind of regression that disappears silently when the Socket.IO handler list is reorganized later. An automated test pinning the wiring is the only durable check.

### D7: Adopt a single canonical authorization-error contract (Section 4.6) across all five fixes

- **Decision:** All five fixes use the same HTTP 403 shape and the same WebSocket error event shape. If PR #97 already shipped a shape, reuse it; otherwise pick one and apply it everywhere.
- **Rationale:** Inconsistent error shapes are a perpetual source of client bugs and force the client to write multiple "is this an auth error?" code paths. One shape, one client handler, one user-facing message.
- **Rejected:** "Each fix invents whatever shape fits its context." Why: leads to inconsistent client UX and complicates future audit logging / monitoring.

### D8: Out-of-scope: auditing handlers/endpoints beyond the five named defects

- **Decision:** This sprint fixes the five named defects, not the broader class of "any other handler that might have similar bugs."
- **Rationale:** Scope discipline. Adding "audit everything" expands the sprint indefinitely and delays merging the actual fixes. The structural guard from D5 plus the explicit out-of-scope note in the PRD give engineering permission to file follow-ups for any adjacent gaps they spot without blocking this PR.
- **Note:** Hephaestus's tech spec for SEC-RBAC-04 should produce a one-time enumeration of handlers and server functions for the structural guard. That enumeration _may_ surface additional defects; if it does, this sprint should add them to scope rather than punt — but the PRD does not pre-commit to fixing what hasn't been found yet.

### D9: No telemetry/observability beyond a single WARN log entry on denied WebSocket attempts

- **Decision:** Only SEC-WS-03 requires logging (denied `column:create` attempts at WARN level with user ID, project ID, event name). No metrics dashboard, no audit trail, no alerting.
- **Rationale:** Audit logging is a separate future feature and would explode this sprint's scope. A single log line at the boundary is the minimum that lets a security reviewer grep for unauthorized attempts post-incident.
- **Rejected:** "Add a security audit log table that records every denial across HTTP and WebSocket." Why: out of scope for a bug-fix sprint, requires schema changes, and is a feature in its own right.

### D10: Session-expired modal wiring must be testable without spinning up a real Socket.IO server

- **Decision:** The regression test for SEC-MODAL-04 must work at the unit-test layer (mocking the Socket.IO client). An additional integration test against real loopback is "bonus."
- **Rationale:** Pre-existing test environment issue (jsdom not loaded for 166 component tests, per `feedback/project_test_env_issue.md`) means integration tests are flaky. A unit test that asserts "when this socket emits X, the trigger function is called" is reliable and fast.
- **Note:** This is a constraint on the testing approach, not a relaxation of the requirement. The wiring must work end-to-end in production; the test just doesn't have to prove that end-to-end on every CI run.

---

## Revision Requests

### Nemesis — 2026-05-09 — REVISIONS verdict (4 BLOCKING, 6 MAJOR, 7 MINOR)

See `prd-challenge.md` for full text. Summary of resolutions below in §"Athena Revision Decisions (v2)".

---

## Athena Revision Decisions (v2 — 2026-05-09)

### D11: Drop the "mutating" qualifier on SEC-RBAC-01

- **Decision:** SEC-RBAC-01 now requires every export in `src/lib/server-functions.ts` (read or write) to enforce auth, not just "mutating" ones.
- **Rationale:** Nemesis-BLOCKING-1 — "mutating" was undefined and load-bearing. Defining it precisely (writes to DB, calls another mutating fn, side-effecting socket emit) added complexity. Dropping it consolidates with SEC-RBAC-02 (which already required reads to enforce auth) and removes ambiguity. Read functions that leak data to non-permitted users are exactly the slipped defect class — there is no benefit to exempting them.
- **Rejected:** "Define 'mutating' precisely as any function calling Prisma's create/update/delete/upsert." Why: still leaves the read-leak class uncovered, and the precise definition is brittle (e.g., raw SQL, alternate ORM calls, transactional helpers).

### D12: Define the canonical batch-denial client UX contract in the PRD

- **Decision:** Added §4.3a (SEC-BATCH-UX-01..05) and expanded flow §5.3 to define: input preservation, the exact user-facing message text, a bisection affordance (save individually or save half), and a `BATCH_DENIED` code distinct from single-item `FORBIDDEN`.
- **Rationale:** Nemesis-BLOCKING-2 — the all-or-nothing security stance was correct but stranded users with no recovery path. The anti-enumeration property is preserved because bisection is client-side using the user's own input; the server never reveals item indices and per-item submissions return SEC-ERR-03–compliant indistinguishable responses.
- **Rejected:** "Show the offending item index for batches under 5 items." Why: still leaks resource information for small batches. The bisection affordance gives the user the same recovery without the leak.
- **Rejected:** "Auto-bisect on the client and only show the failing item." Why: under the hood this is identical to bisection, but the user has less control. Manual bisection lets the user remove the right item rather than auto-discarding.

### D13: SEC-RBAC-04 must be AST-level — meta-tests are explicitly insufficient

- **Decision:** SEC-RBAC-04 narrowed to require ESLint custom rule or AST-equivalent semantic analysis. Meta-tests reading annotation strings, CI grep, and manual review are explicitly listed as **rejected** forms.
- **Rationale:** Nemesis-BLOCKING-3 — a meta-test reading annotations cannot detect (a) new server-function files added outside `server-functions.ts`, (b) annotations that lie (`@requires editor` without a `hasMinimumRole` call), or (c) gutted wrappers (`withAuth(fn)` HOFs that no-op). The AST rule must inspect the actual handler-body call graph and detect new files across `src/`. SEC-RBAC-03 was tightened in lockstep to require the structured `@requires <role>` JSDoc form, giving the AST rule an unambiguous static target.
- **Rejected:** "ESLint rule for the canonical file plus a meta-test for the rest." Why: split rule, harder to reason about, and the meta-test still has all three weaknesses for files it covers.
- **Rejected:** "Allow CI grep as an acceptable form." Why: comments fool grep. SEC-RBAC-04 is the structural guard; it must operate at the same level the bug operates at (function-body call graph).

### D14: Add a pre-merge migration plan with a named owner (§13)

- **Decision:** Added §13 Pre-Merge Migration Plan requiring (a) named owner, (b) 7-day communication window, (c) a real-password-set path (Option A: time-bounded helper, removed before merge; or Option B: manual DB-set), (d) lockout-recovery via the existing manual DB-reset workaround, (e) verification checklist that gates the merge.
- **Rationale:** Nemesis-BLOCKING-4 — "communicate the removal" was too soft for a P0 sprint. Without an explicit owner and verification checklist, developers who only ever used the superpassword will be locked out the day the fix lands. The 7-day window plus pre-merge log verification ensures zero "still using superpassword" sessions at cutover.
- **Rejected:** "Build a real password-reset endpoint as part of this sprint." Why: out of scope for a bug-fix sprint, requires its own spec, and re-introduces the risk class (a recovery endpoint is itself a potential backdoor if not carefully designed). Defer to the future password-reset PRD.

### D15: Redefine the metric in §3 row 1 in terms of `verifyPassword` branches, not literal-string search

- **Decision:** §3 row 1 metric is now "number of branches in `verifyPassword` that return truthy without invoking `bcrypt.compare` against the stored hash." Verified at AST level.
- **Rationale:** Nemesis-MAJOR-1 — a literal-string `rg` search misses backdoors via env var, header, feature flag, or alternate verifier function. The metric is now grounded in the actual security property (every truthy return must flow through hash comparison), not a string match.
- **Rejected:** Keeping the rg-based metric and adding "and any env-var override." Why: still string-level; the AST-level definition is provably complete for the named function.

### D16: Hephaestus's enumeration is gating, not advisory

- **Decision:** §9 mitigation for "the five defects are the only defects" assumption now requires Hephaestus's enumeration to produce a written defect-list appendix to the tech spec, with each found defect triaged (in-scope / new-feature / accepted-risk) before Apollo (stage 7) can approve the spec.
- **Rationale:** Nemesis-MAJOR-2 — without explicit triage, the enumeration was a process gap: Hephaestus was required to enumerate but the response to findings was undefined. Now any sixth defect found gets a deliberate decision, not silent ignore.
- **Rejected:** "Auto-include any newly-found defect in this sprint's scope." Why: scope creep risk. Some findings may legitimately belong to a separate PRD; the triage step gives Athena/Apollo the choice.

### D17: SEC-ERR-02 `event` field is for both logging and user-facing customization, with a defined mapping

- **Decision:** SEC-ERR-02 uses the `event` field for **both** logging and user-facing message customization. Appendix C carries the canonical mapping table from `event` value to user-facing message. The server's `message` field is the authoritative fallback for unmapped events.
- **Rationale:** Nemesis-MAJOR-3 — leaving the `event` field's purpose ambiguous would force engineering to invent a contract during tech spec. Resolving here means a single consistent client handler with a deterministic mapping. The mapping is small enough to keep in the PRD and migrate as new events are added.
- **Rejected:** "`event` is for logging only; client always shows the generic message." Why: misses an opportunity to give users contextual feedback that already does not leak (the `event` is _what action they tried_, not _what resource they targeted_).

### D18: SEC-MODAL-05 — preserve unsaved whiteboard state through session-expired flow

- **Decision:** Added SEC-MODAL-05 requiring the client to persist in-flight edits to a recovery store before the session-expired modal redirects, and surface them on return after re-auth.
- **Rationale:** Nemesis-MAJOR-4 — the original auth PRD's flow 5.6 may or may not address this; the security-hardening PRD restates the modal behavior so it should restate (or explicitly resolve) unsaved-work handling. Losing unsaved edits on session expiry is a quality regression for users on long sessions.
- **Rejected:** "Defer to whatever the original auth PRD specified." Why: the original PRD's coverage is uncertain, and the cost of a small sessionStorage persistence is low. Specifying it explicitly here closes the gap unambiguously.

### D19: ERROR-log dedup/rate-limit on RBAC-check-throws path

- **Decision:** §7 row 4 now requires ERROR logs from the RBAC-throws branch to be sampled at one log line per `(userId, errorClass)` per 60-second window.
- **Rationale:** Nemesis-MAJOR-5 — without dedup, a transient DB outage produces a log explosion that hides the original cause. A simple sample-rate dedup (already supported by most loggers) prevents this without losing observability.
- **Rejected:** "Always log every throw at ERROR." Why: log explosion risk. The dedup keeps the signal without the flood.

### D20: SEC-MODAL-02 paired with an automated single-registration check

- **Decision:** SEC-MODAL-02 now requires an automated guard (test or AST-level lint rule) that asserts `session_expired` is registered in exactly one module. May share the SEC-RBAC-04 rule infrastructure.
- **Rationale:** Nemesis-MAJOR-6 — "code inspection" is a manual gate, the same defect class as the original SEC-RBAC-04 problem. Without a structural guard, a future developer adds a duplicate handler and silently breaks the contract.
- **Rejected:** "Just rely on SEC-MODAL-04's regression test." Why: the regression test asserts the wiring works, not that there is exactly one wiring. A duplicate handler could pass the regression test and still introduce a subtle ordering bug.

### D21: SEC-WS-03 add a per-user-per-event denial counter

- **Decision:** SEC-WS-03 keeps WARN-level logging for individual denials, **and** adds a per-user, per-event counter (or structured-log field) so flood-of-denials patterns are detectable post-hoc.
- **Rationale:** Nemesis-MINOR-1 — WARN level is correct for individual denials (they include benign races and stale UI), but a single denial logged at WARN is invisible at scale. A counter (not new metrics infra — a structured log field is sufficient) makes flood patterns aggregatable.
- **Rejected:** "Promote denial logs to ERROR if the same user fires more than N denials." Why: stateful logging is more complex than a counter; better to keep logging stateless and let aggregation/alerting layer handle thresholds.

### D22: Add the "deploy-time existing logged-in user" persona

- **Decision:** §2 adds a new primary persona for users with open WebSockets at deploy time, documenting their behavior and the deploy-window guidance.
- **Rationale:** Nemesis-MINOR-2 — this persona's experience matters and §7 row 6 covered the technical behavior but not the persona-level expectations.

### D23: Escalate the all-or-nothing batch UX risk to medium

- **Decision:** §9 row 3 risk grade escalated from low to medium. Mitigation expanded: §4.3a UX contract + non-blocking metric to detect regression in user productivity post-deploy.
- **Rationale:** Nemesis-MINOR-3 — agreed the security stance is right but the UX cost is real for users with stale UIs. Tracking the rate gives signal for a future revisit.

### D24: SEC-RBAC-03 fix the comment form to JSDoc `@requires <role>`

- **Decision:** SEC-RBAC-03 now requires JSDoc with structured `@requires <role>` tag, lowercase role string in the fixed set `{authenticated, viewer, editor, admin, owner}`.
- **Rationale:** Nemesis-MINOR-6 — "adjacent comment" was fuzzy. The AST rule from SEC-RBAC-04 needs an unambiguous static target. JSDoc with a structured tag is the most parseable form and integrates with existing tooling.

### D25: SEC-ERR-01 — Athena picks the canonical shape now

- **Decision:** SEC-ERR-01 picks `{ error: "FORBIDDEN", message: "You do not have access to this resource." }` as the canonical HTTP shape. Any PR #97 endpoints already shipped with a different shape are migrated to this one as part of this sprint's scope.
- **Rationale:** Nemesis-MINOR-7 — deferring "engineering picks one and uses it everywhere" was the PRD punting a decision. Athena's job is to make the call; the call is now made. The shape is the simplest one that meets all five fixes' needs.

### D26: SEC-MODAL-04 regression test asserts focus on modal mount

- **Decision:** SEC-MODAL-04 acceptance criteria now includes "test asserts focus moves to the modal (or first focusable element) when it renders."
- **Rationale:** Nemesis-MINOR-5 — without the focus assertion, screen-reader users may not realize the modal appeared. The original auth PRD covers the modal's accessibility but the regression test was not previously required to verify it.

---

## Architecture Review Notes (Apollo) — 2026-05-09

Verdict: **Sound** (no revision-blocking issues). The following implementation refinements are flagged for Ares to apply during the appropriate phase. None invalidates AD-1/AD-3/AD-7 design choices.

| Issue                                                                       | Severity | Rationale                                                                                                                                                                                                                        | Required Change                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getTableProjectId` throw bypasses `BatchDeniedError` translation in §3.5   | Medium   | SEC-ERR-03 anti-enumeration must hold for **all** failure modes (including DB-error throws), not just role-insufficient. A raw Prisma throw inside the per-item loop would propagate the tableId in the unhandled error message. | Phase 4.1: widen the existing `try { await requireServerFnRole(...) } catch (...)` block to wrap **both** `getTableProjectId(tableId)` and `requireServerFnRole(...)`. Translate any throw into `BatchDeniedError`; log raw error via `logSampledError`. |
| Dynamic `await import('@/lib/auth/require-role')` in §3.3                   | Medium   | Hot-path WS handler should not pay first-call import cost; obscures dep graph for the SEC-RBAC-04 ESLint rule itself. No circular-dep justification given.                                                                       | Phase 2.1: use `import { requireRole } from '@/lib/auth/require-role'` at top of `collaboration.ts`. Match the existing static-import pattern for `findEffectiveRole` etc.                                                                               |
| `requireRole` socket parameter typed structurally with `any` payload (§3.1) | Medium   | SEC-WS-02 single-source-of-truth is undermined when the helper accepts a structural shim. SEC-ERR-02 canonical shape is not type-enforced.                                                                                       | Phase 1.2: type `socket` parameter as `Socket` from `socket.io` (or a narrow `AuthorizedSocket` interface). Type the `emit` argument so passing a non-`WSAuthErrorPayload` for the `'error'` event is a compile error.                                   |
| `lastLogAt` and `denialCounter` Maps have no eviction (§3.1, §3.2)          | Low      | Slow memory growth proportional to `(userId, errorClass)` cardinality. Bounded in practice; process restarts mask it.                                                                                                            | Optional: add a watermark check (e.g., evict entries older than `2 * WINDOW_MS` when Map size exceeds 10k). If deferred, document as accepted-risk in §8 Risks.                                                                                          |
| Two error shapes coexist (AD-5, locked) creates known migration debt        | Low      | Locked decision; bounded scope. The 12 ad-hoc legacy shapes in `collaboration.ts` remain.                                                                                                                                        | Action: file a follow-up issue ("Migrate remaining 12 legacy WS error shapes to canonical SEC-ERR-02") once this sprint merges. Add a single sentence to spec §8 Risks naming the follow-up.                                                             |
| §3.7 prose says "three call sites" but lists four                           | Minor    | Verified in codebase: there are 5 callers of `useCollaboration`; 4 need updating; the 5th (`use-whiteboard-collaboration.ts`) already passes `triggerSessionExpired`.                                                            | Phase 5.2: update 4 call sites (the bullet list is correct). Optional: reconcile spec prose if revisited.                                                                                                                                                |
| §2.2 `auth.ts` createServerFn count is 4, not 5                             | Minor    | Verified: registerUser, loginUser, logoutUser, getCurrentUser. The 4 names listed in spec are correct; the count is wrong.                                                                                                       | No code change. Counting fix only if spec is revised. Disposition (accepted-risk via `@requires unauthenticated`/`@requires authenticated`) stands.                                                                                                      |
| §2.2 `auth.test.ts` row claims 2 `createServerFn` exports                   | Minor    | Verified: zero. Test file exercises handler logic directly.                                                                                                                                                                      | No code change. Disposition ("outside lint scope") still correct.                                                                                                                                                                                        |

**§2.5 defect-enumeration sign-off:** Cleared by Apollo. 13 WebSocket handlers + ~83 server-function exports (corrected from 85) in-scope under AD-1. Zero new defects. ~16 accepted-risk demo/test/auth files documented.

---

## Final Resolution

<!-- Athena updates this after all reviews are resolved -->

---

### PRD Alignment (Hera) — 2026-05-09 (Run 1)

Verdict: GAPS. Coverage 73% (22/30). Returning to stage 9 (Ares).

| Criterion               | Status | Gap                                                                                                                              |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| AC-13 (SEC-BATCH-UX-01) | gaps   | No batch column UI component exists; TC-BUX-01 not written                                                                       |
| AC-14 (SEC-BATCH-UX-02) | gaps   | No batch column UI component exists; TC-BUX-02 not written                                                                       |
| AC-15 (SEC-BATCH-UX-03) | gaps   | No bisection affordance in any UI component; TC-BUX-03/04 not written                                                            |
| AC-17 (SEC-BATCH-UX-05) | gaps   | Component regression test (TC-BUX-01..05) not written — no UI component to test                                                  |
| AC-18 (SEC-MODAL-01)    | gaps   | TC-MODAL-01 passes but mocks useCollaboration entirely; else branch only asserts mockFn is defined — not a valid regression test |
| AC-20 (SEC-MODAL-03)    | gaps   | TC-HTTP401-01 and TC-HTTP401-02 not written; HTTP 401 path to triggerSessionExpired untested                                     |
| AC-21 (SEC-MODAL-04)    | gaps   | TC-MODAL-02 (focus moves to modal on render) not written                                                                         |
| AC-22 (SEC-MODAL-05)    | gaps   | TC-MODAL-05 and TC-DRAFT-01..05 not written; useColumnDraftPersistence hook exists but not wired to any UI                       |

---

### PRD Alignment (Hera) — 2026-05-09 (Run 2)

Verdict: GAPS. Coverage 97% (29/30). Returning to stage 9 (Ares). One criterion remains.

| Criterion            | Status | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-20 (SEC-MODAL-03) | gaps   | HTTP 401 → triggerSessionExpired path not implemented. root-provider.tsx explicitly notes the architectural limitation (AuthContext cannot reach the QueryClient level). TC-HTTP401-01/02 pass by calling onSessionExpired() directly — they do not test any HTTP interceptor. The implementation diverges from PRD: HTTP 401s redirect to /login instead of showing SessionExpiredModal. Ares must implement the interceptor or escalate for PRD-owner scope decision. |

---

## Revision Requests

### Code Review (Hermes) — 2026-05-09

| Finding                                                                                             | Tier         | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Required Fix                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/integrations/tanstack-query/root-provider.tsx:7-21 — HTTP 401 interceptor unreachable           | Tier 1       | requireAuth (middleware.ts:44) returns `{error:'UNAUTHORIZED', status:401}` as a resolved value, not a thrown error. QueryCache/MutationCache.onError fires only on rejection — so dispatchUnauthorized() never runs and triggerSessionExpired() is never called from HTTP. AC-20 unfulfilled in production despite TC-HTTP401-01/02 passing (those tests dispatch the event directly on httpAuthEvents and never exercise a real round-trip). Existing client code at ProjectTree.tsx:138, CreateWhiteboardDialog.tsx:44, etc. confirms callers explicitly check `isUnauthorizedError(result)` after a successful await. | Either (a) make requireAuth throw an UnauthorizedError and update ~8 call sites that use isUnauthorizedError(result) to use try/catch, or (b) install a select/onSuccess hook (or a createServerFn wrapper) that inspects resolved values for isUnauthorizedError and dispatches HTTP_UNAUTHORIZED. Add a test that mounts a real useQuery whose queryFn resolves to `{error:'UNAUTHORIZED', status:401}` and asserts the listener fires. |
| src/lib/auth/require-role.ts:59 + src/lib/auth/log-sample.ts:6 — Two Maps grow unboundedly          | Tier 8 (M10) | denialCounter and lastLogAt accumulate one entry per unique (userId,event) and (userId,errorClass) pair forever. On a long-running server this is a slow memory leak with no eviction. The PRD description ("structured-log field, no metrics infra required") confirms these are not intended as durable state.                                                                                                                                                                                                                                                                                                          | Add LRU cap (e.g. 10k entries) or a periodic setInterval cleanup that prunes entries older than the relevant window (60s for lastLogAt; e.g. 24h for denialCounter). Add a test that inserts N+1 entries and asserts the oldest is evicted.                                                                                                                                                                                               |
| src/components/whiteboard/BatchColumnForm.tsx:172-365 — Inline styles violate project UI convention | Tier 5       | CLAUDE.md mandates "ONLY shadcn/ui and TailwindCSS for UI" and explicitly forbids alternate UI libraries. Every button, input, select, banner, and form container in the new component uses `style={{...}}` props with hardcoded colors and pixel paddings — bypassing both shadcn primitives and Tailwind utilities. Inconsistent with the rest of src/components/whiteboard/.                                                                                                                                                                                                                                           | Rewrite using Button (variants default/outline/ghost/destructive), Input, Select, Alert (variant="destructive"), and Form/FormField. Replace inline color literals (#dc2626, #6366f1, #999) with semantic Tailwind tokens (text-destructive, border-destructive, bg-primary). Drop all `style={{...}}` attributes.                                                                                                                        |
