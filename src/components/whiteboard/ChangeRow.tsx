// src/components/whiteboard/ChangeRow.tsx
// One row of the Changes tab: a single change event, or a collapsed batch
// (SQL import, restore, auto-layout, ...) that loads its items when expanded.

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ChevronDown,
  History,
  Layers,
  Move,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type {
  BatchSummaryDto,
  ChangeEventDto,
} from '@/lib/schema-changelog/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  describeBatch,
  describeEvent,
  detailFields,
  formatRelativeTime,
  splitMarked,
} from '@/lib/schema-changelog/describe'
import { getSchemaChangeBatch } from '@/routes/api/schema-changes'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n/use-t'

/** Render a marked sentence: names in a code face, the rest as plain text. */
export function MarkedText({ text }: { text: string }) {
  return (
    <>
      {splitMarked(text).map((run, index) =>
        run.name ? (
          <code
            key={index}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]"
          >
            {run.text}
          </code>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  )
}

function ActionIcon({ event }: { event: ChangeEventDto }) {
  const common = 'mt-0.5 size-4 shrink-0'
  if (event.entityType === 'board')
    return <History className={cn(common, 'text-muted-foreground')} />
  switch (event.action) {
    case 'create':
      return (
        <Plus
          className={cn(common, 'text-emerald-600 dark:text-emerald-400')}
        />
      )
    case 'delete':
      return <Trash2 className={cn(common, 'text-red-600 dark:text-red-400')} />
    case 'move':
    case 'resize':
      return <Move className={cn(common, 'text-muted-foreground')} />
    default:
      return <Pencil className={cn(common, 'text-muted-foreground')} />
  }
}

function Meta({
  viaAgent,
  createdAt,
}: {
  viaAgent: boolean
  createdAt: number
}) {
  const { t, locale } = useI18n()
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {viaAgent && (
        <Badge variant="secondary">
          {t('whiteboard.history.changes.agentBadge')}
        </Badge>
      )}
      <time
        dateTime={new Date(createdAt).toISOString()}
        title={new Date(createdAt).toLocaleString(locale)}
      >
        {formatRelativeTime(createdAt, Date.now(), locale)}
      </time>
    </div>
  )
}

function Value({
  value,
  tone,
}: {
  value: string | null
  tone: 'before' | 'after'
}) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'rounded px-1 [overflow-wrap:anywhere]',
        tone === 'before'
          ? 'bg-red-500/10 text-red-700 dark:text-red-400'
          : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        value === null && 'italic',
      )}
    >
      {value ?? t('whiteboard.history.changes.valueNone')}
    </span>
  )
}

function Details({ event }: { event: ChangeEventDto }) {
  const { t } = useI18n()
  const rows = detailFields(event)
  if (rows.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {t('whiteboard.history.changes.noDetails')}
      </p>
    )
  }
  return (
    <dl className="mt-2 space-y-1 border-t pt-2 text-xs">
      {rows.map((row) => (
        <div
          key={row.field}
          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
        >
          <dt className="font-mono text-muted-foreground [overflow-wrap:anywhere]">
            {row.field}
          </dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-1">
            {event.action !== 'create' && (
              <Value value={row.before} tone="before" />
            )}
            {event.action === 'update' && (
              <ArrowRight
                className="size-3 text-muted-foreground"
                aria-hidden
              />
            )}
            {event.action !== 'delete' && (
              <Value value={row.after} tone="after" />
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function RowShell({
  icon,
  sentence,
  meta,
  expanded,
  onToggle,
  toggleLabel,
  testId,
  children,
}: {
  icon: ReactNode
  sentence: ReactNode
  meta: ReactNode
  expanded: boolean
  onToggle: () => void
  toggleLabel: string
  testId: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-md border px-3 py-2 text-sm" data-testid={testId}>
      <div className="flex items-start gap-2">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="leading-snug [overflow-wrap:anywhere]">{sentence}</p>
          {meta}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-my-1 -mr-1 size-8 shrink-0"
          aria-expanded={expanded}
          aria-label={toggleLabel}
          onClick={onToggle}
        >
          <ChevronDown
            className={cn(
              'size-4 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </Button>
      </div>
      {children}
    </div>
  )
}

/** `nested` rows sit inside an expanded batch: they share its time, so they omit it. */
export function EventRow({
  event,
  nested = false,
}: {
  event: ChangeEventDto
  nested?: boolean
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  return (
    <RowShell
      testId="change-event"
      icon={<ActionIcon event={event} />}
      sentence={
        <>
          <span className="font-medium">{event.actorName}</span>{' '}
          <MarkedText text={describeEvent(event, t)} />
        </>
      }
      meta={
        nested ? null : (
          <Meta viaAgent={event.viaAgent} createdAt={event.createdAt} />
        )
      }
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      toggleLabel={
        expanded
          ? t('whiteboard.history.changes.hideDetails')
          : t('whiteboard.history.changes.showDetails')
      }
    >
      {expanded && <Details event={event} />}
    </RowShell>
  )
}

interface BatchRowProps {
  whiteboardId: string
  batch: BatchSummaryDto
  tableName?: string
  includeLayout: boolean
}

export function BatchRow({
  whiteboardId,
  batch,
  tableName,
  includeLayout,
}: BatchRowProps) {
  const { t, locale } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const { title, counts } = describeBatch(batch, t, locale)

  const items = useInfiniteQuery({
    queryKey: [
      'schema-change-batch',
      whiteboardId,
      batch.batchId,
      tableName ?? null,
      includeLayout,
    ],
    queryFn: async ({ pageParam }) => {
      const result = await getSchemaChangeBatch({
        data: {
          whiteboardId,
          batchId: batch.batchId,
          cursor: pageParam,
          limit: 100,
          tableName,
          includeLayout,
        },
      })
      if ('error' in result) throw new Error(result.error)
      return result
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: expanded,
  })
  const events = items.data?.pages.flatMap((page) => page.events) ?? []

  return (
    <RowShell
      testId="change-batch"
      icon={<Layers className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      sentence={
        <>
          <span className="font-medium">{batch.actorName}</span>{' '}
          <MarkedText text={title} />
          {counts && <span className="text-muted-foreground"> — {counts}</span>}
        </>
      }
      meta={<Meta viaAgent={batch.viaAgent} createdAt={batch.createdAt} />}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      toggleLabel={
        expanded
          ? t('whiteboard.history.changes.hideItems')
          : t('whiteboard.history.changes.showItems')
      }
    >
      {expanded && (
        <div className="mt-2 space-y-2 border-t pt-2">
          {items.isError ? (
            <p className="text-xs text-destructive">
              {t('whiteboard.history.changes.batchLoadFailed')}
            </p>
          ) : items.isPending ? (
            <p className="text-xs text-muted-foreground">
              {t('whiteboard.history.changes.loading')}
            </p>
          ) : (
            <ul
              className="space-y-2"
              aria-label={t('whiteboard.history.changes.batchItems')}
            >
              {events.map((event) => (
                <li key={event.id}>
                  <EventRow event={event} nested />
                </li>
              ))}
            </ul>
          )}
          {items.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={items.isFetchingNextPage}
              onClick={() => void items.fetchNextPage()}
            >
              {items.isFetchingNextPage
                ? t('whiteboard.history.changes.loadingMore')
                : t('whiteboard.history.changes.loadMore')}
            </Button>
          )}
        </div>
      )}
    </RowShell>
  )
}
