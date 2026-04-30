/**
 * TableNode — interactive React Flow node for ER diagram tables
 * Supports inline column editing, creation, deletion, notes, and real-time sync
 * column-reorder: DndContext + SortableContext integration for drag-to-reorder
 */

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { ColumnRow } from './column/ColumnRow'
import { AddColumnRow } from './column/AddColumnRow'
import { DeleteColumnDialog } from './column/DeleteColumnDialog'
import { InsertionLine } from './column/InsertionLine'
import { TableNodeContextMenu } from './TableNodeContextMenu'
import { toast } from 'sonner'
import type { Column } from '@prisma/client'
import type {
  RelationshipEdgeType,
  TableNodeData,
} from '@/lib/react-flow/types'
import type { ColumnRelationship, EditingField } from './column/types'
import type { DataType } from '@/data/schema'
import type { DragStartEvent, DragEndEvent, DragOverEvent } from '@dnd-kit/core'
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion'

// Row height constant for InsertionLine positioning (matches minHeight in ColumnRow)
const COLUMN_ROW_HEIGHT = 28

interface TableNodeProps {
  id: string
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
      onColumnReorder,
      emitColumnReorder,
      isQueueFullForTable,
      setLocalDragging,
      bumpReorderTick,
    } = data

    const columns = table.columns

    // --- Local editing state ---
    const [editingField, setEditingField] = useState<EditingField | null>(null)

    // Which column has a pending delete confirmation dialog
    const [deletingColumn, setDeletingColumn] = useState<Column | null>(null)

    // Header hover state — controls X delete button visibility
    const [isHeaderHovered, setIsHeaderHovered] = useState(false)

    // --- Drag-and-drop reorder state ---
    const [activeId, setActiveId] = useState<string | null>(null)
    const [overIndex, setOverIndex] = useState<number | null>(null)
    const preDragOrderRef = useRef<Array<string>>([])
    const preDragColumnsRef = useRef<Array<Column>>([])
    const prefersReducedMotion = usePrefersReducedMotion()

    const sensors = useSensors(
      useSensor(PointerSensor, {
        activationConstraint: { distance: 4 },
      }),
    )

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
      edges.forEach((edge: RelationshipEdgeType) => {
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
      })
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

    // --- Column description (note) handler ---
    const handleDescriptionUpdate = useCallback(
      (columnId: string, description: string) => {
        if (!onColumnUpdate) return
        onColumnUpdate(columnId, table.id, { description })
      },
      [table.id, onColumnUpdate],
    )

    // --- Drag-and-drop reorder handlers ---
    const handleDragStart = useCallback(
      (event: DragStartEvent) => {
        const tableId = table.id

        // SA-M3: queue-full guard at drag-start
        if (isQueueFullForTable?.(tableId)) {
          toast.warning('Slow down — previous reorders still saving')
          return
        }

        performance.mark('column-reorder:drag-start')
        const draggedId = String(event.active.id)
        setActiveId(draggedId)
        setLocalDragging?.(tableId, true)

        // Capture pre-drag snapshot
        preDragOrderRef.current = columns.map((c: Column) => c.id)
        preDragColumnsRef.current = [...columns]
      },
      [table.id, columns, isQueueFullForTable, setLocalDragging],
    )

    const handleDragOver = useCallback(
      (event: DragOverEvent) => {
        if (!event.over) {
          setOverIndex(null)
          return
        }
        const idx = columns.findIndex(
          (c: Column) => c.id === String(event.over!.id),
        )
        setOverIndex(idx >= 0 ? idx : null)
      },
      [columns],
    )

    const handleDragEnd = useCallback(
      (event: DragEndEvent) => {
        performance.mark('column-reorder:drop')

        const { active, over } = event
        setActiveId(null)
        setOverIndex(null)

        if (!onColumnReorder || !emitColumnReorder || !bumpReorderTick) return

        // B1 FIX: If preDragOrderRef is empty, handleDragStart was rejected by the
        // queue-full guard. @dnd-kit continued the drag anyway (returning from onDragStart
        // does not cancel it). reconcileAfterDrop checks preDragOrder.length === 0 and
        // aborts, but we pass it through here so the guard lives in one place (SA-H4).
        // Passing preDragOrderRef.current as-is (empty array) is sufficient — the
        // reconcileAfterDrop early-return will catch it.

        const tableId = table.id
        const currentColumns = columns

        let newOrder: Array<string> | null = null

        if (over && active.id !== over.id) {
          const oldIndex = currentColumns.findIndex(
            (c: Column) => c.id === String(active.id),
          )
          const newIndex = currentColumns.findIndex(
            (c: Column) => c.id === String(over.id),
          )
          if (oldIndex >= 0 && newIndex >= 0) {
            const currentOrder = currentColumns.map((c: Column) => c.id)
            newOrder = arrayMove(currentOrder, oldIndex, newIndex)
          }
        }

        onColumnReorder({
          tableId,
          preDragOrder: preDragOrderRef.current,
          newOrder,
          preState: preDragColumnsRef.current,
          emitColumnReorder,
          // setNodes not available here — will be a no-op; real setNodes is in ReactFlowWhiteboard
          setNodes: (() => {}) as any,
          bumpReorderTick,
        })
      },
      [table.id, columns, onColumnReorder, emitColumnReorder, bumpReorderTick],
    )

    const handleDragCancel = useCallback(() => {
      performance.mark('column-reorder:cancel')
      setActiveId(null)
      setOverIndex(null)

      if (!onColumnReorder || !emitColumnReorder || !bumpReorderTick) return

      onColumnReorder({
        tableId: table.id,
        preDragOrder: preDragOrderRef.current,
        newOrder: null, // cancel path
        preState: preDragColumnsRef.current,
        emitColumnReorder,
        setNodes: (() => {}) as any,
        bumpReorderTick,
      })
    }, [table.id, onColumnReorder, emitColumnReorder, bumpReorderTick])

    // Filter columns based on display mode
    const visibleColumns = useMemo(() => {
      if (showMode === 'KEY_ONLY') {
        return columns.filter((c: Column) => c.isPrimaryKey || c.isForeignKey)
      }
      return columns
    }, [columns, showMode])

    // Use CSS max-content so the browser measures actual rendered text width.
    // Character-count estimates are unreliable; max-content lets each column row
    // expand to its natural size. minWidth respects the user's manually-saved width.
    const minWidth = Math.max(220, table.width ?? 0)

    return (
      <TableNodeContextMenu onDeleteTable={handleRequestTableDelete}>
        <div
          className={`react-flow__node-erTable ${selected ? 'selected' : ''} ${highlightClass}`}
          style={{
            width: 'max-content',
            minWidth: `${minWidth}px`,
            maxWidth: '500px',
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
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
              autoScroll={false}
            >
              <SortableContext
                items={visibleColumns.map((c: Column) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="table-columns" style={{ position: 'relative' }}>
                  {/* InsertionLine — shows drop position during drag */}
                  <InsertionLine
                    visible={activeId !== null && overIndex !== null}
                    targetIndex={overIndex ?? 0}
                    rowHeight={COLUMN_ROW_HEIGHT}
                    prefersReducedMotion={prefersReducedMotion}
                  />

                  {visibleColumns.map((column: Column, index: number) => (
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
                      onDescriptionUpdate={handleDescriptionUpdate}
                      edges={edges}
                      showMode={showMode}
                    />
                  ))}

                  {/* Add Column Row */}
                  <AddColumnRow
                    tableId={table.id}
                    existingColumns={columns}
                    onCreate={handleCreate}
                  />
                </div>
              </SortableContext>

              {/* DragOverlay — ghost row shown at cursor during drag */}
              <DragOverlay
                dropAnimation={prefersReducedMotion ? null : undefined}
              >
                {activeId && (() => {
                  const activeColumn = visibleColumns.find(
                    (c: Column) => c.id === activeId,
                  )
                  if (!activeColumn) return null
                  return (
                    <div style={{ opacity: 0.8 }}>
                      <ColumnRow
                        column={activeColumn}
                        tableId={table.id}
                        isLast={false}
                        editingField={null}
                        onStartEdit={() => {}}
                        onCommitEdit={() => {}}
                        onCancelEdit={() => {}}
                        onToggleConstraint={() => {}}
                        onDelete={() => {}}
                        onDescriptionUpdate={() => {}}
                        edges={[]}
                        showMode={showMode}
                      />
                    </div>
                  )
                })()}
              </DragOverlay>
            </DndContext>
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
    if (prev.data.onColumnReorder !== next.data.onColumnReorder) return false
    if (prev.data.emitColumnReorder !== next.data.emitColumnReorder) return false
    if (prev.data.isQueueFullForTable !== next.data.isQueueFullForTable) return false
    if (prev.data.setLocalDragging !== next.data.setLocalDragging) return false
    if (prev.data.bumpReorderTick !== next.data.bumpReorderTick) return false
    return true
  },
)

TableNode.displayName = 'TableNode'
