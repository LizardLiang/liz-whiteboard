# Tech Spec Review (PM Perspective): Dynamic Field Management

**Reviewer**: Athena (PM Agent)
**Date**: 2026-03-30
**Tech Spec Version**: Draft (2026-03-30)
**PRD Version**: Revised (2026-03-30, Revision Round 1)

---

## Verdict: Approved

The tech spec faithfully translates all PRD requirements into an implementable design. Every P0, P1, and P2 requirement is accounted for with corresponding components, hooks, and interaction specifications. The implementation plan phases map cleanly to PRD requirements. No product requirements are dropped, misinterpreted, or contradicted.

---

## 1. Requirements Coverage Matrix

| PRD Requirement | Priority | Spec Coverage | Status |
|----------------|----------|---------------|--------|
| REQ-01: Add Field Inline | P0 | AddColumnRow (Section 4.6), useColumnMutations create flow (Section 5.2) | Fully covered |
| REQ-02: Delete Field with Safety Check | P0 | DeleteColumnDialog (Section 4.7), ColumnRow delete button (Section 4.2), edge-based FK check | Fully covered |
| REQ-03: Edit Field Properties Inline | P0 | InlineNameEditor (4.3), DataTypeSelector (4.4), ConstraintBadges (4.5), editing state in TableNode (2.3) | Fully covered |
| REQ-04: Real-Time Collaboration | P0 | useColumnCollaboration hook (5.1), event flow (Section 7), FM-06 handling (7.2) | Fully covered |
| REQ-05: Database Persistence | P0 | Explicit reuse of existing server functions throughout; no new backend work | Fully covered |
| REQ-06: Connection Status | P0 | ConnectionStatusIndicator (4.8), banner behavior, degraded mode | Fully covered |
| REQ-07: Optimistic UI Updates | P1 | useColumnMutations (5.2) with create/update/delete rollback patterns | Fully covered |
| REQ-08: Data Type Selection | P1 | DataTypeSelector (4.4), DATA_TYPE_LABELS constant (Section 6), 8 enum values | Fully covered |
| REQ-09: Keyboard Navigation | P2 | Section 8.3 keyboard table, rapid entry in AddColumnRow | Fully covered |
| REQ-10: Accessibility | P2 | ARIA labels in ConstraintBadges (4.5), AddColumnRow (4.6), delete button mentions | Fully covered |

---

## 2. Acceptance Criteria Traceability

### REQ-01 (Add Field)
| AC | Spec Location | Covered |
|----|---------------|---------|
| AC-01a: "+" appends editable row | AddColumnRow Section 4.6 | Yes |
| AC-01b: Name field auto-focuses | AddColumnRow "auto-focused" behavior | Yes |
| AC-01c: DataType defaults to "string" | AddColumnRow "pre-set to string" | Yes |
| AC-01d: Enter/blur persists via createColumnFn | useColumnMutations create flow | Yes |
| AC-01e: Empty name discards row | AddColumnRow "Escape or blur with empty name: discard row" | Yes |
| AC-01f: Collaborator sync < 500ms | useColumnCollaboration emit on success | Yes |
| AC-01g: "+" hidden in TABLE_NAME mode | AddColumnRow "visible when showMode is ALL_FIELDS or KEY_ONLY" | Yes |
| AC-01h: Order = max(existing) + 1 | AddColumnRow order calculation code block | Yes |
| AC-01i: Server rejection shows error toast | useColumnMutations failure path | Yes |

### REQ-02 (Delete Field)
| AC | Spec Location | Covered |
|----|---------------|---------|
| AC-02a: Delete on hover | ColumnRow "visible on row hover, hidden otherwise" | Yes |
| AC-02b: FK column shows dialog with relationships | DeleteColumnDialog + edge filter logic | Yes |
| AC-02c: Uses shadcn AlertDialog | DeleteColumnDialog Section 4.7, install list Section 10 | Yes |
| AC-02d: Cascade-delete via deleteColumnFn | useColumnMutations delete flow | Yes |
| AC-02e: No-relationship = immediate delete | ColumnRow/DeleteColumnDialog logic | Yes |
| AC-02f: Real-time sync of deletion | useColumnCollaboration column:deleted | Yes |
| AC-02g: FK columns show additional warning | DeleteColumnDialog "FK columns get additional warning text" | Yes |

### REQ-03 (Edit Field)
| AC | Spec Location | Covered |
|----|---------------|---------|
| AC-03a: Double-click name -> input | InlineNameEditor Section 4.3 | Yes |
| AC-03b: Double-click type -> dropdown | DataTypeSelector Section 4.4 | Yes |
| AC-03c: Enter/blur saves | InlineNameEditor behavior | Yes |
| AC-03d: Escape reverts | InlineNameEditor behavior | Yes |
| AC-03e: PK badge click toggles | ConstraintBadges Section 4.5 | Yes |
| AC-03f: Nullable/unique compact UI | ConstraintBadges revised approach (always visible) | Yes |
| AC-03g: Edits broadcast | useColumnCollaboration emit | Yes |
| AC-03h: Duplicate name validation | useColumnMutations error detection (Prisma P2002) | Yes |
| AC-03i: Save failure reverts + toast | useColumnMutations update failure path | Yes |
| AC-03j: cursor:text on name/type | ColumnRow Section 4.2 behavior | Yes |
| AC-03k: "Double-click to edit" tooltip | ColumnRow Section 4.2, tooltip install | Yes |
| AC-03l: Enter/F2 keyboard shortcut | Section 8.3 keyboard table | Yes |

### REQ-03 Constraint Toggle Interactions
| Rule | Spec Location | Covered |
|------|---------------|---------|
| PK ON -> isNullable=false, isUnique=true | ConstraintBadges Section 4.5 | Yes |
| PK OFF -> only isPrimaryKey=false | ConstraintBadges Section 4.5 | Yes |

### REQ-04 through REQ-10
All remaining acceptance criteria are addressed. No gaps found.

---

## 3. User Flow Alignment

| PRD Flow | Spec Support | Notes |
|----------|-------------|-------|
| Flow 1: Add Column | AddColumnRow + useColumnMutations create | Matches step-by-step |
| Flow 2: Delete Column (with/without FK) | ColumnRow + DeleteColumnDialog + useColumnMutations delete | Edge-based lookup matches PRD |
| Flow 3: Edit Property | InlineNameEditor + DataTypeSelector + useColumnMutations update | Single-edit-at-a-time enforced |
| Flow 4: Toggle Constraint | ConstraintBadges + useColumnMutations update | PK auto-set rules implemented |
| Flow 5: Connectivity Loss | ConnectionStatusIndicator + degraded mode behavior | HTTP-first pattern preserves editing |

---

## 4. Scope Alignment

### In Scope: All items from PRD Section 6 are addressed in the spec.

### Out of Scope: The spec does not attempt to implement any out-of-scope items. Confirmed:
- No drag-to-reorder
- No table-level CRUD
- No relationship management
- No undo/redo
- No bulk operations
- No column description editing
- No field-level permissions
- No touch/mobile optimization
- No custom data types

---

## 5. Failure Mode Coverage

| PRD Failure Mode | Spec Handling |
|-----------------|---------------|
| FM-01: Server error on create | useColumnMutations create failure path, specific error messages |
| FM-02: Server error on delete | useColumnMutations delete failure, idempotent 404 handling |
| FM-03: Server error on update | useColumnMutations update failure, revert to previous value |
| FM-04: WebSocket disconnection | ConnectionStatusIndicator, banner warnings, HTTP-first approach |
| FM-05: Concurrent edits | Last-write-wins acknowledged, WebSocket broadcast for convergence |
| FM-06: Column deleted while being edited | Section 7.2 explicit handling -- exit edit mode, remove column |

---

## 6. Observations (Non-Blocking)

### 6a. Edge Cleanup on Column Delete
The spec correctly notes (Section 7.2) that React Flow may not automatically clean up edges when handles are removed. The explicit edge filtering approach in the `onColumnDeleted` handler is the right call. This aligns with the PRD's requirement that affected edges disappear for collaborators.

### 6b. ConstraintBadges Visibility Decision
The spec initially considered showing N/U badges only when active, then self-corrected to always-visible (matching PRD AC-03f). The final "revised approach" in Section 4.5 is correct. The self-correction is documented transparently, which is good.

### 6c. Rapid Entry Mode
The spec addresses REQ-09 AC-09b (rapid entry) in AddColumnRow Section 4.6: "After successful creation, row resets for potential rapid entry." This is a P2 requirement and the spec treats it appropriately -- included in Phase 7 of the implementation plan.

### 6d. Performance Consideration for 30+ Columns
The spec includes memoization strategy (Section 13.1) and pre-computed edge map (Section 13.2), which directly addresses PRD Assumption A6 and Open Question OQ-3. This proactive approach is appreciated.

### 6e. Error Message Specificity
The spec matches the PRD's requirement for actionable error messages: duplicate name detection uses Prisma P2002 error matching (Section 5.2), with the exact message format "Column name '[name]' already exists in this table" as specified in the PRD.

---

## 7. Minor Recommendations (Implementation Phase)

These are not blocking and do not require spec revision:

1. **Delete button aria-label**: The spec mentions ARIA labels for constraint badges and the "+" button but does not explicitly call out `aria-label="Delete column [name]"` from AC-10c. The ColumnRow component description mentions a delete button but the ARIA label should be confirmed during implementation.

2. **Tooltip component placement**: Tooltips inside React Flow nodes can have z-index challenges with the React Flow viewport. Implementation should verify tooltip visibility when nodes are near canvas edges.

3. **Edit mode visual indicator for collaborators**: The spec handles the case where a column is deleted while being edited (FM-06), but does not show other users that a column is currently being edited by someone. This is not in the PRD (and correctly out of scope), but worth noting for future iterations.

---

## 8. Decision Alignment

All product decisions from `decisions.md` are reflected in the tech spec:

| Product Decision | Spec Reflection |
|-----------------|-----------------|
| Inline editing (not sidebar/modal) | Component architecture is entirely inline within TableNode |
| "+" always visible | AddColumnRow visible in ALL_FIELDS and KEY_ONLY modes |
| Double-click to edit | Section 8.1, InlineNameEditor activation |
| Click-to-toggle constraints | ConstraintBadges single-click behavior |
| Confirmation only for FK columns | DeleteColumnDialog conditional rendering |
| Last-write-wins | Acknowledged in spec, no conflict resolution |
| No drag-to-reorder | Not mentioned in spec (correctly absent) |
| Reuse existing server functions | "Files Unchanged" section confirms no backend changes |
| HTTP-first, WebSocket-second | Section 2.2 Data Flow, explicitly documented as a decision |
| Optimistic UI as layered enhancement | Implementation plan phases 2-4 before phase 6 error handling |

---

## Summary

The tech spec is a thorough, well-structured translation of the PRD into implementation guidance. All 10 requirements are covered. All 6 failure modes are addressed. The component architecture, hook design, and implementation phasing are sound from a product perspective. The spec stays within its technical domain without contradicting any product decisions.

**Verdict: Approved** -- ready for SA review and implementation.
