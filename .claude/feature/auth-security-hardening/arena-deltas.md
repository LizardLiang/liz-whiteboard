# Arena Deltas for Feature: auth-security-hardening

**Base Arena Hash**: 515fca9a7ea1cd096b312e0cda88bded10113d55  
**Feature Branch**: master  
**Created**: 2026-05-09T01:09:26+08:00  
**Last Updated**: 2026-05-09T01:09:26+08:00

---

## Purpose

This file captures feature-specific discoveries and changes that are NOT yet in the Master Arena. After this feature merges to main, these deltas will be integrated into the Master Arena documents.

---

## External Research (Athena + Mimir)

**Research Conducted**:

- {topic} researched via {source}
- Key findings: {summary}

**Cached Insights**:

- `.claude/.Arena/insights/{topic}-{date}.md` - {description}

---

## Codebase Discoveries (Hephaestus)

**New Directories**:

- `tools/eslint-rules/` — inline ESLint rule bodies imported by `eslint.config.js` (AD-2). First custom-rule infrastructure in the repo.

**New Files** (planned per tech-spec §5):

- `src/lib/auth/require-role.ts` — centralized authz: `requireRole` (WebSocket), `requireServerFnRole` (server functions), `ForbiddenError`, `BatchDeniedError`, denial counter.
- `src/lib/auth/log-sample.ts` — sampled ERROR logger (60s window per `(userId, errorClass)`) for fail-closed RBAC throws.
- `src/hooks/use-column-draft-persistence.ts` — sessionStorage column-edit draft store keyed `draft:${whiteboardId}:${columnId}`.
- `tools/eslint-rules/require-server-fn-authz.js` — AST guard for SEC-RBAC-04 + SEC-MODAL-02 single-registration check.

**Dependencies Added**:

- None. ESLint 9 inline plugin syntax used (no `eslint-plugin-*` npm package). All RBAC primitives already exist in `@/data/permission` + `@/lib/auth/permissions`.

**Architecture Changes**:

- **Authz centralization pattern**: every WebSocket mutation handler in `src/routes/api/collaboration.ts` and every `createServerFn` export across `src/` flow through one of two helpers (`requireRole` or `requireServerFnRole`). The legacy no-op `denyIfInsufficientPermission` becomes a thin wrapper around `requireRole`. Single source of truth for "who can do what on which whiteboard."
- **JSDoc `@requires <role>` contract** (PRD SEC-RBAC-03): every server-function export carries a structured JSDoc tag with one of `{authenticated, unauthenticated, viewer, editor, admin, owner}`. Statically verified by the AST guard.
- **Canonical auth-error shapes**: `ForbiddenError` (HTTP 403 `{error, message}`) and the WebSocket `error` event with `{code, event, message}` (where `code ∈ {FORBIDDEN, BATCH_DENIED}`). Coexists temporarily with the legacy `socket.emit('error', { event, error, message })` shape (per GA-ERROR-SHAPE-MIGRATION lock — only the 5 patched sites adopt the canonical shape).
- **All-or-nothing batch policy**: `createColumnsFn` (HTTP) pre-validates RBAC + ownership for every item before any DB write. On any denial, throws `BatchDeniedError` without revealing the failing item index (anti-enumeration per AUTH-PERM-03).
- **Column-form sessionStorage recovery**: in-flight column-edit modal form values persist to sessionStorage before session-expired redirect; restored on modal mount after re-authentication. Scope locked to column-edit only per GA-MODAL-RECOVERY-SCOPE.

**Codebase Patterns Verified** (existing, reused):

- `findEffectiveRole(userId, projectId)` in `src/data/permission.ts` already returns `'OWNER' | ProjectRole | null`.
- `hasMinimumRole(effective, required)` in `src/lib/auth/permissions.ts` already implements the role hierarchy.
- `getWhiteboardProjectId / getTableProjectId / getColumnProjectId / getRelationshipProjectId / getFolderProjectId` in `src/data/resolve-project.ts` already cover the resolve-projectId-from-resource needs.
- `requireAuth` HOF in `src/lib/auth/middleware.ts` already wraps server functions with session validation. The new `requireServerFnRole` composes inside `requireAuth`, not replacing it.
- `useCollaboration` hook (`src/hooks/use-collaboration.ts`) already owns the single `socket.on('session_expired', ...)` registration. The fix is to make its `onSessionExpired` callback mandatory (TypeScript-required) so the four call sites must wire `triggerSessionExpired` from `useAuthContext`.

**Defects Confirmed in Existing Code** (root cause: PR #97 left RBAC stubs as no-ops):

- 13 WebSocket mutation handlers all gate via `denyIfInsufficientPermission()` → `async () => false` no-op.
- 28+ `createServerFn` exports across `src/lib/` and `src/routes/api/` carry `// TODO: restore permission check — temporarily disabled` blocks with the real check commented out.
- Superpassword bypass lives in `src/routes/api/auth.ts` lines 129-138 as a `process.env.DEBUG_SUPER_PASSWORD` env-var-gated bypass ORed into `verifyPassword` result. (Not in `password.ts` itself — that function is clean.)
- Three `useCollaboration` call sites omit the `onSessionExpired` argument, so `socket.on('session_expired', ...)` fires `?.()` against undefined.

**Source References**:

- See `tech-spec.md` §1 (Architecture Decisions AD-1..AD-8), §2 (Defect Enumeration Appendix — discharges PRD §9 row 1 gating requirement), §3 (Component Design), §4 (Implementation Plan), §5 (Files create/modify).

---

## Architecture Validation (Apollo)

**Patterns Verified**:

- {pattern} follows existing {convention}

**Notes**:

- {any architectural concerns or recommendations}

---

## Implementation Details (Ares)

**Files Created**:
| File | Purpose | Status |
|------|---------|--------|
| {path} | {description} | Done |

**Files Modified**:
| File | Changes | Status |
|------|---------|--------|
| {path} | {description} | Done |

**Key Implementation Notes**:

- {important implementation details}
- {any deviations from tech spec}

---

## Code Review Notes (Hermes)

**Quality Assessment**:

- Code quality: {assessment}
- Test coverage: {percentage}%
- Security review: {passed/concerns}

**Ready for Integration**:

- [x] All code complete
- [x] Tests passing
- [x] No security issues
- [x] Follows conventions

---

## Integration Checklist

When integrating these deltas into Master Arena:

### tech-stack.md

- [ ] Add new dependencies: {list}
- [ ] Update versions: {list}

### architecture.md

- [ ] Document new services: {list}
- [ ] Update component diagram
- [ ] Add new patterns: {list}

### file-structure.md

- [ ] Add new directories: {list}
- [ ] Update key files list

### conventions.md

- [ ] Document any new conventions discovered
- [ ] Note any exceptions to existing patterns

### project-overview.md

- [ ] Update if feature significantly changes project scope

---

## Conflicts Resolved

If this delta contradicted Master Arena, document here:

| Arena Claimed | Delta Found | Resolution     |
| ------------- | ----------- | -------------- |
| {old value}   | {new value} | {how resolved} |

---

## Notes

- This file is temporary and will be deleted after integration
- Master Arena remains read-only during feature development
- Agents read: Master Arena + This Delta = Combined View
