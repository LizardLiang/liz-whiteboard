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

## Revision Requests
<!-- Reviewers (Apollo, Hermes) append here when requesting changes -->

## Final Resolution
<!-- Athena updates this after all reviews are resolved -->
