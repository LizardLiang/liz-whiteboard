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
  onPointerDown?: (e: React.PointerEvent) => void
  show: boolean
}

export const DragHandle = memo(
  ({ columnName, isDragging, onPointerDown, show }: DragHandleProps) => {
    if (!show) return null

    return (
      <TooltipProvider>
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onPointerDown={onPointerDown}
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
