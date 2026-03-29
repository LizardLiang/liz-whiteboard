import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { TableNodeData } from '@/lib/react-flow/types'
import { createColumnHandleId } from '@/lib/react-flow/edge-routing'

/**
 * Custom React Flow node component for rendering ER diagram tables
 * Displays table name, columns with data types, and connection handles for relationships
 */
export const TableNode = memo(
  ({ data, selected }: NodeProps<TableNodeData>) => {
    const { table, showMode, isActiveHighlighted, isHighlighted, isHovered } =
      data
    const columns = table.columns

    // Determine visual state classes
    const highlightClass = isActiveHighlighted
      ? 'active-highlighted'
      : isHighlighted
        ? 'highlighted'
        : isHovered
          ? 'hovered'
          : ''

    return (
      <div
        className={`react-flow__node-erTable ${selected ? 'selected' : ''} ${highlightClass}`}
        style={{
          width: table.width ? `${table.width}px` : '250px',
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
            {columns
              .filter((column) => {
                // Filter columns based on display mode
                if (showMode === 'KEY_ONLY') {
                  return column.isPrimaryKey || column.isForeignKey
                }
                return true // ALL_FIELDS shows all columns
              })
              .map((column, index) => (
                <div
                  key={column.id}
                  className="column-row"
                  style={{
                    padding: '6px 16px',
                    borderBottom:
                      index < columns.length - 1
                        ? '1px solid var(--rf-table-border)'
                        : 'none',
                    fontSize: '13px',
                    color: 'var(--rf-table-text)',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    minHeight: '28px',
                  }}
                >
                  {/* Left-side handles (source + target share same id) */}
                  <Handle
                    type="source"
                    position={Position.Left}
                    id={createColumnHandleId(table.id, column.id, 'left')}
                    style={{ left: '-5px', opacity: 0, pointerEvents: 'none' }}
                  />
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={createColumnHandleId(table.id, column.id, 'left')}
                    style={{ left: '-5px' }}
                  />

                  {/* Column Name and Type */}
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {/* Primary Key Indicator */}
                    {column.isPrimaryKey && (
                      <span
                        style={{
                          color: 'var(--rf-primary-key-color)',
                          fontWeight: 600,
                          fontSize: '12px',
                        }}
                        title="Primary Key"
                      >
                        PK
                      </span>
                    )}

                    {/* Foreign Key Indicator */}
                    {column.isForeignKey && (
                      <span
                        style={{
                          color: 'var(--rf-foreign-key-color)',
                          fontWeight: 600,
                          fontSize: '12px',
                        }}
                        title="Foreign Key"
                      >
                        FK
                      </span>
                    )}

                    {/* Column Name */}
                    <span
                      style={{ fontWeight: column.isPrimaryKey ? 600 : 400 }}
                    >
                      {column.name}
                    </span>

                    {/* Data Type */}
                    <span
                      style={{
                        color: 'var(--rf-table-text)',
                        opacity: 0.7,
                        fontSize: '12px',
                      }}
                    >
                      {column.dataType}
                    </span>
                  </div>

                  {/* Right-side handles (source + target share same id) */}
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={createColumnHandleId(table.id, column.id, 'right')}
                    style={{ right: '-5px' }}
                  />
                  <Handle
                    type="target"
                    position={Position.Right}
                    id={createColumnHandleId(table.id, column.id, 'right')}
                    style={{ right: '-5px', opacity: 0, pointerEvents: 'none' }}
                  />
                </div>
              ))}
          </div>
        )}
      </div>
    )
  },
)

TableNode.displayName = 'TableNode'
