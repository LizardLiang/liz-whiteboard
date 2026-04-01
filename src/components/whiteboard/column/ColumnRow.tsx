/**
 * ColumnRow — renders a single column in the TableNode
 * Phase 1: skeleton (display only, no editing)
 * Phase 2+: interactive editing, delete button
 */

import { memo, useCallback, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { InlineNameEditor } from './InlineNameEditor'
import { DataTypeSelector } from './DataTypeSelector'
import { ConstraintBadges } from './ConstraintBadges'
import type { Column } from '@prisma/client'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'
import type { EditingField } from './types'
import { createColumnHandleId } from '@/lib/react-flow/edge-routing'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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
  edges: Array<RelationshipEdgeType>
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
    edges: _edges,
  }: ColumnRowProps) => {
    const isEditingName =
      editingField?.columnId === column.id && editingField.field === 'name'
    const isEditingDataType =
      editingField?.columnId === column.id && editingField.field === 'dataType'
    const isEditing = isEditingName || isEditingDataType
    const [isHoveringDataType, setIsHoveringDataType] = useState(false)

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
        if (e.key === 'Delete' && !isEditing) {
          e.stopPropagation()
          onDelete(column)
        }
      },
      [column, column.id, isEditing, onStartEdit, onDelete],
    )

    const handleDeleteClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        onDelete(column)
      },
      [column, onDelete],
    )

    return (
      <TooltipProvider>
        <div
          className={`column-row group${isEditing ? ' editing' : ''}`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
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
          }}
        >
          {/* Left-side handles */}
          <Handle
            type="source"
            position={Position.Left}
            id={createColumnHandleId(tableId, column.id, 'left', 'source')}
            className="nodrag"
            style={{ left: '-5px' }}
          />
          <Handle
            type="target"
            position={Position.Left}
            id={createColumnHandleId(tableId, column.id, 'left', 'target')}
            className="nodrag"
            style={{ left: '-5px' }}
          />

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
                onCommit={(newValue) =>
                  onCommitEdit(column.id, 'name', newValue)
                }
                onCancel={onCancelEdit}
              />
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
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
                </TooltipTrigger>
                <TooltipContent side="top">Double-click to edit</TooltipContent>
              </Tooltip>
            )}

            {/* Data type */}
            {isEditingDataType ? (
              <DataTypeSelector
                value={column.dataType as import('@/data/schema').DataType}
                onSelect={(dt) => onCommitEdit(column.id, 'dataType', dt)}
                onCancel={onCancelEdit}
              />
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
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
                      textDecoration: isHoveringDataType ? 'underline' : 'none',
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
                </TooltipTrigger>
                <TooltipContent side="top">
                  Double-click to edit type
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Delete button — hover visible */}
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

          {/* Right-side handles */}
          <Handle
            type="source"
            position={Position.Right}
            id={createColumnHandleId(tableId, column.id, 'right', 'source')}
            className="nodrag"
            style={{ right: '-5px' }}
          />
          <Handle
            type="target"
            position={Position.Right}
            id={createColumnHandleId(tableId, column.id, 'right', 'target')}
            className="nodrag"
            style={{ right: '-5px' }}
          />
        </div>
      </TooltipProvider>
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
