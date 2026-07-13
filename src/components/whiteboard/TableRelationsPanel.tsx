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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '@xyflow/react'
import type { Column, DiagramTable } from '@/data/models'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'

export interface TableRelationsPanelProps {
  table: DiagramTable & { columns: Array<Column> }
  relatedEdges: Array<RelationshipEdgeType>
  tableNameById: Map<string, string>
  /**
   * GH #138 — jump the live canvas to a related table (pan + normalized
   * zoom + active-highlight + brief pulse) and re-anchor this panel to it.
   * When omitted, rows render as plain, non-interactive divs (defensive —
   * keeps the panel usable in contexts that don't wire up the jump
   * pipeline, e.g. isolated tests/stories).
   */
  onJumpToTable?: (tableId: string) => void
}

export function TableRelationsPanel({
  table,
  relatedEdges,
  tableNameById,
  onJumpToTable,
}: TableRelationsPanelProps) {
  // A 0-size marker rendered inside the table node's DOM; we measure its
  // parent `.react-flow__node` to anchor the (portaled) panel in screen space.
  const anchorRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<'left' | 'right'>('right')
  // Start off-screen so the portal always renders (so panelRef can be
  // measured) but nothing flashes before useLayoutEffect positions it.
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: -9999,
    left: -9999,
  })

  // Under canvas mode the table node lives in React Flow's transformed
  // viewport, which is a stacking layer the `.react-flow__pane` sits ABOVE for
  // hit-testing — an in-node absolutely-positioned drawer that overflows the
  // node box is therefore visually present but NOT clickable (the pane wins
  // `elementFromPoint`, so "jump to related table" rows can't be clicked; z-index
  // can't escape the viewport's stacking context). So we PORTAL the panel to
  // <body> and position it `fixed` at the node's live screen rect, re-tracked on
  // every pan/zoom via the store transform. Subscribing to `transform` re-runs
  // this layout effect each viewport change.
  const transform = useStore((s) => s.transform)

  const reposition = useCallback(() => {
    const nodeEl = anchorRef.current?.closest(
      '.react-flow__node',
    ) as HTMLElement | null
    if (!nodeEl) return
    const nrect = nodeEl.getBoundingClientRect()
    const panelW = panelRef.current?.offsetWidth || 280
    const gap = 10
    const rightLeft = nrect.right + gap
    const overflowsRight = rightLeft + panelW > window.innerWidth - 8
    const nextSide = overflowsRight ? 'left' : 'right'
    setSide(nextSide)
    setPos({
      top: nrect.top,
      left: nextSide === 'right' ? rightLeft : nrect.left - panelW - gap,
    })
  }, [])

  // Reposition on pan/zoom (store transform) + when the panel's content (hence
  // its measured width, hence the side-flip) changes. useLayoutEffect resolves
  // before paint so the panel never flashes at a stale spot.
  useLayoutEffect(() => {
    reposition()
  }, [reposition, transform, relatedEdges, table.id])

  // Also reposition on window resize AND pane-container resize (e.g. a side
  // panel opening/closing) — neither necessarily changes the RF transform, so
  // without this the `position: fixed` panel drifts off its table. Mirrors
  // CanvasNodeLayer's ResizeObserver on the pane.
  useEffect(() => {
    window.addEventListener('resize', reposition)
    const rfEl = anchorRef.current?.closest('.react-flow') as HTMLElement | null
    let ro: ResizeObserver | undefined
    if (rfEl && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => reposition())
      ro.observe(rfEl)
    }
    return () => {
      window.removeEventListener('resize', reposition)
      ro?.disconnect()
    }
  }, [reposition])

  return (
    <>
      <span
        ref={anchorRef}
        style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0 }}
      />
      {createPortal(
        <div
          ref={panelRef}
          data-testid="table-relations-panel"
          data-side={side}
          className="nodrag nowheel"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            // As a <body> portal (position: fixed), this already stacks above
            // the whole react-flow app root — including the CanvasNodeLayer
            // (z-[1000], scoped inside RF's stacking context) — so its jump
            // rows are clickable. Kept BELOW shadcn overlays (Dialog/Popover/
            // ContextMenu = z-50) so a modal opened over the panel still wins
            // pointer events. See Hermes review 2026-07-13.
            zIndex: 40,
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

            const jumpProps = onJumpToTable
              ? {
                  role: 'button' as const,
                  tabIndex: 0,
                  'aria-label': `Jump to ${relatedTableName}`,
                  onClick: () => onJumpToTable(relatedTableId),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onJumpToTable(relatedTableId)
                    }
                  },
                }
              : {}

            return (
              <div
                key={edge.id}
                data-testid="relations-panel-row"
                className={
                  onJumpToTable ? 'relations-panel-row-btn' : undefined
                }
                style={{
                  borderTop: '1px solid var(--rf-table-border)',
                  paddingTop: '6px',
                  cursor: onJumpToTable ? 'pointer' : undefined,
                }}
                {...jumpProps}
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
        </div>,
        document.body,
      )}
    </>
  )
}
