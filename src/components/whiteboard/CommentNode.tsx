/**
 * CommentNode — free-canvas-point comment pin (GH #110). A React Flow node
 * (registered as `comment` in node-types.ts) rendered at the anchor's flow
 * coordinates. Non-draggable/non-deletable (`data-` flags set by the parent
 * when building the node) so it never steals drag/select from table nodes —
 * see the `deletable`/`draggable` node-level props set in ReactFlowWhiteboard.
 *
 * Self-contained popover (mirrors ColumnNotePopover / CommentThreadPopover):
 * clicking the pin opens/closes its own thread — no controlled `open` prop
 * threaded down from the parent.
 */

import { MessageCircle } from 'lucide-react'
import { CommentThreadCard } from './CommentThreadPopover'
import type { NodeProps } from '@xyflow/react'
import type { CommentNodeType } from '@/lib/react-flow/types'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export function CommentNode({ data }: NodeProps<CommentNodeType>) {
  const {
    thread,
    canComment,
    currentUserId,
    canModerateComments,
    onReply,
    onEdit,
    onDelete,
    onResolve,
  } = data
  const resolved = thread.root.resolved

  return (
    <Popover>
      <PopoverTrigger
        asChild
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          data-testid="comment-pin"
          data-comment-id={thread.root.id}
          aria-label={
            resolved ? 'Resolved comment thread' : 'Open comment thread'
          }
          className="nodrag nowheel flex h-7 w-7 items-center justify-center rounded-full border shadow-sm"
          style={{
            background: resolved
              ? 'var(--rf-table-bg)'
              : 'var(--rf-edge-stroke-selected, #6366f1)',
            borderColor: 'var(--rf-table-border)',
            color: resolved ? 'var(--rf-table-text)' : '#fff',
            cursor: 'pointer',
            opacity: resolved ? 0.6 : 1,
          }}
        >
          <MessageCircle size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="nodrag nowheel w-80 p-3"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <CommentThreadCard
          thread={thread}
          canComment={canComment}
          currentUserId={currentUserId}
          canModerateComments={canModerateComments}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onResolve={onResolve}
        />
      </PopoverContent>
    </Popover>
  )
}
