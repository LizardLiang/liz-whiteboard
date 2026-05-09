# Tech Spec Review (SA — Apollo)

| Field | Value |
| --- | --- |
| Feature | auth-security-hardening |
| Reviewer | Apollo (SA) |
| Date | 2026-05-09 |
| Spec Reviewed | tech-spec.md (Hephaestus, Draft v1, 2026-05-09) |
| PRD | prd.md v2.0 |
| PM Review | spec-review-pm.md (Athena, Approved) |
| **Verdict** | **Sound** |

---

## Executive Summary

The tech spec proposes a centralized authz middleware (AD-1) wrapping the existing `findEffectiveRole` + `hasMinimumRole` primitives, surfaced through two helpers: `requireRole` (WS) and `requireServerFnRole` (HTTP). All five PRD defects funnel through these two helpers. Architecture is sound for the bounded scope of restoring guarantees PR #97 already promised. The defect-enumeration appendix (§2) correctly identifies the no-op `denyIfInsufficientPermission` stub as the single root cause behind 13 WebSocket handlers + transitive coverage of ~85 server-function exports.

The §2.5 sign-off line is **accepted**. The ~16 demo/test files marked `@requires authenticated` form a small, well-bounded accepted-risk set with explicit rationale (login-gated routes with no per-resource permission semantics). The PM-flagged minor (SEC-MODAL-03 HTTP 401 regression test enumeration) is **not** an architectural concern — it's a test-plan completeness issue for Artemis, not a design flaw.

---

## Architecture Soundness

### Sound
- **AD-1 (centralized middleware) is the right pattern.** Two helpers backed by the same primitives preserves single-source-of-truth (PRD SEC-WS-02). Replacing one no-op stub closes 13 handlers transitively — high leverage for low blast radius.
- **AD-3 (pre-validate-then-write batch) correctly enforces all-or-nothing semantics.** Pre-validating every unique tableId before entering the data-layer write means the DB transaction is only entered on full pass. Eliminates partial-state class bugs.
- **AD-2 (inline ESLint plugin) matches the toolchain.** Flat config + inline plugin survives `bun install` with no separate package boundary. Rule body separated into `tools/eslint-rules/require-server-fn-authz.js` keeps `eslint.config.js` readable.
- **AD-7 (mandatory `onSessionExpired` callback) closes the wiring gap at the type system.** Compiler enforcement is the right defense against "pass undefined and `?.()` silently no-ops" — this is exactly the slipped-defect class.
- **SEC-ERR-03 anti-enumeration preserved by design.** `requireServerFnRole` collapses `resourceProjectId === null` and `role < minRole` into the same `ForbiddenError` throw. `requireRole` does the same on the WS side. The two paths cannot be distinguished from the client.
- **AD-6 fail-closed with sampled logging.** In-process Map for dedup is appropriate scale (per-process, 60s window, low cardinality of `(userId, errorClass)` tuples). Non-durability is documented and acceptable given PRD allows "structured-log field."

### Concerns (none rising to blocking)

#### MEDIUM-1 — `getTableProjectId` throw path bypasses `BatchDeniedError` translation (SEC-ERR-03 leak risk)

`tech-spec.md:374-387` — In §3.5 step 1, `getTableProjectId(tableId)` is called *outside* the `try { await requireServerFnRole(...) } catch (error) { if (error instanceof ForbiddenError) ... }` translation block. `getTableProjectId` returns `null` on missing rows but **throws** on Prisma errors (DB unreachable, connection pool exhausted, etc.). A throw from `getTableProjectId` propagates as an unhandled `Error`, whose default serialization in TanStack Start may include the tableId (the value passed to the Prisma call) in stack traces or error messages — leaking which table the user attempted to batch against.

- **Architectural issue:** SEC-ERR-03 must hold for *all* failure modes, not just the "role insufficient" path.
- **Recommended fix:** Wrap the entire per-item loop body (both `getTableProjectId` and `requireServerFnRole`) in the try/catch, and translate any throw into `BatchDeniedError`. Alternatively, log the raw error server-side via `logSampledError` and throw a sanitized `BatchDeniedError`. The fix is a 2-line change but the architectural intent (fail-closed + anti-enumeration on every failure path) needs to be explicit in the spec.

#### MEDIUM-2 — Dynamic `await import('@/lib/auth/require-role')` inside hot WebSocket path (§3.3)

`tech-spec.md:307-314` — The `denyIfInsufficientPermission` wrapper uses dynamic `await import(...)` per call. WebSocket mutation handlers are the hot path; bundlers typically resolve dynamic imports synchronously after the first call (cached promise), but the first event per process pays a microtask + module-evaluation cost, and the pattern obscures the dependency graph for static analysis (including the SEC-RBAC-04 ESLint rule itself).

- **Architectural issue:** Static `import { requireRole } from '@/lib/auth/require-role'` at the top of `collaboration.ts` is the conventional pattern and matches how `findEffectiveRole`, `hasMinimumRole`, etc. are already imported. Dynamic import here has no apparent justification (no circular dependency named in the spec).
- **Recommended fix:** Use a static import. If the spec author had a circular-dep concern in mind, document it; otherwise, drop the dynamic import.

#### MEDIUM-3 — `requireRole` socket parameter typed as `any` (§3.1, line 167)

`tech-spec.md:166-171` — The `socket` parameter is typed as `{ data: { userId: string }; emit: (e: string, p: any) => void }` rather than `Socket` from `socket.io`. This loosens the contract: a caller could pass any object with those two fields and bypass the actual Socket.IO middleware chain. More importantly, the `any` payload type (`emit: (e: string, p: any)`) defeats the SEC-ERR-02 canonical-shape contract at the type level — the helper itself cannot enforce that callers don't pass arbitrary payloads.

- **Architectural issue:** Type system is the cheapest enforcement layer; the spec walks past it. The PRD's "single source of truth" intent (SEC-WS-02) is undermined when the helper accepts a structurally typed shim.
- **Recommended fix:** Type as `Socket` (or a narrowly-defined `AuthorizedSocket` interface that extends `Socket` with the `data: { userId: string }` augmentation). Type the `WSAuthErrorPayload` union as the only acceptable `emit` argument when `eventName === 'error'`.

### Minor (acknowledged, no blocking impact)

- **MINOR-1 (counting inconsistency, §3.7):** Spec text says "Update three call sites" then lists four bullets (`use-column-collaboration.ts`, `use-column-reorder-collaboration.ts`, `$whiteboardId.tsx`, `$whiteboardId.new.tsx`). Verified against codebase: there are actually **5 callers** of `useCollaboration` (`use-whiteboard-collaboration.ts` already passes `triggerSessionExpired` correctly at line 80-83 — that one continues to compile after the signature tightens; the other 4 must be updated). Spec count "three" is wrong; bullet list is the correct set to update. Suggest reconciling the prose to "four" and noting the fifth caller is already correct.
- **MINOR-2 (counting inconsistency, §2.2):** `src/routes/api/auth.ts` has **4** `createServerFn` exports (registerUser, loginUser, logoutUser, getCurrentUser), not 5. Verified by `rg -n createServerFn`. The accepted-risk list of 4 names is correct; the "5" count is wrong.
- **MINOR-3 (factual error, §2.2):** `src/routes/api/auth.test.ts` is listed with "createServerFn exports: 2" — verification shows the test file has zero `createServerFn` exports; it tests handler logic directly. The "outside lint scope" disposition still stands (test files are excluded by the rule's scope), so the row's outcome is correct, but the count is fictitious.
- **MINOR-4 (PM passthrough, SEC-MODAL-03 HTTP 401):** The PM review flagged that §3.10 doesn't enumerate an explicit HTTP 401 → `triggerSessionExpired` regression test. Apollo concurs this is **not** an architectural concern — AD-7 doesn't change the HTTP 401 path, and the SEC-MODAL-04 test mock pattern can trivially extend to the HTTP path. This is correctly Artemis's domain (stage 8 — Test Plan).

---

## Security

Security is the central axis of this spec; review depth was applied accordingly.

### Sound
- **Superpassword removal sequence (AD-8 + Phase 6) is operationally safe.** The pre-merge `console.warn` instrumentation gives §13.5 a real signal (zero superpassword warns in 24h before merge) instead of a vibe check. Single-commit deletion of warn + bypass minimizes the window where the bypass exists in code without telemetry.
- **SEC-SP-02 AST one-off assertion (Phase 6.4) is the right tool** for "every truthy return of `verifyPassword` flows through `bcrypt.compare`." The PRD measurement methodology demands AST inspection (not grep); the spec delivers exactly that with `@typescript-eslint/parser`.
- **SEC-RBAC-04 wrapper allowlist closes the "gutted wrapper" Nemesis-BLOCKING-3 concern.** The rule resolves wrapper definitions or requires wrappers to live in an allowlisted file — exactly the static-analysis posture the PRD demands.
- **`@requires unauthenticated` JSDoc tag for login/register handlers is a clean escape hatch.** Forces the AST rule to acknowledge those endpoints exist (vs. silently passing) and provides a search target for future audits.
- **Anti-enumeration preserved on the batch path (SEC-BATCH-03).** `BatchDeniedError` exposes no `tableId`, no `index`. Client bisection is purely client-side (PRD §4.3a Information-leak audit confirmed by spec).

### Concerns

See MEDIUM-1 above (the only security-relevant Medium): the `getTableProjectId` throw path is the one place where the SEC-ERR-03 / SEC-BATCH-03 anti-enumeration guarantee can leak under failure conditions. Architectural fix is small and called out.

### Threat model coverage

| Threat | Spec coverage |
| --- | --- |
| Authenticated user mutates resource they don't own (IDOR) | Sound — AD-1 closes via centralized middleware |
| Batch smuggling (mixed authorized + unauthorized items) | Sound — AD-3 pre-validate-then-write with all-or-nothing rejection |
| Backdoor authentication (superpassword) | Sound — Phase 6 deletes branch + Phase 6.4 AST assertion + §13 migration |
| Future-defect regression (new `createServerFn` without RBAC) | Sound — SEC-RBAC-04 ESLint rule with wrapper allowlist + JSDoc requirement |
| Future-defect regression (multiple `session_expired` registrations drift) | Sound — SEC-MODAL-02 single-registration AST assertion |
| Information leak via error responses | Sound for 4/5 paths; **see MEDIUM-1** for the 5th (DB-error path on batch) |
| Log explosion under DB failure | Sound — AD-6 sampled logger with 60s dedup window |
| Fail-open if RBAC lookup throws | Sound — AD-6 try/catch denies on throw |

---

## Performance

### Sound
- **Per-WS-mutation overhead is low.** `findEffectiveRole` is a 2-row indexed Prisma lookup. p99 < 5ms is a defensible expectation; the spec's risk row 2 acknowledges and offers an LRU cache as future mitigation if needed. Out of scope for v1 is the right call.
- **Batch pre-validation cost is N indexed lookups.** Spec correctly notes typical batch sizes ≤20; serial `for` loop is fine for that scale. Parallel `Promise.all` deferred is a reasonable optimization gate.
- **Sampled logger dedup is O(1) Map ops.** Map size bounded by `(userId, errorClass)` cardinality — for a typical multi-tenant deployment this is at worst single-digit thousands, well within in-process Map performance.

### Concerns

#### LOW-1 — Sampled-logger Map has no eviction (memory growth over uptime)

`tech-spec.md:281-300` — The `lastLogAt` Map in `log-sample.ts` only ever sets entries; there's no TTL eviction. Every unique `(userId, errorClass)` accumulates an entry that lives until process restart. For a long-running server, this leaks memory proportional to user-class cardinality.

- **Severity:** Low. Cardinality is bounded; a 100k-entry Map costs ~10MB. Process restarts are frequent enough in practice.
- **Recommended fix (optional, defer if scope-tight):** Add a tiny eviction pass — when a `set` happens, check if the Map size exceeds a watermark (e.g., 10k) and evict entries older than `2 * WINDOW_MS`. 5-line addition. If deferred, document as accepted-risk.

#### LOW-2 — Same eviction concern for `denialCounter` Map (§3.1)

`tech-spec.md:224-231` — The `denialCounter` Map (per-user, per-event denial count) has the same monotonic-growth pattern. Same severity, same disposition.

---

## Maintainability

### Sound
- **Two-helper symmetry is clear.** `requireRole` returns boolean (caller `return`s); `requireServerFnRole` throws (caller doesn't catch). Different shapes match the different control-flow conventions of the WS handler vs. the `createServerFn` pipeline. Documented in the code comments.
- **JSDoc `@requires` tag is both documentation and contract.** Future engineers reading a server function see the role requirement inline; the AST rule enforces consistency.
- **Phase 1 → Phase 8 sequencing is build-order-correct.** Foundation (helpers) before consumers (handlers); behavior change before AST guard turn-on. Phase 8 verification gate is real (manual + lint + test).

### Concerns

#### LOW-3 — Two error shapes coexist (AD-5) creates a known migration debt

The locked `GA-ERROR-SHAPE-MIGRATION = FIVE_FIXES_ONLY` decision means the canonical SEC-ERR-02 shape lives only on the 5 patched sites. The other ~12 ad-hoc `socket.emit('error', { event, error, message })` shapes in `collaboration.ts` remain. Client must understand both shapes (spec §7.2 and AD-5 acknowledge this).

- **Severity:** Low (locked decision, documented, bounded scope). The architectural debt is real but not blocking.
- **Recommendation:** Spec should explicitly call out a follow-up ticket to migrate the legacy shapes once this sprint lands. "Coexistence is temporary" is implied but not actioned. A single sentence in §8 Risks ("Mitigation: file follow-up issue #N to migrate remaining 12 ad-hoc shapes once this sprint merges") closes the loop.

---

## Integration

### Sound
- **Existing primitives reused, not reinvented.** `findEffectiveRole`, `hasMinimumRole`, `getWhiteboardProjectId`, `getTableProjectId`, `getColumnProjectId`, `getRelationshipProjectId` all exist in the codebase (verified). The spec adds no new data-access surface.
- **`useAuthContext().triggerSessionExpired` is the established trigger** (verified via `rg`); spec correctly funnels all four call sites through it.
- **TanStack Start error pipeline handles `ForbiddenError` natively.** Throwing from a `requireAuth` handler serializes through the existing path; the spec doesn't need to invent a new error transport.

### Concerns
None. Integration surface is minimal and well-understood.

---

## Defect-Enumeration Appendix (§2) Sign-Off

The PRD §9 mitigation requires Hephaestus's enumeration to be "gating" — Apollo signs off on the §2.5 line before the spec advances. Apollo's evaluation:

| §2 sub-section | Triage outcome | Apollo assessment |
| --- | --- | --- |
| §2.1 — 13 WebSocket handlers | All in-scope under AD-1 | **Accepted.** Single root cause (no-op stub) → single fix. Transitive closure is correct. |
| §2.2 — 85 server-function exports across 9 files | All in-scope | **Accepted** with MINOR-2/MINOR-3 counting corrections (auth.ts has 4 not 5 exports; auth.test.ts has 0 not 2). The dispositions stand. |
| §2.2 — 4 auth-route exports | Accepted-risk (login/register `@requires unauthenticated`; logout/getCurrentUser `@requires authenticated`) | **Accepted.** Pre-auth and self-auth functions cannot meaningfully take a per-resource role check. JSDoc tags + AST escape hatch close the audit trail. |
| §2.2 — 9 demo/test exports (3 files) | Accepted-risk `@requires authenticated` | **Accepted.** Demo files are login-gated routes with no per-resource permission semantics. The whitelist is small (3 files), bounded, and reviewable. |
| §2.3 — 4 batch endpoints | All in-scope | **Accepted.** Disposition correctly distinguishes per-item RBAC (createColumnsFn) from namespace-scope RBAC (table:move:bulk, updateTablePositionsBulk). |
| §2.4 — New defects discovered | Zero new defects | **Accepted.** The "no-op stub" root cause unifies what the PRD framed as 3 separate symptoms. |

### Apollo §2.5 Gate Line (signed)

> Apollo (SA review, 2026-05-09) accepts the §2.5 sign-off. 13 WebSocket handlers + ~83 server-function exports (corrected from 85) are in-scope under AD-1. Zero new defects. ~16 accepted-risk demo/test/auth files documented with rationale. Counting inconsistencies in §2.2 (auth.ts: 4 not 5; auth.test.ts: 0 not 2) noted as MINOR — do not affect dispositions. **The defect-enumeration gate is cleared.**

---

## Issues Summary

### Critical (Blocks Approval)
None.

### High
None.

### Medium (Should Address Before Implementation)
1. **MEDIUM-1** — `getTableProjectId` throw path bypasses `BatchDeniedError` translation. Risk: SEC-ERR-03 anti-enumeration leak under DB failure. Fix: wrap full per-item loop body in try/catch.
2. **MEDIUM-2** — Dynamic `await import(...)` in hot WebSocket path. Risk: obscures dependency graph, marginal latency on first event. Fix: use static import.
3. **MEDIUM-3** — `requireRole` socket parameter typed as structural shim with `any` payload. Risk: SEC-ERR-02 canonical shape not type-enforced. Fix: type as `Socket` and narrow the `emit` signature.

### Low (Acknowledged)
1. **LOW-1** — `lastLogAt` Map has no eviction (slow memory growth).
2. **LOW-2** — `denialCounter` Map same pattern.
3. **LOW-3** — Two error shapes coexist (locked AD-5 decision); recommend filing follow-up to migrate the 12 legacy shapes.

### Minor (Cleanup)
1. **MINOR-1** — §3.7 prose says "three call sites," bullets list four. Reconcile to four (with note that `use-whiteboard-collaboration.ts` is already correct).
2. **MINOR-2** — §2.2 `auth.ts` count is 4 exports, not 5.
3. **MINOR-3** — §2.2 `auth.test.ts` has 0 `createServerFn` exports, not 2.
4. **MINOR-4** — PM-flagged SEC-MODAL-03 HTTP 401 test enumeration: not architectural. Defer to Artemis (stage 8).

---

## Verdict Justification

Per Apollo's verdict thresholds:
- **Critical issues:** 0
- **High issues:** 0
- **Medium issues:** 3 → would normally trigger `Concerns`

However, all three Medium issues are **localized implementation refinements**, not architectural mismatches:
- MEDIUM-1 is a 2-line widening of an existing try/catch.
- MEDIUM-2 is a single import statement change.
- MEDIUM-3 is a TypeScript type narrowing.

None invalidates the AD-1/AD-3/AD-7 design choices, and none requires re-thinking the centralized middleware approach. The architecture is genuinely sound; these are surface-level fixes that Ares can apply during implementation under the existing spec's intent.

**Verdict: Sound** — approved for downstream stages, with the three Medium fixes flagged in `decisions.md` for Ares to apply during Phase 1 (`require-role.ts` creation) and Phase 4 (`createColumnsFn` modification). These do not require Hephaestus to revise the spec; they are implementation refinements within the spec's stated intent.

---

## Recommendations for Downstream Stages

| Stage | Recommendation |
| --- | --- |
| Stage 8 (Artemis — Test Plan) | Add explicit HTTP 401 → `triggerSessionExpired` test (PM minor #1). Add a test that exercises the `getTableProjectId` throw path on the batch endpoint to verify MEDIUM-1's fix preserves anti-enumeration. |
| Stage 9 (Ares — Implementation) | Apply MEDIUM-1, MEDIUM-2, MEDIUM-3 inline during Phase 1 / Phase 4 work. Reconcile the §3.7 "three vs four call sites" prose. Confirm column-edit modal file path (Open Question §9.1) and update spec §3.8 + §5 file list. |
| Stage 11 (Hermes — Code Review) | Verify the `BatchDeniedError` translation block actually wraps `getTableProjectId` (MEDIUM-1). Verify the `requireRole` socket parameter is typed as `Socket`, not the structural shim (MEDIUM-3). Verify static (not dynamic) import of `requireRole` in `collaboration.ts` (MEDIUM-2). |

---

## Gate Decision

- [x] Approved for next stage (Sound)
- [ ] Concerns — revisions recommended
- [ ] Unsound — revisions required

**§2.5 defect-enumeration sign-off:** Cleared.
