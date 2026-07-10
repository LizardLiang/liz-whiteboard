// src/components/whiteboard/WhiteboardHistoryPanel.tsx
// Version history panel (GH #107) — save/list/preview/restore whiteboard
// snapshots. Mirrors src/components/project/ProjectSharePanel.tsx's shadcn
// Sheet + TanStack Query pattern.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ReactFlowWhiteboard } from './ReactFlowWhiteboard'
import type { EffectiveRole } from '@/data/permission'
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

/** Fall back to a timestamp-derived name when a snapshot has no label (AC2). */
function formatSnapshotName(
  label: string | null,
  createdAt: string | Date,
): string {
  if (label && label.trim().length > 0) return label
  return `Version — ${new Date(createdAt).toLocaleString()}`
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
  const queryClient = useQueryClient()
  const canEdit = hasMinimumRole(viewerRole, 'EDITOR')

  const [newLabel, setNewLabel] = useState('')
  const [previewSnapshotId, setPreviewSnapshotId] = useState<string | null>(
    null,
  )

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
        toast.error('Failed to save version')
        return
      }
      setNewLabel('')
      invalidateSnapshots()
      toast.success('Version saved')
    },
    onError: () => toast.error('Failed to save version'),
  })

  const restoreMutation = useMutation({
    mutationFn: (snapshotId: string) =>
      restoreSnapshot({ data: { snapshotId } }),
    onSuccess: (result) => {
      if ('error' in result) {
        toast.error('Failed to restore version')
        return
      }
      setPreviewSnapshotId(null)
      invalidateSnapshots()
      toast.success('Version restored')
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
    },
    onError: () => toast.error('Failed to restore version'),
  })

  const { data: previewData, isLoading: isPreviewLoading } = useQuery({
    queryKey: ['snapshot-preview', previewSnapshotId],
    queryFn: () => getSnapshot({ data: { snapshotId: previewSnapshotId! } }),
    enabled: previewSnapshotId !== null,
  })

  const previewValid = !!previewData && !('error' in previewData)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md" side="right">
          <SheetHeader>
            <SheetTitle>Version History</SheetTitle>
            <SheetDescription>
              Save and browse point-in-time versions of this whiteboard.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {canEdit && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Save current version
                </Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Optional label"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    aria-label="Version label"
                  />
                  <Button
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending ? 'Saving...' : 'Save version'}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <Label className="text-sm font-medium">Versions</Label>
              {isLoading ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
              ) : isSnapshotsError ? (
                <p className="mt-2 text-sm text-destructive">
                  {classifyQueryFailure({ error: snapshotsError }) ===
                  'forbidden'
                    ? 'You no longer have access to this version history.'
                    : 'Failed to load versions. Please try again.'}
                </p>
              ) : (
                <ul className="mt-2 space-y-2" aria-label="Version list">
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
                            )}
                          </span>
                          {snapshot.isAuto && (
                            <Badge variant="secondary">Auto</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {new Date(snapshot.createdAt).toLocaleString()}
                          {snapshot.authorName
                            ? ` · ${snapshot.authorName}`
                            : ''}
                        </div>
                      </button>
                    </li>
                  ))}
                  {snapshots.length === 0 && (
                    <li className="py-2 text-sm text-muted-foreground">
                      No versions saved yet.
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
                ? formatSnapshotName(previewData.label, previewData.createdAt)
                : 'Preview'}
            </DialogTitle>
            <DialogDescription>
              Read-only preview — this does not change the live whiteboard.
            </DialogDescription>
          </DialogHeader>

          <div className="relative flex-1 overflow-hidden rounded-md border">
            {isPreviewLoading ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Loading preview...
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
                  Preview unavailable.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPreviewSnapshotId(null)}
            >
              Close
            </Button>
            {canEdit && previewSnapshotId && (
              <Button
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(previewSnapshotId)}
              >
                {restoreMutation.isPending
                  ? 'Restoring...'
                  : 'Restore this version'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
