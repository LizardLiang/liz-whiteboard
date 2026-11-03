// src/hooks/use-board-settings.ts
// Board-level diagram settings: seeded from the loader, then kept live by
// optimistic local edits and collaborators' `board:settings-updated`.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { settleAckOnce } from './use-canvas-elements'
import type { ConnectionState } from './use-collaboration'
import type {
  CanvasBoardSettings,
  CanvasBoardSettingsPatch,
} from '@/data/canvas-board-settings'
import { tError } from '@/lib/i18n/t-error'
import { useT } from '@/lib/i18n/use-t'
import { DEFAULT_CANVAS_BOARD_SETTINGS } from '@/data/canvas-board-settings'

type Emit = (event: string, data: any, ack?: (res: any) => void) => void
type Listen = (event: string, handler: (...args: Array<any>) => void) => void

export interface UseBoardSettingsParams {
  initialSettings?: CanvasBoardSettings
  emit: Emit
  on: Listen
  off: Listen
  connectionState: ConnectionState
}

export function useBoardSettings({
  initialSettings,
  emit,
  on,
  off,
  connectionState,
}: UseBoardSettingsParams) {
  const t = useT()
  const [settings, setSettings] = useState<CanvasBoardSettings>(
    initialSettings ?? DEFAULT_CANVAS_BOARD_SETTINGS,
  )

  // Keys with a local edit awaiting its ack. A collaborator's broadcast must
  // not overwrite those, or the UI would show a value the server is about to
  // replace.
  const pendingSettingsRef = useRef<Map<string, number>>(new Map())
  // Bumped when the connection drops: acks of writes sent before the drop no
  // longer own a pending count.
  const epochRef = useRef(0)

  useEffect(() => {
    const onSettingsUpdated = (payload: { settings?: CanvasBoardSettings }) => {
      const incoming = payload.settings
      if (!incoming) return
      setSettings((prev) => {
        const next: Record<string, unknown> = { ...incoming }
        for (const key of pendingSettingsRef.current.keys()) {
          next[key] = (prev as Record<string, unknown>)[key]
        }
        return next as unknown as CanvasBoardSettings
      })
    }
    on('board:settings-updated', onSettingsUpdated)
    return () => off('board:settings-updated', onSettingsUpdated)
  }, [on, off])

  const wasConnectedRef = useRef(false)
  useEffect(() => {
    if (connectionState === 'connected') {
      wasConnectedRef.current = true
      return
    }
    if (!wasConnectedRef.current) return
    wasConnectedRef.current = false
    epochRef.current += 1
    pendingSettingsRef.current.clear()
  }, [connectionState])

  // Optimistic write through the socket handler, which persists AND
  // broadcasts to collaborators (the server fn persists without broadcasting).
  // A failed or unanswered write reverts only the keys it changed, and only
  // those still holding its value.
  const handleSettingsChange = useCallback(
    (patch: CanvasBoardSettingsPatch) => {
      const keys = Object.keys(patch)
      const before: Record<string, unknown> = {}
      setSettings((prev) => {
        for (const key of keys) {
          before[key] = (prev as Record<string, unknown>)[key]
        }
        return { ...prev, ...patch }
      })
      const pending = pendingSettingsRef.current
      const epoch = epochRef.current
      for (const key of keys) pending.set(key, (pending.get(key) ?? 0) + 1)
      emit(
        'board:settings-update',
        patch,
        settleAckOnce<unknown>((res) => {
          if (epoch === epochRef.current) {
            for (const key of keys) {
              const count = (pending.get(key) ?? 1) - 1
              if (count <= 0) pending.delete(key)
              else pending.set(key, count)
            }
          }
          if (res.ok) return
          // A write sent before a connection drop may have been saved; the
          // reset above already released its keys, so a later broadcast
          // decides the value.
          if (epoch !== epochRef.current) return
          // Revert a key only while it still holds what this write set: a
          // newer edit or broadcast on that key is not overwritten.
          setSettings((prev) => {
            const next: Record<string, unknown> = { ...prev }
            for (const key of keys) {
              if (next[key] === (patch as Record<string, unknown>)[key]) {
                next[key] = before[key]
              }
            }
            return next as unknown as CanvasBoardSettings
          })
          toast.error(t('hooks.boardSettings.saveFailed'), {
            description: tError(t, res),
          })
        }),
      )
    },
    [emit, t],
  )

  return { settings, handleSettingsChange }
}
