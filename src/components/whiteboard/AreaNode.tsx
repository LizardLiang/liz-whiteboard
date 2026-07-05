// src/components/whiteboard/AreaNode.tsx
// Subject-area node (GH #106) — a colored, labeled background region rendered
// BEHIND table nodes. Areas do NOT own table positions; they are a purely
// visual grouping. Kept in a separate node array from tables so they never
// touch the table highlighting / edge-routing / DDL pipeline.

import { useEffect, useRef, useState } from 'react'
import { NodeResizer } from '@xyflow/react'
import { X } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'
import type { AreaNodeType } from '@/lib/react-flow/types'
import { AREA_COLORS, resolveAreaColor } from '@/lib/area-colors'

const MIN_AREA_WIDTH = 160
const MIN_AREA_HEIGHT = 120

/**
 * React Flow custom node for a subject area. Sizing comes from the node's
 * width/height (set by the parent from Area.width/height); NodeResizer edits
 * that size and reports the committed bounds through `data.onResize`.
 */
export function AreaNode({ id, data, width, height, selected }: NodeProps<AreaNodeType>) {
  const { area, canEdit, onRename, onRecolor, onResize, onDelete } = data
  const color = resolveAreaColor(area.color)

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(area.name)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the draft in sync when the area is renamed elsewhere (remote edit).
  useEffect(() => {
    if (!editingName) setNameDraft(area.name)
  }, [area.name, editingName])

  useEffect(() => {
    if (editingName) inputRef.current?.select()
  }, [editingName])

  const commitName = () => {
    setEditingName(false)
    const next = nameDraft.trim()
    if (next && next !== area.name) onRename?.(id, next)
    else setNameDraft(area.name)
  }

  return (
    <>
      {canEdit && (
        <NodeResizer
          color={color.solid}
          isVisible={selected}
          minWidth={MIN_AREA_WIDTH}
          minHeight={MIN_AREA_HEIGHT}
          onResizeEnd={(_event, params) => {
            onResize?.(id, {
              positionX: params.x,
              positionY: params.y,
              width: params.width,
              height: params.height,
            })
          }}
        />
      )}

      <div
        className="rounded-lg"
        style={{
          width: width ?? area.width,
          height: height ?? area.height,
          backgroundColor: color.fill,
          border: `1.5px dashed ${color.border}`,
          boxSizing: 'border-box',
        }}
      >
        {/* Header: label + (edit affordances) */}
        <div
          className="flex items-center gap-1.5 px-2 py-1"
          style={{ color: color.solid }}
        >
          {editingName && canEdit ? (
            <input
              ref={inputRef}
              className="nodrag rounded bg-white/80 px-1 text-sm font-semibold outline-none dark:bg-black/40"
              style={{ color: color.solid }}
              value={nameDraft}
              maxLength={255}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName()
                if (e.key === 'Escape') {
                  setNameDraft(area.name)
                  setEditingName(false)
                }
              }}
            />
          ) : (
            <span
              className="select-none text-sm font-semibold"
              title={canEdit ? 'Double-click to rename' : undefined}
              onDoubleClick={() => {
                if (canEdit) setEditingName(true)
              }}
            >
              {area.name}
            </span>
          )}

          {canEdit && (
            <div className="nodrag ml-auto flex items-center gap-1">
              {/* Color swatches — only shown when selected to reduce clutter */}
              {selected &&
                AREA_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.label}
                    aria-label={`Set color ${c.label}`}
                    onClick={() => onRecolor?.(id, c.id)}
                    className="h-3 w-3 rounded-full border"
                    style={{
                      backgroundColor: c.solid,
                      borderColor:
                        c.id === area.color ? color.solid : 'transparent',
                      outline: c.id === area.color ? `1px solid ${c.solid}` : 'none',
                    }}
                  />
                ))}
              {selected && (
                <button
                  type="button"
                  title="Delete area"
                  aria-label="Delete area"
                  onClick={() => onDelete?.(id)}
                  className="ml-1 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
