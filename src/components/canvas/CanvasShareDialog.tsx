// src/components/canvas/CanvasShareDialog.tsx
// Create, list and revoke public read-only share links for ONE canvas board.
//
// This lives on the board rather than in ProjectSharePanel deliberately. That
// panel is built around a whiteboard picker fed by getWhiteboardsByProject,
// and canvas boards are a separate board kind in a separate table; teaching
// it to hold two kinds would mean genericising its picker, its list rows and
// its two mutations, for a feature that is more naturally reached from the
// board you are already looking at. The server handlers are the shared
// contract instead of the UI.
//
// The raw token is shown exactly once, at creation. It is never persisted
// (only its SHA-256 hash is) so it cannot be recovered afterwards — the list
// below can only ever revoke.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link2 } from 'lucide-react'
import type { InviteExpiryHours } from '@/data/schema'
import {
  createCanvasShareLink,
  listCanvasShareLinks,
  revokeCanvasShareLink,
} from '@/routes/api/canvas-share'
import { copyText } from '@/lib/copy-text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Same choices as ProjectSharePanel's EXPIRY_OPTIONS — the two link kinds
 * share one expiry policy, enforced by one Zod schema. */
const EXPIRY_OPTIONS: Array<{ value: InviteExpiryHours; label: string }> = [
  { value: 1, label: '1 hour' },
  { value: 24, label: '24 hours' },
  { value: 24 * 7, label: '7 days' },
  { value: 24 * 30, label: '30 days' },
]

interface CanvasShareDialogProps {
  boardId: string
}

/**
 * Pull a human message off a denial without an `any` cast.
 *
 * These handlers return either a `{ error, status, message }` refusal or an
 * `AuthErrorResponse`, and only the first carries `message`. ProjectSharePanel
 * reaches for it through `as any`; narrowing is the same length and keeps the
 * union honest if either shape changes.
 */
function denialMessage(result: object, fallback: string): string {
  return 'message' in result && typeof result.message === 'string'
    ? result.message
    : fallback
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function CanvasShareDialog({ boardId }: CanvasShareDialogProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [expiresInHours, setExpiresInHours] = useState<InviteExpiryHours>(
    24 * 7,
  )
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Only fetched while the dialog is open — a board page that never opens it
  // should not pay for the query.
  const { data, isLoading } = useQuery({
    queryKey: ['canvas-share-links', boardId],
    queryFn: () => listCanvasShareLinks({ data: boardId }),
    enabled: open,
  })

  const links = data && !('error' in data) ? data.links : []

  const createMutation = useMutation({
    mutationFn: () =>
      createCanvasShareLink({ data: { canvasBoardId: boardId, expiresInHours } }),
    onSuccess: (result) => {
      if ('error' in result) {
        toast.error(denialMessage(result, 'Could not create the share link.'))
        return
      }
      // The one and only moment this value exists outside the creator's
      // browser. Held in state so the input below can show it; gone on close.
      setCreatedToken(result.token)
      setCopied(false)
      void queryClient.invalidateQueries({
        queryKey: ['canvas-share-links', boardId],
      })
    },
    onError: () => toast.error('Could not create the share link.'),
  })

  const revokeMutation = useMutation({
    mutationFn: (linkId: string) =>
      revokeCanvasShareLink({ data: { linkId } }),
    onSuccess: (result) => {
      if ('error' in result) {
        toast.error(denialMessage(result, 'Could not revoke the link.'))
        return
      }
      toast.success('Link revoked.')
      void queryClient.invalidateQueries({
        queryKey: ['canvas-share-links', boardId],
      })
    },
    onError: () => toast.error('Could not revoke the link.'),
  })

  const shareUrl = createdToken
    ? `${window.location.origin}/canvas-share/${createdToken}`
    : ''

  const handleCopy = async () => {
    if (!shareUrl) return
    const didCopy = await copyText(shareUrl)
    if (!didCopy) {
      toast.error('Could not copy — select and copy the link manually.')
      return
    }
    setCopied(true)
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    // Closing discards the raw token. It is unrecoverable by design, and
    // leaving it in state would resurrect it the next time the dialog opens,
    // long after the creator has moved on.
    if (!next) {
      setCreatedToken(null)
      setCopied(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 className="mr-2 h-4 w-4" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share this board</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this board — no account needed. They
            cannot edit it, and the link stops working when it expires or is
            revoked.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="canvas-share-expiry">Link expires after</Label>
            <Select
              value={String(expiresInHours)}
              onValueChange={(v) =>
                setExpiresInHours(Number(v))
              }
            >
              <SelectTrigger id="canvas-share-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create link'}
          </Button>
        </div>

        {createdToken && (
          <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
            <Label htmlFor="canvas-share-url">
              Copy this link now — it cannot be shown again
            </Label>
            <div className="flex gap-2">
              <Input id="canvas-share-url" readOnly value={shareUrl} />
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Existing links</p>
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
          {!isLoading && links.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No share links on this board yet.
            </p>
          )}
          <ul className="space-y-1">
            {links.map((link) => {
              const revoked = link.revokedAt !== null
              return (
                <li
                  key={link.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    {revoked ? 'Revoked' : `Expires ${formatDate(link.expiresAt)}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoked || revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(link.id)}
                  >
                    Revoke
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
