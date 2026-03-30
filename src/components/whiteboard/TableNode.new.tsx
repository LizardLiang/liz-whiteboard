/**
 * TableNode — interactive React Flow node for ER diagram tables
 * Supports inline column editing, creation, deletion, and real-time sync
 */

import { memo, useCallback, useMemo, useState } from 'react'
import type { Column } from '@prisma/client'
import type { TableNodeData, RelationshipEdgeType, TableNodeType } from '@/lib/react-flow/types'
import type { EditingField, ColumnRelationship } from './column/types'
import type { DataType } from '@/data/schema'
import { ColumnRow } from './column/ColumnRow'
import { AddColumnRow } from './column/AddColumnRow'
import { DeleteColumnDialog } from './column/DeleteColumnDialog'
import { useNodes } from '@xyflow/react'

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
      edges = [],
    } = data

    const columns = table.columns

    // Build a lookup map from tableId → tableName using the live node list
    const allNodes = useNodes<TableNodeType['data']>()
    const tableNameById = useMemo(() => {
      const map = new Map<string, string>()
      allNodes.forEach((node) => {
        if (node.data?.table?.id && node.data?.table?.name) {
          map.set(node.data.table.id, node.data.table.name)
        }
      })
      return map
    }, [allNodes])

    // --- Local editing state ---
    const [editingField, setEditingField] = useState<EditingField | null>(null)

    // Which column has a pending delete confirmation dialog
    const [deletingColumn, setDeletingColumn] = useState<Column | null>(null)

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
      ;(edges as Array<RelationshipEdgeType>).forEach((edge: RelationshipEdgeType) => {
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
        onColumnUpdate(columnId, table.id, { [field]: value as unknown as Partial<DataType> })
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
          sourceTableName: tableNameById.get(rel.sourceTableId) ?? rel.sourceTableId,
          sourceColumnName: rel.sourceColumn.name,
          targetTableName: tableNameById.get(rel.targetTableId) ?? rel.targetTableId,
          targetColumnName: rel.targetColumn.name,
          cardinality: edge.data!.cardinality,
        }
      })
    }, [deletingColumn, columnEdgeMap, tableNameById])

    // --- Create handler ---
    const handleCreate = useCallback(
      async (data: { name: string; dataType: DataType; order: number }) => {
        if (onColumnCreate) {
          onColumnCreate(table.id, data)
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

    return (
      <div
        className={`react-flow__node-erTable ${selected ? 'selected' : ''} ${highlightClass}`}
        style={{
          width: table.width ? `${table.width}px` : '280px',
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
          }}
        >
          {table.name}
        </div>

        {/* Columns List */}
        {showMode !== 'TABLE_NAME' && (
          <div className="table-columns">
            {(visibleColumns as Array<Column>).map((column: Column, index: number) => (
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
    )
  },
  (prev: TableNodeProps, next: TableNodeProps) => {
    // Custom memo comparator: allow re-renders when columns change, skip position-only changes
    if (prev.data.table !== next.data.table) return false
    if (prev.data.showMode !== next.data.showMode) return false
    if (prev.data.isActiveHighlighted !== next.data.isActiveHighlighted) return false
    if (prev.data.isHighlighted !== next.data.isHighlighted) return false
    if (prev.data.isHovered !== next.data.isHovered) return false
    if (prev.selected !== next.selected) return false
    if (prev.data.onColumnCreate !== next.data.onColumnCreate) return false
    if (prev.data.onColumnUpdate !== next.data.onColumnUpdate) return false
    if (prev.data.onColumnDelete !== next.data.onColumnDelete) return false
    if (prev.data.edges !== next.data.edges) return false
    return true
  },
)

TableNode.displayName = 'TableNode'
