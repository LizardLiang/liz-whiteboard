// src/components/whiteboard/WhiteboardHistoryPanel.tsx
// Version history panel (GH #107) — save/list/preview/restore whiteboard
// snapshots. Mirrors src/components/project/ProjectSharePanel.tsx's shadcn
// Sheet + TanStack Query pattern.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ReactFlowWhiteboard } from './ReactFlowWhiteboard'
import type { EffectiveRole } from '@/data/permission'
import type { TFunction } from '@/lib/i18n/translate'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { classifyQueryFailure } from '@/lib/auth/errors'
import {
  getSnapshot,
  listSnapshots,
  restoreSnapshot,
  saveSnapshot,
} from '@/routes/api/history'
import { useI18n } from '@/lib/i18n/use-t'

/** Placeholder viewer id for the read-only snapshot preview canvas — never a
 * real authenticated user, mirrors PUBLIC_VIEWER_ID in share.$token.tsx. */
const HISTORY_PREVIEW_USER_ID = 'history-preview'

/** Client-safe snapshot list item shape returned by listSnapshots (no `payload`, AC2). */
interface SnapshotListItem {
  id: string
  whiteboardId: string
  label: string | null
  authorName: string | null
  isAuto: boolean
  createdAt: string | Date
}

interface WhiteboardHistoryPanelProps {
  whiteboardId: string
  /** Requesting user's effective role — gates Save/Restore (EDITOR+, AC6). */
  viewerRole: EffectiveRole | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Label the server stores on the automatic version made before a restore. */
const AUTO_RESTORE_LABEL = 'Auto-saved before restore'

/** Fall back to a timestamp-derived name when a snapshot has no label (AC2). */
function formatSnapshotName(
  label: string | null,
  createdAt: string | Date,
  t: TFunction,
  locale: string,
): string {
  if (label === AUTO_RESTORE_LABEL)
    return t('whiteboard.history.autoRestoreLabel')
  if (label && label.trim().length > 0) return label
  return t('whiteboard.history.versionName', {
    date: new Date(createdAt).toLocaleString(locale),
  })
}

/**
 * getSnapshot's preview payload is the DB-reloaded (persisted) shape —
 * every `createdAt`/`updatedAt` is a `string` (see `PersistedSnapshotPayload`
 * / `WithPersistedDates` in data/models.ts, and `buildPreviewData` in
 * lib/history/handlers.ts, which deliberately leaves date coercion to the
 * client). Revive them back to `Date` before handing the payload to
 * ReactFlowWhiteboard, which expects real DiagramTable/Column/Relationship
 * shapes.
 */
function reviveDates<T extends { createdAt: string; updatedAt: string }>(
  obj: T,
): Omit<T, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date } {
  return {
    ...obj,
    createdAt: new Date(obj.createdAt),
    updatedAt: new Date(obj.updatedAt),
  }
}

/**
 * WhiteboardHistoryPanel renders a slide-out sheet listing every saved
 * version of a whiteboard (AC2), with a read-only preview + non-destructive
 * restore flow (AC3/AC4). Visible to VIEWER+; Save/Restore require EDITOR+.
 */
export function WhiteboardHistoryPanel({
  whiteboardId,
  viewerRole,
  open,
  onOpenChange,
}: WhiteboardHistoryPanelProps) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const canEdit = hasMinimumRole(viewerRole, 'EDITOR')

  const [newLabel, setNewLabel] = useState('')
  const [previewSnapshotId, setPreviewSnapshotId] = useState<string | null>(
    null,
  )
  // FR-035a: the restore confirmation gate — inserted between "Restore this
  // version" and the actual mutate() call.
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)

  const invalidateSnapshots = () => {
    queryClient.invalidateQueries({ queryKey: ['snapshots', whiteboardId] })
  }

  const {
    data,
    isLoading,
    isError: isSnapshotsError,
    error: snapshotsError,
  } = useQuery({
    queryKey: ['snapshots', whiteboardId],
    queryFn: () => listSnapshots({ data: { whiteboardId } }),
    enabled: open,
  })

  const snapshots: Array<SnapshotListItem> =
    data && !('error' in data) ? data.snapshots : []

  const saveMutation = useMutation({
    mutationFn: () =>
      saveSnapshot({
        data: { whiteboardId, label: newLabel.trim() || undefined },
      }),
    onSuccess: (result) => {
      if ('error' in result) {
        toast.error(t('whiteboard.history.saveFailed'))
        return
      }
      setNewLabel('')
      invalidateSnapshots()
      toast.success(t('whiteboard.history.saved'))
    },
    onError: () => toast.error(t('whiteboard.history.saveFailed')),
  })

  const restoreMutation = useMutation({
    mutationFn: (snapshotId: string) =>
      restoreSnapshot({ data: { snapshotId } }),
    onSuccess: (result) => {
      if ('error' in result) {
        toast.error(t('whiteboard.history.restoreFailed'))
        return
      }
      setPreviewSnapshotId(null)
      invalidateSnapshots()
      toast.success(t('whiteboard.history.restored'))
      // AC5: other connected clients refresh via the whiteboard:restored
      // socket broadcast (emitted server-side in restoreSnapshotHandler).
      // Belt-and-suspenders — also invalidate the acting client's own
      // whiteboard queries locally so its canvas refreshes regardless of
      // socket delivery: the broadcast no-ops in the dev two-process split
      // (io is null in the Vite server-fn process) and could be missed in
      // prod if the socket is momentarily disconnected. Mirrors the query
      // keys used by the SQL-import flow (use-sql-import.ts).
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
      queryClient.invalidateQueries({
        queryKey: ['whiteboard-page', whiteboardId],
      })
      queryClient.invalidateQueries({
        queryKey: ['relationships', whiteboardId],
      })
      // B1 (Hermes code review): this set omitted ['shapes', whiteboardId] —
      // the only key useWhiteboardShapes reads. Without it the canvas's
      // useState copy of shapes/connectors survives a restore untouched; a
      // shape that the restore re-inserts under its original id (D3) then
      // renders at its stale pre-restore position, and dragging it writes
      // that stale position back — a silent partial undo of the restore.
      queryClient.invalidateQueries({ queryKey: ['shapes', whiteboardId] })
    },
    onError: () => toast.error(t('whiteboard.history.restoreFailed')),
  })

  const { data: previewData, isLoading: isPreviewLoading } = useQuery({
    queryKey: ['snapshot-preview', previewSnapshotId],
    queryFn: () => getSnapshot({ data: { snapshotId: previewSnapshotId! } }),
    enabled: previewSnapshotId !== null,
  })

  const previewValid = !!previewData && !('error' in previewData)

  // FR-035a: the live shape count comes from the ['shapes', whiteboardId]
  // TanStack Query cache, which useWhiteboardShapes (the live canvas, a
  // sibling under the same route) already populates. Falls back to 0 if the
  // canvas hasn't populated it yet (e.g. panel opened before the canvas
  // finished its first load) — the confirmation still names a real number,
  // never blank.
  const liveShapesData = queryClient.getQueryData<{
    shapes: Array<unknown>
    connectors: Array<unknown>
  }>(['shapes', whiteboardId])
  const liveShapeCount = liveShapesData?.shapes.length ?? 0
  const liveConnectorCount = liveShapesData?.connectors.length ?? 0
  const snapshotShapeCount =
    previewValid && 'snapshotShapeCount' in previewData
      ? previewData.snapshotShapeCount
      : 0

  const restoreConfirmCopy =
    snapshotShapeCount === 0 && liveShapeCount > 0
      ? t('whiteboard.history.restoreCopyNoShapes', {
          shapes: liveShapeCount,
          connectors: liveConnectorCount,
        })
      : t('whiteboard.history.restoreCopy', {
          snapshot: snapshotShapeCount,
          live: liveShapeCount,
        })

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 sm:max-w-lg" side="right">
          <SheetHeader className="px-6 pt-6 pb-4">
            <SheetTitle>{t('whiteboard.history.title')}</SheetTitle>
            <SheetDescription>
              {t('whiteboard.history.description')}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 pt-2 pb-6">
            {canEdit && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {t('whiteboard.history.saveCurrent')}
                </Label>
                <div className="flex gap-2">
                  <Input
                    placeholder={t('whiteboard.history.labelPlaceholder')}
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    aria-label={t('whiteboard.history.labelAria')}
                  />
                  <Button
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending
                      ? t('whiteboard.history.saving')
                      : t('whiteboard.history.saveVersion')}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <Label className="text-sm font-medium">
                {t('whiteboard.history.versions')}
              </Label>
              {isLoading ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('whiteboard.history.loading')}
                </p>
              ) : isSnapshotsError ? (
                <p className="mt-2 text-sm text-destructive">
                  {classifyQueryFailure({ error: snapshotsError }) ===
                  'forbidden'
                    ? t('whiteboard.history.noAccess')
                    : t('whiteboard.history.loadFailed')}
                </p>
              ) : (
                <ul
                  className="mt-2 space-y-2"
                  aria-label={t('whiteboard.history.list')}
                >
                  {snapshots.map((snapshot) => (
                    <li key={snapshot.id}>
                      <button
                        type="button"
                        className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => setPreviewSnapshotId(snapshot.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {formatSnapshotName(
                              snapshot.label,
                              snapshot.createdAt,
                              t,
                              locale,
                            )}
                          </span>
                          {snapshot.isAuto && (
                            <Badge variant="secondary">
                              {t('whiteboard.history.auto')}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {new Date(snapshot.createdAt).toLocaleString(locale)}
                          {snapshot.authorName
                            ? ` · ${snapshot.authorName}`
                            : ''}
                        </div>
                      </button>
                    </li>
                  ))}
                  {snapshots.length === 0 && (
                    <li className="py-2 text-sm text-muted-foreground">
                      {t('whiteboard.history.empty')}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Read-only preview (AC3) + non-destructive restore confirmation (AC4) */}
      <Dialog
        open={previewSnapshotId !== null}
        onOpenChange={(next) => {
          if (!next) setPreviewSnapshotId(null)
        }}
      >
        <DialogContent className="flex h-[80vh] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle>
              {previewValid
                ? formatSnapshotName(
                    previewData.label,
                    previewData.createdAt,
                    t,
                    locale,
                  )
                : t('whiteboard.history.preview')}
            </DialogTitle>
            <DialogDescription>
              {t('whiteboard.history.previewDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="relative flex-1 overflow-hidden rounded-md border">
            {isPreviewLoading ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {t('whiteboard.history.previewLoading')}
                </p>
              </div>
            ) : previewValid ? (
              <ReactFlowWhiteboard
                whiteboardId={previewData.whiteboardId}
                userId={HISTORY_PREVIEW_USER_ID}
                isPublic
                data={{
                  tables: previewData.tables.map((table) => ({
                    ...reviveDates(table),
                    columns: table.columns.map(reviveDates),
                    outgoingRelationships:
                      table.outgoingRelationships.map(reviveDates),
                    incomingRelationships:
                      table.incomingRelationships.map(reviveDates),
                  })),
                  relationships: previewData.relationships.map((rel) => ({
                    ...reviveDates(rel),
                    sourceTable: {
                      ...reviveDates(rel.sourceTable),
                      columns: rel.sourceTable.columns.map(reviveDates),
                    },
                    targetTable: {
                      ...reviveDates(rel.targetTable),
                      columns: rel.targetTable.columns.map(reviveDates),
                    },
                    sourceColumn: reviveDates(rel.sourceColumn),
                    targetColumn: reviveDates(rel.targetColumn),
                  })),
                }}
                showMinimap={previewData.tables.length > 0}
                showControls={true}
                nodesDraggable={false}
                viewerRole={null}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {t('whiteboard.history.previewUnavailable')}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPreviewSnapshotId(null)}
            >
              {t('whiteboard.history.close')}
            </Button>
            {canEdit && previewSnapshotId && (
              <Button
                disabled={restoreMutation.isPending}
                onClick={() => setRestoreConfirmOpen(true)}
              >
                {restoreMutation.isPending
                  ? t('whiteboard.history.restoring')
                  : t('whiteboard.history.restoreThis')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FR-035a: paired loss+recovery copy, required in BOTH branches (not
          only the legacy zero-shape case) — the only compensating control
          for the preview dialog above not rendering shapes. */}
      <AlertDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('whiteboard.history.restoreTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {restoreConfirmCopy}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreMutation.isPending}
              onClick={() => {
                if (!previewSnapshotId) return
                restoreMutation.mutate(previewSnapshotId)
                setRestoreConfirmOpen(false)
              }}
            >
              {restoreMutation.isPending
                ? t('whiteboard.history.restoring')
                : t('whiteboard.history.restore')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
