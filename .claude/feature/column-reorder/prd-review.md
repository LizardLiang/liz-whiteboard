# PRD Review -- Column Reorder

**Reviewer**: Nemesis (Adversarial Review) -- 2026-04-30
**Review document**: see `prd-challenge.md` for the complete adversarial findings (this file is the gate-conformant alias).

## Verdict: revisions

## Summary

The PRD is unusually thorough but has 5 BLOCKING issues that prevent tech-spec entry. The full findings (BLOCKING / MAJOR / MINOR breakdown, line-cited evidence, suggested fixes) are in `prd-challenge.md`.

## Blocking Issues (must fix before approval)

1. **FM-05 silent overwrite** -- A user mid-drag who drops after a buffered remote reorder silently overwrites the teammate's change. Add a passive notification or rebase-and-warn behavior.
2. **FM-04 silent reorder loss** -- Post-reconnect sync may silently revert a user's optimistic reorder. Add detection-and-toast to REQ-08.
3. **p95 latency methodology** -- Localhost-only target with no methodology, no LAN target, "remote-render" undefined. Specify all three.
4. **Optimistic <100ms methodology** -- "Drop" timestamp is ambiguous; no measurement methodology. Specify both.
5. **First-time discovery gap** -- Visibility != discoverability. Add a tooltip-on-handle requirement OR explicitly call out release-notes as the discovery vector.

## Major Issues

9 issues including: REQ-03 transactional-batch-update mandate, REQ-11 WCAG 2.1.1 Level A failure, FM-07 missing-column placement tightening, missing personas (first-time, screen-reader, trackpad, reduced-motion), AC-02c/AC-02d testability, "refresh" toast guidance, A4 React Flow pointer suppression spike. Full details in `prd-challenge.md`.

## Minor Issues

6 issues including: vague "~80%" / "~50%" opacity language, A9 / OQ-5 conflicting performance numbers, `reorderedBy` field with no consumer, REQ-04 AC-04c "no visible intermediate states" hand-waviness.

## Score

BLOCKING: 5 | MAJOR: 9 | MINOR: 6 | Total: 20

## Required Changes

PRD must be revised to address all 5 BLOCKING items and SHOULD address the 9 MAJOR items before re-review. See `prd-challenge.md` "If REVISIONS: Required Changes" section for the full list.

## Status

- Round 1 review: revisions
- Round 1 revision: in progress (Athena addressing all BLOCKING + MAJOR items, MINOR items where they intersect)
- Round 2 review: pending (Nemesis to re-review after Athena's revision)
