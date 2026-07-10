/**
 * TableNode — interactive React Flow node for ER diagram tables
 * Supports inline column editing, creation, deletion, notes, and real-time sync
 * column-reorder: raw pointer-event drag (document-level listeners, rAF throttled)
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@xyflow/react'
import { Link2, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { ColumnRow } from './column/ColumnRow'
import { ColumnHandles } from './column/ColumnHandles'
import { AddColumnRow } from './column/AddColumnRow'
import { DeleteColumnDialog } from './column/DeleteColumnDialog'
import { InsertionLine } from './column/InsertionLine'
import { TableNodeContextMenu } from './TableNodeContextMenu'
import { TableRelationsPanel } from './TableRelationsPanel'
import { CommentThreadPopover } from './CommentThreadPopover'
import { TableNotePopover } from './TableNotePopover'
import { useWhiteboardPermissions } from './whiteboard-permissions-context'
import type { Column } from '@/data/models'
import type {
  RelationshipEdgeType,
  TableNodeData,
} from '@/lib/react-flow/types'
import type { ColumnRelationship, EditingField } from './column/types'
import type { DataType } from '@/data/schema'
import type { Dialect } from '@/lib/ddl-generator'
import { getDirectlyRelatedTableIds } from '@/lib/react-flow/highlighting'
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion'
import {
  LOD_ZOOM_THRESHOLD,
  useForceFullDetail,
} from '@/lib/react-flow/level-of-detail'

// Row height constant for InsertionLine positioning (matches minHeight in ColumnRow)
const COLUMN_ROW_HEIGHT = 28

interface TableNodeProps {
  id: string
  data: TableNodeData
  selected?: boolean
}

/**
 * Minimal column row rendered when LOD-collapsed (GH #121 perf, opt #3) —
 * keeps ONLY the 4 column-level handles, at the same row height as the full
 * ColumnRow, so edge routing/drag-to-connect never lose their anchor point
 * while zoomed out (column-level handles are fragile and required — see
 * ColumnRow.tsx / project conventions). Skips every other bit of per-column
 * DOM: drag handle, constraint badges, name/type text, tooltips, note/
 * duplicate/delete buttons — the actual DOM-weight win.
 */
function LodColumnRow({
  column,
  tableId,
  isLast,
}: {
  column: Column
  tableId: string
  isLast: boolean
}) {
  return (
    <div
      style={{
        position: 'relative',
        minHeight: `${COLUMN_ROW_HEIGHT}px`,
        borderBottom: isLast ? 'none' : '1px solid var(--rf-table-border)',
      }}
    >
      <ColumnHandles tableId={tableId} columnId={column.id} />
    </div>
  )
}

export const TableNode = memo(
  ({ data, selected }: TableNodeProps) => {
    const { canEdit } = useWhiteboardPermissions()
    const {
      table,
      showMode,
      isActiveHighlighted,
      isHighlighted,
      isRelationsPreviewOpen,
      onColumnCreate,
      onColumnUpdate,
      onColumnDelete,
      onColumnDuplicate,
      onRequestTableDelete,
      onFocusTable,
      onExportDdl,
      onPreviewRelations,
      areas,
      onAddToArea,
      onRemoveFromArea,
      edges = [],
      relationsEdges = [],
      tableNameById = new Map(),
      onColumnReorder,
      emitColumnReorder,
      isQueueFullForTable,
      setLocalDragging,
      bumpReorderTick,
      commentThreads = [],
      canComment = false,
      currentUserId = '',
      canModerateComments = false,
      onCreateTableComment,
      onReplyComment,
      onEditComment,
      onDeleteComment,
      onResolveComment,
      onTableNoteSave,
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

    // Determine visual state classes. Hover highlight is driven imperatively
    // by ReactFlowCanvas.tsx's DOM-class effect (`.rf-hover-highlighted` in
    // react-flow-theme.css) instead of a setNodes-driven prop, so a hover no
    // longer rebuilds/re-renders the full node array.
    const highlightClass = isActiveHighlighted
      ? 'active-highlighted'
      : isHighlighted
        ? 'highlighted'
        : ''

    // Level-of-detail (GH #121 perf, opt #3): below LOD_ZOOM_THRESHOLD,
    // render each column as a minimal handles-only LodColumnRow instead of
    // the full interactive ColumnRow (columns are still mapped — see the
    // .map call below — so edge anchors survive) — cuts DOM weight
    // dramatically on a dense, zoomed-out board. `useStore` selects a
    // derived boolean (not the raw zoom number) so this only re-renders when
    // the board crosses the threshold, not on every pan/zoom tick.
    // forceFullDetail (from ForceFullDetailContext) overrides this during
    // image export, which rasterizes the live DOM and must always capture
    // full detail regardless of the current on-screen zoom.
    const forceFullDetail = useForceFullDetail()
    const isZoomedBelowLodThreshold = useStore(
      (s) => s.transform[2] < LOD_ZOOM_THRESHOLD,
    )
    const isLodCollapsed = isZoomedBelowLodThreshold && !forceFullDetail

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

    // Related edges for the attached relations panel (1-hop neighbors).
    // Sourced from relationsEdges (pre-filtered via filterValidEdges), NOT
    // the raw `edges` above — a relationship whose sourceColumn/targetColumn
    // snapshot references a column deleted elsewhere must never reach the
    // panel, or it would render a connection line naming a column that no
    // longer exists.
    const relatedEdges = useMemo(
      () => getDirectlyRelatedTableIds(table.id, relationsEdges).relatedEdges,
      [table.id, relationsEdges],
    )

    // Comment badge (GH #110) — count of UNRESOLVED threads anchored to this
    // table, shown on the header comment button.
    const unresolvedCommentCount = useMemo(
      () => commentThreads.filter((t) => !t.root.resolved).length,
      [commentThreads],
    )

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

    // GH #121 data-loss fix: LOD-collapsing the row a user is mid-edit on
    // would unmount ColumnRow (and its InlineNameEditor/DataTypeSelector)
    // without ever firing blur/focusout (WHATWG ancestor-unmount quirk),
    // silently dropping typed-but-uncommitted text and leaving `editingField`
    // dangling (so zooming back in re-opens an editor the user never closed).
    // A plain `useEffect` keyed on `isLodCollapsed` can't fix this on its own
    // — the render that flips `isLodCollapsed` true is the SAME commit that
    // unmounts the row, so by the time any effect runs the live input is
    // already gone. The per-column carve-out below (see the columns .map)
    // keeps the row currently being edited mounted as a full ColumnRow
    // through the collapse; this effect then forces that still-live row to
    // resolve through its OWN existing, already-correct handlers — a real
    // `.blur()` call for a name edit (InlineNameEditor's blur commits, and
    // already guards empty input by canceling instead — see
    // InlineNameEditor.tsx), or a direct cancel for a dataType edit
    // (DataTypeSelector's own close-without-selection path also cancels —
    // see DataTypeSelector.tsx — and there's no persisted value to lose for
    // an unmade combobox selection). Only after this resolves (editingField
    // clears) is the row free to actually collapse to LodColumnRow.
    useEffect(() => {
      if (!isLodCollapsed || !editingField) return
      if (editingField.field === 'name') {
        columnRowsRef.current
          ?.querySelector<HTMLInputElement>('input[type="text"]')
          ?.blur()
      } else {
        handleCancelEdit()
      }
    }, [isLodCollapsed, editingField, handleCancelEdit])

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

    // --- Table note handler (table-level twin of column notes) ---
    const handleTableNoteSave = useCallback(
      (description: string) => onTableNoteSave?.(table.id, description),
      [table.id, onTableNoteSave],
    )

    // --- Export DDL handler ---
    const handleExportDdl = useCallback(
      (dialect: Dialect) => {
        onExportDdl?.(table.id, dialect)
      },
      [onExportDdl, table.id],
    )

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
    }, [activeId])

    // Use CSS max-content so the browser measures actual rendered text width.
    // Character-count estimates are unreliable; max-content lets each column row
    // expand to its natural size. minWidth respects the user's manually-saved width.
    const minWidth = Math.max(220, table.width ?? 0)

    return (
      <TableNodeContextMenu
        onDeleteTable={handleRequestTableDelete}
        onFocusTable={() => onFocusTable?.(table.id)}
        onExportDdl={handleExportDdl}
        onPreviewRelations={() => onPreviewRelations?.(table.id)}
        areas={areas}
        tableId={table.id}
        onAddToArea={onAddToArea}
        onRemoveFromArea={onRemoveFromArea}
      >
        <div
          className={`react-flow__node-erTable ${selected ? 'selected' : ''} ${highlightClass}`}
          style={{
            position: 'relative',
            width: 'max-content',
            minWidth: `${minWidth}px`,
            maxWidth: '500px',
            opacity:
              isActiveHighlighted || isHighlighted || selected ? 1 : 0.7,
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
              {/* Relations preview trigger — always visible, not gated by
                  canEdit (relations viewing is a read-only action, matches
                  the un-gated "Show relations" context-menu item). */}
              <button
                type="button"
                aria-label={
                  isRelationsPreviewOpen
                    ? `Hide relations for ${table.name}`
                    : `Show relations for ${table.name}`
                }
                aria-pressed={isRelationsPreviewOpen}
                data-testid="table-relations-trigger"
                title={
                  isRelationsPreviewOpen
                    ? 'Hide relations (r)'
                    : 'Show relations (r)'
                }
                onClick={(e) => {
                  e.stopPropagation()
                  onPreviewRelations?.(table.id)
                }}
                className="nodrag nowheel"
                style={{
                  opacity: 1,
                  flexShrink: 0,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  color: isRelationsPreviewOpen
                    ? 'var(--rf-edge-stroke-selected)'
                    : 'var(--rf-table-header-text)',
                  transition: 'color 0.1s',
                }}
              >
                <Link2 size={14} />
              </button>

              {/* Comment badge (GH #110) — always visible when there are
                  unresolved threads (or on header hover otherwise), like the
                  relations trigger. Read-only viewers may still open it to
                  read/reply/resolve — comments are VIEWER+, not EDITOR+. */}
              {canComment && (
                <CommentThreadPopover
                  trigger={
                    <button
                      type="button"
                      aria-label={
                        unresolvedCommentCount > 0
                          ? `${unresolvedCommentCount} unresolved comment${unresolvedCommentCount === 1 ? '' : 's'} on ${table.name}`
                          : `Comment on ${table.name}`
                      }
                      data-testid="table-comment-trigger"
                      className="nodrag nowheel relative flex items-center"
                      style={{
                        opacity:
                          unresolvedCommentCount > 0 || isHeaderHovered ? 1 : 0,
                        flexShrink: 0,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px',
                        color:
                          unresolvedCommentCount > 0
                            ? 'var(--rf-edge-stroke-selected)'
                            : 'var(--rf-table-header-text)',
                        transition: 'opacity 0.1s',
                      }}
                    >
                      <MessageCircle size={14} />
                      {unresolvedCommentCount > 0 && (
                        <span
                          className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-semibold text-white"
                          style={{
                            background:
                              'var(--rf-edge-stroke-selected, #6366f1)',
                          }}
                        >
                          {unresolvedCommentCount}
                        </span>
                      )}
                    </button>
                  }
                  threads={commentThreads}
                  canComment={canComment}
                  currentUserId={currentUserId}
                  canModerateComments={canModerateComments}
                  onCreateThread={(body) =>
                    onCreateTableComment?.(table.id, body)
                  }
                  onReply={(parentId, body) => onReplyComment?.(parentId, body)}
                  onEdit={(commentId, body) => onEditComment?.(commentId, body)}
                  onDelete={(commentId) => onDeleteComment?.(commentId)}
                  onResolve={(commentId, resolved) =>
                    onResolveComment?.(commentId, resolved)
                  }
                />
              )}

              {/* Table note trigger — table-level twin of the column note
                  popover. Distinct StickyNote icon (not the MessageCircle
                  thread button above). Gated by canEdit like the delete
                  button; view-only viewers get no editable affordance. */}
              {canEdit && (
                <TableNotePopover
                  description={table.description ?? null}
                  onSave={handleTableNoteSave}
                />
              )}

              {/* Delete button — visible on header hover. View-only viewers
                  don't get this affordance at all (server also blocks it). */}
              {canEdit && (
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
              )}
            </div>
          </div>

          {/* Columns List — LOD-collapsed (GH #121) below LOD_ZOOM_THRESHOLD:
              still maps every column (handles must stay so edge routing/
              drag-to-connect keep working while zoomed out) but renders the
              minimal LodColumnRow instead of the full interactive ColumnRow. */}
          {showMode !== 'TABLE_NAME' && (
            <div
              ref={columnRowsRef}
              className="table-columns"
              style={{ position: 'relative' }}
            >
              {/* InsertionLine — shows drop position during drag (reorder
                  drag can't start while collapsed — no DragHandle rendered). */}
              {!isLodCollapsed && (
                <InsertionLine
                  visible={activeId !== null && overIndex !== null}
                  targetIndex={overIndex ?? 0}
                  rowHeight={COLUMN_ROW_HEIGHT}
                  prefersReducedMotion={prefersReducedMotion}
                />
              )}
              {visibleColumns.map((column: Column, index: number) => {
                // GH #121 data-loss fix: never LOD-collapse the row currently
                // mid-edit — see the resolveOpenEditOnLodCollapse effect
                // above for why this carve-out is required (a plain effect
                // alone runs too late to save the live, uncommitted input).
                const isEditingThisColumn =
                  editingField?.columnId === column.id
                return isLodCollapsed && !isEditingThisColumn ? (
                  <LodColumnRow
                    key={column.id}
                    column={column}
                    tableId={table.id}
                    isLast={index === visibleColumns.length - 1}
                  />
                ) : (
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
                )
              })}

              {/* Add Column Row — hidden for view-only viewers (server also
                  blocks the underlying createColumnsFn mutation) and while
                  LOD-collapsed (zoom in to add columns). */}
              {canEdit && !isLodCollapsed && (
                <AddColumnRow
                  tableId={table.id}
                  existingColumns={columns}
                  onCreate={handleCreate}
                />
              )}
            </div>
          )}

          {/* Relations Panel — attached "drawer" shown via `r` shortcut / context menu.
              Renders regardless of showMode since related-table connections are
              independent of which columns are currently visible. */}
          {isRelationsPreviewOpen && (
            <TableRelationsPanel
              table={table}
              relatedEdges={relatedEdges}
              tableNameById={tableNameById}
            />
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
    if (prev.data.isRelationsPreviewOpen !== next.data.isRelationsPreviewOpen)
      return false
    if (prev.data.onPreviewRelations !== next.data.onPreviewRelations)
      return false
    if (prev.selected !== next.selected) return false
    if (prev.data.onColumnCreate !== next.data.onColumnCreate) return false
    if (prev.data.onColumnUpdate !== next.data.onColumnUpdate) return false
    if (prev.data.onColumnDelete !== next.data.onColumnDelete) return false
    if (prev.data.onColumnDuplicate !== next.data.onColumnDuplicate)
      return false
    if (prev.data.edges !== next.data.edges) return false
    if (prev.data.relationsEdges !== next.data.relationsEdges) return false
    if (prev.data.tableNameById !== next.data.tableNameById) return false
    if (prev.data.areas !== next.data.areas) return false
    if (prev.data.onAddToArea !== next.data.onAddToArea) return false
    if (prev.data.onRemoveFromArea !== next.data.onRemoveFromArea) return false
    if (prev.data.onRequestTableDelete !== next.data.onRequestTableDelete)
      return false
    if (prev.data.onFocusTable !== next.data.onFocusTable) return false
    if (prev.data.onExportDdl !== next.data.onExportDdl) return false
    if (prev.data.onColumnReorder !== next.data.onColumnReorder) return false
    if (prev.data.emitColumnReorder !== next.data.emitColumnReorder)
      return false
    if (prev.data.isQueueFullForTable !== next.data.isQueueFullForTable)
      return false
    if (prev.data.setLocalDragging !== next.data.setLocalDragging) return false
    if (prev.data.bumpReorderTick !== next.data.bumpReorderTick) return false
    if (prev.data.commentThreads !== next.data.commentThreads) return false
    if (prev.data.canComment !== next.data.canComment) return false
    if (prev.data.currentUserId !== next.data.currentUserId) return false
    if (prev.data.canModerateComments !== next.data.canModerateComments)
      return false
    if (prev.data.onCreateTableComment !== next.data.onCreateTableComment)
      return false
    if (prev.data.onReplyComment !== next.data.onReplyComment) return false
    if (prev.data.onEditComment !== next.data.onEditComment) return false
    if (prev.data.onDeleteComment !== next.data.onDeleteComment) return false
    if (prev.data.onResolveComment !== next.data.onResolveComment) return false
    if (prev.data.onTableNoteSave !== next.data.onTableNoteSave) return false
    return true
  },
)

TableNode.displayName = 'TableNode'
