/**
 * TableNotesButton - Icon button for accessing table notes
 * Uses shadcn/ui Button with visual state indicators
 */

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TableNotesButtonProps {
  /** Table ID for the notes */
  tableId: string
  /** Whether the table has notes */
  hasNotes: boolean
  /** Whether the notes drawer is active/open */
  isActive: boolean
  /** Whether the button is in loading state */
  isLoading?: boolean
  /** Click handler to open notes drawer */
  onClick: () => void
  /** Additional CSS classes */
  className?: string
}

/**
 * TableNotesButton component with visual state indicators
 *
 * Visual states:
 * - Default: text-muted-foreground (no notes)
 * - Has notes: text-primary (notes exist)
 * - Active: text-primary bg-accent (drawer open)
 * - Loading: text-muted-foreground with disabled state
 */
export function TableNotesButton({
  tableId,
  hasNotes,
  isActive,
  isLoading = false,
  onClick,
  className,
}: TableNotesButtonProps) {
  // Determine visual state classes based on props
  const getVisualState = () => {
    if (isLoading) return 'text-muted-foreground'
    if (isActive) return 'text-primary bg-accent'
    if (hasNotes) return 'text-primary'
    return 'text-muted-foreground'
  }

  const visualStateClass = getVisualState()

  // Tooltip text based on state
  const getTooltipText = () => {
    if (isLoading) return 'Loading notes...'
    if (hasNotes) return 'Edit table notes'
    return 'Add table notes'
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            disabled={isLoading}
            aria-label={`${hasNotes ? 'Edit' : 'Add'} notes for table ${tableId}`}
            className={cn(
              'h-8 w-8 p-0 nodrag nowheel', // nodrag/nowheel to prevent interference with ReactFlow
              visualStateClass,
              'hover:bg-accent hover:text-accent-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              className,
            )}
          >
            <FileText className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{getTooltipText()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}