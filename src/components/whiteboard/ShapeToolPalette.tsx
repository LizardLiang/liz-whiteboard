// src/components/whiteboard/ShapeToolPalette.tsx
// The inline, always-visible canvas control group (FR-001) — replaces the
// two loose Add Area / Add Comment buttons that used to live directly in
// ReactFlowWhiteboard.tsx (tech-spec §8). Never behind a menu, never in
// Toolbar.tsx (which owns table/relationship/export/import/auto-layout/
// search/history).

import { MessageCircle, SquareDashed } from 'lucide-react'
import type { ToolMode } from '@/lib/react-flow/tool-mode'
import { Button } from '@/components/ui/button'

interface ShapeToolPaletteProps {
  activeTool: ToolMode
  onSelectTool: (tool: ToolMode) => void
  /** Identical expression the Add Area button already used (FR-039). */
  canEdit: boolean
  canComment: boolean
  /** No palette at all on the public share-link path (§6a). */
  isPublic: boolean
}

export function ShapeToolPalette({
  activeTool,
  onSelectTool,
  canEdit,
  canComment,
  isPublic,
}: ShapeToolPaletteProps) {
  if (isPublic) return null
  if (!canEdit && !canComment) return null

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Drawing tools"
      className="absolute left-4 top-4 z-10 flex flex-col gap-1"
      data-testid="shape-tool-palette"
    >
      {canEdit && (
        <Button
          variant={activeTool === 'area' ? 'default' : 'outline'}
          size="sm"
          onClick={() =>
            onSelectTool(activeTool === 'area' ? 'select' : 'area')
          }
          title={
            activeTool === 'area'
              ? 'Drag on the canvas to draw the area'
              : 'Draw a subject area'
          }
          aria-pressed={activeTool === 'area'}
        >
          <SquareDashed className="mr-2 h-4 w-4" />
          {activeTool === 'area' ? 'Drag to draw...' : 'Add area'}
        </Button>
      )}
      {canComment && (
        <Button
          variant={activeTool === 'comment' ? 'default' : 'outline'}
          size="sm"
          onClick={() =>
            onSelectTool(activeTool === 'comment' ? 'select' : 'comment')
          }
          title={
            activeTool === 'comment'
              ? 'Click the canvas to place a comment'
              : 'Add a comment pin'
          }
          aria-pressed={activeTool === 'comment'}
        >
          <MessageCircle className="mr-2 h-4 w-4" />
          {activeTool === 'comment' ? 'Click canvas...' : 'Add comment'}
        </Button>
      )}
    </div>
  )
}
