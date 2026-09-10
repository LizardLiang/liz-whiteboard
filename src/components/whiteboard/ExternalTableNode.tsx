/**
 * ExternalTableNode — a cross-file table reference (LizMeter #83).
 *
 * Stands in for a table that lives in ANOTHER whiteboard of the same project.
 * Deliberately compact and read-only: a dashed border, the source file's name,
 * the table's name, and only the picked columns. Everything you could edit on a
 * real table (rename, add/reorder columns, notes) is absent, because editing
 * here could not reach the file that actually owns the table.
 *
 * Each picked column renders the same `ColumnHandles` a real column row does,
 * with the LOCAL stub column's id — that is what makes drag-to-connect and
 * `RelationshipEdge` work here with no edge code of their own.
 */

import { memo, useCallback, useState } from 'react'
import {
  ExternalLink,
  FileWarning,
  KeyRound,
  Link2,
  Repeat2,
  Trash2,
} from 'lucide-react'
import { ColumnHandles } from './column/ColumnHandles'
import type { ExternalTableNodeData } from '@/lib/react-flow/types'
import { HEADER_H, ROW_H } from '@/lib/react-flow/canvas-node-geometry'

interface ExternalTableNodeProps {
  id: string
  data: ExternalTableNodeData
  selected?: boolean
}

/** Minimum width — wide enough for "file / table" without wrapping the badge. */
const MIN_WIDTH = 200

/** Shared look for the two header actions. */
const ACTION_BUTTON: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  padding: 0,
  border: 'none',
  borderRadius: 3,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

export const ExternalTableNode = memo(
  ({ id, data, selected }: ExternalTableNodeProps) => {
    const {
      sourceWhiteboardId,
      sourceTableId,
      sourceTableName,
      sourceWhiteboardName,
      columns,
      missing,
      isActiveHighlighted,
      isHighlighted,
      onJumpToSource,
      onRetarget,
      onDelete,
    } = data

    // Both actions were threaded into node data from the start but had no
    // control to fire them, so re-targeting and removing a reference were
    // unreachable on the board (found by dogfooding). Revealed on hover or
    // while selected, like every other node-level affordance here.
    const [hovered, setHovered] = useState(false)
    const showActions = (hovered || selected === true) && Boolean(onRetarget || onDelete)

    const handleRetarget = useCallback(() => onRetarget?.(id), [onRetarget, id])
    const handleDelete = useCallback(() => onDelete?.(id), [onDelete, id])

    // Double-click is the discoverable half of jump-to-source; `g` on the
    // selected node is the other, and lives in ReactFlowWhiteboard's keyboard
    // handler because it needs the canvas selection, not this node's DOM.
    const handleDoubleClick = useCallback(() => {
      if (!onJumpToSource) return
      onJumpToSource(sourceWhiteboardId, sourceTableId)
    }, [onJumpToSource, sourceWhiteboardId, sourceTableId])

    const borderColor = missing
      ? 'var(--destructive)'
      : isActiveHighlighted || selected
        ? 'var(--primary)'
        : isHighlighted
          ? 'var(--primary)'
          : 'var(--muted-foreground)'

    return (
      <div
        data-testid={`external-table-node-${id}`}
        data-missing={missing ? 'true' : 'false'}
        onDoubleClick={handleDoubleClick}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        title={
          missing
            ? 'The table this references no longer exists. Re-target or delete this node.'
            : onJumpToSource
              ? `Open ${sourceWhiteboardName ?? 'the source file'} at ${sourceTableName} (double-click or press g)`
              : `${sourceTableName} in ${sourceWhiteboardName ?? 'another file'}`
        }
        style={{
          minWidth: MIN_WIDTH,
          // Dashed all round: the one glance-level signal that this box is not
          // a table of this file.
          border: `2px dashed ${borderColor}`,
          borderRadius: 6,
          background: 'var(--card)',
          color: 'var(--card-foreground)',
          opacity: missing ? 0.85 : 1,
          // Deliberately NOT `overflow: hidden`. ColumnHandles positions its
          // handles at left/right -14px, OUTSIDE this box; clipping them made
          // the connection dots invisible AND un-hit-testable, so a
          // relationship could not be dragged from a reference node at all
          // (found by dogfooding — every unit test asserts the handles are
          // rendered, none that they are reachable). The header clips itself
          // to the rounded corners below instead.
        }}
      >
        {/* Header: source file badge + table name */}
        <div
          style={{
            height: HEADER_H,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 8px',
            // Own top corners, because the card no longer clips (see above).
            borderRadius: '4px 4px 0 0',
            background: missing ? 'var(--destructive)' : 'var(--muted)',
            // Not `--destructive-foreground`: this app's light theme defines
            // it as the SAME colour as `--destructive`, so the whole header
            // painted red-on-red and the file/table name was unreadable
            // (found by dogfooding). White reads on the destructive red of
            // both themes.
            color: missing ? '#fff' : 'var(--muted-foreground)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {missing ? (
            <FileWarning size={13} aria-hidden />
          ) : (
            <ExternalLink size={13} aria-hidden />
          )}
          <span
            style={{
              maxWidth: 110,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: 0.9,
            }}
          >
            {sourceWhiteboardName ?? 'Missing file'}
          </span>
          <span aria-hidden style={{ opacity: 0.5 }}>
            /
          </span>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: missing ? '#fff' : 'var(--foreground)',
            }}
          >
            {sourceTableName}
          </span>

          {showActions && (
            <div
              className="nodrag nopan"
              style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}
            >
              {onRetarget && (
                <button
                  type="button"
                  data-testid={`reference-retarget-${id}`}
                  aria-label="Point this reference at another table"
                  title="Point this reference at another table"
                  onClick={handleRetarget}
                  style={ACTION_BUTTON}
                >
                  <Repeat2 size={13} aria-hidden />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  data-testid={`reference-delete-${id}`}
                  aria-label="Remove this reference"
                  title="Remove this reference"
                  onClick={handleDelete}
                  style={ACTION_BUTTON}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>

        {missing && (
          <div
            style={{
              padding: '4px 8px',
              fontSize: 11,
              color: 'var(--destructive)',
            }}
          >
            Source table no longer exists
          </div>
        )}

        {/* Picked columns — each one connectable via the shared handle set */}
        {columns.map((column, index) => (
          <div
            key={column.id}
            className="column-row"
            style={{
              position: 'relative',
              height: ROW_H,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 8px',
              fontSize: 12,
              borderTop: index === 0 ? 'none' : '1px solid var(--border)',
              color: column.missing
                ? 'var(--destructive)'
                : 'var(--foreground)',
            }}
          >
            <ColumnHandles tableId={id} columnId={column.id} />
            {column.isPrimaryKey ? (
              <KeyRound size={11} aria-label="Primary key" />
            ) : column.isForeignKey ? (
              <Link2 size={11} aria-label="Foreign key" />
            ) : null}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textDecoration: column.missing ? 'line-through' : undefined,
              }}
            >
              {column.name}
            </span>
            <span
              style={{
                marginLeft: 'auto',
                opacity: 0.6,
                fontSize: 11,
                whiteSpace: 'nowrap',
              }}
            >
              {column.missing ? 'missing' : column.dataType}
            </span>
          </div>
        ))}
      </div>
    )
  },
)

ExternalTableNode.displayName = 'ExternalTableNode'
