/**
 * ColumnRow — renders a single column in the TableNode
 * Phase 1: skeleton (display only, no editing)
 * Phase 2+: interactive editing, delete button
 * column-reorder: DragHandle integration via useSortable
 */

import { memo, useCallback, useState } from 'react'
import { useWhiteboardPermissions } from '../whiteboard-permissions-context'
import { InlineNameEditor } from './InlineNameEditor'
import { DataTypeSelector } from './DataTypeSelector'
import { ConstraintBadges } from './ConstraintBadges'
import { ColumnNotePopover } from './ColumnNotePopover'
import { DragHandle } from './DragHandle'
import { ColumnHandles } from './ColumnHandles'
import type { Column } from '@/data/models'
import type { RelationshipEdgeType, ShowMode } from '@/lib/react-flow/types'
import type { DataType } from '@/data/schema'
import type { EditingField } from './types'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * Lazily mounts the Tooltip machinery (GH #121 perf, opt #4) — when
 * `active` is false, renders ONLY the trigger element with none of Radix's
 * Provider/Root/Trigger/Portal overhead. Only once the row is hovered
 * (`active` flips true) does the real Tooltip get mounted, at which point a
 * subsequent pointer move onto the trigger reveals the tooltip as normal.
 * Column-level connection Handles are NEVER part of this — they stay
 * unconditionally rendered in ColumnRow below (fragile, required by edge
 * routing/drag-to-connect).
 */
function LazyTooltip({
  active,
  content,
  children,
}: {
  active: boolean
  content: React.ReactNode
  children: React.ReactElement
}) {
  if (!active) return children
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top">{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export interface ColumnRowProps {
  column: Column
  tableId: string
  isLast: boolean
  editingField: EditingField | null
  onStartEdit: (columnId: string, field: 'name' | 'dataType') => void
  onCommitEdit: (
    columnId: string,
    field: 'name' | 'dataType',
    value: string,
  ) => void
  onCancelEdit: () => void
  onToggleConstraint: (
    columnId: string,
    constraint: 'isPrimaryKey' | 'isNullable' | 'isUnique',
    value: boolean,
  ) => void
  onDelete: (column: Column) => void
  onDuplicate?: (column: Column) => void
  onDescriptionUpdate: (columnId: string, description: string) => void
  edges: Array<RelationshipEdgeType>
  showMode?: ShowMode
  /** Called when user presses pointer on the drag handle */
  onDragHandlePointerDown?: (e: React.PointerEvent) => void
  /** Whether this column is the one currently being dragged */
  isDraggingActive?: boolean
}

export const ColumnRow = memo(
  ({
    column,
    tableId,
    isLast,
    editingField,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    onToggleConstraint,
    onDelete,
    onDuplicate,
    onDescriptionUpdate,
    edges: _edges,
    showMode = 'ALL_FIELDS',
    onDragHandlePointerDown,
    isDraggingActive = false,
  }: ColumnRowProps) => {
    const { canEdit } = useWhiteboardPermissions()
    const isEditingName =
      editingField?.columnId === column.id && editingField.field === 'name'
    const isEditingDataType =
      editingField?.columnId === column.id && editingField.field === 'dataType'
    const isEditing = isEditingName || isEditingDataType
    const [isHoveringDataType, setIsHoveringDataType] = useState(false)
    // Row hover (GH #121 perf, opt #4) — gates LazyTooltip below so the
    // Tooltip machinery only mounts for the row currently under the pointer,
    // not all of them all the time.
    const [isRowHovered, setIsRowHovered] = useState(false)

    const handleNameDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        onStartEdit(column.id, 'name')
      },
      [column.id, onStartEdit],
    )

    const handleDataTypeDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        onStartEdit(column.id, 'dataType')
      },
      [column.id, onStartEdit],
    )

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === 'F2') {
          e.stopPropagation()
          onStartEdit(column.id, 'name')
        }
        if (e.key === 'Delete' && !isEditing && canEdit) {
          e.stopPropagation()
          onDelete(column)
        }
      },
      [column, column.id, isEditing, onStartEdit, onDelete, canEdit],
    )

    const handleDeleteClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        onDelete(column)
      },
      [column, onDelete],
    )

    const handleDuplicateClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        onDuplicate?.(column)
      },
      [column, onDuplicate],
    )

    return (
      <div
        className={`column-row group${isEditing ? ' editing' : ''}`}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setIsRowHovered(true)}
        onMouseLeave={() => setIsRowHovered(false)}
        style={{
          padding: '4px 16px 4px 8px',
          borderBottom: isLast ? 'none' : '1px solid var(--rf-table-border)',
          fontSize: '13px',
          color: 'var(--rf-table-text)',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minHeight: '28px',
          background: isEditing
            ? 'var(--rf-column-edit-bg, rgba(99,102,241,0.08))'
            : 'transparent',
          outline: 'none',
          opacity: isDraggingActive ? 0.4 : 1,
        }}
      >
        {/* Drag handle — visible in ALL_FIELDS mode only */}
        <DragHandle
          columnName={column.name}
          isDragging={isDraggingActive}
          onPointerDown={onDragHandlePointerDown}
          show={showMode === 'ALL_FIELDS'}
        />
        {/* Column-level connection handles (left + right, source + target) */}
        <ColumnHandles tableId={tableId} columnId={column.id} />

        {/* Constraint Badges */}
        <ConstraintBadges
          isPrimaryKey={column.isPrimaryKey}
          isNullable={column.isNullable}
          isUnique={column.isUnique}
          isForeignKey={column.isForeignKey}
          onToggle={(constraint, value) =>
            onToggleConstraint(column.id, constraint, value)
          }
        />

        {/* Column name */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '4px',
            minWidth: 0,
          }}
        >
          {isEditingName ? (
            <InlineNameEditor
              value={column.name}
              onCommit={(newValue) => onCommitEdit(column.id, 'name', newValue)}
              onCancel={onCancelEdit}
            />
          ) : (
            <LazyTooltip active={isRowHovered} content="Double-click to edit">
              <span
                style={{
                  fontWeight: column.isPrimaryKey ? 600 : 400,
                  cursor: 'text',
                  flexShrink: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                onDoubleClick={handleNameDoubleClick}
              >
                {column.name}
              </span>
            </LazyTooltip>
          )}

          {/* Data type */}
          {isEditingDataType ? (
            <DataTypeSelector
              value={column.dataType as DataType}
              onSelect={(dt) => onCommitEdit(column.id, 'dataType', dt)}
              onCancel={onCancelEdit}
              autoOpen
            />
          ) : (
            <LazyTooltip
              active={isRowHovered}
              content="Double-click to edit type"
            >
              <span
                style={{
                  color: isHoveringDataType
                    ? 'var(--rf-edge-stroke-selected, #6366f1)'
                    : 'var(--rf-table-text)',
                  opacity: isHoveringDataType ? 1 : 0.6,
                  fontSize: '11px',
                  cursor: 'pointer',
                  flexShrink: 0,
                  width: '72px',
                  textAlign: 'right',
                  borderRadius: '3px',
                  padding: '1px 3px',
                  background: isHoveringDataType
                    ? 'var(--rf-column-edit-bg, rgba(99,102,241,0.12))'
                    : 'transparent',
                  transition: 'background 0.1s, color 0.1s, opacity 0.1s',
                  textDecorationLine: isHoveringDataType ? 'underline' : 'none',
                  textDecorationStyle: 'dotted',
                }}
                onDoubleClick={handleDataTypeDoubleClick}
                onMouseEnter={() => {
                  setIsHoveringDataType(true)
                }}
                onMouseLeave={() => {
                  setIsHoveringDataType(false)
                }}
              >
                {column.dataType}
              </span>
            </LazyTooltip>
          )}
        </div>

        {/* Column note popover — editing a note is a write action; hidden for view-only viewers */}
        {canEdit && (
          <ColumnNotePopover
            description={column.description}
            onSave={(desc) => onDescriptionUpdate(column.id, desc)}
          />
        )}

        {/* Duplicate button — hover visible. Write action, hidden when !canEdit. */}
        {canEdit && (
          <LazyTooltip active={isRowHovered} content="Duplicate field">
            <button
              type="button"
              aria-label={`Duplicate column ${column.name}`}
              onClick={handleDuplicateClick}
              className="nodrag nowheel"
              style={{
                opacity: 0,
                flexShrink: 0,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px',
                color: 'var(--rf-table-text)',
                transition: 'opacity 0.1s',
                fontSize: '11px',
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.opacity = '0'
              }}
            >
              ⧉
            </button>
          </LazyTooltip>
        )}

        {/* Delete button — hover visible. Write action, hidden when !canEdit. */}
        {canEdit && (
          <button
            type="button"
            aria-label={`Delete column ${column.name}`}
            onClick={handleDeleteClick}
            className="nodrag nowheel"
            style={{
              opacity: 0,
              flexShrink: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              color: 'var(--rf-table-text)',
              transition: 'opacity 0.1s',
              fontSize: '14px',
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.opacity = '0'
            }}
          >
            ×
          </button>
        )}

      </div>
    )
  },
  (prev, next) => {
    // Custom memo comparator: skip re-render if nothing editing-related changed
    if (prev.column !== next.column) return false
    if (prev.tableId !== next.tableId) return false
    if (prev.isLast !== next.isLast) return false
    if (prev.onStartEdit !== next.onStartEdit) return false
    if (prev.onCommitEdit !== next.onCommitEdit) return false
    if (prev.onCancelEdit !== next.onCancelEdit) return false
    if (prev.onToggleConstraint !== next.onToggleConstraint) return false
    if (prev.onDelete !== next.onDelete) return false
    if (prev.onDuplicate !== next.onDuplicate) return false
    if (prev.onDescriptionUpdate !== next.onDescriptionUpdate) return false
    if (prev.showMode !== next.showMode) return false

    // Check if editing state changed for this column
    const prevEditing =
      prev.editingField?.columnId === prev.column.id ? prev.editingField : null
    const nextEditing =
      next.editingField?.columnId === next.column.id ? next.editingField : null
    if (prevEditing?.field !== nextEditing?.field) return false

    return true
  },
)

ColumnRow.displayName = 'ColumnRow'
