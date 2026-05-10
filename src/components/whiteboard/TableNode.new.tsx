/**
 * TableNode — interactive React Flow node for ER diagram tables
 * Supports inline column editing, creation, deletion, notes, and real-time sync
 * column-reorder: raw pointer-event drag (document-level listeners, rAF throttled)
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ColumnRow } from './column/ColumnRow'
import { AddColumnRow } from './column/AddColumnRow'
import { DeleteColumnDialog } from './column/DeleteColumnDialog'
import { InsertionLine } from './column/InsertionLine'
import { TableNodeContextMenu } from './TableNodeContextMenu'
import type { Column } from '@prisma/client'
import type {
  RelationshipEdgeType,
  TableNodeData,
} from '@/lib/react-flow/types'
import type { ColumnRelationship, EditingField } from './column/types'
import type { DataType } from '@/data/schema'
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
      onColumnDuplicate,
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

    // --- Drag-and-drop reorder state (raw pointer events) ---
    const [activeId, setActiveId] = useState<string | null>(null)
    const [overIndex, setOverIndex] = useState<number | null>(null)
    const preDragOrderRef = useRef<Array<string>>([])
    const preDragColumnsRef = useRef<Array<Column>>([])
    const prefersReducedMotion = usePrefersReducedMotion()
    // Snapshot of column row rects captured at drag start (viewport coords)
    const columnRectsRef = useRef<
      Array<{ id: string; top: number; bottom: number; mid: number }>
    >([])
    const columnRowsRef = useRef<HTMLDivElement | null>(null)

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

    // --- Duplicate handler ---
    const handleDuplicateColumn = useCallback(
      (column: Column) => {
        if (onColumnDuplicate) {
          onColumnDuplicate(column)
        }
      },
      [onColumnDuplicate],
    )

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

    // Filter columns based on display mode (declared early — used in drag handler below)
    const visibleColumns = useMemo(() => {
      if (showMode === 'KEY_ONLY') {
        return columns.filter((c: Column) => c.isPrimaryKey || c.isForeignKey)
      }
      return columns
    }, [columns, showMode])

    // Keep a ref to visibleColumns so the pointermove handler can re-read rects
    // without capturing a stale closure value when columns change during drag
    const visibleColumnsRef = useRef(visibleColumns)
    useEffect(() => {
      visibleColumnsRef.current = visibleColumns
    }, [visibleColumns])

    // --- Raw pointer drag reorder ---
    // Compute which index the pointer is over given a clientY and column rects snapshot
    const computeTargetIndex = (clientY: number): number => {
      const rects = columnRectsRef.current
      if (rects.length === 0) return 0
      for (let i = 0; i < rects.length; i++) {
        if (clientY < rects[i].mid) return i
      }
      return rects.length - 1
    }

    const handleDragHandlePointerDown = useCallback(
      (e: React.PointerEvent, columnId: string) => {
        // Queue-full check BEFORE preventDefault so click behaves normally when rejected
        if (isQueueFullForTable?.(table.id)) {
          toast.warning('Slow down — previous reorders still saving')
          return
        }

        e.preventDefault()
        e.stopPropagation()

        // Snapshot column row rects from the DOM right now (fresh viewport coords)
        const rowEls =
          columnRowsRef.current?.querySelectorAll<HTMLElement>('.column-row')
        if (rowEls) {
          columnRectsRef.current = Array.from(rowEls).map((el, i) => {
            const r = el.getBoundingClientRect()
            return {
              id: visibleColumns[i]?.id ?? '',
              top: r.top,
              bottom: r.bottom,
              mid: r.top + r.height / 2,
            }
          })
        }

        const dragIndex = visibleColumns.findIndex(
          (c: Column) => c.id === columnId,
        )

        preDragOrderRef.current = columns.map((c: Column) => c.id)
        preDragColumnsRef.current = [...columns]
        setActiveId(columnId)
        setOverIndex(dragIndex)
        setLocalDragging?.(table.id, true)
        document.body.style.cursor = 'grabbing'
      },
      [
        table.id,
        columns,
        visibleColumns,
        isQueueFullForTable,
        setLocalDragging,
      ],
    )

    // Document-level pointermove/pointerup while a column drag is active
    useEffect(() => {
      if (!activeId) return

      // rAF handle is declared inside the effect so each effect instance has its own
      let frame: number | null = null

      const onMove = (e: PointerEvent) => {
        if (frame !== null) return
        frame = requestAnimationFrame(() => {
          frame = null
          // Re-read rects fresh in case canvas scrolled/zoomed since drag started
          const rowEls =
            columnRowsRef.current?.querySelectorAll<HTMLElement>('.column-row')
          if (rowEls && rowEls.length > 0) {
            columnRectsRef.current = Array.from(rowEls).map((el, i) => {
              const r = el.getBoundingClientRect()
              return {
                id: visibleColumnsRef.current[i]?.id ?? '',
                top: r.top,
                bottom: r.bottom,
                mid: r.top + r.height / 2,
              }
            })
          }
          const idx = computeTargetIndex(e.clientY)
          setOverIndex(idx)
        })
      }

      const onUp = (e: PointerEvent) => {
        document.body.style.cursor = ''
        const newOverIndex = computeTargetIndex(e.clientY)
        const oldIndex = preDragOrderRef.current.indexOf(activeId)
        setActiveId(null)
        setOverIndex(null)
        setLocalDragging?.(table.id, false)

        if (!onColumnReorder || !emitColumnReorder || !bumpReorderTick) return

        let newOrder: Array<string> | null = null
        if (newOverIndex !== oldIndex && oldIndex >= 0) {
          const arr = [...preDragOrderRef.current]
          arr.splice(oldIndex, 1)
          arr.splice(newOverIndex, 0, preDragOrderRef.current[oldIndex])
          newOrder = arr
        }

        onColumnReorder({
          tableId: table.id,
          preDragOrder: preDragOrderRef.current,
          newOrder,
          preState: preDragColumnsRef.current,
          emitColumnReorder,
          setNodes: (() => {}) as any,
          bumpReorderTick,
        })
      }

      const onCancel = () => {
        document.body.style.cursor = ''
        setActiveId(null)
        setOverIndex(null)
        setLocalDragging?.(table.id, false)
        if (onColumnReorder && emitColumnReorder && bumpReorderTick) {
          onColumnReorder({
            tableId: table.id,
            preDragOrder: preDragOrderRef.current,
            newOrder: null,
            preState: preDragColumnsRef.current,
            emitColumnReorder,
            setNodes: (() => {}) as any,
            bumpReorderTick,
          })
        }
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onCancel)
      return () => {
        if (frame !== null) cancelAnimationFrame(frame)
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onCancel)
        // If we unmount while drag is active (table deleted, route change, etc.), restore state
        if (activeId) {
          document.body.style.cursor = ''
          setLocalDragging?.(table.id, false)
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId])

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
            <div
              ref={columnRowsRef}
              className="table-columns"
              style={{ position: 'relative' }}
            >
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
                  onDuplicate={handleDuplicateColumn}
                  onDescriptionUpdate={handleDescriptionUpdate}
                  edges={edges}
                  showMode={showMode}
                  isDraggingActive={activeId === column.id}
                  onDragHandlePointerDown={(e) =>
                    handleDragHandlePointerDown(e, column.id)
                  }
                />
              ))}

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
    if (prev.data.onColumnDuplicate !== next.data.onColumnDuplicate)
      return false
    if (prev.data.edges !== next.data.edges) return false
    if (prev.data.tableNameById !== next.data.tableNameById) return false
    if (prev.data.onRequestTableDelete !== next.data.onRequestTableDelete)
      return false
    if (prev.data.onColumnReorder !== next.data.onColumnReorder) return false
    if (prev.data.emitColumnReorder !== next.data.emitColumnReorder)
      return false
    if (prev.data.isQueueFullForTable !== next.data.isQueueFullForTable)
      return false
    if (prev.data.setLocalDragging !== next.data.setLocalDragging) return false
    if (prev.data.bumpReorderTick !== next.data.bumpReorderTick) return false
    return true
  },
)

TableNode.displayName = 'TableNode'
