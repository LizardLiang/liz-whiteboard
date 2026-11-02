// src/components/canvas/BoardStyleControl.tsx
// The 看板樣式 popover: board-wide diagram style and flow-dot mode.
//
// Plain buttons in groups rather than a ToggleGroup primitive (the project has
// none installed). Viewers see the current values but cannot change them.

import { Palette } from 'lucide-react'
import type {
  CanvasBoardSettings,
  CanvasBoardSettingsPatch,
} from '@/data/canvas-board-settings'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface BoardStyleControlProps {
  settings: CanvasBoardSettings
  readOnly: boolean
  onChange: (patch: CanvasBoardSettingsPatch) => void
}

const STYLE_OPTIONS = [
  { value: 'card', label: '卡片' },
  { value: 'classic', label: '經典' },
] as const

const DOT_OPTIONS = [
  { value: 'path', label: '只在滑過或選取時' },
  { value: 'always', label: '一直跑' },
] as const

function Group<T extends string>({
  label,
  options,
  active,
  disabled,
  onPick,
}: {
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  active: T
  disabled: boolean
  onPick: (value: T) => void
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={option.value === active ? 'default' : 'outline'}
            disabled={disabled}
            aria-pressed={option.value === active}
            aria-label={`${label} ${option.label}`}
            onClick={() => onPick(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function BoardStyleControl({
  settings,
  readOnly,
  onChange,
}: BoardStyleControlProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="看板樣式"
          title="看板樣式"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto"
        // A portalled keydown still bubbles through the React tree to the
        // board container and would trigger its tool shortcuts.
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Group
          label="樣式"
          options={STYLE_OPTIONS}
          active={settings.diagramStyle}
          disabled={readOnly}
          onPick={(diagramStyle) => onChange({ diagramStyle })}
        />
        <Group
          label="流動點"
          options={DOT_OPTIONS}
          active={settings.flowDots}
          disabled={readOnly}
          onPick={(flowDots) => onChange({ flowDots })}
        />
      </PopoverContent>
    </Popover>
  )
}
