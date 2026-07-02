/**
 * TableHoverPreview — lightweight, read-only preview card shown near the
 * cursor after hovering a table node for ~450ms. Lists every directly-related
 * (1-hop) table: its name, primary-key column(s), the specific foreign-key
 * column that links it to the hovered table, and the connecting
 * relationship's label (or cardinality if no label is set).
 *
 * Deliberately lighter-weight than TableFocusOverlay (which mounts a full
 * read-only sub-canvas) — this is a plain presentational component with no
 * @xyflow/react dependency and no interactivity of its own.
 */

import type { RelationshipEdgeType, TableNodeType } from '@/lib/react-flow/types'

export interface TableHoverPreviewProps {
  table: TableNodeType
  relatedEdges: Array<RelationshipEdgeType>
  allNodesById: Map<string, TableNodeType>
  anchorPosition: { x: number; y: number }
}

const CARD_WIDTH = 280
const CARD_OFFSET = 12
const VIEWPORT_MARGIN = 8

export function TableHoverPreview({
  table,
  relatedEdges,
  allNodesById,
  anchorPosition,
}: TableHoverPreviewProps) {
  const left = Math.min(
    anchorPosition.x + CARD_OFFSET,
    window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN,
  )
  const top = Math.min(
    anchorPosition.y + CARD_OFFSET,
    window.innerHeight - VIEWPORT_MARGIN,
  )

  return (
    <div
      role="tooltip"
      data-testid="table-hover-preview"
      style={{
        position: 'fixed',
        left,
        top,
        width: CARD_WIDTH,
        maxHeight: '60vh',
        overflowY: 'auto',
        background: 'var(--rf-table-bg)',
        border: '1px solid var(--rf-table-border)',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        padding: '10px 12px',
        fontSize: '12px',
        color: 'var(--rf-table-text)',
        zIndex: 2000,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: '13px',
          color: 'var(--rf-table-header-text)',
          marginBottom: '6px',
        }}
      >
        {table.data.table.name}
      </div>

      {relatedEdges.length === 0 ? (
        <div style={{ color: 'var(--rf-table-text)', opacity: 0.7 }}>
          No related tables
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {relatedEdges.map((edge) => {
            const relatedTableId =
              edge.source === table.id ? edge.target : edge.source
            const relatedNode = allNodesById.get(relatedTableId)
            if (!relatedNode) return null

            const relationship = edge.data?.relationship
            const fkColumn =
              relationship?.sourceTableId === relatedTableId
                ? relationship.sourceColumn
                : relationship?.targetColumn

            const pkColumns = relatedNode.data.table.columns.filter(
              (col) => col.isPrimaryKey,
            )

            const relationshipText =
              edge.data?.label || edge.data?.cardinality || ''

            return (
              <div
                key={edge.id}
                data-testid="hover-preview-row"
                style={{
                  borderTop: '1px solid var(--rf-table-border)',
                  paddingTop: '6px',
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {relatedNode.data.table.name}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                    marginTop: '4px',
                    alignItems: 'center',
                  }}
                >
                  {pkColumns.map((col) => (
                    <span
                      key={col.id}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                    >
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '0 3px',
                          borderRadius: '2px',
                          lineHeight: '14px',
                          background: 'var(--rf-primary-key-color, #f59e0b)',
                          color: '#fff',
                        }}
                      >
                        PK
                      </span>
                      <span>{col.name}</span>
                    </span>
                  ))}
                  {fkColumn && (
                    <span
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                    >
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '0 3px',
                          borderRadius: '2px',
                          lineHeight: '14px',
                          background: 'var(--rf-foreign-key-color, #6366f1)',
                          color: '#fff',
                        }}
                      >
                        FK
                      </span>
                      <span>{fkColumn.name}</span>
                    </span>
                  )}
                </div>
                {relationshipText && (
                  <div
                    style={{
                      marginTop: '4px',
                      opacity: 0.75,
                      fontSize: '11px',
                    }}
                  >
                    {relationshipText}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
