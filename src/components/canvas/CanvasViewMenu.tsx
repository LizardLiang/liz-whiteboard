// src/components/canvas/CanvasViewMenu.tsx
// The canvas board's "…" view-options menu. It holds the same "Show FPS"
// switch as the ER whiteboard toolbar and drives the same shared store, so the
// choice carries across both board types.
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import {
  setPerfEnabled,
  usePerfEnabledValue,
} from '@/hooks/perf-tracker-enabled-store'
import { useT } from '@/lib/i18n/use-t'

export function CanvasViewMenu() {
  const t = useT()
  const perfEnabled = usePerfEnabledValue()
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          data-testid="canvas-view-menu-trigger"
          aria-label={t('canvas.board.viewMenuAria')}
          title={t('canvas.board.viewMenuAria')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuCheckboxItem
          checked={perfEnabled}
          onCheckedChange={setPerfEnabled}
          onSelect={(e) => e.preventDefault()}
          data-testid="fps-display-switch"
          className="justify-between pl-2 [&>span:first-child]:hidden"
        >
          {t('whiteboard.toolbar.showFps')}
          <Switch
            checked={perfEnabled}
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none"
          />
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
