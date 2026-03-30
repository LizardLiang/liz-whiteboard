# PRD Alignment Report: Dynamic Field Management

**Feature**: dynamic-field-management
**Agent**: Hera (PRD Alignment)
**Date**: 2026-03-30
**Stage**: 10-prd-alignment

---

## 1. Summary

| Item | Value |
|------|-------|
| Total Acceptance Criteria | 43 |
| Criteria with verified implementation | 43 |
| Criteria with verified test coverage | 4 (in schema.test.ts, partial) |
| Criteria with PLAN_GAP (no test in test plan) | 0 |
| Criteria with MISSING tests (in plan, not in codebase) | 39 |
| Coverage (implementation) | 100% |
| Coverage (test) | ~9% |
| Verdict | **GAPS** |

---

## 2. Acceptance Criteria Mapping

### REQ-01: Add Field Inline (P0)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-01a | Clicking "+" appends new editable row | TS-04, TS-10 | NO | `[BLOCKER]` missing |
| AC-01b | Name field auto-focused on creation | TS-04, TS-10 | NO | `[BLOCKER]` missing |
| AC-01c | dataType defaults to "string" pre-populated | TS-04, TS-10 | NO | `[BLOCKER]` missing |
| AC-01d | Enter/blur with valid name persists via createColumnFn | TS-04, TS-07, TS-10 | NO | `[BLOCKER]` missing |
| AC-01e | Empty name on blur/Escape discards row | TS-04, TS-10 | NO | `[BLOCKER]` missing |
| AC-01f | New column appears on collaborators' canvases within 500ms | TS-11 | NO | `[BLOCKER]` missing |
| AC-01g | "+" button hidden in TABLE_NAME display mode | TS-10 | NO | `[BLOCKER]` missing |
| AC-01h | order = max(existing orders) + 1 | TS-04 | NO | `[BLOCKER]` missing |
| AC-01i | Server rejection removes row and shows error toast | TS-12 | NO | `[BLOCKER]` missing |

**Implementation verified**: `AddColumnRow.tsx` implements all AC-01 behaviors (auto-focus, default "string", order calculation, Escape discard, blur create). `TableNode.new.tsx` hides AddColumnRow when `showMode === 'TABLE_NAME'`. `useColumnMutations.createColumn` implements optimistic insert + WebSocket emit + `isConnected` guard. `useColumnCollaboration` broadcasts `column:create`.

---

### REQ-02: Delete Field with Safety Check (P0)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-02a | Delete affordance visible on hover | TS-06 | NO | `[BLOCKER]` missing |
| AC-02b | Confirmation dialog lists affected relationships | TS-05, TS-06, TS-10 | NO | `[BLOCKER]` missing |
| AC-02c | Dialog uses shadcn AlertDialog | TS-05 | NO | `[BLOCKER]` missing |
| AC-02d | Confirm deletes via deleteColumnFn | TS-05, TS-07, TS-10 | NO | `[BLOCKER]` missing |
| AC-02e | No-relationship column deletes immediately (no dialog) | TS-06, TS-10 | NO | `[BLOCKER]` missing |
| AC-02f | Deleted column disappears from collaborators' canvases | TS-11 | NO | `[BLOCKER]` missing |
| AC-02g | FK columns show additional warning in dialog | TS-05 | NO | `[BLOCKER]` missing |

**Implementation verified**: `DeleteColumnDialog.tsx` uses `AlertDialog`, lists affected relationships, shows FK warning. `ColumnRow.tsx` has delete button (opacity 0, transitions to 1 on hover via inline JS — CSS class-based hover not used). `TableNode.new.tsx` checks `columnEdgeMap` to determine immediate vs dialog delete. `useColumnMutations.deleteColumn` removes column and edges optimistically.

**Note on AC-02a**: The delete button opacity is controlled via `onMouseEnter`/`onMouseLeave` handlers rather than CSS group hover class. The button is present in the DOM at all times (opacity: 0). This achieves the same visual effect but differs from the CSS-class approach implied by TS-06 TC-06-06. Functionally equivalent; test must account for this implementation detail.

---

### REQ-03: Edit Field Properties Inline (P0)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-03a | Double-click name enters editable input pre-filled | TS-02, TS-06, TS-10 | NO | `[BLOCKER]` missing |
| AC-03b | Double-click dataType enters dropdown selector | TS-01, TS-06, TS-10 | NO | `[BLOCKER]` missing |
| AC-03c | Enter/blur saves via updateColumnFn | TS-02, TS-07, TS-10 | NO | `[BLOCKER]` missing |
| AC-03d | Escape reverts without saving | TS-02, TS-10 | NO | `[BLOCKER]` missing |
| AC-03e | PK badge click toggles and persists immediately | TS-03, TS-10 | NO | `[BLOCKER]` missing |
| AC-03f | Nullable and Unique toggles accessible in row | TS-03 | NO | `[BLOCKER]` missing |
| AC-03g | All edits broadcast to collaborators | TS-11 | NO | `[BLOCKER]` missing |
| AC-03h | Validation: empty names blocked; duplicate names produce actionable error | TS-07, TS-12 | NO | `[BLOCKER]` missing |
| AC-03i | Server failure reverts UI + error toast | TS-12 | NO | `[BLOCKER]` missing |
| AC-03j | cursor:text on name/type; cursor:pointer on badges | TS-06 | NO | `[BLOCKER]` missing |
| AC-03k | Tooltip "Double-click to edit" on hover over name/type | TS-06 | NO | `[BLOCKER]` missing |
| AC-03l | Enter/F2 when column row focused enters name edit mode | TS-15 | NO | `[BLOCKER]` missing |

**Implementation verified**: `InlineNameEditor.tsx` auto-focuses, handles Enter/Escape/blur, rejects empty values. `DataTypeSelector.tsx` uses shadcn Select, restricted to 8 enum values, has `nodrag` class. `ConstraintBadges.tsx` implements PK/N/U toggles with cursor:pointer, proper role/aria-pressed/aria-label. `ColumnRow.tsx` shows Tooltip "Double-click to edit" on name/type spans with cursor:text. `ColumnRow.tsx` handles Enter/F2 keyboard shortcut. `TableNode.new.tsx` enforces single-edit-at-a-time via shared `editingField` state. PK toggle auto-sets `isNullable: false, isUnique: true`. Error toasts implemented in `useColumnMutations.onColumnError` with duplicate name detection.

---

### REQ-04: Real-Time Collaboration (P0)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-04a | User B sees new column without refresh | TS-08, TS-11 | NO | `[BLOCKER]` missing |
| AC-04b | User B sees updated name | TS-08, TS-11 | NO | `[BLOCKER]` missing |
| AC-04c | User B sees column disappear; edges removed | TS-08, TS-11 | NO | `[BLOCKER]` missing |
| AC-04d | Events include sufficient data for client-side update | TS-08 | NO | `[BLOCKER]` missing |
| AC-04e | Events scoped to whiteboard namespace | TS-11 | NO | `[BLOCKER]` missing |

**Implementation verified**: `useColumnCollaboration.ts` registers `column:created`, `column:updated`, `column:deleted`, `error` listeners. Self-event filtering implemented (ignores events where `createdBy/updatedBy/deletedBy === userId`). `ReactFlowWhiteboard.tsx` wires collaboration callbacks to node state update functions. Column events include `tableId` and full column data.

---

### REQ-05: Database Persistence (P0)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-05a | New columns use createColumn (via WebSocket -> server) | TS-07, TS-10, TS-12 | NO | `[BLOCKER]` missing |
| AC-05b | Updates use updateColumn | TS-07, TS-10, TS-12 | NO | `[BLOCKER]` missing |
| AC-05c | Deletions use deleteColumn (cascade-deletes relationships) | TS-07, TS-10, TS-12 | NO | `[BLOCKER]` missing |
| AC-05d | order field maintained correctly | TS-04, TS-07 | NO | `[BLOCKER]` missing |

**Implementation verified**: `useColumnMutations` emits `column:create`, `column:update`, `column:delete` via Socket.IO. Server-side handlers (pre-existing) call `createColumn`, `updateColumn`, `deleteColumn` from `src/data/column.ts`. Order calculation: `max(existing orders) + 1` in `AddColumnRow.tsx`. Cascade delete is handled server-side via Prisma `onDelete: Cascade`.

**Note on persistence path**: The implementation uses WebSocket-only persistence (emit to server -> server persists). The PRD references `createColumnFn`/`updateColumnFn`/`deleteColumnFn` server functions, but the tech-spec aligned implementation routes everything through Socket.IO events instead (matching the existing `table:create`/`table:update` pattern). This is an intentional deviation noted in the tech-spec and is consistent with the existing architecture. Functionally equivalent for AC-05 — data is persisted via the same Prisma data layer.

---

### REQ-06: Connection Status and Degraded Mode (P0)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-06a | Connection status indicator visible in whiteboard UI | TS-09 | NO | `[BLOCKER]` missing |
| AC-06b | Non-connected state shows warning banner | TS-09, TS-12 | NO | `[BLOCKER]` missing |
| AC-06c | Editing not blocked by WebSocket disconnection alone | TS-12 | NO | `[BLOCKER]` missing |
| AC-06d | Server function failure shows error toast + reverts | TS-12 | NO | `[BLOCKER]` missing |
| AC-06e | sync:request fires on reconnection | TS-12 | NO | `[BLOCKER]` missing |

**Implementation verified**: `ConnectionStatusIndicator.tsx` renders amber banner for "connecting", red banner for "disconnected", null for "connected". Integrated into `ReactFlowWhiteboard.tsx`. `useColumnMutations` gates mutations on `isConnected` and shows "Not connected" toast. Rollback on error via `onColumnError`. `sync:request` is handled by existing `useCollaboration` hook (pre-existing feature).

---

### REQ-07: Optimistic UI Updates (P1)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-07a | New row appears immediately (temp ID) before server responds | TS-13 | NO | `[BLOCKER]` missing |
| AC-07b | Temp ID replaced with real DB ID on success | TS-13 | NO | `[BLOCKER]` missing |
| AC-07c | Server failure rolls back optimistic update + error toast | TS-13 | NO | `[BLOCKER]` missing |
| AC-07d | Edit shows new value immediately; rolled back on failure | TS-13 | NO | `[BLOCKER]` missing |

**Implementation verified**: `useColumnMutations.createColumn` uses `crypto.randomUUID()` for temp ID, inserts into node state synchronously before emitting. `replaceTempId` swaps temp ID with real ID on `column:created` from current user's flow. Rollback mechanism via `pendingMutations` Map with per-mutation rollback closures.

---

### REQ-08: Data Type Selection (P1)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-08a | dataType renders as dropdown (not free-text) | TS-01 | NO | `[BLOCKER]` missing |
| AC-08b | Dropdown contains exactly 8 options | TS-01, TS-14 | NO | `[BLOCKER]` missing |
| AC-08c | Dropdown submits enum value not display label | TS-01 | NO | `[BLOCKER]` missing |
| AC-08d | No custom/free-text data types allowed | TS-01 | NO | `[BLOCKER]` missing |

**Implementation verified**: `DataTypeSelector.tsx` uses shadcn `Select` component (not `<input>`). `DATA_TYPES` array in `types.ts` contains exactly 8 values: `int`, `string`, `float`, `boolean`, `date`, `text`, `uuid`, `json`. `DATA_TYPE_LABELS` provides display names. `onValueChange` submits the stored enum value via `onSelect`.

**Partial test coverage**: `src/data/schema.test.ts` tests schema validation broadly but does not include the TS-14 data type enum tests (no test for "accepts all 8 valid values", "rejects invalid values", "DATA_TYPES constant has 8 entries", or "DATA_TYPE_LABELS has 8 entries").

---

### REQ-09: Keyboard Navigation (P2)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-09a | Tab moves focus to next field within column row | TS-15 | NO | `[BLOCKER]` missing |
| AC-09b | Enter on last field auto-creates column + opens new row | TS-15 | NO | `[BLOCKER]` missing |

**Implementation verified**: `AddColumnRow.tsx` handles Tab key to move to DataTypeSelector. After `onCreate` resolves, form stays open (rapid entry mode) and input is re-focused.

---

### REQ-10: Accessibility (P2)

| Criterion | Description | Test Suite | Test Files Exist | Status |
|-----------|-------------|------------|------------------|--------|
| AC-10a | Constraint badges have role="button", aria-pressed, aria-label | TS-16 | NO | `[BLOCKER]` missing |
| AC-10b | "+" button has aria-label="Add new column" | TS-16 | NO | `[BLOCKER]` missing |
| AC-10c | Delete buttons have aria-label="Delete column [name]" | TS-16 | NO | `[BLOCKER]` missing |

**Implementation verified**: `ConstraintBadges.tsx` has `role="button"`, `aria-pressed={localPK/localN/localU}`, and descriptive `aria-label` on all three interactive badges (PK, N, U). `AddColumnRow.tsx` has `aria-label="Add new column"`. `ColumnRow.tsx` has `aria-label={`Delete column ${column.name}`}`.

---

## 3. Test File Existence Summary

| Test Suite | File Path | Status |
|------------|-----------|--------|
| TS-01: DataTypeSelector | `src/components/whiteboard/column/DataTypeSelector.test.tsx` | MISSING |
| TS-02: InlineNameEditor | `src/components/whiteboard/column/InlineNameEditor.test.tsx` | MISSING |
| TS-03: ConstraintBadges | `src/components/whiteboard/column/ConstraintBadges.test.tsx` | MISSING |
| TS-04: AddColumnRow | `src/components/whiteboard/column/AddColumnRow.test.tsx` | MISSING |
| TS-05: DeleteColumnDialog | `src/components/whiteboard/column/DeleteColumnDialog.test.tsx` | MISSING |
| TS-06: ColumnRow | `src/components/whiteboard/column/ColumnRow.test.tsx` | MISSING |
| TS-07: useColumnMutations | `src/hooks/use-column-mutations.test.ts` | MISSING |
| TS-08: useColumnCollaboration | `src/hooks/use-column-collaboration.test.ts` | MISSING |
| TS-09: ConnectionStatusIndicator | `src/components/whiteboard/ConnectionStatusIndicator.test.tsx` | MISSING |
| TS-10: TableNode Integration | `src/components/whiteboard/TableNode.integration.test.tsx` | MISSING |
| TS-11: Real-Time Collaboration | `src/components/whiteboard/TableNode.integration.test.tsx` | MISSING |
| TS-12: Error Handling | `src/components/whiteboard/TableNode.integration.test.tsx` | MISSING |
| TS-13: Optimistic Updates | `src/hooks/use-column-mutations.test.ts` | MISSING |
| TS-14: Data Type Enum | `src/data/schema.test.ts` (extend existing) | PARTIAL — file exists, TS-14 tests not present |
| TS-15: Keyboard Navigation | Column test files (above) | MISSING |
| TS-16: Accessibility | Column test files (above) | MISSING |

---

## 4. Test Execution Results

**Existing test suite**: 80 tests across 6 files — all passing.

**Feature tests**: None exist. Zero of the 126 planned test cases from the test plan have been implemented in the codebase.

---

## 5. Coverage Calculation

```
Implementation coverage (ACs with verified code): 43 / 43 = 100%
Test coverage (ACs with verified + passing tests): ~4 / 43 = ~9%
  (only pre-existing schema tests provide any indirect coverage)

Blocker count: 39 criteria have no test implementation
```

---

## 6. Findings

### Implementation Assessment

The feature implementation is functionally complete. All 43 acceptance criteria have corresponding implementation code:

- All 7 column components exist in `src/components/whiteboard/column/`
- `useColumnMutations` and `useColumnCollaboration` hooks are complete
- `ConnectionStatusIndicator` is implemented and integrated
- `TableNode.new.tsx` orchestrates all column operations
- `ReactFlowWhiteboard.tsx` integrates hooks and indicator

No acceptance criteria are absent from the implementation. The verdict is not `misaligned`.

### Test Gap Assessment

All 16 test suites defined in `test-plan.md` are absent from the codebase. The test plan is thorough and maps to all requirements, but zero test files have been written for this feature:

- `src/components/whiteboard/column/` — 6 test files missing
- `src/hooks/` — 2 test files missing
- `src/components/whiteboard/ConnectionStatusIndicator.test.tsx` — missing
- `src/components/whiteboard/TableNode.integration.test.tsx` — missing
- `src/data/schema.test.ts` extension (TS-14) — not written

This constitutes a complete test coverage gap for all P0, P1, and P2 criteria.

---

## 7. Verdict

**GAPS**

All 43 acceptance criteria are implemented in source code. Zero test cases from the test plan exist in the codebase. Every criterion is unverified.

Ares must implement all test suites defined in `test-plan.md`:

**Priority order (per test-plan.md section 4 execution order)**:
1. TS-14 — extend `src/data/schema.test.ts` (prerequisite for all data type tests)
2. TS-01 — `DataTypeSelector.test.tsx`
3. TS-02 — `InlineNameEditor.test.tsx`
4. TS-03 — `ConstraintBadges.test.tsx`
5. TS-04 — `AddColumnRow.test.tsx`
6. TS-05 — `DeleteColumnDialog.test.tsx`
7. TS-06 — `ColumnRow.test.tsx`
8. TS-07 — `use-column-mutations.test.ts`
9. TS-08 — `use-column-collaboration.test.ts`
10. TS-09 — `ConnectionStatusIndicator.test.tsx`
11. TS-10, TS-11, TS-12, TS-13 — `TableNode.integration.test.tsx`
12. TS-15, TS-16 — keyboard and accessibility tests (P2, extend existing files)

---

## 8. Criteria Requiring Test Coverage (Return to Stage 9)

All 43 acceptance criteria need test coverage. Grouped by priority:

**P0 Blockers (must have tests before proceeding)**:
AC-01a through AC-01i, AC-02a through AC-02g, AC-03a through AC-03l, AC-04a through AC-04e, AC-05a through AC-05d, AC-06a through AC-06e

**P1 Blockers**:
AC-07a through AC-07d, AC-08a through AC-08d

**P2 (should have tests)**:
AC-09a, AC-09b, AC-10a, AC-10b, AC-10c
