// src/components/whiteboard/ShapeStyleControls.tsx
// Fill / stroke / stroke-width / dash controls (§8), rendered by ShapeNode
// as a <NodeToolbar> anchored to the selected shape. The first NodeToolbar
// in this repo: it portals out of the node subtree into the .react-flow
// wrapper (verified in @xyflow/react v12), so it neither inherits the
// node's `pointer-events: none` wrapper rule nor collides with the fixed
// bottom dock — it follows the shape, not the viewport.

import { NodeToolbar, Position } from '@xyflow/react'
import type { ShapeStyle } from '@/data/schema'
import { SHAPE_STROKE_WIDTHS } from '@/data/schema'
import { AREA_COLORS } from '@/lib/area-colors'
import { useT } from '@/lib/i18n/use-t'

interface ShapeStyleControlsProps {
  style: ShapeStyle
  visible: boolean
  onChange: (patch: Partial<ShapeStyle>) => void
}

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
  const t = useT()
  return (
    <NodeToolbar
      isVisible={visible}
      position={Position.Top}
      offset={16}
      className="nodrag nopan"
    >
      <div
        role="toolbar"
        aria-label={t('whiteboard.shapeStyle.ariaLabel')}
        className="flex items-center gap-2 rounded-md border bg-popover p-1.5 shadow-md"
      >
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t('whiteboard.shapeStyle.fill')}
        >
          <Swatch
            active={style.fill === 'none'}
            color="transparent"
            title={t('whiteboard.shapeStyle.noFill')}
            onClick={() => onChange({ fill: 'none' })}
          />
          {AREA_COLORS.map((c) => (
            <Swatch
              key={c.id}
              active={style.fill === c.id}
              color={c.solid}
              title={t('whiteboard.shapeStyle.fillColor', {
                color: t(`whiteboard.colors.${c.id}`),
              })}
              onClick={() => onChange({ fill: c.id })}
            />
          ))}
        </div>
        <div className="h-5 w-px bg-border" />
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t('whiteboard.shapeStyle.strokeColorGroup')}
        >
          {AREA_COLORS.map((c) => (
            <Swatch
              key={c.id}
              active={style.stroke === c.id}
              color={c.solid}
              title={t('whiteboard.shapeStyle.strokeColor', {
                color: t(`whiteboard.colors.${c.id}`),
              })}
              onClick={() => onChange({ stroke: c.id })}
            />
          ))}
        </div>
        <div className="h-5 w-px bg-border" />
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t('whiteboard.shapeStyle.strokeWidthGroup')}
        >
          {SHAPE_STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              title={t('whiteboard.shapeStyle.pxStroke', { width: w })}
              aria-label={t('whiteboard.shapeStyle.strokeWidth', { width: w })}
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
          title={t('whiteboard.shapeStyle.toggleDashed')}
          aria-label={t('whiteboard.shapeStyle.toggleDashed')}
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
