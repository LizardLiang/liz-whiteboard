/**
 * TableRelationsPanel — canvas-space "drawer" attached to the side of a
 * table node, shown when the `r` keyboard shortcut or the "Show relations"
 * context-menu item is used on that table. Rendered as an
 * absolutely-positioned child of TableNode.tsx's own DOM element, so it
 * pans and zooms (including content scaling with zoom) exactly like the
 * rest of the table node — no manual position/anchor tracking required.
 *
 * Anchors to the right of the node by default, and flips to the left when
 * it would overflow the right edge of the viewport (measured post-render
 * via getBoundingClientRect, matching the pattern used for column-row rect
 * snapshots in TableNode.tsx).
 *
 * Lists every directly-related (1-hop) table with a field-to-field
 * connection line (e.g. `Orders.customer_id → Customers.id`) derived from
 * the relationship's sourceColumnId/targetColumnId, instead of separate
 * PK/FK badge lists.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Column, DiagramTable } from '@/data/models'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'

export interface TableRelationsPanelProps {
  table: DiagramTable & { columns: Array<Column> }
  relatedEdges: Array<RelationshipEdgeType>
  tableNameById: Map<string, string>
}

export function TableRelationsPanel({
  table,
  relatedEdges,
  tableNameById,
}: TableRelationsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<'left' | 'right'>('right')

  // Post-render measurement: getBoundingClientRect gives real screen pixels
  // (the panel is transformed by React Flow's pan/zoom), so "room on the
  // right" can only be known after the panel has actually rendered on the
  // right. useLayoutEffect (not useEffect) resolves this before paint so no
  // flicker is visible when the side flips.
  // Note: getBoundingClientRect() always returns an all-zero rect in jsdom
  // (no real layout engine), so this flip cannot be meaningfully exercised
  // by Vitest/RTL — it will always resolve `overflowsRight = false` there.
  // Manual/browser verification is required to confirm the flip.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const overflowsRight = rect.right > window.innerWidth - 8
    setSide(overflowsRight ? 'left' : 'right')
  }, [relatedEdges, table.id])

  const sideStyle: CSSProperties =
    side === 'right'
      ? { left: '100%', marginLeft: '10px' }
      : { right: '100%', marginRight: '10px' }

  return (
    <div
      ref={panelRef}
      data-testid="table-relations-panel"
      data-side={side}
      className="nodrag nowheel"
      style={{
        position: 'absolute',
        top: 0,
        ...sideStyle,
        width: 'max-content',
        maxWidth: '360px',
        maxHeight: '50vh',
        overflowY: 'auto',
        background: 'var(--rf-table-bg)',
        border: '1px solid var(--rf-table-border)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        padding: '10px 12px',
        fontSize: '12px',
        color: 'var(--rf-table-text)',
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
        Related tables
      </div>

      {relatedEdges.length === 0 ? (
        <div style={{ color: 'var(--rf-table-text)', opacity: 0.7 }}>
          No related tables
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {relatedEdges.map((edge) => {
            const rel = edge.data?.relationship
            if (!rel) return null

            const hoveredIsSource = rel.sourceTableId === table.id
            const hoveredColumn = hoveredIsSource
              ? rel.sourceColumn
              : rel.targetColumn
            const relatedColumn = hoveredIsSource
              ? rel.targetColumn
              : rel.sourceColumn
            const relatedTableId = hoveredIsSource
              ? rel.targetTableId
              : rel.sourceTableId

            if (!tableNameById.has(relatedTableId)) {
              return null
            }

            const relatedTableName = tableNameById.get(relatedTableId)
            const relationshipText =
              edge.data?.label || edge.data?.cardinality || ''

            return (
              <div
                key={edge.id}
                data-testid="relations-panel-row"
                style={{
                  borderTop: '1px solid var(--rf-table-border)',
                  paddingTop: '6px',
                }}
              >
                <div style={{ fontWeight: 600 }}>{relatedTableName}</div>
                <div
                  data-testid="relations-panel-connection"
                  style={{
                    marginTop: '4px',
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    fontSize: '11px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>
                    {table.name}.{hoveredColumn.name}
                  </span>
                  <span>{'→'}</span>
                  <span>
                    {relatedTableName}.{relatedColumn.name}
                  </span>
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
