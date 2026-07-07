// src/components/whiteboard/WhiteboardCommentsPanel.tsx
// Canvas comments side panel (GH #110) — lists every thread (unresolved
// first), lets a VIEWER+ jump the live canvas to a thread's anchor, and
// resolve/reopen inline. Mirrors WhiteboardHistoryPanel.tsx's shadcn Sheet
// pattern, but reads live data/actions from the caller instead of its own
// query — see CommentActions' doc comment in ReactFlowWhiteboard.tsx for why
// (all comment mutations must go through the one socket-connected hook
// instance, not a second HTTP-only path).

import { useMemo } from 'react'
import type { EffectiveRole } from '@/data/permission'
import type { CommentWithAuthor } from '@/data/models'
import type { CommentActions } from './ReactFlowWhiteboard'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { hasMinimumRole } from '@/lib/auth/permissions'

interface CommentThreadListItem {
  root: CommentWithAuthor
  replyCount: number
}

interface WhiteboardCommentsPanelProps {
  /** Requesting user's effective role — gates resolve/reopen (VIEWER+, AC per plan). */
  viewerRole: EffectiveRole | null
  /** Live flat comment list (roots + replies), fed from the canvas's socket
   * hook via ReactFlowWhiteboard's onCommentsChange ready-callback. */
  comments: Array<CommentWithAuthor>
  /** Live mutation entry points, fed via onCommentActionsReady. Null until
   * the canvas has mounted and reported them. */
  actions: CommentActions | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatTimestamp(date: Date | string): string {
  return new Date(date).toLocaleString()
}

export function WhiteboardCommentsPanel({
  viewerRole,
  comments,
  actions,
  open,
  onOpenChange,
}: WhiteboardCommentsPanelProps) {
  const canComment = hasMinimumRole(viewerRole, 'VIEWER')

  const threads = useMemo<Array<CommentThreadListItem>>(() => {
    const replyCounts = new Map<string, number>()
    for (const c of comments) {
      if (c.parentId === null) continue
      replyCounts.set(c.parentId, (replyCounts.get(c.parentId) ?? 0) + 1)
    }
    const roots = comments.filter((c) => c.parentId === null)
    return roots
      .map((root) => ({ root, replyCount: replyCounts.get(root.id) ?? 0 }))
      .sort((a, b) => {
        if (a.root.resolved !== b.root.resolved) {
          return a.root.resolved ? 1 : -1
        }
        return (
          new Date(b.root.createdAt).getTime() -
          new Date(a.root.createdAt).getTime()
        )
      })
  }, [comments])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md" side="right">
        <SheetHeader>
          <SheetTitle>Comments</SheetTitle>
          <SheetDescription>
            Threaded discussion pinned to tables and canvas points.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          <Label className="text-sm font-medium">Threads</Label>
          <ul className="mt-2 space-y-2" aria-label="Comment thread list">
            {threads.map(({ root, replyCount }) => (
              <li key={root.id}>
                <div className="rounded-md border px-3 py-2 text-left text-sm">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => actions?.panToComment(root)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {root.targetType === 'table'
                          ? 'Table comment'
                          : 'Canvas comment'}
                      </span>
                      {root.resolved && (
                        <Badge variant="secondary">Resolved</Badge>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {root.body}
                    </p>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {root.authorName} · {formatTimestamp(root.createdAt)}
                      {replyCount > 0
                        ? ` · ${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}`
                        : ''}
                    </div>
                  </button>
                  {canComment && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() =>
                          actions?.resolveComment(root.id, !root.resolved)
                        }
                      >
                        {root.resolved ? 'Reopen' : 'Resolve'}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
            {threads.length === 0 && (
              <li className="py-2 text-sm text-muted-foreground">
                No comments yet.
              </li>
            )}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  )
}
