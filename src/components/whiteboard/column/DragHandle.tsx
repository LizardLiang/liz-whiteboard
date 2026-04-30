/**
 * DragHandle — drag handle button for column reordering
 *
 * Renders a GripVertical icon with:
 * - nodrag nowheel classes (Spike S1: React Flow pointer suppression)
 * - aria-label for accessibility (AC-01d)
 * - shadcn Tooltip with 400ms delay (AC-12a)
 * - useSortable activatorNodeRef integration
 */

import { memo } from 'react'
import { GripVertical } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface DragHandleProps {
  columnName: string
  isDragging: boolean
  /** Ref passed from useSortable to set the activator node */
  setActivatorNodeRef: (element: HTMLElement | null) => void
  /** Listeners from useSortable (onPointerDown etc.) */
  listeners: Record<string, (...args: Array<unknown>) => unknown> | undefined
  /** Whether to show the drag handle (only in ALL_FIELDS mode) */
  show: boolean
}

export const DragHandle = memo(
  ({
    columnName,
    isDragging,
    setActivatorNodeRef,
    listeners,
    show,
  }: DragHandleProps) => {
    if (!show) return null

    return (
      <TooltipProvider>
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...listeners}
              aria-label={`Reorder column ${columnName}`}
              className="nodrag nowheel column-drag-handle"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                padding: '2px',
                cursor: isDragging ? 'grabbing' : 'grab',
                color: 'var(--rf-table-text)',
                opacity: 0.4,
                flexShrink: 0,
                lineHeight: 1,
                touchAction: 'none',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                if (!isDragging) {
                  ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.4'
                }
              }}
            >
              <GripVertical size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Drag to reorder</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  },
)

DragHandle.displayName = 'DragHandle'
