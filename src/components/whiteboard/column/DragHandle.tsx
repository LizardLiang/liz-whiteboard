import { memo } from 'react'
import { GripVertical } from 'lucide-react'
import { useWhiteboardPermissions } from '../whiteboard-permissions-context'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useT } from '@/lib/i18n/use-t'

export interface DragHandleProps {
  columnName: string
  isDragging: boolean
  onPointerDown?: (e: React.PointerEvent) => void
  show: boolean
}

export const DragHandle = memo(
  ({ columnName, isDragging, onPointerDown, show }: DragHandleProps) => {
    const t = useT()
    const { canEdit } = useWhiteboardPermissions()
    // Reordering is a write action — no drag handle for view-only viewers.
    if (!show || !canEdit) return null

    return (
      <TooltipProvider>
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onPointerDown={onPointerDown}
              aria-label={t('whiteboard.column.reorder', { name: columnName })}
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
                e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                if (!isDragging) {
                  e.currentTarget.style.opacity = '0.4'
                }
              }}
            >
              <GripVertical size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {t('whiteboard.column.dragToReorder')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  },
)

DragHandle.displayName = 'DragHandle'
