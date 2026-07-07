/**
 * CommentThreadPopover — canvas comment thread UI (GH #110). Mirrors the
 * shadcn Popover + `nodrag nowheel` + stopPropagation pattern used by
 * `column/ColumnNotePopover.tsx`.
 *
 * Two exports:
 * - `CommentThreadCard` renders ONE thread (root + flat replies, a reply
 *   box, the Resolve/Reopen toggle, and edit/delete on own comments) —
 *   reused by both the table-anchored badge (which can list many threads)
 *   and the free-point pin (which is always exactly one thread).
 * - `CommentThreadPopover` wraps a trigger with a Popover listing every
 *   thread anchored to a table, plus a "start a new thread" composer.
 */

import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CommentThreadVM } from '@/lib/react-flow/types'
import type { CommentWithAuthor } from '@/data/models'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

const MAX_LENGTH = 2000

/** Absolute-ish relative time (no new date dependency): "just now", "5m ago",
 * "3h ago", "2d ago", falling back to a locale date string beyond a week. */
function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

interface CommentActionHandlers {
  canComment: boolean
  currentUserId: string
  canModerateComments: boolean
  onReply: (parentId: string, body: string) => void
  onEdit: (commentId: string, body: string) => void
  onDelete: (commentId: string) => void
  onResolve: (commentId: string, resolved: boolean) => void
}

function CommentRow({
  comment,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  comment: CommentWithAuthor
  canEdit: boolean
  canDelete: boolean
  onEdit: (body: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
          className="min-h-16 resize-none text-xs"
          autoFocus
        />
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setDraft(comment.body)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={draft.trim().length === 0}
            onClick={() => {
              onEdit(draft.trim())
              setEditing(false)
            }}
          >
            Save
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{comment.authorName}</span>
        <span className="text-[10px] text-muted-foreground">
          {formatRelativeTime(comment.createdAt)}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-xs">{comment.body}</p>
      {(canEdit || canDelete) && (
        <div className="mt-0.5 flex gap-2">
          {canEdit && (
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:underline"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="text-[10px] text-destructive hover:underline"
              onClick={onDelete}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function CommentThreadCard({
  thread,
  canComment,
  currentUserId,
  canModerateComments,
  onReply,
  onEdit,
  onDelete,
  onResolve,
}: { thread: CommentThreadVM } & CommentActionHandlers) {
  const { root, replies } = thread
  const [replyDraft, setReplyDraft] = useState('')

  // Server contract is asymmetric (collaboration.ts): comment:update is
  // author-only, comment:delete is author OR project ADMIN+ (moderation).
  // Gating both buttons off one combined predicate showed moderators an Edit
  // affordance the server always FORBIDs — split them to match the server.
  const canEdit = (c: CommentWithAuthor) => c.authorId === currentUserId
  const canDelete = (c: CommentWithAuthor) =>
    c.authorId === currentUserId || canModerateComments

  return (
    <div
      data-testid="comment-thread"
      data-comment-id={root.id}
      className="flex flex-col gap-2 rounded-md border p-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <CommentRow
            comment={root}
            canEdit={canEdit(root)}
            canDelete={canDelete(root)}
            onEdit={(body) => onEdit(root.id, body)}
            onDelete={() => onDelete(root.id)}
          />
        </div>
        {canComment && (
          <Button
            size="sm"
            variant={root.resolved ? 'outline' : 'secondary'}
            className="h-6 shrink-0 px-2 text-[10px]"
            onClick={() => onResolve(root.id, !root.resolved)}
          >
            {root.resolved ? 'Reopen' : 'Resolve'}
          </Button>
        )}
      </div>

      {replies.length > 0 && (
        <div className="ml-3 flex flex-col gap-2 border-l pl-2">
          {replies.map((reply) => (
            <CommentRow
              key={reply.id}
              comment={reply}
              canEdit={canEdit(reply)}
              canDelete={canDelete(reply)}
              onEdit={(body) => onEdit(reply.id, body)}
              onDelete={() => onDelete(reply.id)}
            />
          ))}
        </div>
      )}

      {canComment && (
        <div className="flex flex-col gap-1.5">
          <Textarea
            placeholder="Reply..."
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value.slice(0, MAX_LENGTH))}
            className="min-h-12 resize-none text-xs"
          />
          <Button
            size="sm"
            className="h-6 self-end px-2 text-xs"
            disabled={replyDraft.trim().length === 0}
            onClick={() => {
              onReply(root.id, replyDraft.trim())
              setReplyDraft('')
            }}
          >
            Reply
          </Button>
        </div>
      )}
    </div>
  )
}

export interface CommentThreadPopoverProps extends CommentActionHandlers {
  trigger: ReactNode
  threads: Array<CommentThreadVM>
  onCreateThread: (body: string) => void
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}

/** Table-anchored popover: lists every thread on the table plus a "start a
 * new thread" composer. Used by the table header comment badge. */
export function CommentThreadPopover({
  trigger,
  threads,
  onCreateThread,
  side = 'right',
  align = 'start',
  ...handlers
}: CommentThreadPopoverProps) {
  const [newThreadDraft, setNewThreadDraft] = useState('')

  return (
    <Popover>
      <PopoverTrigger
        asChild
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="nodrag nowheel w-80 p-3"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {threads.length === 0 && (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          )}
          {threads.map((thread) => (
            <CommentThreadCard
              key={thread.root.id}
              thread={thread}
              {...handlers}
            />
          ))}

          {handlers.canComment && (
            <div className="flex flex-col gap-1.5 border-t pt-2">
              <Textarea
                placeholder="Start a new thread..."
                value={newThreadDraft}
                onChange={(e) =>
                  setNewThreadDraft(e.target.value.slice(0, MAX_LENGTH))
                }
                className="min-h-14 resize-none text-xs"
              />
              <Button
                size="sm"
                className="h-6 self-end px-2 text-xs"
                disabled={newThreadDraft.trim().length === 0}
                onClick={() => {
                  onCreateThread(newThreadDraft.trim())
                  setNewThreadDraft('')
                }}
              >
                <MessageSquarePlus className="mr-1 h-3 w-3" />
                Comment
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
