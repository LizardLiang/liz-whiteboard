/**
 * CanvasSearch — Cmd/Ctrl+K command palette to jump to a canvas element.
 *
 * The bespoke-canvas sibling of `src/components/whiteboard/WhiteboardSearch.tsx`:
 * same shadcn `CommandDialog` (cmdk) shell, same "cmdk owns the filtering"
 * approach, same `useMemo` over the index. Results are grouped into Shapes /
 * Text / Connectors instead of Tables / Columns — the vocabulary this engine
 * actually has (see `scene.ts`'s `CanvasElementKind`) — and selecting one
 * asks the board to pan/select/highlight the target (`onSelectElement`).
 *
 * Filtering is handled by cmdk's built-in case-insensitive matcher against
 * each item's value/keywords. The flat index is derived from the current
 * scene via `buildCanvasSearchIndex`.
 */

import { useMemo } from 'react'
import { Spline, Type } from 'lucide-react'
import { SHAPE_TOOL_META } from './shape-tool-meta'
import type { CanvasSearchEntry } from '@/lib/canvas-engine/search-index'
import type { CanvasShapeKind, Scene } from '@/lib/canvas-engine/scene'
import { buildCanvasSearchIndex } from '@/lib/canvas-engine/search-index'
import { isCanvasShapeKind } from '@/lib/canvas-engine/scene'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

export interface CanvasSearchProps {
  /** Whether the palette is open. */
  open: boolean
  /** Open/close handler. */
  onOpenChange: (open: boolean) => void
  /** The scene currently on screen — the search index is derived from this. */
  scene: Scene
  /** Called with the target element id when a result is selected. */
  onSelectElement: (elementId: string) => void
}

/**
 * A `CommandItem`'s `value` needs to be UNIQUE — cmdk keys its own selection
 * state off it — but two elements can legitimately carry identical text.
 * Suffixing the id makes the value unique while `keywords` (below) keeps
 * filtering matching on the text alone.
 */
function itemValue(entry: CanvasSearchEntry): string {
  return `${entry.text} ${entry.elementId}`
}

export function CanvasSearch({
  open,
  onOpenChange,
  scene,
  onSelectElement,
}: CanvasSearchProps) {
  const index = useMemo(() => buildCanvasSearchIndex(scene), [scene])

  // The type-guard predicate (rather than a plain `=>` filter) is what lets
  // TypeScript narrow `entry.kind` to `CanvasShapeKind` for every entry in
  // `shapes` below — `SHAPE_TOOL_META[entry.kind]` then indexes cleanly with
  // no cast.
  const shapes = index.filter(
    (entry): entry is CanvasSearchEntry & { kind: CanvasShapeKind } =>
      isCanvasShapeKind(entry.kind),
  )
  const texts = index.filter((entry) => entry.kind === 'text')
  const connectors = index.filter((entry) => entry.kind === 'connector')

  const handleSelect = (elementId: string) => {
    onSelectElement(elementId)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search canvas elements"
      description="Type an element's text to jump to it on the board."
    >
      <CommandInput placeholder="Search canvas elements…" />
      <CommandList>
        <CommandEmpty>No matching elements.</CommandEmpty>

        {shapes.length > 0 && (
          <CommandGroup heading="Shapes">
            {shapes.map((entry) => {
              const Icon = SHAPE_TOOL_META[entry.kind].Icon
              return (
                <CommandItem
                  key={entry.elementId}
                  value={itemValue(entry)}
                  keywords={[entry.text]}
                  onSelect={() => handleSelect(entry.elementId)}
                >
                  <Icon />
                  <span>{entry.text}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        {texts.length > 0 && (
          <CommandGroup heading="Text">
            {texts.map((entry) => (
              <CommandItem
                key={entry.elementId}
                value={itemValue(entry)}
                keywords={[entry.text]}
                onSelect={() => handleSelect(entry.elementId)}
              >
                <Type />
                <span>{entry.text}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {connectors.length > 0 && (
          <CommandGroup heading="Connectors">
            {connectors.map((entry) => (
              <CommandItem
                key={entry.elementId}
                value={itemValue(entry)}
                keywords={[entry.text]}
                onSelect={() => handleSelect(entry.elementId)}
              >
                <Spline />
                <span>{entry.text}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
