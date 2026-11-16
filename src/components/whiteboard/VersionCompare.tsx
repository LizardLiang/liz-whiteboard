// src/components/whiteboard/VersionCompare.tsx
// The compare view of the Versions tab: pick an older and a newer side (a saved
// version, or the current board) and list what was Added, Removed and Changed.
// Rows reuse the Changes-tab row look; the same "Show layout changes" switch
// hides position, size and edge-path differences.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { MarkedText, RowShell, Value } from './ChangeRow'
import type { ReactNode } from 'react'
import type { BoardDiff, DiffEntry } from '@/lib/schema-diff/types'
import type { DiffStatus } from '@/lib/schema-diff/describe'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  describeDiffEntry,
  hiddenLayoutCount,
  visibleDiff,
  visibleFields,
} from '@/lib/schema-diff/describe'
import { classifyQueryFailure } from '@/lib/auth/errors'
import { compareVersions } from '@/routes/api/history'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n/use-t'

export const CURRENT = 'current'

export interface CompareSnapshot {
  id: string
  createdAt: string | Date
}

interface VersionCompareProps {
  whiteboardId: string
  snapshots: Array<CompareSnapshot>
  /** Display name of a snapshot, for the pickers. */
  nameOf: (snapshot: CompareSnapshot) => string
  left: string
  right: string
  onChange: (sides: { left: string; right: string }) => void
  onBack: () => void
}

const time = (s: CompareSnapshot) => new Date(s.createdAt).getTime()

/**
 * Keep the older version on the left: when both sides are saved versions and
 * the left one is newer, swap them. The current board is always the newer side.
 */
export function orderSides(
  left: string,
  right: string,
  snapshots: Array<CompareSnapshot>,
): { left: string; right: string } {
  const l = snapshots.find((s) => s.id === left)
  const r = snapshots.find((s) => s.id === right)
  if (l && r && time(l) > time(r)) return { left: right, right: left }
  return { left, right }
}

function StatusIcon({ status }: { status: DiffStatus }) {
  const common = 'mt-0.5 size-4 shrink-0'
  if (status === 'added')
    return (
      <Plus className={cn(common, 'text-emerald-600 dark:text-emerald-400')} />
    )
  if (status === 'removed')
    return <Trash2 className={cn(common, 'text-red-600 dark:text-red-400')} />
  return <Pencil className={cn(common, 'text-muted-foreground')} />
}

function DiffDetails({
  entry,
  status,
  includeLayout,
}: {
  entry: DiffEntry
  status: DiffStatus
  includeLayout: boolean
}) {
  const rows = visibleFields(entry, includeLayout)
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
            {status !== 'added' && <Value value={row.before} tone="before" />}
            {status === 'changed' && (
              <ArrowRight
                className="size-3 text-muted-foreground"
                aria-hidden
              />
            )}
            {status !== 'removed' && <Value value={row.after} tone="after" />}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function DiffRow({
  entry,
  status,
  includeLayout,
}: {
  entry: DiffEntry
  status: DiffStatus
  includeLayout: boolean
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  return (
    <RowShell
      testId="compare-entry"
      icon={<StatusIcon status={status} />}
      sentence={
        <MarkedText text={describeDiffEntry(entry, status, includeLayout, t)} />
      }
      meta={null}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      toggleLabel={
        expanded
          ? t('whiteboard.history.changes.hideDetails')
          : t('whiteboard.history.changes.showDetails')
      }
    >
      {expanded && (
        <DiffDetails
          entry={entry}
          status={status}
          includeLayout={includeLayout}
        />
      )}
    </RowShell>
  )
}

function Section({
  status,
  entries,
  includeLayout,
}: {
  status: DiffStatus
  entries: Array<DiffEntry>
  includeLayout: boolean
}) {
  const t = useT()
  if (entries.length === 0) return null
  return (
    <section data-testid={`compare-${status}`} className="space-y-2">
      <h3 className="text-sm font-medium">
        {t(`whiteboard.history.compare.${status}`, { count: entries.length })}
      </h3>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={`${entry.entityType}:${entry.entityId}`}>
            <DiffRow
              entry={entry}
              status={status}
              includeLayout={includeLayout}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function Result({
  diff,
  includeLayout,
}: {
  diff: BoardDiff
  includeLayout: boolean
}) {
  const t = useT()
  const shown = visibleDiff(diff, includeLayout)
  const empty =
    shown.added.length + shown.removed.length + shown.changed.length === 0
  if (empty) {
    return (
      <p className="text-sm text-muted-foreground">
        {hiddenLayoutCount(diff) > 0
          ? t('whiteboard.history.compare.layoutOnly')
          : t('whiteboard.history.compare.identical')}
      </p>
    )
  }
  return (
    <div
      className="space-y-4"
      aria-label={t('whiteboard.history.compare.list')}
      role="region"
    >
      <Section
        status="added"
        entries={shown.added}
        includeLayout={includeLayout}
      />
      <Section
        status="removed"
        entries={shown.removed}
        includeLayout={includeLayout}
      />
      <Section
        status="changed"
        entries={shown.changed}
        includeLayout={includeLayout}
      />
    </div>
  )
}

function SidePicker({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  const t = useT()
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue
            placeholder={t('whiteboard.history.compare.pickVersion')}
          />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  )
}

export function VersionCompare({
  whiteboardId,
  snapshots,
  nameOf,
  left,
  right,
  onChange,
  onBack,
}: VersionCompareProps) {
  const t = useT()
  const [includeLayout, setIncludeLayout] = useState(false)
  const sameVersion = left === right
  const ready = left !== '' && right !== '' && !sameVersion

  const result = useQuery({
    queryKey: ['version-compare', whiteboardId, left, right],
    queryFn: () =>
      compareVersions({
        data: { whiteboardId, leftSnapshotId: left, rightSnapshotId: right },
      }),
    enabled: ready,
    refetchOnMount: 'always',
  })

  const choose = (next: { left: string; right: string }) =>
    onChange(orderSides(next.left, next.right, snapshots))

  const failure = result.isError
    ? classifyQueryFailure({ error: result.error }) === 'forbidden'
      ? t('whiteboard.history.compare.noAccess')
      : t('whiteboard.history.compare.loadFailed')
    : result.data && 'error' in result.data
      ? t('whiteboard.history.compare.notFound')
      : null

  return (
    <div className="space-y-4" data-testid="version-compare">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t('whiteboard.history.compare.back')}
        </Button>
      </div>
      <h3 className="text-sm font-medium">
        {t('whiteboard.history.compare.heading')}
      </h3>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SidePicker
          id="compare-older"
          label={t('whiteboard.history.compare.older')}
          value={left}
          onChange={(value) => choose({ left: value, right })}
        >
          {snapshots.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {nameOf(s)}
            </SelectItem>
          ))}
        </SidePicker>
        <SidePicker
          id="compare-newer"
          label={t('whiteboard.history.compare.newer')}
          value={right}
          onChange={(value) => choose({ left, right: value })}
        >
          <SelectItem value={CURRENT}>
            {t('whiteboard.history.compare.currentBoard')}
          </SelectItem>
          {snapshots.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {nameOf(s)}
            </SelectItem>
          ))}
        </SidePicker>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="compare-layout"
          checked={includeLayout}
          onCheckedChange={setIncludeLayout}
        />
        <Label htmlFor="compare-layout" className="text-sm font-normal">
          {t('whiteboard.history.changes.showLayout')}
        </Label>
      </div>

      {sameVersion ? (
        <p className="text-sm text-muted-foreground">
          {t('whiteboard.history.compare.sameVersion')}
        </p>
      ) : !ready ? null : result.isPending ? (
        <p className="text-sm text-muted-foreground">
          {t('whiteboard.history.compare.loading')}
        </p>
      ) : failure ? (
        <p className="text-sm text-destructive">{failure}</p>
      ) : result.data && 'diff' in result.data && result.data.diff ? (
        <Result diff={result.data.diff} includeLayout={includeLayout} />
      ) : null}
    </div>
  )
}
