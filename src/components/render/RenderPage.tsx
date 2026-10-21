// src/components/render/RenderPage.tsx
// Shared shell for the headless render pages (/render/whiteboard/$token and
// /render/canvas/$token). The MCP server's headless browser opens one of
// these, waits for `data-render-ready="true"` (or `data-render-error`), reads
// the framing attributes and screenshots the root element.
//
// Attributes on the root element:
//   data-render-root         marks the element to screenshot
//   data-render-ready        "true" once framing, fonts, theme and two
//                            animation frames have all landed
//   data-render-error        a machine-readable reason: invalid-token,
//                            token-expired, unknown-focus:<id>, invalid-tile:r,c
//   data-world-rect          JSON {x,y,width,height}: world area on screen
//   data-tile-grid           JSON {cols,rows,tileWidth,tileHeight,originX,
//                            originY,occupied:[[row,col],...]}, or absent
//   data-board-empty         "true" when the board holds nothing to draw

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  FramePlan,
  FramingMode,
  RenderFraming,
} from '@/lib/render/framing'
import { formatWorldRect, parseFocusIds, parseTile } from '@/lib/render/framing'
import { useTheme } from '@/hooks/use-theme'

export interface RenderSearch {
  mode: FramingMode
  focus?: string
  tile?: string
  theme: 'light' | 'dark'
}

/** Coerce raw search params; anything unknown falls back to the defaults. */
export function validateRenderSearch(
  search: Record<string, unknown>,
): RenderSearch {
  const mode =
    search.mode === 'focus' || search.mode === 'tile' ? search.mode : 'fit'
  return {
    mode,
    focus: typeof search.focus === 'string' ? search.focus : undefined,
    tile: typeof search.tile === 'string' ? search.tile : undefined,
    theme: search.theme === 'dark' ? 'dark' : 'light',
  }
}

/** Build the framing request and track the plan the board reports back. */
export function useRenderFraming(search: RenderSearch) {
  const [plan, setPlan] = useState<FramePlan | null>(null)
  const onFramed = useCallback((next: FramePlan) => setPlan(next), [])
  const { mode, focus, tile } = search
  const framing = useMemo<RenderFraming>(
    () => ({
      mode,
      focusIds: parseFocusIds(focus),
      tile: parseTile(tile),
      onFramed,
    }),
    [mode, focus, tile, onFramed],
  )
  return { framing, plan }
}

interface RenderRootProps {
  theme: 'light' | 'dark'
  plan: FramePlan | null
  /** A reason to show instead of the board, e.g. `invalid-token`. */
  error?: string
  children?: ReactNode
}

export function RenderRoot({ theme, plan, error, children }: RenderRootProps) {
  const { setTheme, resolvedTheme } = useTheme()
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    setTheme(theme)
    // setTheme is a fresh closure each render; the theme value is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  const planError = plan && 'error' in plan ? plan.error : undefined
  const frame = plan && !('error' in plan) ? plan : null
  const themeApplied = resolvedTheme === theme

  // Ready = framed + theme applied + fonts loaded + two painted frames.
  useEffect(() => {
    if (!frame || !themeApplied) return
    const run = { cancelled: false }
    void (async () => {
      await document.fonts.ready
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      if (!run.cancelled) setSettled(true)
    })()
    return () => {
      run.cancelled = true
    }
  }, [frame, themeApplied])

  const renderError = error ?? planError
  return (
    <div
      data-render-root=""
      data-render-ready={!renderError && settled ? 'true' : undefined}
      data-render-error={renderError}
      data-world-rect={frame ? formatWorldRect(frame.worldRect) : undefined}
      data-tile-grid={
        frame?.tileGrid ? JSON.stringify(frame.tileGrid) : undefined
      }
      data-board-empty={frame && !frame.boardBounds ? 'true' : undefined}
      className="fixed inset-0 overflow-hidden bg-background [&_.react-flow__attribution]:hidden"
    >
      {renderError && !children ? (
        <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {renderError}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
