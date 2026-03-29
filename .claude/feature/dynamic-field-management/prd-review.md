# PRD Review: Dynamic Field Management

**Reviewer**: Athena (PM Agent)
**Date**: 2026-03-29
**PRD Version**: Draft
**Verdict**: **Revisions**

---

## Overall Assessment

This is a well-structured, thorough PRD that correctly identifies the gap (read-only TableNode), leverages existing backend infrastructure, and defines clear user flows with comprehensive acceptance criteria. The problem statement is strong, the scope is well-bounded, and the failure modes section is notably complete for a V1 feature.

However, there are **two factual inaccuracies** that would cause implementation failures if not corrected, plus several smaller gaps that need attention before this moves to tech spec.

---

## Evaluation Criteria

### 1. Problem Statement
**Rating**: Pass

The problem statement is clear, non-circular, and grounded in a real user pain point. It correctly identifies that the backend CRUD exists and the gap is frontend-only. No issues.

### 2. User Personas
**Rating**: Pass

Two distinct personas with clear roles. The primary user (Database Designer) has well-defined expectations. The secondary user (Collaborating Viewer) is correctly scoped to real-time observation only.

### 3. Success Metrics
**Rating**: Pass

All five metrics have a number, baseline, target, and owner. The 500ms and 100ms latency targets are concrete and measurable. The "0 per 100 operations" data loss target is testable.

### 4. Requirements and Acceptance Criteria
**Rating**: Revisions Required

The requirements are detailed and individually testable, with one critical exception:

**CRITICAL -- REQ-07 (Data Type Suggestions) contradicts the actual codebase.**

- **AC-07a** lists SQL-style types: `VARCHAR, INTEGER, TEXT, BOOLEAN, TIMESTAMP, UUID, FLOAT, SERIAL, JSON, DATE`.
- The actual Zod validation schema (`src/data/schema.ts`, line 57) uses a **strict enum**: `int, string, float, boolean, date, text, uuid, json`.
- These are different names (`VARCHAR` vs `string`, `INTEGER` vs `int`) and include types not in the enum (`TIMESTAMP`, `SERIAL`).
- Any column created with the PRD's suggested types would **fail Zod validation** at the server function layer.

- **AC-07b** states "The user can also type a custom data type not in the list." This is **impossible** with the current strict `z.enum()` schema. Custom types would fail validation. Either the schema must be changed (which contradicts Assumption A2 "no migration required") or AC-07b must be removed.

**Action Required**: Update REQ-07 to list the actual enum values (`int, string, float, boolean, date, text, uuid, json`) and remove AC-07b (custom types), OR explicitly state that a schema change is needed and update Assumption A2 accordingly.

### 5. Scope Boundaries
**Rating**: Pass

Both in-scope and out-of-scope are clearly defined. The explicit exclusion of drag-to-reorder, table CRUD, relationship management, undo/redo, and bulk operations is thorough and prevents scope creep.

### 6. Failure Modes
**Rating**: Pass

Six failure modes covering server errors, WebSocket disconnection, concurrent edits, and cross-user edit/delete conflicts. FM-05 (last-write-wins) and FM-06 (deletion during edit) are particularly well-thought-out for V1. Each failure mode has trigger, impact, and handling.

### 7. Assumptions
**Rating**: Revisions Required

**Assumption A2** states: "The existing Prisma Column model has all fields needed (no migration required)" and claims it was "verified by reading prisma/schema.prisma."

This is **conditionally correct** -- the Column model does have all needed fields. However, if REQ-07 AC-07b (custom data types) is kept, the `dataType` column is currently a `VARCHAR(50)` in the database but validated by a strict Zod enum on the server side. The Prisma schema would not need a migration, but the Zod schema would need modification. This should be clarified.

### 8. External API Dependencies
**Rating**: N/A (no external APIs)

No external APIs are involved. The PRD correctly identifies only internal dependencies.

---

## Factual Accuracy Check (Codebase Verification)

| PRD Claim | Verified | Finding |
|-----------|----------|---------|
| `createColumnFn` exists in `src/routes/api/columns.ts` | Yes | Confirmed at line 111 |
| `updateColumnFn` exists in `src/routes/api/columns.ts` | Yes | Confirmed at line 150 |
| `deleteColumnFn` exists in `src/routes/api/columns.ts` | Yes | Confirmed at line 202 |
| `getColumnsByTableId` exists | Yes | Confirmed at line 23 |
| Column model has all needed fields | Yes | Confirmed: id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, description, order |
| Cascade delete works for relationships | Yes | `Relationship.sourceColumn` and `Relationship.targetColumn` both have `onDelete: Cascade` |
| `@@unique([tableId, name])` prevents duplicate names | Yes | Confirmed at line 102 of schema |
| WebSocket only handles `table:moved` currently | Yes | `use-whiteboard-collaboration.ts` only listens for `table:moved` and `table:position-updated` |
| Zod schema uses enum for dataType | **Mismatch** | Schema uses `z.enum(['int', 'string', 'float', 'boolean', 'date', 'text', 'uuid', 'json'])`, not the SQL-style names listed in the PRD |
| Appendix A says `dataType: enum` | **Incomplete** | Does not list the actual enum values, creating ambiguity |

---

## Required Revisions

### R1: Fix Data Type List in REQ-07 (P0 -- Blocks Implementation)

**Current**: AC-07a lists `VARCHAR, INTEGER, TEXT, BOOLEAN, TIMESTAMP, UUID, FLOAT, SERIAL, JSON, DATE`.

**Required**: Replace with the actual Zod enum values: `int, string, float, boolean, date, text, uuid, json`. If SQL-style names are desired as display labels, state that explicitly (e.g., "Display `Integer` in the dropdown, submit `int` to the server").

### R2: Remove or Rewrite AC-07b Custom Data Types (P0 -- Blocks Implementation)

**Current**: "The user can also type a custom data type not in the list."

**Required**: Either:
- (a) Remove AC-07b entirely and restrict to the enum values, OR
- (b) State that the Zod schema must be changed from `z.enum()` to `z.string()` and update Assumption A2 to reflect this scope change.

Option (a) is recommended for V1 simplicity.

### R3: Clarify Appendix A dataType Description (P1 -- Prevents Confusion)

**Current**: Appendix A describes `dataType: enum` without listing the values.

**Required**: List the actual enum values: `dataType: enum('int' | 'string' | 'float' | 'boolean' | 'date' | 'text' | 'uuid' | 'json')`.

---

## Observations (Non-Blocking)

These are not required revisions but are worth noting for the tech spec author:

1. **REQ-02 confirmation dialog**: The PRD says to list "affected relationships" but does not specify where the relationship data comes from. The current `deleteColumnFn` does not return relationship info before deletion. The frontend would need to either (a) already have relationship data loaded in the React Flow edges, or (b) make a separate query. This is a technical decision for Hephaestus but worth flagging.

2. **Open Question OQ-2 answer is correct but could be more precise**: The PRD says "FK references are by column ID, not name." This is verified -- the Relationship model uses `sourceColumnId` and `targetColumnId` (UUIDs), not column names. The answer is accurate.

3. **Display mode interaction (AC-01f)**: The PRD mentions `TABLE_NAME`, `ALL_FIELDS`, and `KEY_ONLY` modes. The "+" button visibility rule is clear, but the edit/delete affordances in `KEY_ONLY` mode are not explicitly addressed. Should users be able to edit/delete only the visible key columns, or all columns? This could be clarified.

4. **The `order` field default is 0**: AC-01g says "set to max(existing orders) + 1" but the Zod schema defaults `order` to 0. The frontend must explicitly calculate and pass the correct order value; it cannot rely on the default.

---

## Decisions Log Review

The `decisions.md` file is well-maintained with 10 product decisions, each with rationale and trade-offs. Key decisions (inline over sidebar, double-click convention, last-write-wins for V1, confirmation only for FK columns) are all sound and well-justified.

---

## Verdict: Revisions

The PRD is strong overall but contains factual inaccuracies in REQ-07 that would cause implementation failures. Specifically, the data type list does not match the codebase's Zod enum, and the "custom data type" acceptance criterion is impossible with the current validation layer. These must be corrected before proceeding to tech spec.

**Estimated effort to fix**: Small -- 15 minutes of PRD updates. No structural changes needed.

**After revisions**: This PRD is ready for tech spec. The requirements are well-scoped, the backend is verified, and the user flows are complete.
