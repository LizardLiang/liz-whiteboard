# Decisions Log -- Dynamic Field Management

## Product Decisions (Athena -- PRD Creation)

| Decision | Rationale | Trade-offs Considered |
|----------|-----------|----------------------|
| Inline editing within the TableNode (not a sidebar or modal) | Keeps the user in the visual context of the diagram. Reduces context-switching. Matches how tools like dbdiagram.io and Figma handle in-place editing. | Sidebar panel would allow more properties to be shown at once but breaks flow. Modal editing is disruptive. Inline is more complex to implement but best UX. |
| "+" button always visible (not hover-only) | Reduces discovery friction -- new users can see the affordance immediately. Hover-only buttons are a common usability problem. | Always-visible button adds visual noise. Mitigated by making it subtle (muted color, small size). |
| Double-click to enter edit mode for name/type | Single-click is already used for node selection in React Flow. Double-click is the standard convention for entering edit mode in diagram tools. | Single-click-to-edit would be faster but conflicts with React Flow's selection model. |
| Click-to-toggle for PK/nullable/unique constraints | Constraint toggles are binary (on/off) and do not need a text input. A single click is the most efficient interaction. | Could use a dropdown or form, but toggles are faster for boolean properties. |
| Confirmation dialog only for columns with relationships | Deleting a column without relationships is low-risk and should be fast. Showing a dialog every time adds friction. Columns with FK relationships are high-risk deletions. | Could always show a dialog (safer but slower) or never show one (faster but risky). The hybrid approach balances safety and speed. |
| Last-write-wins for concurrent edits (no conflict resolution) | V1 simplicity. Conflict resolution (OT, CRDT) adds significant complexity. The WebSocket broadcast ensures all users converge to the same final state. Edits to the same column by two users simultaneously are rare in practice. | CRDT would prevent overwrites but is out of scope for V1. Could add optimistic locking (version field) later if needed. |
| No drag-to-reorder columns in this scope | Explicitly excluded by user requirements. Reordering is a separate interaction pattern (drag handle, order management) that adds complexity without blocking the core value of add/edit/delete. | Could include it since the `order` field exists, but it would expand scope significantly (drag-and-drop within React Flow nodes is non-trivial). |
| Reuse existing server functions -- no new backend endpoints | The CRUD layer in `src/data/column.ts` and `src/routes/api/columns.ts` already covers all needed operations. Avoids duplicating logic. | Could create new "optimized" endpoints, but there is no evidence the existing ones are insufficient. |
| New WebSocket events for column mutations (column:created, column:updated, column:deleted) | The existing collaboration hook only handles `table:moved`. Column mutations need their own events to sync in real-time. Follows the established event naming pattern. | Could reuse a generic "whiteboard:changed" event, but that would require full re-fetches. Granular events allow targeted state updates. |
| Optimistic UI as P1 (not P0) | Core functionality (add/edit/delete with persistence and sync) must work first. Optimistic updates are a UX enhancement that can be layered on. | Could make it P0 since it affects perceived performance, but the feature is functional without it. |

## Product Decisions (Athena -- Revision Round 1)

| Decision | Rationale | Trade-offs Considered |
|----------|-----------|----------------------|
| Default dataType for new columns is `"string"` | Most common column type in schema design. Pre-populating reduces friction -- user can just type a name and press Enter. The Zod schema requires `dataType` (not optional), so a default is mandatory. | Could use `"text"` (more generic) or `"int"` (common for IDs). `"string"` is the safest universal default -- it maps to VARCHAR which works for most initial column definitions. |
| Data type input is a restricted dropdown (not free-text) | The Zod schema uses `z.enum()` with exactly 8 values. Free-text input would allow values that fail server validation, creating a confusing UX. Dropdown eliminates this class of errors entirely. | Free-text with autocomplete would feel more flexible but creates validation failures. Widening the Zod schema from enum to string would allow custom types but changes backend contract and is out of scope. |
| Relationship data for delete dialog comes from React Flow edges (no server query) | The whiteboard already loads all relationships as React Flow edges. Filtering by columnId is instant and avoids an extra round-trip. | Could query the server for relationship data on-demand (more authoritative), but adds latency to the delete flow and the data is already available client-side. |
| Single-edit mode (one field at a time per table) | Prevents confusion about which field is being edited. Committing the first edit before starting the second ensures no edits are accidentally lost. Simpler implementation. | Multi-edit would let power users work faster, but adds complexity around partial saves and error handling. Not needed for V1. |
| PK toggle auto-sets isNullable=false and isUnique=true | Primary keys are inherently not-null and unique in all SQL databases. Auto-setting these prevents logically invalid states and reduces clicks. | Could leave them independent and trust the user, but that allows PK + nullable which is invalid in every real database. |
| Cursor and tooltip for discoverability (no onboarding tour) | Cursor changes and tooltips are the lightest-weight discoverability mechanism. They work for new and returning users without interrupting workflow. | An onboarding tour or first-use overlay would be more visible but adds implementation complexity and can be annoying on repeat visits. |
| Editing not blocked during WebSocket disconnection | Server functions use HTTP, not WebSocket. Blocking edits on WS disconnect would prevent users from working when the issue is only with real-time sync, not persistence. | Could block all edits for safety, but that over-penalizes the user. The connection indicator + banner provides sufficient warning. |
| Socket.IO server column handlers already exist -- no new server work needed | Verified by reading `src/routes/api/collaboration.ts`. The server already handles `column:create`, `column:update`, `column:delete` with Zod validation, DB persistence, and broadcast. This reduces scope and risk. | Original PRD listed this as "partially exists" with medium risk. Verification resolved the uncertainty. |

## Revision Requests

### Architecture Review (Apollo) -- 2026-03-30
| Issue | Severity | Rationale | Required Change |
|-------|----------|-----------|-----------------|
| SA-C1: Double persistence via HTTP + WebSocket | Critical | The spec's dual-path pattern (HTTP persist then WebSocket emit) causes the Socket.IO server handler to persist to DB a second time. `column:create` handler at collaboration.ts:358-386 calls `createColumn()`, so emitting `column:create` after HTTP persistence creates duplicate DB writes. On delete, the second persistence attempt fails because the row is already gone. | Revise Section 2.2 and Section 5 to use a single persistence path. Recommended: Option A (WebSocket-only persistence, matching existing server handlers) or Option B (HTTP persistence + broadcast-only WebSocket notification that skips server-side DB write). Update event flow diagram in Section 7.1 accordingly. |
| SA-M1: No authorization on column mutations | Medium | Column mutations (create/update/delete) are more destructive than position updates, yet neither the HTTP server functions nor the WebSocket handlers verify that the calling user has permission to modify the target table's whiteboard. This is a pre-existing codebase gap, not introduced by this spec, but the spec should acknowledge it. | Add a risk entry in Section 15 documenting the authorization gap as a known limitation to be addressed in a future security pass. |
| SA-M2: Rapid constraint toggle race condition | Medium | Single-edit mode prevents concurrent field edits but does not prevent rapid clicks on the same constraint badge (e.g., PK on/off/on). Each toggle fires an independent server call. Out-of-order responses can desynchronize local state from server state. | Add debounce (200-300ms) to constraint toggle handlers in ConstraintBadges spec (Section 4.5), or document as a known limitation with explicit mitigation path (mutation queue or last-response-wins check). |

## Final Resolution

**PM Spec Review (2026-03-30)**: Tech spec approved without revision requests. All 10 PRD requirements, all acceptance criteria, all 6 failure modes, and all product decisions from this log are faithfully represented in the technical design. No product-level concerns. Proceed to SA review and implementation.

---

### PRD Alignment (Hera) -- 2026-03-30

| Criterion | Status | Gap |
|-----------|--------|-----|
| AC-01a through AC-01i (REQ-01: Add Field Inline) | gaps | All 9 ACs implemented in code; zero test files exist for TS-04, TS-07, TS-10, TS-11 |
| AC-02a through AC-02g (REQ-02: Delete with Safety) | gaps | All 7 ACs implemented; zero test files exist for TS-05, TS-06, TS-07, TS-10, TS-11 |
| AC-03a through AC-03l (REQ-03: Edit Field Properties) | gaps | All 12 ACs implemented; zero test files exist for TS-02, TS-03, TS-06, TS-07, TS-10 |
| AC-04a through AC-04e (REQ-04: Real-Time Collaboration) | gaps | All 5 ACs implemented; zero test files exist for TS-08, TS-11 |
| AC-05a through AC-05d (REQ-05: Database Persistence) | gaps | All 4 ACs implemented; zero test files exist for TS-07, TS-10, TS-12 |
| AC-06a through AC-06e (REQ-06: Connection Status) | gaps | All 5 ACs implemented; zero test files exist for TS-09, TS-12 |
| AC-07a through AC-07d (REQ-07: Optimistic UI) | gaps | All 4 ACs implemented; zero test files exist for TS-13 |
| AC-08a through AC-08d (REQ-08: Data Type Selection) | gaps | All 4 ACs implemented; zero test files exist for TS-01, TS-14 extension |
| AC-09a through AC-09b (REQ-09: Keyboard Navigation) | gaps | Both ACs implemented; zero test files exist for TS-15 |
| AC-10a through AC-10c (REQ-10: Accessibility) | gaps | All 3 ACs implemented; zero test files exist for TS-16 |

**Resolution**: Return to stage 9 (Ares). All 16 test suites from test-plan.md must be written. Implementation code is complete and correct. No implementation changes required -- tests only.

### Code Review (Hermes) -- 2026-03-30
| Finding | Tier | Rationale | Required Fix |
|---------|------|-----------|--------------|
| TableNode.new.tsx:155-156 -- Delete dialog shows UUIDs instead of table names | Tier 1 -- Correct | `affectedRelationships` maps `rel.sourceTableId` (a UUID) to `sourceTableName` and `rel.targetTableId` to `targetTableName`. The delete confirmation dialog (AC-02b) requires human-readable table names to list affected relationships, not raw IDs. | Resolve table names from the React Flow nodes array (each node contains `node.data.table.name`) using a `tableId -> tableName` lookup map, or extract table names from the edge/relationship data if available. |
| ReactFlowWhiteboard.tsx:253 -- onColumnError callback was a no-op (AUTO-FIXED) | Tier 1 -- Correct | The `onColumnError` callback passed to `useColumnCollaboration` was an empty placeholder. Server error events were silently ignored, meaning optimistic updates were never rolled back on failure. | Fixed via ref pattern: `onColumnErrorRef` is populated after `columnMutations` is created, and the callback delegates to it. |
