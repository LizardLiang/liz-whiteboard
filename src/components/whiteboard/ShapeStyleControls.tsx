// src/components/whiteboard/ShapeStyleControls.tsx
// Fill / stroke / stroke-width / dash controls (§8), rendered by ShapeNode
// as a <NodeToolbar> anchored to the selected shape. The first NodeToolbar
// in this repo: it portals out of the node subtree into the .react-flow
// wrapper (verified in @xyflow/react v12), so it neither inherits the
// node's `pointer-events: none` wrapper rule nor collides with the fixed
// ShapeToolPalette at left-4 top-4 — it follows the shape, not the viewport.

import { NodeToolbar, Position } from '@xyflow/react'
import type { ShapeStyle } from '@/data/schema'
import { AREA_COLORS } from '@/lib/area-colors'

export interface ShapeStyleControlsProps {
  style: ShapeStyle
  visible: boolean
  onChange: (patch: Partial<ShapeStyle>) => void
}

const STROKE_WIDTHS = [1, 2, 4] as const

function Swatch({
  active,
  color,
  title,
  onClick,
}: {
  active: boolean
  color: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className="h-5 w-5 shrink-0 rounded-full border-2"
      style={{
        backgroundColor: color,
        borderColor: active ? 'var(--rf-edge-stroke-selected)' : 'transparent',
      }}
    />
  )
}

export function ShapeStyleControls({
  style,
  visible,
  onChange,
}: ShapeStyleControlsProps) {
  return (
    <NodeToolbar
      isVisible={visible}
      position={Position.Top}
      offset={16}
      className="nodrag nopan"
    >
      <div
        role="toolbar"
        aria-label="Shape style"
        className="flex items-center gap-2 rounded-md border bg-popover p-1.5 shadow-md"
      >
        <div className="flex items-center gap-1" role="group" aria-label="Fill">
          <Swatch
            active={style.fill === 'none'}
            color="transparent"
            title="No fill"
            onClick={() => onChange({ fill: 'none' })}
          />
          {AREA_COLORS.map((c) => (
            <Swatch
              key={c.id}
              active={style.fill === c.id}
              color={c.solid}
              title={`Fill ${c.label}`}
              onClick={() => onChange({ fill: c.id })}
            />
          ))}
        </div>
        <div className="h-5 w-px bg-border" />
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Stroke color"
        >
          {AREA_COLORS.map((c) => (
            <Swatch
              key={c.id}
              active={style.stroke === c.id}
              color={c.solid}
              title={`Stroke ${c.label}`}
              onClick={() => onChange({ stroke: c.id })}
            />
          ))}
        </div>
        <div className="h-5 w-px bg-border" />
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Stroke width"
        >
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              title={`${w}px stroke`}
              aria-label={`Stroke width ${w}`}
              aria-pressed={style.strokeWidth === w}
              onClick={() => onChange({ strokeWidth: w })}
              className={`h-6 w-6 rounded text-xs ${
                style.strokeWidth === w ? 'bg-accent' : ''
              }`}
            >
              {w}
            </button>
          ))}
        </div>
        <div className="h-5 w-px bg-border" />
        <button
          type="button"
          title="Toggle dashed stroke"
          aria-label="Toggle dashed stroke"
          aria-pressed={style.strokeStyle === 'dashed'}
          onClick={() =>
            onChange({
              strokeStyle: style.strokeStyle === 'dashed' ? 'solid' : 'dashed',
            })
          }
          className={`h-6 w-6 rounded text-xs ${
            style.strokeStyle === 'dashed' ? 'bg-accent' : ''
          }`}
        >
          - -
        </button>
      </div>
    </NodeToolbar>
  )
}
