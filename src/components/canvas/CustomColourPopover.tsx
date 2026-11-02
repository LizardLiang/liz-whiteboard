// src/components/canvas/CustomColourPopover.tsx
// The "custom" button at the end of a Fill, Stroke or Text colour row: a small
// popover with a colour field, a hex input and a transparency slider.
//
// Applying writes `#rrggbb` at full opacity, else `rgba(r, g, b, a)`, through
// the same `onApply` the preset swatches use, so it is one undo step.

import { useState } from 'react'
import { Pipette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { parseColourWithAlpha } from '@/lib/canvas-engine/colour-ramps'

const FALLBACK_HEX = '#696e77'
const HEX_PATTERN = /^#[0-9a-f]{6}$/

export interface CustomColourDraft {
  hex: string
  /** Transparency, 0 (opaque) to 100 (invisible). */
  transparency: number
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Read a stored colour into picker fields. Unparseable values open on slate, opaque. */
export function parseCustomColour(value: string | null): CustomColourDraft {
  const parsed = value === null ? null : parseColourWithAlpha(value)
  if (!parsed) return { hex: FALLBACK_HEX, transparency: 0 }
  return {
    hex: toHex(parsed.r, parsed.g, parsed.b),
    transparency: Math.round((1 - parsed.a) * 100),
  }
}

/** The stored string for picker fields, or null when the hex is not valid. */
export function formatCustomColour(draft: CustomColourDraft): string | null {
  const hex = draft.hex.trim().toLowerCase()
  if (!HEX_PATTERN.test(hex)) return null
  const transparency = Math.max(
    0,
    Math.min(100, Math.round(draft.transparency)),
  )
  if (transparency === 0) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const alpha = ((100 - transparency) / 100).toFixed(2)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface CustomColourPopoverProps {
  /** "Fill", "Stroke" or "Text": names the button and the fields. */
  rowLabel: string
  /** The stored value of the selection, or null when the targets disagree. */
  storedValue: string | null
  /** Whether the stored value is a custom one (not a preset or the default). */
  active: boolean
  onApply: (value: string) => void
}

export function CustomColourPopover({
  rowLabel,
  storedValue,
  active,
  onApply,
}: CustomColourPopoverProps) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(FALLBACK_HEX)
  const [transparency, setTransparency] = useState(0)

  const lower = rowLabel.toLowerCase()
  const formatted = formatCustomColour({ hex, transparency })

  function handleOpenChange(next: boolean) {
    if (next) {
      const draft = parseCustomColour(storedValue)
      setHex(draft.hex)
      setTransparency(draft.transparency)
    }
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-shadow ${
            active
              ? 'ring-2 ring-ring ring-offset-1 ring-offset-background'
              : 'border-dashed border-muted-foreground/60'
          }`}
          style={
            active && storedValue
              ? { backgroundColor: storedValue, borderColor: storedValue }
              : undefined
          }
          aria-label={`Custom ${lower} colour`}
          aria-pressed={active}
          title={`Custom ${lower} colour`}
        >
          {active ? null : <Pipette className="size-3 text-muted-foreground" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={6}
        className="w-56 space-y-2 p-2"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
            value={
              HEX_PATTERN.test(hex.toLowerCase())
                ? hex.toLowerCase()
                : FALLBACK_HEX
            }
            onChange={(event) => setHex(event.target.value)}
            aria-label={`Custom ${lower} colour field`}
          />
          <Input
            className="h-8 font-mono text-xs"
            value={hex}
            maxLength={7}
            spellCheck={false}
            onChange={(event) => setHex(event.target.value)}
            aria-label={`Custom ${lower} hex`}
            aria-invalid={formatted === null}
          />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Transparency</span>
            <span>{transparency}%</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[transparency]}
            onValueChange={([next]) => setTransparency(next)}
            aria-label={`Custom ${lower} transparency`}
          />
        </div>
        <Button
          type="button"
          size="sm"
          className="h-7 w-full"
          disabled={formatted === null}
          onClick={() => {
            if (formatted === null) return
            onApply(formatted)
            setOpen(false)
          }}
        >
          Apply
        </Button>
      </PopoverContent>
    </Popover>
  )
}
