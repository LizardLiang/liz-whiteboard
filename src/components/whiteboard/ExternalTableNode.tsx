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

import { memo, useCallback } from 'react'
import { ExternalLink, FileWarning, KeyRound, Link2 } from 'lucide-react'
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
    } = data

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
          overflow: 'hidden',
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
            background: missing ? 'var(--destructive)' : 'var(--muted)',
            color: missing
              ? 'var(--destructive-foreground)'
              : 'var(--muted-foreground)',
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
              color: missing
                ? 'var(--destructive-foreground)'
                : 'var(--foreground)',
            }}
          >
            {sourceTableName}
          </span>
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
