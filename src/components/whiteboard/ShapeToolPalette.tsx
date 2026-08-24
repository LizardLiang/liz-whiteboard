// src/components/whiteboard/ShapeToolPalette.tsx
// The inline, always-visible canvas control group (FR-001) — replaces the
// two loose Add Area / Add Comment buttons that used to live directly in
// ReactFlowWhiteboard.tsx (tech-spec §8). Never behind a menu, never in
// Toolbar.tsx (which owns table/relationship/export/import/auto-layout/
// search/history).

import {
  ArrowRight,
  Circle,
  Diamond,
  MessageCircle,
  Square,
  SquareDashed,
  Type,
} from 'lucide-react'
import type { ToolMode } from '@/lib/react-flow/tool-mode'
import { Button } from '@/components/ui/button'

interface ShapeToolDescriptor {
  tool: 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'text'
  label: string
  Icon: typeof Square
}

const SHAPE_TOOLS: Array<ShapeToolDescriptor> = [
  { tool: 'rectangle', label: 'Rectangle', Icon: Square },
  { tool: 'ellipse', label: 'Ellipse', Icon: Circle },
  { tool: 'diamond', label: 'Diamond', Icon: Diamond },
  { tool: 'arrow', label: 'Arrow', Icon: ArrowRight },
  { tool: 'text', label: 'Text', Icon: Type },
]

export interface ShapeToolPaletteProps {
  activeTool: ToolMode
  onSelectTool: (tool: ToolMode) => void
  /** Identical expression the Add Area button already used (FR-039). */
  canEdit: boolean
  canComment: boolean
  /** No palette at all on the public share-link path (§6a). */
  isPublic: boolean
  onCreateArea: () => void
  /**
   * Keyboard creation (FR-019): Enter/Space on an ALREADY-armed tool button
   * creates a default-sized shape instead of re-toggling it off.
   * Discriminated by `event.detail === 0` (keyboard-synthesised click), so
   * a mouse double-click on the tool never creates a shape.
   */
  onKeyboardCreate?: (
    tool: 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'text',
  ) => void
}

export function ShapeToolPalette({
  activeTool,
  onSelectTool,
  canEdit,
  canComment,
  isPublic,
  onCreateArea,
  onKeyboardCreate,
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
          variant="outline"
          size="sm"
          onClick={onCreateArea}
          title="Add subject area"
        >
          <SquareDashed className="mr-2 h-4 w-4" />
          Add area
        </Button>
      )}
      {canEdit &&
        SHAPE_TOOLS.map(({ tool, label, Icon }) => (
          <Button
            key={tool}
            variant={activeTool === tool ? 'default' : 'outline'}
            size="icon"
            title={label}
            aria-label={label}
            aria-pressed={activeTool === tool}
            data-testid={`shape-tool-${tool}`}
            onClick={(event) => {
              if (activeTool === tool && event.detail === 0) {
                onKeyboardCreate?.(tool)
                return
              }
              onSelectTool(activeTool === tool ? 'select' : tool)
            }}
          >
            <Icon className="h-4 w-4" />
          </Button>
        ))}
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
