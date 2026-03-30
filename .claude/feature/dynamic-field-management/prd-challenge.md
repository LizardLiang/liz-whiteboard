# PRD Adversarial Review -- Dynamic Field Management (Round 2)

## Reviewer
Nemesis (Devil's Advocate + User Advocate) -- 2026-03-30

## Verdict: APPROVED

## Executive Summary
The revised PRD comprehensively addresses all four BLOCKING findings and all MAJOR findings from Round 1. Data types now match the actual Zod enum, Socket.IO column handlers have been verified against source code, connectivity loss UX is fully specified in REQ-06, and default data type behavior is explicit. The revision also resolved discoverability, error message specificity, cascade-delete verification, and edit-mode visual treatment. Remaining findings are minor and can be addressed during implementation.

---

## Round 1 Issue Resolution Verification

### BLOCKING Issues -- All Resolved

**DA-B1 (Data type mismatch): RESOLVED**
- REQ-08 now lists the correct 8 Zod enum values: `int`, `string`, `float`, `boolean`, `date`, `text`, `uuid`, `json`.
- Custom data types removed. Dropdown-only input specified (AC-08a, AC-08d).
- Verified against `src/data/schema.ts` lines 70-79: `dataTypeSchema = z.enum(['int', 'string', 'float', 'boolean', 'date', 'text', 'uuid', 'json'])`. Values match exactly.

**DA-B2 (Socket.IO server relay capability): RESOLVED**
- Verified against `src/routes/api/collaboration.ts`: `column:create` handler at line 358, `column:update` at line 390, `column:delete` at line 427. All three validate via Zod, persist to DB, and broadcast via `socket.broadcast.emit`.
- Events are namespace-scoped (dynamic namespace `/whiteboard/:whiteboardId` at line 77), confirming AC-04e.
- PRD updated Assumption A3 to "Low" risk with verification reference. Appendix B documents all column events with payloads.

**UA-B1 (Connectivity loss UX): RESOLVED**
- New REQ-06 defines three connection states (connected/reconnecting/disconnected) with visual indicators and banner messages.
- Correctly identifies that editing uses HTTP server functions and should NOT be blocked by WebSocket disconnection alone.
- Flow 5 walks through the full connectivity loss scenario including reconnection via `sync:request`.
- Verified: `useCollaboration` hook exports `connectionState` (type `'disconnected' | 'connecting' | 'connected'`) and emits `sync:request` on reconnection (line 139 of `src/hooks/use-collaboration.ts`).

**UA-B2 (Default data type for new columns): RESOLVED**
- REQ-01 step 5 explicitly states default is `"string"`. AC-01c added.
- Flow 1 updated to show "type dropdown (pre-set to 'string')".
- Decision log documents rationale for choosing `"string"` over `"text"` or `"int"`.

### MAJOR Issues -- All Resolved

**DA-M2 (Relationship data source): RESOLVED** -- REQ-02 now specifies React Flow edge data as the source. Assumption A7 added. Flow 2 references edge filtering.

**DA-M3 (Circular "no migrations" AC): RESOLVED** -- Moved to Assumption A2 with qualification.

**DA-M4 (Cascade-delete verification): RESOLVED** -- Verified against `prisma/schema.prisma` lines 143-144: both `sourceColumn` and `targetColumn` have `onDelete: Cascade`. Documented in AC-05c and Appendix A.

**DA-M5 (Default dataType unspecified): RESOLVED** -- Specified as `"string"` in REQ-01 step 5 and step 7.

**UA-M1 (Discoverability for double-click): RESOLVED** -- REQ-03 now specifies `cursor: text` on hover, `cursor: pointer` on badges, tooltip "Double-click to edit", highlighted background for edit state. ACs 03j, 03k added.

**UA-M3 (Duplicate name errors not actionable): RESOLVED** -- AC-03h specifies exact message format: "Column name '[name]' already exists in this table." FM-01 and FM-03 updated with specific messages.

**UA-M5 (Edit mode visual treatment): RESOLVED** -- REQ-03 now defines highlighted background, focused border, single-edit-at-a-time behavior, and commit-on-second-edit semantics.

---

## Devil's Advocate Findings (Round 2)

### BLOCKING

None.

### MAJOR

None.

### MINOR

**DA-m1: `[ASSUMPTION]` Order Calculation Is Frontend Responsibility -- AC-01h**
- **Location**: REQ-01 (AC-01h)
- **Challenge**: AC-01h states "the `order` field of the new column is explicitly calculated as `max(existing orders) + 1`." This is correct behavior, but the existing `createColumn` function in `src/data/column.ts` does NOT auto-calculate order -- it passes the Zod-validated value directly to Prisma (defaulting to 0). The frontend must compute this value before submitting. The PRD implies this but does not state it is a frontend calculation.
- **Risk**: Low. An engineer reading the AC will implement it correctly, but may initially assume the server handles it.
- **Suggested Fix**: Add a parenthetical: "calculated on the frontend before submission."

**DA-m2: `[ASSUMPTION]` Actionable Error Messages Require Error Parsing -- FM-01, FM-03, AC-03h**
- **Location**: FM-01, FM-03, AC-03h
- **Challenge**: The PRD promises specific error messages like "Column name '[name]' already exists in this table." However, the server-side error handling in `src/routes/api/collaboration.ts` (line 379-384) returns the raw Prisma error message wrapped in "Failed to create column: Unique constraint failed on the constraint: `Column_tableId_name_key`". To produce the user-friendly message, either (1) the frontend must pattern-match against the raw error string, or (2) the server handlers need modification to detect unique constraint violations and return structured errors.
- **Risk**: Low. This is an implementation detail, not a design gap. The PRD correctly specifies the desired UX; the engineer will need to implement error mapping somewhere in the stack.
- **Suggested Fix**: Note in the tech spec that error message mapping is needed (either server-side or client-side). This does not block the PRD.

**DA-m3: `[VAGUE_TERM]` "Non-intrusive banner" -- REQ-06 (AC-06b)**
- **Location**: REQ-06 (AC-06b)
- **Challenge**: "Non-intrusive banner or indicator" is not specific enough to guarantee consistent implementation. Banner could mean a toast, an inline bar, a floating element, etc.
- **Risk**: Low. The engineer will choose a reasonable implementation, and this is a UX polish detail.
- **Suggested Fix**: Can be resolved during implementation or tech spec.

---

## User Advocate Findings (Round 2)

### BLOCKING

None.

### MAJOR

None.

### MINOR

**UA-m1: `[MISSING_PERSONA]` Color-Blind Users for Connection Status**
- **Location**: REQ-06
- **Challenge**: Connection states use color as the primary differentiator (green/amber/red). Color-blind users cannot distinguish these. The PRD does include text labels ("Reconnecting...", "Disconnected") which mitigates this, but the color-only indicator (AC-06a mentions "Green indicator (or no indicator)") could be the sole feedback in the "connected" state.
- **Risk**: Very low. The text labels for non-connected states are sufficient. The connected state having no indicator at all (noted as an option) actually avoids the issue.
- **Suggested Fix**: Ensure the non-connected states always show text, not just color. The PRD already does this.

**UA-m2: `[MISSING_FAILURE_MODE]` Race Condition: User Clicks Delete While Another User Already Deleted**
- **Location**: FM-02
- **Challenge**: FM-02 covers the case where the column "was already deleted by another user" and says to show an error toast. But if the column was deleted by another user, the `column:deleted` WebSocket event should have already removed it from the UI. The race window is very small (between the WebSocket event arriving and the user clicking delete). FM-02's handling is correct but could be more precise.
- **Risk**: Very low. The idempotent delete handling (remove from local state on 404) is correct.

**UA-m3: `[ACCESSIBILITY_GAP]` F2/Enter Keyboard Entry Requires Focus Management Details**
- **Location**: REQ-03 (AC-03l)
- **Challenge**: AC-03l says "pressing Enter or F2 when a column row is focused enters edit mode." For this to work, column rows must be focusable (tabindex), and focus order within the table node must be defined. This is an implementation detail but worth noting.
- **Risk**: Low. The tech spec should address focus management.

**UA-m4 (Carried from Round 1, reclassified): `[MISSING_PERSONA]` Users on Mobile/Touch Devices**
- **Location**: Section 6 (Scope)
- **Status**: RESOLVED as explicit out-of-scope. The revised PRD adds "Touch/mobile device support" to Out of Scope with rationale. No further action needed.

---

## Score

| Category | Count |
|----------|-------|
| Unvalidated assumptions | 0 |
| Vague metrics | 0 |
| Scope drift | 0 |
| Circular requirements | 0 |
| Missing failure modes | 1 (minor race condition) |
| Missing error states | 0 |
| Missing personas | 1 (minor: color-blind for status) |
| Vague language / UX clarity | 1 (minor: banner style) |
| Accessibility gaps | 1 (minor: focus management) |
| Implementation notes | 2 (order calc, error parsing) |
| **Total** | **6** |

| Severity | Devil's Advocate | User Advocate | Combined |
|----------|-----------------|---------------|----------|
| BLOCKING | 0 | 0 | 0 |
| MAJOR | 0 | 0 | 0 |
| MINOR | 3 | 3 | 6 |

---

## Round 1 vs Round 2 Comparison

| Severity | Round 1 | Round 2 | Delta |
|----------|---------|---------|-------|
| BLOCKING | 4 | 0 | -4 |
| MAJOR | 10 | 0 | -10 |
| MINOR | 5 | 6 | +1 |
| **Total** | **19** | **6** | **-13** |

All BLOCKING and MAJOR issues from Round 1 have been resolved. The one additional MINOR finding (DA-m2, error parsing) was always latent but only became visible after the PRD specified exact error message formats. It does not affect the verdict.
