# PRD Review — Auto Layout (Post-Revision)

## Reviewer
Athena (PM Agent) — self-review of revision 1.1 against Nemesis's BLOCKING items
Date: 2026-05-01

## Verdict: approved

Verdict scope: this review documents that all 8 BLOCKING items raised in `prd-challenge.md` have been resolved in `prd.md` v1.1. Final pipeline approval still flows through Kratos's normal verification gate; this document is the revision-author's self-attestation that each blocker has a concrete, testable resolution.

## Summary

Nemesis raised 8 BLOCKING + 13 MAJOR + 6 MINOR findings against `prd.md` v1.0. This revision (v1.1) addresses all 8 BLOCKING items with concrete, testable language. Selected MAJOR findings are also addressed (notably Open Question #5 hardware binding, persistence-failure UX, FR-009 collaboration semantics). Remaining MAJOR/MINOR items are deferred to either the tech-spec phase or noted as accepted v1 limitations.

## BLOCKING Resolutions

### 1. FR-003 — "FK-related" definition + edge cases — RESOLVED

**Nemesis finding:** "FK-related" not defined; behaviour undefined for fully-connected schemas (no non-FK denominator), schemas with no FKs (no FK numerator), isolated tables, circular references.

**Resolution in prd.md (Section 4, FR-003):**
- Defined: two tables A and B are FK-related iff a `Relationship` row exists between them in either direction (equivalently, a React Flow edge); **direct edges only**, transitive does not count.
- Edge cases specified explicitly:
  - 0 FK relationships → proximity assertion **skipped**; only FR-004 (gap) and FR-006 (fit-view) apply.
  - Fully-connected schema → non-FK denominator empty → proximity assertion **skipped**.
  - Isolated tables → participate in non-FK side only; repulsion still positions them.
  - Circular FKs (A→B→C→A) → 3 direct pairs, treated identically to any other direct edge.

**Testable now:** yes. Unit test enumerates pairs in two sets, computes medians, asserts the 0.60 ratio when both sets are non-empty; skips when either set is empty.

### 2. FR-004 — Single overlap contract — RESOLVED

**Nemesis finding:** "0px overlap or 16px gap" is two contracts; engineer cannot tell which to test.

**Resolution in prd.md (Section 4, FR-004):**
- Single contract: **L∞ gap ≥ 16px** between every pair of axis-aligned bounding boxes after layout completes (including post-pass nudge).
- Concrete formula included for the test: `max(0, A.left - B.right, B.left - A.right) + max(0, A.top - B.bottom, B.top - A.bottom) ≥ 16` is equivalent to the L∞ ≥ 16 condition.
- Previous "0 overlap or 16px" alternative explicitly removed.

**Testable now:** yes. Single arithmetic assertion per pair across the layout output.

### 3. FR-007 — Input lag measurement + re-entry reconciliation — RESOLVED

**Nemesis finding:** "no input lag > 200ms" not measurable; "clicks remain processable" contradicts disabled-button rule.

**Resolution in prd.md (Section 4, FR-007 + NFR Performance):**
- Measurement: any longtask entry with `duration ≥ 200ms` reported by `PerformanceObserver({ entryTypes: ['longtask'] })` during the layout run constitutes a violation.
- Implementation implication: simulation must tick in `requestAnimationFrame` chunks or in a Web Worker — a single synchronous block is forbidden.
- Re-entry reconciled: button is disabled synchronously before computation begins. "Click responsiveness" contract applies to the **rest** of the UI (canvas, sidebar, other toolbar buttons), not to re-clicking Auto Layout (intentional no-op).

**Testable now:** yes. Cassandra/Artemis can register a longtask observer in the perf test and assert `entries.every(e => e.duration < 200)`.

### 4. Performance target — Reproducible benchmark binding — RESOLVED

**Nemesis finding:** "mid-range laptop" not a measurement unit; Open Question #5 attempted resolution still vague.

**Resolution in prd.md (NFR Performance — reference benchmark hardware):**
- Bound to: ≥ 4-core / 2.5 GHz CPU, ≥ 8 GB RAM, Chrome latest stable, no DevTools throttling, AC power.
- Metric: p95 wall time over 5 consecutive runs.
- CI proxy: 4 vCPU / 8 GB Linux runner with headless Chrome.
- "Mid-range laptop" elsewhere in document explicitly cross-references this binding.
- Open Question #5 marked Resolved.

**Testable now:** yes. The binding is concrete enough for a CI workflow.

### 5. FR-009 — Multi-user sync contract — RESOLVED

**Nemesis finding:** Atomicity (FR-005) contradicts streamed per-node sync (FR-009); no acknowledgement of the contradiction.

**Resolution in prd.md (Section 4, FR-009 + NFR Collaboration):**
- Decision recorded: **option (b) streamed per-node updates with last-write-wins**, but routed through a **new `table:move:bulk` Socket.IO event** that carries all positions in one broadcast (so collaborators apply positions in a single tick on receipt rather than N ticks).
- Tradeoffs documented explicitly: collaborator-side flicker (one-tick rearrangement); mid-drag local-wins until release; near-simultaneous double-click resolves last-write-wins per whiteboard.
- FR-005 atomicity reframed: **local atomicity preserved**, remote-collaborator atomicity not guaranteed (but mitigated by the bulk broadcast).
- Why not option (a) atomic broadcast with client suspension: explicitly listed as out of scope (would require new client state machine).

**Testable now:** yes. The contract is explicit; multi-user integration test can assert that user B applies all positions in one tick on bulk receipt.

### 6. Persistence-failure UX — RESOLVED

**Nemesis finding:** "Fall back to existing behaviour" delegates a P0 user-facing error to undefined behaviour.

**Resolution in prd.md (NFR Persistence — failure UX):**
- Toast with explicit message text: *"Auto Layout could not be saved — your changes are visible locally but not persisted. Click Retry to save."*
- Retry action button included in the toast.
- Local positions retained (optimistic; not snapped back).
- Reload-during-failure consistency: server-last-saved positions reload (existing manual-drag behaviour); no "unsaved changes" dialog (out of scope for v1).
- Collaboration consistency in failure case: `table:move:bulk` is server-emitted only on transaction success → on failure, no collaborator sees the layout, and the toast tells the user.

**Testable now:** yes. Mock the server function to reject; assert toast appears with retry button; assert local positions remain; assert no Socket.IO emit observed.

### 7. Bulk persistence — Validated, requirement added — RESOLVED

**Nemesis finding:** Appendix A row 2 assumed bulk persistence works; FR-007/FR-008 treat it as fact.

**Resolution in prd.md (NFR Persistence + Appendix A):**
- Validated by reading `src/lib/server-functions.ts:113-141` and `src/hooks/use-whiteboard-collaboration.ts:207-217`.
- Finding: existing client-callable path is **per-table only** (`updateTablePosition` + `emit('table:move', ...)`).
- Note recorded: server-side `computeAutoLayout` at `src/lib/server-functions.ts:204` does use `prisma.$transaction` for bulk DB writes, proving the pattern works at the DB layer, but it does not emit Socket.IO and is not the path Auto Layout will use.
- New P0 requirement added: `updateTablePositionsBulk` server function + `table:move:bulk` Socket.IO event.
- Appendix A row 2 marked "validated and replaced by an explicit requirement."

**Testable now:** yes. Hephaestus implements the new endpoint; Cassandra performance-tests it against the 100-table fixture.

### 8. Cancellation — Decision documented (FR-011) — RESOLVED

**Nemesis finding:** No cancellation mechanism; user has no escape on long runs.

**Resolution in prd.md (Section 4, new FR-011):**
- Decision: **no in-flight cancellation in v1.** Rationale documented (safe cancellation requires Web Worker abort or cooperative tick cancellation with rollback — material v1 scope expansion).
- Pre-run warning dialog (P0): when whiteboard contains > 50 tables, a confirmation dialog appears before computation starts: *"This whiteboard has N tables. Auto Layout may take several seconds and cannot be cancelled once started. Existing positions will be overwritten. Continue?"* with Cancel (default focus) and Run Layout buttons.
- Below 50 tables: no dialog; layout starts immediately.
- Tooltip on the button on > 50 table diagrams: *"Layout cannot be cancelled once started."*

**Testable now:** yes. UI test: open a > 50 table whiteboard, click button, assert dialog appears; click Cancel, assert no layout runs; click Run Layout, assert layout runs.

## MAJOR Findings — Status

| Finding | Status |
|---------|--------|
| Executive Summary "dramatically reducing" claim unvalidated | **Deferred** — accepted as v1 limitation; will revisit if usability data later contradicts. |
| Determinism metric not pass/fail | **Acknowledged in prd.md** — moved out of Success Metrics framing into "quality goal" language under NFR Determinism. |
| FR-001 vague label/icon | **Deferred to design / tech-spec** — explicitly noted in prd.md Open Questions. |
| FR-006 "reasonable padding" | **Deferred to tech-spec** — Hephaestus to bind to React Flow's `fitView({ padding: 0.2 })` or similar concrete value. Noted in prd Open Questions. |
| Missing first-time-user persona | **Partially addressed** — tooltip and pre-run dialog (FR-011) preview the action's effect for > 50 table case. Below 50 tables, the action is "low-stakes enough" that immediate execution + toast is acceptable for v1. |
| Missing large-diagram persona | **Addressed** by FR-011 pre-run warning + 50-table threshold. |
| FR-008 reload-during-save consistency | **Addressed** in NFR Persistence — failure UX (point 4). |
| FR-005 vs FR-009 atomicity contradiction | **Addressed** by FR-009 resolution — local atomicity preserved, remote bulk-broadcast mitigates. |
| Accessibility — completion announcement | **Deferred to tech-spec** — recommend `aria-live="polite"` toast, but not promoted to FR/NFR in this revision. Flagged for Apollo (spec review). |
| Accessibility — keyboard alternative if toolbar collapses | **Deferred to tech-spec** — confirm toolbar reachability or promote FR-031 to P1. |
| Undo dependency (FR-021 / Open Q #4) | **Deferred** — Kratos to investigate global undo before tech-spec. FR-021 stays P1 with caveat. |
| Risks row 1 — d3-force adequacy on dense graphs | **Deferred to tech-spec** — Hephaestus to produce a small POC or cite prior art before committing to the algorithm; FR-004 16px contract is the testable gate. |
| Risks row 6 — fit-view test ownership | **Deferred to test-plan** — Cassandra/Artemis to own the test. |

## MINOR Findings

All 6 MINOR findings deferred to tech-spec or accepted as-is. Pain Points #2 and "typical FK density" are now bound by the NFR Performance fixture definition, partially addressing two of the MINOR vagueness flags.

## Net Score Change vs prd-challenge.md

- BLOCKING: 8 → **0** (all resolved in revision 1.1)
- MAJOR: 13 → **9** (4 directly addressed; 9 deferred to tech-spec / acknowledged limitations)
- MINOR: 6 → **6** (no change; deferred)

## Recommendation

Approve the revised PRD (v1.1) for progression to the next pipeline stage. Remaining MAJOR/MINOR items are appropriate for tech-spec or test-plan resolution. Hephaestus should explicitly handle:
- React Flow `fitView` padding value (FR-006).
- d3-force algorithm POC or prior-art citation (Risks row 1).
- `aria-live="polite"` semantics for the completion toast (Accessibility).
- Toolbar button keyboard reachability across viewport sizes.
- Implementation of `updateTablePositionsBulk` + `table:move:bulk` (NFR Persistence).
- Web Worker vs `requestAnimationFrame`-chunked simulation (FR-007 longtask budget).

## Verdict

approved
