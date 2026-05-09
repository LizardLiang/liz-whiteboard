# Feature: Auth Security Hardening

## Overview
Fix 5 security vulnerabilities identified in PR #97 (account-authentication) code review.

## Priority
P0 (Critical) — security holes in code about to merge

## Bugs Being Fixed
1. **Superpassword bypass** — hardcoded password grants admin access in production
2. **WebSocket IDOR: column:create** — missing whiteboard ownership check
3. **Batch column RBAC gap** — batch operations skip RBAC check on all items
4. **Session expired modal unwired** — `session_expired` event never triggers `triggerSessionExpired()`
5. **Missing RBAC on server functions** — `findEffectiveRole`/`hasMinimumRole` absent from server-functions.ts

## Current Stage
Stage 1: PRD Creation (in-progress)

## Pipeline Status
| Stage | Status | Agent | Document |
|-------|--------|-------|----------|
| 1. PRD | In Progress | Athena | prd.md |
| 2. PRD Review | Pending | Nemesis | prd-challenge.md |
| 3. Decomposition | Pending | Daedalus | decomposition.md |
| 4. Discuss | Pending | Themis | context.md |
| 5. Tech Spec | Pending | Hephaestus | tech-spec.md |
| 6. SA Spec Review | Pending | Apollo | spec-review-sa.md |
| 7. Test Plan | Pending | Artemis | test-plan.md |
| 8. Implementation | Pending | Ares | implementation-notes.md |
| 9. PRD Alignment | Pending | Hera | prd-alignment.md |
| 10. Review | Pending | Hermes + Cassandra | code-review.md + risk-analysis.md |

## History
- 2026-05-09: Feature created by Kratos
