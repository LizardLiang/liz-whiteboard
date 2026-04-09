# Implementation Notes: Field-Level Connection Handles

## Summary

Implemented drag-to-connect relationship creation between ER diagram table fields. Users can now hover a column row to reveal connection handles, drag from one handle to another, and select a cardinality before the relationship is persisted.

## Files Modified

### 1. `src/lib/react-flow/edge-routing.ts`
Added `parseColumnHandleId(handleId: string)` utility function that splits a handle ID on `__` and returns `{ tableId, columnId, side, type }`. Returns `null` if the format is invalid (not exactly 4 parts, or invalid side/type values).

### 2. `src/styles/react-flow-theme.css`
- Made all `.react-flow__handle` elements invisible by default (`opacity: 0; pointer-events: none`) via CSS, removing the need for inline style overrides in JSX.
- Added `.column-row:hover .react-flow__handle` rule to reveal handles when the parent row is hovered — pure CSS, no React state required.
- Added rules for `.react-flow__handle.connectingto` and `.react-flow__handle.valid` to keep handles visible and styled during an active connection drag.
- Added `.column-row:hover` background highlight using `--rf-table-hover-bg`.
- Added `.react-flow__connection-line` styling: dashed stroke using `--rf-edge-stroke-selected`, 2px width.

### 3. `src/components/whiteboard/column/ColumnRow.tsx`
- Removed `style={{ opacity: 0, pointerEvents: 'none' }}` from the left-source and right-target handles (was overriding the CSS approach).
- Added `className="nodrag"` to all 4 handles so that dragging on a handle starts a connection rather than moving the node.
- CSS now controls all handle visibility via `.column-row:hover .react-flow__handle`.

### 4. `src/components/whiteboard/ReactFlowCanvas.tsx`
- Added `ConnectionMode` import from `@xyflow/react`.
- Changed `nodesConnectable={false}` to `nodesConnectable={true}`.
- Added `connectionMode={ConnectionMode.Loose}` to allow connecting any handle to any handle (not just source→target type matching).

### 5. `src/routes/whiteboard/$whiteboardId.new.tsx`
- Added imports: `Connection` type from `@xyflow/react`, `Cardinality` type from schema, shadcn Dialog/Select/Button/Label components, `parseColumnHandleId` utility.
- Added `PendingConnection` interface and `CARDINALITY_OPTIONS` constant array outside the component.
- Added `pendingConnection` and `selectedCardinality` state.
- Added `onConnect` callback: parses source and target handle IDs, extracts table/column IDs, sets `pendingConnection` and resets cardinality to `ONE_TO_MANY`.
- Added `handleCardinalityConfirm` callback: calls `handleCreateRelationship` with full `CreateRelationship` data, then clears pending connection.
- Added `handleCardinalityCancel` callback: clears pending connection.
- Wired `onConnect` into `<ReactFlowCanvas>`.
- Added `<Dialog>` (cardinality picker) to JSX: shown when `pendingConnection !== null`, contains a Select with all 17 cardinality options, Cancel and Create buttons.

## Design Decisions

**CSS-only hover for handles**: Using `.column-row:hover .react-flow__handle` avoids React state for hover, preventing unnecessary re-renders on every column row. The memo comparator is unaffected.

**`ConnectionMode.Loose`**: Required because the handle ID format has distinct source/target handles on each side. Without Loose mode, React Flow enforces source→target type matching which would prevent connecting a source handle to a target handle on a column.

**`nodrag` on handles**: Without this class, clicking on a handle starts node drag instead of connection drag. React Flow checks for this class name to distinguish interaction intent.

**`parseColumnHandleId` returns null on bad format**: The `onConnect` handler silently returns if parsing fails, protecting against non-column handles or malformed IDs.

## Test Results

All 303 pre-existing tests pass. No tests were broken by these changes.

## Known Constraints

- The cardinality dialog uses a flat Select list with all 17 cardinality values. A grouped approach (common vs. advanced) was not requested.
- No `crypto.randomUUID()` is used anywhere in this feature (IDs come from the database via the mutation).
