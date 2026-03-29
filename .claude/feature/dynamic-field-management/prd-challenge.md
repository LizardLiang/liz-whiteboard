# PRD Adversarial Review -- Dynamic Field Management

## Reviewer
Nemesis (Devil's Advocate + User Advocate) -- 2026-03-29

## Verdict: REVISIONS

## Executive Summary
The PRD is well-structured with clear user flows and thorough failure mode coverage, but contains a critical factual error about the data type schema that would cause implementation to fail. The dataType field uses a strict Zod enum (`int`, `string`, `float`, `boolean`, `date`, `text`, `uuid`, `json`) but the PRD's REQ-07 suggests types like `VARCHAR`, `INTEGER`, `TIMESTAMP`, `SERIAL` that will be rejected by validation. Additionally, the PRD lacks error state coverage for several user-facing scenarios and makes unverified claims about the Socket.IO server's ability to relay custom events.

---

## Devil's Advocate Findings

### BLOCKING

**DA-B1: `[UNVALIDATED]` Data Type Mismatch -- REQ-07 vs. Actual Zod Schema**
- **Location**: REQ-07 (AC-07a), Appendix A (Zod schema description)
- **Challenge**: The PRD states in AC-07a that suggested types should include "VARCHAR, INTEGER, TEXT, BOOLEAN, TIMESTAMP, UUID, FLOAT, SERIAL, JSON, DATE." However, the actual `dataTypeSchema` in `src/data/schema.ts` (line 57-66) is a strict enum: `['int', 'string', 'float', 'boolean', 'date', 'text', 'uuid', 'json']`. Most of the suggested types (VARCHAR, INTEGER, TIMESTAMP, SERIAL) do not exist in this enum and will fail Zod validation. Furthermore, AC-07b says "the user can also type a custom data type not in the list" -- this is impossible with the current enum-based validation without a schema migration.
- **Appendix A also misrepresents the schema**: It states `dataType: enum` but describes it as a generic concept. The actual allowed values are much more restrictive than what the PRD promises.
- **Risk**: An engineer implementing REQ-07 will build a dropdown with types that the backend rejects. This is a factual error, not an assumption.
- **Suggested Fix**: Either (1) update the PRD to list only the actual enum values (`int`, `string`, `float`, etc.) and remove the "custom type" claim, or (2) explicitly add a new requirement to migrate the `dataTypeSchema` from an enum to a less restrictive `z.string()` with suggestions, and note this as a new migration/schema change (contradicting AC-05d "no new migrations required").

**DA-B2: `[UNVALIDATED]` Socket.IO Server Relay Capability -- REQ-04, Assumption A3**
- **Location**: REQ-04 (all ACs), Assumption A3, Dependencies table
- **Challenge**: The PRD states assumption A3 as "medium risk" but then builds all of REQ-04 (P0) on it. The `use-collaboration.ts` hook shows the client can emit arbitrary events, but there is no evidence that the Socket.IO server has handlers for `column:created`, `column:updated`, or `column:deleted`. The current server only relays `table:moved`/`table:position-updated` events. If the server does not have a generic relay mechanism, new server-side event handlers are required -- this is **missing scope**.
- **Risk**: REQ-04 is P0. If the server needs new handlers, the claim "no new backend work" is false, and the scope/effort estimate is wrong.
- **Suggested Fix**: Verify whether the Socket.IO server has generic event relay (broadcast-to-room) capability. If not, add an explicit requirement for server-side column event handlers, update the Dependencies table to reflect this, and remove/qualify assumption A3.

### MAJOR

**DA-M1: `[VAGUE_METRIC]` Success Metric "< 500ms on same network" -- Section 3**
- **Location**: Goals and Success Metrics table, row 3
- **Challenge**: "< 500ms on same network" is not objectively measurable as written. What constitutes "same network"? LAN? Same data center? Same WiFi? The qualifier makes the metric untestable in any standardized way. Additionally, there is no baseline, no owner responsible for measuring, and no timeframe for when this should be validated.
- **Suggested Fix**: Define a specific test environment (e.g., "localhost to localhost" or "same LAN segment") and specify how/when this will be measured.

**DA-M2: `[SCOPE_DRIFT]` Confirmation Dialog Requires Relationship Data Not Currently in TableNode -- REQ-02 (AC-02b)**
- **Location**: REQ-02 (AC-02b, AC-02g)
- **Challenge**: The confirmation dialog must list "affected relationships (e.g., orders.customer_id (FK), invoices.customer_id (FK))". However, the current TableNode data structure (`TableNodeData`) only contains column data -- it does not include `sourceRelationships` or `targetRelationships` with their related table/column names. This means the frontend needs to either (1) fetch relationship data on-demand when delete is clicked, or (2) the TableNode data must be enriched with relationship information. Neither is addressed.
- **Risk**: Implied data-fetching or data-structure changes that are not scoped.
- **Suggested Fix**: Specify where relationship data comes from for the delete confirmation dialog. Does it require a new server query? Is it already available in the React Flow edge data? This needs an explicit answer.

**DA-M3: `[CIRCULAR]` "No new database migrations required" -- AC-05d**
- **Location**: REQ-05 (AC-05d)
- **Challenge**: This is presented as an acceptance criterion, but it is actually an assumption. If the dataType issue (DA-B1) is resolved by widening the schema, a migration IS required. Labeling "no migration needed" as an AC rather than an assumption means it cannot fail gracefully -- it either blocks the feature or gets silently violated.
- **Suggested Fix**: Move to the Assumptions table or qualify it: "No new migrations required unless the dataType enum is expanded."

**DA-M4: `[ASSUMPTION]` "deleteColumn cascade-deletes relationships per Prisma schema" -- AC-05c, REQ-02**
- **Location**: AC-05c, REQ-02 flow
- **Challenge**: The PRD claims `deleteColumn` cascade-deletes relationships. The Prisma schema shows `Column` -> `DiagramTable` has `onDelete: Cascade`, but the Relationship model references columns via `sourceColumnId`/`targetColumnId`. The cascade behavior on relationships when a column is deleted depends on whether the Relationship model's column references have `onDelete: Cascade` configured. This was not verified in the PRD.
- **Risk**: If relationships are NOT cascade-deleted, REQ-02's flow breaks -- columns get deleted but orphaned relationship edges remain, causing rendering errors.
- **Suggested Fix**: Verify the Relationship model's `onDelete` behavior for `sourceColumnId` and `targetColumnId` foreign keys and state the finding explicitly.

**DA-M5: `[VAGUE_TERM]` "sensible defaults" -- REQ-01, step 6**
- **Location**: REQ-01 user flow, step 6
- **Challenge**: Step 6 says "the column is created with sensible defaults" then lists them explicitly. The term "sensible defaults" is subjective, though in this case the values ARE listed. However, the default `dataType` is not specified. What data type is a new column created with if the user only enters a name and presses Enter? The Zod schema requires `dataType` (it is not optional).
- **Risk**: Engineer must guess the default data type or the creation will fail validation.
- **Suggested Fix**: Specify the default dataType for new columns (e.g., `"string"` or `"text"`).

### MINOR

**DA-m1: `[VAGUE_TERM]` "subtle (muted color, small size)" -- decisions.md, "+" button decision**
- **Location**: decisions.md, row 2
- **Challenge**: "Muted color, small size" is not specific enough for consistent implementation. What color? What size in pixels?
- **Suggested Fix**: Can be addressed during implementation/design, but note the ambiguity.

**DA-m2: `[SCOPE_DRIFT]` Open Question OQ-3 "No hard limit" on columns**
- **Location**: OQ-3
- **Challenge**: "No hard limit in V1" combined with "tables with 50+ columns are rare" is an assumption about user behavior. React Flow node rendering performance with 50+ columns plus inline editing could degrade. The assumption is stated but the risk mitigation is absent.
- **Suggested Fix**: Add a note about testing performance at 30+ columns during implementation.

---

## User Advocate Findings

### BLOCKING

**UA-B1: `[MISSING_ERROR_STATE]` What Happens When WebSocket is Disconnected and User Tries to Add/Edit/Delete?**
- **Location**: FM-04 covers reconnection but not the active editing scenario
- **Challenge**: FM-04 addresses "WebSocket disconnection during edit" but only from the perspective of collaborator sync. It does not address: what does the user SEE when they are disconnected? Is there a connection status indicator? Can they still add/edit/delete fields (since those go through HTTP server functions, not WebSocket)? If yes, do they get a warning that collaborators won't see changes? If the server function ALSO fails (server down), what happens?
- **Risk**: User performs edits in a disconnected state, believes they are saved, but they are not. No feedback mechanism is defined.
- **Suggested Fix**: Define (1) a visible connection status indicator, (2) behavior when server functions fail due to connectivity, and (3) whether editing is blocked or degraded when offline.

**UA-B2: `[MISSING_FAILURE_MODE]` No Failure Mode for "Add Column" When dataType Is Invalid or Missing**
- **Location**: REQ-01 user flow
- **Challenge**: The add-column flow (REQ-01) says the user enters a name and "selects/types a data type," then on blur/Enter the column is created. But: (1) What if the user enters a name but leaves the data type empty? The Zod schema requires `dataType`. (2) What if the user types an invalid data type (given the strict enum)? There is no error state defined for data type validation failure during column creation.
- **Risk**: User types a column name, presses Enter, and gets an unexplained error or silent failure.
- **Suggested Fix**: Define the default data type behavior (pre-selected default?) and the error feedback when data type validation fails.

### MAJOR

**UA-M1: `[MISSING_JOURNEY_STAGE]` Discovery -- How Does a First-Time User Know They Can Double-Click to Edit?**
- **Location**: REQ-03 user flow, decisions.md (double-click decision)
- **Challenge**: The decision to use double-click for editing is justified by "standard convention for diagram tools." But first-time users of THIS tool have no affordance telling them double-click is available. There is no tooltip, no hover state change, no cursor change, no onboarding hint. The "+" button for adding is visible (good), but editing and constraint toggling are invisible interactions.
- **Risk**: Users do not discover inline editing exists. They assume the tool is read-only for existing columns.
- **Suggested Fix**: Define at least one discoverability mechanism: hover cursor change to `text`, a tooltip on hover ("Double-click to edit"), or a first-use hint.

**UA-M2: `[MISSING_PERSONA]` Infrequent Users / Returning Users**
- **Location**: Section 2 (Users)
- **Challenge**: Only two personas are defined: "Database Designer" (power user) and "Collaborating Viewer" (passive). Missing: the infrequent user who designed a schema 3 weeks ago, returns to make a small change, and has forgotten the interaction patterns (double-click to edit, click badge to toggle PK). These users need re-discoverable affordances.
- **Suggested Fix**: Add hover states or contextual hints that remind returning users of available actions.

**UA-M3: `[MISSING_ERROR_STATE]` No Error Feedback for Duplicate Column Name During Inline Edit (REQ-03)**
- **Location**: REQ-03 (AC-03h, AC-03i)
- **Challenge**: AC-03h says "Validation prevents duplicate column names within the same table." AC-03i says "If a save fails, the UI reverts and shows an error toast." But the Prisma schema has `@@unique([tableId, name])` -- this is a DATABASE constraint, not a frontend one. The error will come back as a Prisma unique constraint violation, which the server wraps in a generic "Failed to update column" message. The user will see a vague error toast, not "Column name 'email' already exists."
- **Risk**: User gets unhelpful error message.
- **Suggested Fix**: Either (1) add frontend validation that checks for duplicates before submitting, or (2) ensure the server error message is parsed to produce an actionable message mentioning the duplicate name.

**UA-M4: `[MISSING_FAILURE_MODE]` Toggling PK on a Column That Is Already an FK Target**
- **Location**: REQ-03 (AC-03e), Flow 4
- **Challenge**: What happens when a user toggles isPrimaryKey on a column that is the target of a foreign key relationship? Or toggles isNullable to false on a column that is referenced as an FK? These are semantically meaningful database operations that could cause issues, but the PRD treats all constraint toggles as simple boolean flips with no validation.
- **Risk**: User creates invalid schema states (e.g., nullable FK target) without any warning.
- **Suggested Fix**: Define whether constraint toggles have any cross-column validation rules, or explicitly state that V1 allows any combination.

**UA-M5: `[UX_CLARITY]` Edit Mode Ambiguity -- Which Column Is Currently Being Edited?**
- **Location**: REQ-03, Flow 3
- **Challenge**: When a user double-clicks a column name, it becomes an editable input. But the PRD does not specify any visual distinction for the edit state. Is the input styled differently? Does the row highlight? Can only one column be in edit mode at a time, or can multiple? If another user deletes the column while editing (FM-06), the edit form "should close" -- but how does the user know what happened?
- **Suggested Fix**: Specify the visual treatment of edit mode (input styling, row highlight) and whether single or multi-edit is allowed.

### MINOR

**UA-m1: `[ACCESSIBILITY_GAP]` Keyboard-Only Users Cannot Trigger Double-Click**
- **Location**: REQ-03, REQ-08
- **Challenge**: REQ-08 (keyboard navigation) is P2, but the primary edit interaction (REQ-03, P0) requires double-click. Keyboard-only users (including screen reader users) cannot double-click. There is no keyboard alternative defined for entering edit mode (e.g., Enter or F2 on a focused column).
- **Suggested Fix**: Add a keyboard shortcut for entering edit mode (Enter or F2 when column is focused) as part of REQ-03, not deferred to REQ-08.

**UA-m2: `[ACCESSIBILITY_GAP]` PK/FK/Constraint Badges Have No Accessible Labels**
- **Location**: REQ-03 (AC-03e, AC-03f)
- **Challenge**: The current TableNode uses `title="Primary Key"` on the PK span, which is a start. But for the new clickable toggles, screen readers need `aria-label`, `role="button"`, and state indication (`aria-pressed`). The PRD does not mention accessibility for interactive constraint toggles.
- **Suggested Fix**: Add accessibility requirements for interactive elements (ARIA labels, roles, keyboard focus).

**UA-m3: `[MISSING_PERSONA]` Users on Mobile/Touch Devices**
- **Location**: Section 2
- **Challenge**: Double-click is a poor interaction on touch devices. The PRD does not mention touch support at all. While this may be out of scope for a desktop-focused tool, it should be explicitly called out as out of scope.

---

## Score

| Category | Count |
|----------|-------|
| Unvalidated assumptions | 2 |
| Vague metrics | 1 |
| Scope drift | 2 |
| Circular requirements | 1 |
| Missing failure modes | 2 |
| Missing error states | 2 |
| Missing personas | 1 |
| Vague language / UX clarity | 2 |
| Accessibility gaps | 2 |
| **Total** | **15** |

| Severity | Devil's Advocate | User Advocate | Combined |
|----------|-----------------|---------------|----------|
| BLOCKING | 2 | 2 | 4 |
| MAJOR | 5 | 5 | 10 |
| MINOR | 2 | 3 | 5 |

---

## If REVISIONS: Required Changes

The following **must** be resolved before this PRD can proceed to tech spec:

1. **[DA-B1] Fix the dataType mismatch.** Either update REQ-07 to reflect the actual Zod enum values (`int`, `string`, `float`, `boolean`, `date`, `text`, `uuid`, `json`) and remove the "custom type" claim, OR add an explicit requirement to widen the schema (which means AC-05d "no migrations" is false and must be updated).

2. **[DA-B2] Verify Socket.IO server relay capability.** Confirm whether the server can relay arbitrary events to room members or if new server-side handlers are needed. If handlers are needed, add them to the scope and Dependencies table.

3. **[UA-B1] Define user experience during connectivity loss.** What does the user see when WebSocket is down? When the server is unreachable? Is there a connection indicator? Can they still edit (graceful degradation)?

4. **[UA-B2] Define the default data type for new columns.** The Zod schema requires `dataType`. Specify what value is used when a user adds a column without explicitly selecting a type. Define the error state if validation fails.

The following **should** be resolved before tech spec:

5. **[DA-M2]** Specify where relationship data comes from for the delete confirmation dialog.
6. **[DA-M4]** Verify cascade-delete behavior on the Relationship model when a Column is deleted.
7. **[DA-M5]** Specify the default dataType for new columns explicitly in REQ-01.
8. **[UA-M1]** Add at least one discoverability mechanism for double-click editing (hover state, tooltip, or cursor change).
9. **[UA-M3]** Ensure duplicate column name errors produce actionable user-facing messages, not generic "Failed to update" errors.
10. **[UA-M5]** Define the visual treatment of edit mode and single-vs-multi edit behavior.
