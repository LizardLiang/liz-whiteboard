# Technical Specification Review (PM)

## Document Info

| Field        | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| **Reviewed** | tech-spec.md (Hephaestus, Draft v1, 2026-05-09)                   |
| **PRD**      | prd.md v2.0 (Athena, 2026-05-09)                                  |
| **Decisions**| decisions.md D1–D26 + 4 locked GA-* decisions                     |
| **Reviewer** | Athena (PM Agent)                                                 |
| **Date**     | 2026-05-09                                                        |
| **Verdict**  | Aligned — Approved                                                |

---

## Review Summary

The tech spec faithfully translates PRD v2.0 into an implementation plan. Every P0 acceptance criterion in §4.1–§4.6 is mapped to a concrete file, helper, test, or AST guard. All four locked GA-* decisions (RBAC-BATCH-SHORT-CIRCUIT, MODAL-RECOVERY-SCOPE, ESLINT-RULE-PACKAGING, ERROR-SHAPE-MIGRATION) are honored verbatim. The "gating" defect-enumeration appendix demanded by D16 / §9 is present in §2 with a triage line ready for Apollo's signoff.

The spec stays within Hephaestus's lane — it picks the centralized middleware approach (AD-1) and offers two helper signatures, but does not redefine any PRD requirement. Where engineering trade-offs were made (e.g., column-form-only modal recovery, two error shapes coexisting), the spec credits the locked decision rather than inventing scope.

One MINOR observation and one note for Apollo's downstream review (§7) are recorded below. Neither blocks PM approval.

---

## Requirements Coverage

### P0 Requirements

| Requirement     | Covered? | Spec Section                                | Notes                                                                                                                              |
| --------------- | -------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SEC-SP-01       | Yes      | §3.6, Phase 6.2                             | Branch deletion plus `verifyPassword` left clean (`bcrypt.compare` only).                                                          |
| SEC-SP-02       | Yes      | §3.6, Phase 6.4 (one-off AST assertion)     | AST inspection of `verifyPassword` — covers PRD §3 row 1 metric methodology.                                                       |
| SEC-SP-03       | Yes      | Phase 6.1 (instrumentation), §13 plan       | AD-8 promotes the staging warn line so §13.5 verification is real, not assumed.                                                    |
| SEC-SP-04       | Yes      | §3.10 row 1, Phase 6.3                      | Regression test extends `src/routes/api/auth.test.ts`.                                                                             |
| SEC-WS-01       | Yes      | AD-1 + §3.3 (replaces no-op stub)           | Fix transitively closes 12 sibling handlers (§2.1) — bonus coverage explicitly enumerated.                                         |
| SEC-WS-02       | Yes      | §3.1 (`requireRole`)                        | Single source of truth — both helpers wrap the same `findEffectiveRole` + `hasMinimumRole` primitives.                             |
| SEC-WS-03       | Yes      | §3.1 (`incrementDenialCounter`), AD-6       | Per-(user, event) counter in-process Map + `console.warn` structured field. PRD allows "structured-log field" (D21). Match.        |
| SEC-WS-04       | Yes      | §3.10 row 2                                 | Mocks `findEffectiveRole`, asserts no DB write + canonical error event.                                                            |
| SEC-BATCH-01    | Yes      | AD-3, §3.5 step 1                           | Pre-validate every unique tableId before write.                                                                                    |
| SEC-BATCH-02    | Yes      | AD-3, §3.5 step 2                           | Locked GA-RBAC-BATCH-SHORT-CIRCUIT honored. Write only on full pass.                                                                |
| SEC-BATCH-03    | Yes      | §3.5 (`BatchDeniedError` — no item index)   | Anti-enumeration preserved — error class exposes no `index` / `tableId` field.                                                     |
| SEC-BATCH-04    | Yes      | §3.10 row 3a, Phase 4.2                     | New `src/routes/api/columns.test.ts` for HTTP regression.                                                                          |
| SEC-BATCH-UX-01 | Yes      | §3.10 row 3b, Phase 4.3                     | "Preserve form input" called out as test assertion target.                                                                         |
| SEC-BATCH-UX-02 | Yes      | §3.5 (`BatchDeniedError` constructor msg)   | Message string matches PRD §4.3a SEC-BATCH-UX-02 verbatim.                                                                         |
| SEC-BATCH-UX-03 | Yes      | Phase 4.3 ("per-row save individually")     | Spec defers UX choice (per-row button) to Ares — within PRD's allowance ("Engineering may pick either UX").                        |
| SEC-BATCH-UX-04 | Yes      | §7.2 (canonical WS payload), AD-3           | `code: 'BATCH_DENIED'` distinct from `FORBIDDEN`; client switches on `code`.                                                       |
| SEC-BATCH-UX-05 | Yes      | §3.10 row 3b                                | Component test asserts banner visible + bisection reachable via Tab.                                                               |
| SEC-MODAL-01    | Yes      | AD-7, §3.7                                  | `useCollaboration` already owns the single registration; AD-7 closes the gap by making the callback mandatory at the type system. |
| SEC-MODAL-02    | Yes      | §3.9 (AST guard "after-all-files" pass)     | ESLint rule asserts `socket.on('session_expired', ...)` appears in exactly one file. Matches D20 automated guard requirement.     |
| SEC-MODAL-03    | Partial  | §3.7 (HTTP 401 path)                        | Spec ensures wiring fix doesn't regress the existing HTTP 401 path. **See Minor #1** — explicit regression test for HTTP 401 path is not enumerated in §3.10. The PRD requires "a test asserts both paths." Recommendation: extend §3.10 row 4 to include the HTTP 401 case. |
| SEC-MODAL-04    | Yes      | §3.10 row 4, AD-7                           | Test extends `use-whiteboard-collaboration-auth.test.ts`; focus assertion called out per D26.                                      |
| SEC-MODAL-05    | Yes      | AD-4, §3.8, Phase 5.3                       | Locked GA-MODAL-RECOVERY-SCOPE = COLUMN_FORM_ONLY honored. Limitation documented in spec §3.8 + risks table.                       |
| SEC-RBAC-01     | Yes      | AD-1, Phase 3.1–3.2                         | All 85 in-scope `createServerFn` exports get either `requireServerFnRole(...)` or `@requires authenticated` JSDoc. Read AND write. |
| SEC-RBAC-02     | Yes      | Phase 3.3                                   | Read-only handlers explicitly use `'VIEWER'` minimum role.                                                                         |
| SEC-RBAC-03     | Yes      | §7.3, Phase 3.1                             | JSDoc `@requires <role>` form, lowercase set `{authenticated, unauthenticated, viewer, editor, admin, owner}`. Matches D24.        |
| SEC-RBAC-04     | Yes      | AD-2, §3.9, Phase 7                         | Inline ESLint plugin (locked GA-ESLINT-RULE-PACKAGING honored). Rule body verifies (a) handler-body call presence, (b) JSDoc tag, (c) wrapper allowlist (`requireAuth`). Catches "gutted wrappers" via wrapper allowlist — closes Nemesis-BLOCKING-3 concern. |
| SEC-RBAC-05     | Yes      | §3.10 row 5, Phase 3.5                      | Four tests, one per role tier, in new `src/lib/server-functions.test.ts`.                                                          |
| SEC-ERR-01      | Yes      | §7.1, AD-5                                  | Canonical HTTP 403 `{error, message}` shape. Locked GA-ERROR-SHAPE-MIGRATION = FIVE_FIXES_ONLY documented as scope boundary.       |
| SEC-ERR-02      | Yes      | §7.2, §3.1 (`emitAuthDenied`), AD-5         | Canonical WS `error` event with `{code, event, message}`. Coexistence with legacy ad-hoc shape documented in §7.2 + AD-5.          |
| SEC-ERR-03      | Yes      | §3.1 (returns `FORBIDDEN` when projectId is null), §3.5 | `getWhiteboardProjectId === null` → same error path as forbidden. Indistinguishable from "exists but unauthorized."     |

### P1 Requirements

None defined in PRD v2.0. All requirements are P0.

---

## User Flow Alignment

### Supported Flows

| User Flow                                                | PRD Section | Spec Support | Assessment                                                                                                              |
| -------------------------------------------------------- | ----------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 5.1 Restored: Session Expiry on Active WebSocket         | §5.1        | Full         | AD-7 (mandatory callback) + AD-4 (column-form draft persistence). Step 4 unsaved-state persistence is COLUMN_FORM_ONLY scope per locked decision — PRD allows minimum-viable persistence. |
| 5.2 Restored: column:create Authorization Denial         | §5.2        | Full         | AD-1 covers; SEC-ERR-02 emit shape includes `event: "column:create"` for Appendix C message lookup.                     |
| 5.3 Restored: Batch Column Authorization Denial          | §5.3        | Full         | AD-3 (pre-validate) + §3.5 (`BatchDeniedError` with canonical message) + Phase 4.3 (UI bisection affordance).            |
| 5.4 Restored: Server Function Authorization Denial       | §5.4        | Full         | `ForbiddenError` thrown by `requireServerFnRole`; Phase 3.4 routes it through TanStack Start's existing error pipeline. |
| 5.5 Prevented: Superpassword Login Attempt               | §5.5        | Full         | §3.6 + Phase 6.2 deletes the bypass; Phase 6.3 regression test asserts the prevented path.                              |

### Missing or Incomplete Flows

- **5.1 step 8 (post-login restore prompt):** The spec specifies the column-edit-modal mount triggers the Apply/Discard prompt by watching `useAuthContext().sessionExpired` transitions (§3.8). This is the right hook — the user does not need to land on a special "restore" page; the modal itself surfaces the prompt on next open. This satisfies PRD §5.1 step 8 within the COLUMN_FORM_ONLY scope. Confirmed Full coverage.

---

## Scope Assessment

### Scope Match

- **PRD Scope:** 5 named defects + AST guard + canonical error contract + pre-merge migration plan + column-form unsaved-state persistence (locked).
- **Spec Scope:** All of the above, plus transitive coverage of 12 sibling WebSocket handlers (because the AD-1 fix to the no-op stub closes them all) and 85 in-scope `createServerFn` exports across 9 server-function files.
- **Assessment:** **Match.** The transitive WebSocket / server-function coverage is explicitly enumerated as in-scope under §2 (Defect Enumeration Appendix) — this is exactly the gating triage D16 / PRD §9 requires. Hephaestus did not silently expand scope; the appendix is the intended product of the gating step.

### Scope Deviations

| Deviation                                                                                                | Type    | Impact | Recommendation                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two error shapes coexist (canonical only on the 5 fix sites; legacy on other handlers in collaboration.ts) | Bounded | Low    | Locked under GA-ERROR-SHAPE-MIGRATION. PRD allows this. Spec §7.2 + risks table call out client-side dual-handling cost. No action.                                                                  |
| Modal recovery scope = column-form only (other unsaved state — table positions, draft relationships — not preserved) | Bounded | Low    | Locked under GA-MODAL-RECOVERY-SCOPE. PRD §4.4 SEC-MODAL-05 allows "minimum viable persistence." Documented limitation. No action.                                                                   |
| Defect enumeration includes ~16 demo/test files marked **accepted-risk** (whitelisted via `@requires authenticated`) | Bounded | Low    | Triage rationale present in §2.2 (demo files all require login per original auth PRD; no per-resource permission applies). Apollo's gate sign-off in §2.5 covers this. No action from PM lens.        |

---

## Acceptance Criteria Verification

### Testability Check

| Acceptance Criterion                                                                | Testable? | How Spec Enables Testing                                                                                          | Notes                                                                                                                |
| ----------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| SEC-SP-02 — every truthy return of `verifyPassword` flows through `bcrypt.compare`  | Yes       | Phase 6.4 one-off Vitest test parses `password.ts` AST and walks `ReturnStatement` chain                          | Matches PRD §3 measurement methodology.                                                                              |
| SEC-WS-04 — column:create authz regression                                          | Yes       | §3.10 row 2 — mock `findEffectiveRole`, emit event, assert no DB write + canonical error                          | Standard mock-Socket pattern.                                                                                        |
| SEC-BATCH-04 — mixed batch all-or-nothing                                           | Yes       | §3.10 row 3a — HTTP test asserts zero rows written + `BatchDeniedError`                                           | Verifies PRE_VALIDATE_THEN_WRITE locked behavior.                                                                    |
| SEC-BATCH-UX-05 — bisection reachable via keyboard                                  | Yes       | §3.10 row 3b — component test, Tab-key navigation                                                                 | Accessibility extension covered.                                                                                     |
| SEC-MODAL-04 — `triggerSessionExpired` invoked + focus moves to modal               | Yes       | §3.10 row 4 — extends existing `use-whiteboard-collaboration-auth.test.ts`                                        | D26 focus assertion explicitly called out.                                                                           |
| SEC-MODAL-05 — column-form draft restore                                            | Yes       | §3.10 row 4 + Phase 5.4 — new component test                                                                      | sessionStorage key `draft:${whiteboardId}:${columnId}` testable.                                                     |
| SEC-RBAC-04 — AST guard fails CI on missing RBAC                                    | Yes       | §3.10 row 6 — rule self-test fixtures with 5 cases (gutted wrapper, missing JSDoc, escape hatch, etc.)            | Self-test of the guard is a strong safety net.                                                                       |
| SEC-RBAC-05 — four-tier denial                                                      | Yes       | §3.10 row 5 — four tests, one per role tier                                                                       | Specific endpoints picked at implementation per role tier — acceptable per PRD.                                      |
| SEC-MODAL-03 — HTTP 401 path also triggers modal                                    | Partial   | Implicit — AD-7 doesn't change the existing HTTP 401 path                                                         | **Minor #1** — no explicit regression test enumerated in §3.10 for HTTP 401 path. PRD requires "a test asserts both paths." |

---

## Issues Summary

### Critical (Blocks Alignment)

None.

### Major (Should Address)

None.

### Minor (Consider)

1. **SEC-MODAL-03 missing explicit regression test enumeration.** The PRD acceptance criterion reads: "A test asserts both paths" (HTTP 401 + WebSocket `session_expired`). The spec's §3.10 covers the WebSocket path via SEC-MODAL-04, and AD-7 does not modify the HTTP 401 path so it is preserved by construction. However, the PRD asks for a positive test of the HTTP 401 path, not just non-regression by inspection. Recommendation: extend Phase 5.4 / §3.10 row 4 to add a one-line assertion that an HTTP 401 response also reaches `triggerSessionExpired`. Low effort; closes the PRD requirement literally.

2. **§9 Open Question 3** ("SEC-MODAL-02 single-registration assertion implemented as ESLint rule or Vitest meta-test") — the PRD D20 prefers the ESLint route ("May share the SEC-RBAC-04 rule infrastructure"). The spec's §3.9 says the rule attempts the assertion as `Program:exit` cross-file state but allows Ares fallback to a separate Vitest meta-test if flat-config makes the cross-file pass awkward. This fallback is acceptable per the PRD ("test or AST-level lint rule"), but a meta-test for `session_expired` registration is a single string-literal grep — simpler than a meta-test for SEC-RBAC-04 (which has the three weaknesses Nemesis called out). The fallback is structurally fine because the surface area is "one literal in one file" rather than "one helper across N files." No action needed; flagged here so Apollo doesn't flag it as a regression of D20's intent.

---

## Recommendations

| Priority | Recommendation                                                                                                                              | Rationale                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low      | Add an explicit HTTP 401 → `triggerSessionExpired` test to §3.10 row 4 (extend the existing `use-whiteboard-collaboration-auth.test.ts`).   | Closes SEC-MODAL-03 acceptance criterion literally rather than by construction. Trivial to add alongside the WebSocket-side assertion.                                 |
| Low      | When Ares confirms the column-edit modal file path (Open Question §9.1), update the spec's §3.8 + §5 file list with the resolved path.      | Living-document hygiene. Post-implementation, the spec should not retain "TBD by Ares" markers — they hide later regression review.                                    |

---

## Locked Decision Verification

| Locked Decision                | Spec Honor              | Where                                                                                                            |
| ------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GA-RBAC-BATCH-SHORT-CIRCUIT    | Yes (PRE_VALIDATE_THEN_WRITE) | AD-3 + §3.5 — every item RBAC-checked before any write; `BatchDeniedError` thrown on first failure.        |
| GA-MODAL-RECOVERY-SCOPE        | Yes (COLUMN_FORM_ONLY)  | AD-4 + §3.8 — sessionStorage keyed by `draft:${whiteboardId}:${columnId}`; broader unsaved state explicitly deferred. |
| GA-ESLINT-RULE-PACKAGING       | Yes (INLINE_PLUGIN_IN_FLAT_CONFIG) | AD-2 + §3.9 — rule body in `tools/eslint-rules/require-server-fn-authz.js`, registered inline in `eslint.config.js`. |
| GA-ERROR-SHAPE-MIGRATION       | Yes (FIVE_FIXES_ONLY)   | AD-5 + §7.2 — canonical SEC-ERR-01/02 only on the 5 patched sites; coexistence with legacy shapes documented.    |

---

## Verdict

**ALIGNED — APPROVED**

The tech spec fully addresses all PRD requirements and user flows. All four locked decisions are honored. The single Minor item (SEC-MODAL-03 explicit HTTP 401 regression test) is a one-line test addition that does not block this stage and can be picked up by Artemis (stage 8 — Test Plan) or Ares (stage 9 — Implementation) without spec revision.

The defect-enumeration appendix (§2) satisfies the gating triage required by D16 / PRD §9 mitigation. Apollo (stage 7 — SA review) can now sign off on the §2.5 line.

### Aligned

The spec fully addresses all 30 PRD acceptance criteria across §4.1–§4.6 and all 5 restored user flows. Ready for Apollo (stage 7) and onward.

---

## Gate Decision

- [x] Approved for next stage
- [ ] Requires revisions before proceeding
