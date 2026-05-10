# PRD Adversarial Review — Auth Security Hardening

## Reviewer

Nemesis (Devil's Advocate + User Advocate) — 2026-05-09

## Verdict: REVISIONS

verdict: revisions

## Executive Summary

PRD is unusually disciplined for a security bug-fix sprint — anti-enumeration stance, fail-closed defaults, structural guard requirement, and per-fix regression tests are all well-stated. However, three pressure-test items raised by Athena resolve as follows: (a) **all-or-nothing batch** policy needs an explicit client UX contract before it ships — the PRD currently does not specify what the client shows the user, raising risk of opaque "your batch failed" toasts that strand work; (b) **SEC-RBAC-04** as written allows a meta-test, but a meta-test alone is insufficient because it cannot detect new server-function files added outside `server-functions.ts` or wrappers that pass-through without checking — an ESLint-or-equivalent static guard is the only durable form, and the PRD should narrow the acceptable forms; (c) **SEC-WS-03 WARN log** is correctly graded — denied attempts can be benign (race conditions, stale UI), so WARN is appropriate, but the PRD should require a **rate-based escalation** signal so a flood of denials surfaces. Beyond the three pressure-tests, there are gaps in batch-failure user recovery, undefined behavior for the developer who is currently locked out post-superpassword-removal, and missing definition of "mutating" that SEC-RBAC-01 hinges on.

## Findings

### BLOCKING

- `[VAGUE_TERM]` Section 4.5 SEC-RBAC-01 — "Every **mutating** server function" — the term "mutating" is undefined and load-bearing. A function that calls `findEffectiveRole` for read but not write will pass review trivially while still leaking data. Define mutating precisely (writes to DB, calls another mutating function, or any side effect including socket emit) **or** drop the qualifier entirely and require RBAC on every export. Recommended fix: drop "mutating" — every server function in the file gets a check or an explicit `// Requires: authenticated` annotation. SEC-RBAC-02 already requires this for reads; consolidating removes the ambiguity.

- `[MISSING_ERROR_STATE]` Section 4.3 SEC-BATCH-02 + Section 5.3 — All-or-nothing batch rejection has no client UX contract. Flow 5.3 ends at "server returns canonical authorization-error response without identifying which item failed." That leaves the client with one error and N items the user just spent time configuring. The PRD must specify: (a) does the client preserve the user's batch input so they can retry without re-entering data? (b) what is the user-facing message — "your batch contains a resource you don't have access to" per D4 is a _generic_ message that does not tell the user what to _do_. (c) is there a recovery path that lets the user identify the offending item themselves (e.g., retry with smaller batches)? Without this contract, the anti-enumeration stance is correct but the resulting UX strands users with no path forward. Pressure-test item (a) — partial answer: anti-enumeration is the right policy, but it requires a complementary user-side recovery strategy that this PRD does not yet contain.

- `[UNTESTABLE_AC]` Section 4.5 SEC-RBAC-04 — "A linter rule, **test**, or CI check exists" allows a meta-test (option b) as sufficient. Pressure-test item (b) — a meta-test that imports `server-functions.ts` and checks every export has a marker is insufficient for three reasons: (1) it does not catch new server-function files added elsewhere (e.g., a future `src/lib/admin-functions.ts`); (2) it relies on the marker being honest — a developer can add the annotation `// Requires: Editor` without actually invoking `hasMinimumRole`; (3) it does not catch wrappers that no-op (a `withAuth(fn)` HOF that's been gutted). The only form that catches all three is a static-analysis rule (ESLint custom rule or equivalent AST check) that asserts the actual call to `hasMinimumRole` (or its middleware) reaches the function body. Required fix: narrow SEC-RBAC-04 to require **either** an ESLint custom rule that AST-verifies the permission call **or** a CI check that has equivalent semantic strength. A pure meta-test that reads annotations is explicitly insufficient.

- `[MISSING_FAILURE_MODE]` Section 7 — Missing failure mode: "Developer who legitimately authenticated via superpassword during PR #97 development cannot log in post-fix and has no real password set." The "Failure Modes" table line for this scenario says they should use the manual DB-reset workaround, but the PRD does not specify (i) who is responsible for communicating the removal pre-merge so developers can set real passwords first, (ii) whether a pre-removal one-time password-set step is required for affected accounts, (iii) what happens if the user discovers the lockout in production after merge. For a P0 sprint, "communicate the removal" (Section 9 mitigation) is too soft — needs an explicit pre-merge action item with an owner.

### MAJOR

- `[VAGUE_METRIC]` Section 3 row 1 — "Number of code paths that accept a password not derived from the per-user stored hash" with target 0 — "code paths" is not measurable without a defined enumeration method. Is this rg-grep based, manual review, or AST-based? The repo-wide search in SEC-SP-01 covers a literal-string match, but a code path could accept a non-hash-derived password via env var, header, or feature flag (which SEC-SP-01 acknowledges) without containing the literal. Define the measurement: the metric should be "any branch in `verifyPassword` (or equivalent) that returns true without invoking `bcrypt.compare` (or equivalent) against the stored hash" — not a string search.

- `[ASSUMPTION]` Section 9 row 1 — "The five defects are the only security defects in PR #97" labeled high risk. The mitigation ("Hephaestus's tech spec for SEC-RBAC-04 should include a one-time enumeration of all WebSocket handlers and all server functions") is good but unverified — the PRD does not require Hephaestus to actually report findings from that enumeration back to Athena/Apollo. If Hephaestus enumerates and finds defect #6, what happens? D8 says "this sprint should add them to scope rather than punt — but the PRD does not pre-commit to fixing what hasn't been found yet." This creates a process gap: the enumeration is required, but the response to it is undefined. Required fix: add an explicit step — Hephaestus's enumeration produces a written "defect list" appendix to the tech spec, and any defect found goes through a triage decision (in-scope / new-feature / accepted-risk) before tech spec is approved.

- `[UX_CLARITY]` Section 4.6 SEC-ERR-02 — WebSocket error event includes `event: "<original_event_name>"` so the client can map back to the action that was denied. But the PRD does not specify what the client should _do_ with that mapping. Is the toast generic ("you don't have access") or contextual ("you don't have access to create columns on this whiteboard")? The latter leaks slightly less than per-item batch errors but still tells the user the action category. The PRD should resolve: original event name in the response is for _logging_ only, or also for _user-facing message customization_. If the latter, define the exact mapping table.

- `[MISSING_ERROR_STATE]` Section 4.4 SEC-MODAL-01 — "redirects to `/login` with a `redirect` query parameter set to the current URL" — the current URL may contain unsaved whiteboard state (e.g., a user mid-edit on a column they just added). Flow 5.1 step 6 says "standard re-auth flow proceeds" but does not specify whether the client persists in-flight edits before the modal redirects. Without this, users lose work on session expiry. The original auth PRD's flow 5.6 may cover this, but this PRD restates the modal behavior and so should restate (or explicitly defer to) the unsaved-work handling.

- `[VAGUE_TERM]` Section 7 row 4 — "RBAC check throws (e.g., database unreachable while resolving role)" — "treat as denial" is correct, but "logs at ERROR level" leaves observability incomplete. If the database is unreachable, _every_ request fails closed and floods the logs. Need a rate-limit / dedup strategy for ERROR logs in the throw case, otherwise a transient DB outage produces a log explosion that hides the original cause. Recommended: log at ERROR with a circuit-breaker or sample once per N seconds per user/error-type.

- `[UNTESTABLE_AC]` Section 4.4 SEC-MODAL-02 — "Code inspection shows there is one place that registers Socket.IO event handlers" — "code inspection" is a manual gate. Pair with an automated check: a test or lint rule that asserts only one module registers `session_expired`. This is the same defect class as SEC-RBAC-04 — without a structural guard, a future developer adds a duplicate handler and silently breaks the contract.

### MINOR

- `[VAGUE_TERM]` Section 4.2 SEC-WS-03 — "WARN level" with "user ID, project ID, and event name" — re Athena's pressure-test item (c), WARN is correct because (i) denied attempts are not always malicious (race conditions where permission was just revoked, stale client UI), (ii) ERROR should be reserved for system failures the operator must act on. However, a single denial logged at WARN is invisible at scale. The PRD should add: "and a counter/metric is incremented so that a flood of denials from one user or one project is detectable post-hoc." The WARN log line is for forensic grep; the counter is for alerting. This is a MINOR add because D9 explicitly defers metrics, but a single counter is a small enough scope to include.

- `[MISSING_PERSONA]` Section 2 — Missing persona: **Existing logged-in user with an open WebSocket at the moment the fix is deployed**. They will receive whatever the new error contract is (SEC-ERR-02). Section 7 row 6 says "the client must not crash on the new error event" but does not address what happens to their in-flight actions during the deployment window. Acceptable (failure mode is captured) but worth restating in the Persona section.

- `[ASSUMPTION]` Section 9 row 3 — "The all-or-nothing batch policy is preferable to partial-success" labeled low risk. Disagree on the risk grade. If users routinely submit batches of 10+ columns and one is unauthorized due to a stale UI (e.g., they were just removed from a project), the entire batch fails. They cannot tell which item to remove. Rebuilding the batch by bisection is tedious. This is _medium_ risk for product quality, even if the security stance is right. Mitigation should be stronger than "revisit if user feedback demands it" — should be "track batch-failure rate as a non-blocking metric so regression in user productivity is visible."

- `[UX_CLARITY]` Section 5.2 step 5 — "Client receives the error and shows the standard 'you do not have access' toast/message." The "standard" message is not defined here or referenced from elsewhere. Either define it inline or reference where in the original auth PRD it lives.

- `[ACCESSIBILITY_GAP]` Section 12 — defers to original auth PRD's modal accessibility guarantees. Acceptable, but worth verifying in SEC-MODAL-04 that the regression test asserts focus moves to the modal when it renders (otherwise screen-reader users may not realize the modal appeared).

- `[VAGUE_TERM]` Section 4.5 SEC-RBAC-03 — "Documentation comments adjacent to the function signature" — "adjacent" is fuzzy. JSDoc, single-line comment, decorator? Pick one to make SEC-RBAC-04's static check unambiguous.

- `[CIRCULAR]` Section 4.6 SEC-ERR-01 — "(or the existing equivalent already shipped in PR #97 — engineering should pick one and use it everywhere)" — defining the canonical contract as "whatever shipped, plus consistency" defers the decision to engineering. Athena should resolve before tech spec: which shape is canonical? The PRD's job is to make the call, not punt it. (Marked MINOR because the consistency requirement is the load-bearing part and is enforced.)

## Score

BLOCKING: 4 | MAJOR: 6 | MINOR: 7 | Total: 17

## If REVISIONS: Required Changes

1. **SEC-RBAC-01** — Define "mutating" precisely or drop the qualifier. Recommend dropping it: every export in `server-functions.ts` gets a check or an `// Requires: authenticated` annotation.

2. **SEC-BATCH-02 / Flow 5.3** — Add a client UX contract for all-or-nothing batch rejection: (a) batch input is preserved so user can retry, (b) user-facing message specifies what category of action failed (without leaking item identity), (c) document the recovery path (e.g., retry smaller subsets).

3. **SEC-RBAC-04** — Narrow acceptable forms. Pure meta-test that reads annotation strings is insufficient. Require an AST-based rule (ESLint custom rule or equivalent semantic check) that confirms the permission call reaches the function body. A meta-test alone is **rejected**.

4. **Section 7 / Failure Modes** — Add a pre-merge owner and action item for communicating superpassword removal to developers who relied on it, with a defined window for them to set real passwords before the fix lands.

5. **Section 3 row 1 metric** — Redefine "code paths that accept a password not derived from the per-user stored hash" in terms of branches in `verifyPassword`, not literal-string search.

6. **Section 9 row 1 mitigation** — Make Hephaestus's enumeration produce a written defect-list appendix to the tech spec, with explicit triage outcomes for any defect found beyond the five.

7. **SEC-ERR-02** — Resolve whether `event` field in the WebSocket error is for logging only or for user-facing message customization. If the latter, define the mapping.

8. **Flow 5.1 / SEC-MODAL-01** — Specify whether unsaved whiteboard state is preserved through the session-expired-modal redirect. Either define here or explicitly defer to the original auth PRD.

9. **Section 7 row 4** — Add a rate-limit / dedup strategy for ERROR logs when RBAC check throws, to avoid log explosions during DB outages.

10. **SEC-MODAL-02** — Pair "code inspection" with an automated check (lint or test) that asserts a single registration site for `session_expired`.

11. **SEC-WS-03** — Add a counter/metric increment alongside the WARN log so denial floods are detectable. WARN level itself is correct (denials are not by definition system errors; they include benign races and stale UI). Pressure-test item (c): WARN is graded correctly; the gap is the missing aggregate signal.

12. **SEC-ERR-01** — Athena picks the canonical HTTP error shape now rather than deferring "engineering picks." The PRD's job is to make the decision.

13. **SEC-RBAC-03** — Specify the comment/annotation form (JSDoc, single-line, decorator) so SEC-RBAC-04's static check has an unambiguous target.

---

# Re-Review (v2.0) — 2026-05-09

## Reviewer

Nemesis (Devil's Advocate + User Advocate) — re-review of prd.md v2.0

## Verdict: APPROVED

verdict: approved

## Executive Summary

PRD v2.0 resolves all 4 BLOCKING findings and all 6 MAJOR findings from the v1 review. The "mutating" qualifier is dropped (every export is gated). §4.3a establishes an explicit client UX contract for batch denial with input preservation, action-specific messaging, and a client-side bisection affordance — the anti-enumeration policy now ships with a real user-recovery path. SEC-RBAC-04 is narrowed to AST-level static analysis with explicit rejection of meta-tests/grep/manual review and three named duties (new-file detection, handler-body inspection, gutted-wrapper detection). §13 establishes a pre-merge migration plan with named owner role, 7-day comms window, two implementation options, and a verification checklist. Residual gaps are MINOR-grade at most and do not block tech-spec progression.

## Verification of v1 BLOCKING Findings

| v1 Finding                                   | Resolution in v2                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| BLOCKING-1: SEC-RBAC-01 "mutating" undefined | §4.5 terminology note explicitly drops the qualifier. Every `createServerFn` export must call permission helpers, be wrapped by middleware that does, or carry `@requires authenticated` JSDoc. SEC-RBAC-01 acceptance criteria says "Each one either (a) calls the permission helpers explicitly... (b) is composed with a middleware/wrapper that does, or (c) carries the explicit JSDoc annotation."                                                                      | RESOLVED |
| BLOCKING-2: Batch UX contract missing        | §4.3a added with SEC-BATCH-UX-01..05: input preservation, action-specific message without leaking item identity, bisection affordance (per-row save or save-half), distinct `BATCH_DENIED` code, regression test. §5.3 rewritten with the full recovery flow. Information-leak audit included to prove the bisection preserves anti-enumeration.                                                                                                                              | RESOLVED |
| BLOCKING-3: SEC-RBAC-04 must be AST-level    | SEC-RBAC-04 now requires "an ESLint custom rule (or equivalent AST-based static analysis tool — TypeScript compiler API check, or Babel plugin)" with three explicit duties: (1) detect new `createServerFn` exports across `src/`, not just `server-functions.ts`; (2) inspect handler body to confirm permission call reaches DB call; (3) catch gutted wrappers. "Explicitly rejected forms" line names meta-tests reading annotation strings, CI grep, and manual review. | RESOLVED |
| BLOCKING-4: Pre-merge migration plan         | §13 added with five subsections: 13.1 owner role and four named responsibilities; 13.2 communication channel/subject/content with 7 calendar-day minimum window; 13.3 two implementation options (time-bounded helper or manual DB-set), both must be removed before merge; 13.4 post-merge lockout recovery; 13.5 verification checklist with four checkboxes that gate the PR.                                                                                              | RESOLVED |

## Verification of v1 MAJOR Findings

| v1 Finding                                          | Resolution in v2                                                                                                                                                                                                                                               | Status   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| §3 row 1 metric: "code paths" undefined             | §3 row 1 redefined as "branches in `verifyPassword` that can return `true` without invoking `bcrypt.compare`." Methodology note added: AST inspection, not literal-string `rg`.                                                                                | RESOLVED |
| §9 row 1: Hephaestus enumeration unbounded response | §9 mitigation now requires written defect-list appendix to tech spec. Each new defect triaged as in-scope / new-feature / accepted-risk. Apollo gates tech-spec approval on triage completion. §7 adds explicit failure-mode row for the discovery case.       | RESOLVED |
| SEC-ERR-02: `event` field purpose unclear           | SEC-ERR-02 explicitly names "both logging and user-facing message customization." Appendix C added with full mapping table from `event` value + `code` to user-facing string. Server's `message` field is authoritative fallback.                              | RESOLVED |
| SEC-MODAL-01 / Flow 5.1: unsaved state              | SEC-MODAL-05 added requiring persistence to recovery store before redirect. Flow 5.1 step 4 expanded: "Before the modal mounts, the client persists in-flight unsaved edits to the recovery store." Step 8 surfaces edits with apply/discard prompt on return. | RESOLVED |
| §7 row 4: log explosion on RBAC throw               | §7 row 4 now requires sample rate "one log line per `(userId, errorClass)` per 60-second window (or via existing logger sample-rate config)." Fail-closed still required.                                                                                      | RESOLVED |
| SEC-MODAL-02: code inspection only                  | SEC-MODAL-02 now requires "automated guard (test or AST-level lint rule) asserts that `session_expired` is registered in exactly one module." Same SEC-RBAC-04 ESLint infrastructure may host. Manual inspection alone insufficient.                           | RESOLVED |

## Verification of v1 MINOR Findings

All 7 MINOR findings addressed: SEC-WS-03 counter added, persona added (§2), batch risk grade escalated to medium with mitigation tightened (§9 row 3), "standard" message defined (Appendix C), accessibility focus assertion in SEC-MODAL-04, SEC-RBAC-03 form fixed to JSDoc `@requires <role>`, SEC-ERR-01 canonical shape decided at PRD layer (no engineering deferral).

## New Findings in v2 Review

### MINOR (non-blocking, advisory)

- `[VAGUE_TERM]` §13.5 verification checklist — "Staging logs show zero successful logins via the superpassword for the 24 hours preceding merge" presumes the staging log distinguishes superpassword-bypass success from real-password success. Pre-fix code may not have differentiated these in logs. Tech spec should clarify whether this requires temporary instrumentation (a log-tag added to the to-be-removed branch before merge so the metric is observable) or whether the metric is operationally infeasible and should be replaced (e.g., "no developer reports a working superpassword login in the 24h window").

- `[VAGUE_TERM]` SEC-WS-03 — "in-process counter" is per-process and non-durable across restarts; multi-instance deployments would have fragmented counts. The mitigation already permits "existing log-aggregation field" which solves this; recommend tech spec pick that path explicitly to avoid wasted in-process implementation. Not blocking — the intent is clear and the structured-log option is durable.

- `[UX_CLARITY]` Appendix C catch-all rows — two "(any other event)" rows for FORBIDDEN and BATCH_DENIED read ambiguously as a table. Recommend tech spec render this as a precedence order (specific event match first, then code-keyed fallback). Not blocking.

- `[VAGUE_TERM]` SEC-BATCH-UX-04 calls `BATCH_DENIED` "a sub-code of `FORBIDDEN`," but SEC-ERR-02 declares them as siblings in the type union (`"FORBIDDEN" | "BATCH_DENIED"`). The semantics are clear — single-item denials use FORBIDDEN, batch denials use BATCH_DENIED — but the "sub-code" wording is inconsistent with the type. Tech spec should pick one model. Not blocking.

- `[ASSUMPTION]` §13.1 owner is "PR #97 lead (or, if unassigned, team-lead-of-record at the time the fix lands)" — a named role, not a named person. Acceptable for PRD layer; resolution at execution time is appropriate. Calling out as a watch-item for tech spec / pre-merge to confirm a real human is assigned before §13.5 verification begins.

## Score (re-review)

BLOCKING: 0 | MAJOR: 0 | MINOR: 5 | Total: 5

The threshold for `approved` is "zero BLOCKING findings, ≤3 MAJOR findings." Met.

## Verdict Justification

PRD v2.0 makes the call on every previously-deferred decision: "mutating" qualifier dropped, AST-level guard required (with rejected forms named), batch UX contract specified down to the user-facing string, pre-merge migration plan owns the lockout-recovery problem with a named role and verification checklist. Anti-enumeration is preserved (server never reveals item identity) while user recovery is real (client-side bisection from preserved input).

The PRD now passes the bar: an engineer could implement this correctly for real users without guessing. The 5 MINOR findings are advisories for tech spec — they refine, not block.

## Next Stage

Tech-spec stage may proceed. Hephaestus should pay particular attention to:

- The AST-rule implementation (SEC-RBAC-04 is the most architecturally novel requirement)
- The recovery-store implementation choice (SEC-MODAL-05 — pick durable layer)
- The §13 staging-log instrumentation question (MINOR-1 in this re-review)
- The mandated written defect-list appendix from the §9 enumeration (gates tech-spec approval)
