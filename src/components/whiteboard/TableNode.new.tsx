/**
 * TableNode — interactive React Flow node for ER diagram tables
 * Supports inline column editing, creation, deletion, notes, and real-time sync
 */

import React, { memo, useCallback, useMemo, useState, Suspense } from 'react'
import { ColumnRow } from './column/ColumnRow'
import { AddColumnRow } from './column/AddColumnRow'
import { DeleteColumnDialog } from './column/DeleteColumnDialog'
import { TableNodeContextMenu } from './TableNodeContextMenu'
import { TableNotesButton } from './TableNotesButton'
import { useBulkTableNotes } from '@/hooks/useTableNotes'
import type { Column } from '@prisma/client'
import type {
  RelationshipEdgeType,
  TableNodeData,
} from '@/lib/react-flow/types'
import type { ColumnRelationship, EditingField } from './column/types'
import type { DataType } from '@/data/schema'

// Lazy-loaded drawer to reduce initial bundle size
const TableNoteDrawer = React.lazy(() =>
  import('./TableNoteDrawer').then(module => ({ default: module.TableNoteDrawer }))
)

interface TableNodeProps {
  data: TableNodeData
  selected?: boolean
}

export const TableNode = memo(
  ({ data, selected }: TableNodeProps) => {
    const {
      table,
      showMode,
      isActiveHighlighted,
      isHighlighted,
      isHovered,
      onColumnCreate,
      onColumnUpdate,
      onColumnDelete,
      onRequestTableDelete,
      edges = [],
      tableNameById = new Map(),
      // Notes functionality context - will be added to TableNodeData interface
      whiteboardId = 'unknown',
      userId = 'unknown',
    } = data

    const columns = table.columns

    // --- Local editing state ---
    const [editingField, setEditingField] = useState<EditingField | null>(null)

    // Which column has a pending delete confirmation dialog
    const [deletingColumn, setDeletingColumn] = useState<Column | null>(null)

    // Header hover state — controls X delete button visibility
    const [isHeaderHovered, setIsHeaderHovered] = useState(false)

    // Notes drawer state
    const [isNotesDrawerOpen, setIsNotesDrawerOpen] = useState(false)

    // Check if table has notes using bulk notes hook (more efficient than individual queries)
    const { data: bulkNotesData } = useBulkTableNotes([table.id])
    const hasNotes = Boolean(bulkNotesData?.notes?.[table.id]?.description?.trim())

    // Determine visual state classes
    const highlightClass = isActiveHighlighted
      ? 'active-highlighted'
      : isHighlighted
        ? 'highlighted'
        : isHovered
          ? 'hovered'
          : ''

    // Pre-compute a map from columnId to affected edges for fast delete checks
    const columnEdgeMap = useMemo(() => {
      const map = new Map<string, Array<RelationshipEdgeType>>()
      ;(edges).forEach(
        (edge: RelationshipEdgeType) => {
          const srcId = edge.data?.relationship.sourceColumnId
          const tgtId = edge.data?.relationship.targetColumnId
          if (srcId) {
            if (!map.has(srcId)) map.set(srcId, [])
            map.get(srcId)!.push(edge)
          }
          if (tgtId && tgtId !== srcId) {
            if (!map.has(tgtId)) map.set(tgtId, [])
            map.get(tgtId)!.push(edge)
          }
        },
      )
      return map
    }, [edges])

    // --- Edit handlers ---
    const handleStartEdit = useCallback(
      (columnId: string, field: 'name' | 'dataType') => {
        setEditingField({ columnId, field })
      },
      [],
    )

    const handleCommitEdit = useCallback(
      (columnId: string, field: 'name' | 'dataType', value: string) => {
        setEditingField(null)
        if (!onColumnUpdate) return
        onColumnUpdate(columnId, table.id, {
          [field]: value as unknown as Partial<DataType>,
        })
      },
      [table.id, onColumnUpdate],
    )

    const handleCancelEdit = useCallback(() => {
      setEditingField(null)
    }, [])

    const handleToggleConstraint = useCallback(
      (
        columnId: string,
        constraint: 'isPrimaryKey' | 'isNullable' | 'isUnique',
        value: boolean,
      ) => {
        if (!onColumnUpdate) return
        // PK ON: auto-set isNullable=false + isUnique=true
        if (constraint === 'isPrimaryKey' && value === true) {
          onColumnUpdate(columnId, table.id, {
            isPrimaryKey: true,
            isNullable: false,
            isUnique: true,
          })
        } else {
          onColumnUpdate(columnId, table.id, { [constraint]: value })
        }
      },
      [table.id, onColumnUpdate],
    )

    // --- Delete handlers ---
    const handleDeleteColumn = useCallback(
      (column: Column) => {
        const affectedEdges = columnEdgeMap.get(column.id) ?? []
        if (affectedEdges.length > 0) {
          // Show confirmation dialog
          setDeletingColumn(column)
        } else {
          // Immediate optimistic delete — no dialog
          if (editingField?.columnId === column.id) {
            setEditingField(null)
          }
          if (onColumnDelete) {
            onColumnDelete(column.id, table.id)
          }
        }
      },
      [columnEdgeMap, editingField, table.id, onColumnDelete],
    )

    const handleConfirmDelete = useCallback(() => {
      if (!deletingColumn) return
      // FM-06: exit edit mode if deleting the column being edited
      if (editingField?.columnId === deletingColumn.id) {
        setEditingField(null)
      }
      if (onColumnDelete) {
        onColumnDelete(deletingColumn.id, table.id)
      }
      setDeletingColumn(null)
    }, [deletingColumn, editingField, table.id, onColumnDelete])

    const handleCancelDelete = useCallback(() => {
      setDeletingColumn(null)
    }, [])

    // Build relationship data for the delete dialog
    const affectedRelationships = useMemo((): Array<ColumnRelationship> => {
      if (!deletingColumn) return []
      const affectedEdges = columnEdgeMap.get(deletingColumn.id) ?? []
      return affectedEdges.map((edge) => {
        const rel = edge.data!.relationship
        return {
          id: edge.id,
          sourceTableName:
            tableNameById.get(rel.sourceTableId) ?? rel.sourceTableId,
          sourceColumnName: rel.sourceColumn.name,
          targetTableName:
            tableNameById.get(rel.targetTableId) ?? rel.targetTableId,
          targetColumnName: rel.targetColumn.name,
          cardinality: edge.data!.cardinality,
        }
      })
    }, [deletingColumn, columnEdgeMap, tableNameById])

    // --- Table delete handler ---
    const handleRequestTableDelete = useCallback(() => {
      onRequestTableDelete?.(table.id)
    }, [onRequestTableDelete, table.id])

    // --- Create handler ---
    const handleCreate = useCallback(
      async (data: { name: string; dataType: DataType; order: number }) => {
        if (onColumnCreate) {
          try {
            await onColumnCreate(table.id, data)
          } catch (error) {
            console.error('Failed to create column:', error)
            throw error
          }
        }
      },
      [table.id, onColumnCreate],
    )

    // Filter columns based on display mode
    const visibleColumns = useMemo(() => {
      if (showMode === 'KEY_ONLY') {
        return columns.filter((c: Column) => c.isPrimaryKey || c.isForeignKey)
      }
      return columns
    }, [columns, showMode])

    // Auto-compute width to fit the longest column name
    const autoWidth = useMemo(() => {
      const MIN_WIDTH = 220
      const MAX_WIDTH = 500

      // Header: table name + fixed chrome (padding + buttons)
      const headerWidth = table.name.length * 8.5 + 80

      // Columns: name text + fixed chrome (badges + dataType + padding + gaps + delete)
      const maxColumnWidth = columns.reduce((max, col) => {
        const nameWidth = col.name.length * 7.5 + 200
        return Math.max(max, nameWidth)
      }, 0)

      // User-stored width acts as a floor
      const userWidth = table.width ?? 0

      return Math.min(
        Math.max(MIN_WIDTH, headerWidth, maxColumnWidth, userWidth),
        MAX_WIDTH,
      )
    }, [table.name, table.width, columns])

    return (
      <TableNodeContextMenu onDeleteTable={handleRequestTableDelete}>
        <div
          className={`react-flow__node-erTable ${selected ? 'selected' : ''} ${highlightClass}`}
          style={{
            width: `${autoWidth}px`,
            minWidth: '200px',
            opacity:
              isActiveHighlighted || isHighlighted || isHovered || selected
                ? 1
                : 0.7,
            transition: 'opacity 0.2s, box-shadow 0.2s',
            boxShadow:
              isActiveHighlighted || selected
                ? '0 0 0 2px var(--rf-edge-stroke-selected)'
                : isHighlighted
                  ? '0 0 0 1px var(--rf-edge-stroke-selected)'
                  : undefined,
          }}
        >
          {/* Table Header */}
          <div
            className="table-header"
            style={{
              padding: '12px 16px',
              background: 'var(--rf-table-header-bg)',
              borderBottom: '1px solid var(--rf-table-border)',
              fontWeight: 600,
              fontSize: '14px',
              color: 'var(--rf-table-header-text)',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
            onMouseEnter={() => {
              setIsHeaderHovered(true)
            }}
            onMouseLeave={() => {
              setIsHeaderHovered(false)
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {table.name}
            </span>

            {/* Header buttons container */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {/* Notes button — always visible when header is hovered */}
              <TableNotesButton
                tableId={table.id}
                hasNotes={hasNotes}
                isActive={isNotesDrawerOpen}
                onClick={() => setIsNotesDrawerOpen(true)}
                className={`transition-opacity duration-100 ${isHeaderHovered ? 'opacity-100' : 'opacity-0'}`}
              />

              {/* Delete button — visible on header hover */}
              <button
                type="button"
                aria-label={`Delete table ${table.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  handleRequestTableDelete()
                }}
                className="nodrag nowheel"
                style={{
                  opacity: isHeaderHovered ? 1 : 0,
                  flexShrink: 0,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  color: 'var(--rf-table-header-text)',
                  transition: 'opacity 0.1s',
                  fontSize: '16px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Columns List */}
          {showMode !== 'TABLE_NAME' && (
            <div className="table-columns">
              {(visibleColumns).map(
                (column: Column, index: number) => (
                  <ColumnRow
                    key={column.id}
                    column={column}
                    tableId={table.id}
                    isLast={index === visibleColumns.length - 1}
                    editingField={editingField}
                    onStartEdit={handleStartEdit}
                    onCommitEdit={handleCommitEdit}
                    onCancelEdit={handleCancelEdit}
                    onToggleConstraint={handleToggleConstraint}
                    onDelete={handleDeleteColumn}
                    edges={edges}
                  />
                ),
              )}

              {/* Add Column Row */}
              <AddColumnRow
                tableId={table.id}
                existingColumns={columns}
                onCreate={handleCreate}
              />
            </div>
          )}

          {/* Delete Confirmation Dialog */}
          {deletingColumn && (
            <DeleteColumnDialog
              column={deletingColumn}
              affectedRelationships={affectedRelationships}
              onConfirm={handleConfirmDelete}
              onCancel={handleCancelDelete}
            />
          )}

          {/* Notes Drawer - Lazy loaded and rendered outside the node */}
          {isNotesDrawerOpen && (
            <Suspense fallback={<div>Loading notes...</div>}>
              <TableNoteDrawer
                isOpen={isNotesDrawerOpen}
                tableId={table.id}
                tableName={table.name}
                whiteboardId={whiteboardId}
                userId={userId}
                onClose={() => setIsNotesDrawerOpen(false)}
              />
            </Suspense>
          )}
        </div>
      </TableNodeContextMenu>
    )
  },
  (prev: TableNodeProps, next: TableNodeProps) => {
    // Custom memo comparator: allow re-renders when columns change, skip position-only changes
    if (prev.data.table !== next.data.table) return false
    if (prev.data.showMode !== next.data.showMode) return false
    if (prev.data.isActiveHighlighted !== next.data.isActiveHighlighted)
      return false
    if (prev.data.isHighlighted !== next.data.isHighlighted) return false
    if (prev.data.isHovered !== next.data.isHovered) return false
    if (prev.selected !== next.selected) return false
    if (prev.data.onColumnCreate !== next.data.onColumnCreate) return false
    if (prev.data.onColumnUpdate !== next.data.onColumnUpdate) return false
    if (prev.data.onColumnDelete !== next.data.onColumnDelete) return false
    if (prev.data.edges !== next.data.edges) return false
    if (prev.data.tableNameById !== next.data.tableNameById) return false
    if (prev.data.onRequestTableDelete !== next.data.onRequestTableDelete)
      return false
    // Compare whiteboard and user context for notes functionality
    if (prev.data.whiteboardId !== next.data.whiteboardId) return false
    if (prev.data.userId !== next.data.userId) return false
    return true
  },
)

TableNode.displayName = 'TableNode'
