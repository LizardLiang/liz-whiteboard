# PRD Adversarial Review -- Column Reorder (Round 2)

## Reviewer

Nemesis (Devil's Advocate + User Advocate) -- 2026-04-30 (Round 2)

## Verdict: APPROVED

## Executive Summary

Round 1 returned REVISIONS with 5 BLOCKING, 9 MAJOR, and 6 MINOR findings. Athena's Revision 1 addresses every BLOCKING and MAJOR item with material, testable changes (not hand-waves), and resolves all MINOR items as well. The revision introduces three new requirements (REQ-12 tooltip, REQ-13 reduced-motion, REQ-14 overwrite notification, REQ-15 toast guidance), one new section (Section 12 -- WCAG Debt), one new section (Section 13 -- Required Spikes), and tightens measurement methodology in Section 3. No new BLOCKING or MAJOR gaps were introduced by the revision. The PRD is now unambiguous enough for tech-spec entry.

## Round 2 Verification Matrix

### BLOCKING items from Round 1 -- all RESOLVED

| #   | Round 1 Finding               | Round 2 Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                        | Verification                                                                              |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | FM-05 silent overwrite        | REQ-14 added (P0). AC-14a-g specify buffer-on-mid-drag, comparison logic on drop, exact toast text, dismissal, no-op exception, post-toast convergence. AC-07c references REQ-14. FM-05 handling step 3 invokes REQ-14. Flow 3 walks the journey end-to-end.                                                                                                                                                                                              | RESOLVED. Comparison logic is non-trivial but testable; toast text is specified verbatim. |
| 2   | FM-04 silent reorder loss     | REQ-08 AC-08e/f added. Detection rule is purely "after reconnect-sync, does server order differ from optimistic order?" -- no special tagging required. Toast text specified verbatim. FM-04 handling step 4 invokes REQ-08 AC-08e. Flow 5 walks the disconnect-reconnect-mismatch journey.                                                                                                                                                               | RESOLVED. Detection rule is implementable without new server protocol.                    |
| 3   | p95 latency methodology       | Section 3 "Measurement Methodology Reference" added. Drop = `performance.mark('column-reorder:drop')` at first line of `pointerup` handler. Remote-paint = first rAF after socket-event handler whose DOM read confirms new order. Sample size ≥ 30. Warm cache. Both localhost (500ms p95) AND LAN (1000ms p95) targets specified. Clock alignment punted to tech-spec (acceptable -- it's a measurement-implementation detail, not a product decision). | RESOLVED. Methodology is now an engineer-implementable test, not a hope.                  |
| 4   | Optimistic <100ms methodology | Section 3 specifies `performance.mark('column-reorder:drop')` at `pointerup` and `performance.mark('column-reorder:local-paint')` at first rAF that confirms new DOM order. Sample size ≥ 30.                                                                                                                                                                                                                                                             | RESOLVED. Start and end timestamps are unambiguously defined.                             |
| 5   | First-time discovery          | REQ-12 added (P1, but P0-quality discovery vector). Tooltip "Drag to reorder" via shadcn Tooltip on 400ms hover. AC-12a-e cover hover delay, screen-reader announcement (aria-describedby), touch-device exclusion, dismissal on drag start. Two new personas added: Returning User and First-Time User.                                                                                                                                                  | RESOLVED. Discovery now relies on in-app tooltip, not external comms.                     |

### MAJOR items from Round 1 -- all RESOLVED

| Round 1 Finding                          | Round 2 Resolution                                                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-09 AC-09a "moderate speed"           | REQ-09 AC-09a: 600 px/s default; AC-09d: 300 px/s for reduced-motion. Tech-spec may use library default if within 20% (must be documented).                                                                                                 |
| Partial transaction success / Option B   | REQ-03 now mandates `prisma.$transaction`. Option B (parallel per-column writes) explicitly forbidden in PRD text. AC-03b atomicity is now trivially satisfiable.                                                                           |
| FM-07 missing-column placement hand-wave | FM-07 specifies deterministic merge rule: A's order first, missing columns appended in ascending order of their existing `Column.order`, then full ordering re-sequenced to 0..N-1 within the same transaction.                             |
| Missing personas                         | Section 2 enumerates Database Designer, Collaborating Viewer, Returning User, First-Time User, Mac trackpad, Screen-reader, Reduced-motion, Touch -- each with explicit in/out/partial-V1 decision and justification.                       |
| WCAG 2.1.1 buried as P2 stretch          | Section 12 added. Explicit V1 non-conformance acceptance, conditions under which REQ-11 must promote to P0 (contractual/regulatory check, accessibility-statement audit), V1 mitigations (aria-label, tooltip-aria-describedby) documented. |
| "Refresh" toast guidance                 | REQ-15 added (P0). Operation-failed toasts say "try again" only. FM-01/03 toast text updated. AC-04e toast text updated and explicitly says "Refresh is NOT recommended".                                                                   |
| A4 weak "precedent" evidence             | Section 13 added with Spike S1 (React Flow pointer suppression) and S2 (edge re-anchor) MANDATORY before tech-spec entry. A4 description elevated to "Medium-to-High risk; MUST be validated by spike".                                     |
| AC-02c untestable "offset"               | AC-02c: exactly 8px right + 8px down from cursor hot-spot.                                                                                                                                                                                  |
| AC-02d untestable midpoint heuristic     | AC-02d: midpoint-crossing rule with directional behavior, no interpolation, hysteresis on exact-midpoint (line stays at previous position to prevent flicker), out-of-bounds = no-op cancel.                                                |

### MINOR items from Round 1 -- all RESOLVED

| Round 1 Finding                                | Round 2 Resolution                                                                                                                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-02a "~50%"                                  | Now exactly 50% (`opacity: 0.5`).                                                                                                                                                                                                                         |
| AC-02b "~80%"                                  | Now exactly 80% (`opacity: 0.8`).                                                                                                                                                                                                                         |
| A9 vs OQ-5 conflicting numbers (40+ vs 30)     | Unified at 30 columns minimum.                                                                                                                                                                                                                            |
| `reorderedBy` field with no consumer           | Now consumed by REQ-14 (overwrite notification toast may include collaborator's display name). Justification documented in REQ-04 event description.                                                                                                      |
| REQ-07 circular ("matching existing patterns") | New "Why an explicit decision" section in REQ-07 distinguishes single-field edits (last-write-wins is non-controversial) from batch reorder (last-write-wins requires REQ-14 to avoid silent overwrite). Argument is now independent of pattern-matching. |
| Rapid-succession persona                       | AC-08d adds FIFO queue bounded to 5 pending reorders, with toast on overflow.                                                                                                                                                                             |
| AC-04c "visible" hand-wave                     | Tightened: "between the receipt of the `column:reordered` event and the next painted frame, no intermediate ordering... is observable in the React Flow node DOM."                                                                                        |

## New-Gap Audit (Round 2)

The revision introduces several new requirements and ACs. I scanned for new BLOCKING / MAJOR risks introduced by the revision itself.

### New requirements scrutinized

- **REQ-12 (Tooltip)** -- AC-12a-e are testable. AC-12c correctly excludes touch (consistent with V1 scope). AC-12d (dismiss on `pointerdown`) prevents tooltip-during-drag visual artifact. No gap.
- **REQ-13 (Reduced-motion)** -- AC-13a-c specify `matchMedia` check at drag-start, no easing on ghost-row tracking, instant insertion-line transitions. Cleanly scoped. No gap.
- **REQ-14 (Overwrite notification)** -- AC-14a-g cover all branches (mid-drag buffering, drop-time comparison, no-op exception, strict-subset exception, dismissal, post-toast convergence). AC-14b's "B's change is not a strict subset of A's change" comparison is non-trivial logic, but it is precisely defined and testable.
- **REQ-15 (Toast guidance)** -- AC-15a-c. The split between "operation-failed" (try again) and "connection-degraded" (try again, but the connection-status indicator is the primary signal) is sensible and actionable.
- **Section 12 (WCAG Debt)** -- The two pre-ship checks (no contractual obligation, accessibility-statement audit) are owned by tech-spec phase. This is the right placement -- it's not a PRD-internal blocker, it's an external constraint that must be verified.
- **Section 13 (Spikes)** -- S1 and S2 are scoped (30 min and 15 min respectively), have pass/fail outcomes, and have direct tech-spec implications. Correctly placed as pre-tech-spec gates.
- **AC-08d (FIFO bound = 5)** -- The "Slow down" toast text is reasonable; blocking the 6th drag at `pointerdown` is the correct UX (prevents lost intent rather than queuing it).

### Potential nits (NOT blocking, NOT major)

- `[MINOR]` REQ-09 AC-09a -- "tech-spec may use the chosen DnD library's documented default value if it differs by < 20%" introduces a small flexibility window. The PRD requires the value to be documented in tech-spec, which is the right control. Acceptable as written.
- `[MINOR]` Section 3 -- Clock alignment between User A and User B for cross-machine latency measurement is punted to tech-spec ("WebSocket round-trip subtraction OR NTP-equivalent server timestamp echo"). This is a measurement-implementation detail, not a product decision. Acceptable.
- `[MINOR]` REQ-14 AC-14b -- The "strict subset" comparison is moderately complex client-side logic. The tech-spec will need to specify the exact comparison algorithm (set difference vs. positional difference), but the PRD's intent ("at least one position that B had moved is overwritten by A") is unambiguous. Acceptable -- this is the right level of PRD detail; algorithmic specifics belong in tech-spec.

None of the above rise to BLOCKING or MAJOR.

## Score

BLOCKING: 0 | MAJOR: 0 | MINOR: 0 (all Round 1 minors resolved; Round 2 nits noted but non-flagged) | Total: 0 unresolved

## Summary

The revised PRD:

1. Closes every silent-data-loss path the user could be exposed to (REQ-14 covers in-flight overwrite, REQ-08 AC-08e covers post-reconnect rollback).
2. Replaces every vague metric with a `performance.mark`-instrumented, sample-sized, dual-environment (localhost + LAN) measurement.
3. Mandates transactional persistence at the requirement level so partial-failure intermediate states are architecturally impossible.
4. Surfaces accessibility debt explicitly with pre-ship verification gates rather than burying it.
5. Forbids "refresh" guidance in operation-failed toasts to protect unrelated unsaved user state.
6. Promotes Assumption A4 (React Flow pointer suppression) to a mandatory pre-tech-spec spike.

The PRD is approved for tech-spec entry. Hephaestus must:

- Complete Spikes S1 and S2 before writing the tech spec (per Section 13).
- Document the chosen auto-scroll velocity if it deviates from 600 px/s (per AC-09a).
- Specify the comparison algorithm for AC-14b (strict-subset vs. positional difference).
- Verify the WCAG 2.1.1 Level A non-conformance against any contractual or regulatory obligation before V1 ship (per Section 12).

No further PRD revisions required.
