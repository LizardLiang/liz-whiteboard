// src/components/whiteboard/WhiteboardChangesTab.tsx
// The "Changes" tab of the history panel: the change log of one whiteboard
// with table / person / date / text filters, a layout switch, batch rows and
// "Load more" paging. Reads through src/routes/api/schema-changes.ts.

import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, RefreshCw, X } from 'lucide-react'
import { BatchRow, EventRow } from './ChangeRow'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { classifyQueryFailure } from '@/lib/auth/errors'
import {
  listChangeLogFacets,
  listSchemaChanges,
} from '@/routes/api/schema-changes'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n/use-t'

/** Ask the tab to filter on a table (the table menu's "View history"). */
export interface TableHistoryRequest {
  tableName: string
  /** Changes on each request, so asking for the same table twice still applies. */
  seq: number
}

interface WhiteboardChangesTabProps {
  whiteboardId: string
  request: TableHistoryRequest | null
}

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300
const ALL = 'all'
const AGENT = 'agent'

/** Start of the local day of a `YYYY-MM-DD` input value, as epoch ms. */
function dayStart(value: string): number | undefined {
  if (!value) return undefined
  const ms = new Date(`${value}T00:00:00`).getTime()
  return Number.isNaN(ms) ? undefined : ms
}

/** End of the local day of a `YYYY-MM-DD` input value, as epoch ms. */
function dayEnd(value: string): number | undefined {
  if (!value) return undefined
  const ms = new Date(`${value}T23:59:59.999`).getTime()
  return Number.isNaN(ms) ? undefined : ms
}

export function WhiteboardChangesTab({
  whiteboardId,
  request,
}: WhiteboardChangesTabProps) {
  const t = useT()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [tableName, setTableName] = useState<string | null>(
    request?.tableName ?? null,
  )
  const [person, setPerson] = useState(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [includeLayout, setIncludeLayout] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(search.trim()),
      SEARCH_DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (request) setTableName(request.tableName)
  }, [request])

  const facets = useQuery({
    queryKey: ['schema-change-facets', whiteboardId],
    queryFn: async () => {
      const result = await listChangeLogFacets({ data: { whiteboardId } })
      if ('error' in result) throw new Error(result.error)
      return result
    },
    refetchOnMount: 'always',
  })

  const filters = useMemo(
    () => ({
      tableName: tableName ?? undefined,
      actorUserId: person !== ALL && person !== AGENT ? person : undefined,
      viaAgent: person === AGENT ? true : undefined,
      from: dayStart(from),
      to: dayEnd(to),
      q: debouncedSearch || undefined,
      includeLayout,
    }),
    [tableName, person, from, to, debouncedSearch, includeLayout],
  )

  const list = useInfiniteQuery({
    queryKey: ['schema-changes', whiteboardId, filters],
    queryFn: async ({ pageParam }) => {
      const result = await listSchemaChanges({
        data: { whiteboardId, cursor: pageParam, limit: PAGE_SIZE, ...filters },
      })
      if ('error' in result) throw new Error(result.error)
      return result
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnMount: 'always',
  })
  const items = list.data?.pages.flatMap((page) => page.items) ?? []

  const filtered =
    tableName !== null ||
    person !== ALL ||
    from !== '' ||
    to !== '' ||
    search !== ''
  const clearFilters = () => {
    setTableName(null)
    setPerson(ALL)
    setFrom('')
    setTo('')
    setSearch('')
  }

  const tableOptions = useMemo(() => {
    const names = facets.data?.tables ?? []
    return tableName !== null && !names.includes(tableName)
      ? [tableName, ...names]
      : names
  }, [facets.data, tableName])

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('whiteboard.history.changes.searchPlaceholder')}
            aria-label={t('whiteboard.history.changes.searchAria')}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label={t('whiteboard.history.changes.refresh')}
            onClick={() => {
              void facets.refetch()
              void list.refetch()
            }}
          >
            <RefreshCw
              className={cn('size-4', list.isFetching && 'animate-spin')}
            />
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Popover open={tableOpen} onOpenChange={setTableOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={tableOpen}
                aria-label={t('whiteboard.history.changes.tableAria')}
                className="w-full justify-between gap-2 font-normal"
              >
                <span className="truncate">
                  {tableName ?? t('whiteboard.history.changes.tableAll')}
                </span>
                <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
              <Command>
                <CommandInput
                  placeholder={t('whiteboard.history.changes.tableSearch')}
                />
                <CommandList>
                  <CommandEmpty>
                    {t('whiteboard.history.changes.tableNone')}
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value={`__all__ ${t('whiteboard.history.changes.tableAll')}`}
                      onSelect={() => {
                        setTableName(null)
                        setTableOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 size-4',
                          tableName === null ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      {t('whiteboard.history.changes.tableAll')}
                    </CommandItem>
                    {tableOptions.map((name) => (
                      <CommandItem
                        key={name}
                        value={name}
                        onSelect={() => {
                          setTableName(name)
                          setTableOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 size-4 shrink-0',
                            tableName === name ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="[overflow-wrap:anywhere]">{name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Select value={person} onValueChange={setPerson}>
            <SelectTrigger
              className="w-full"
              aria-label={t('whiteboard.history.changes.personAria')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('whiteboard.history.changes.personAll')}
              </SelectItem>
              {facets.data?.hasAgentEdits && (
                <SelectItem value={AGENT}>
                  {t('whiteboard.history.changes.personAgent')}
                </SelectItem>
              )}
              {facets.data?.actors.map((actor) => (
                <SelectItem key={actor.userId} value={actor.userId}>
                  {actor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0 space-y-1">
            <Label
              htmlFor="changes-from"
              className="text-xs text-muted-foreground"
            >
              {t('whiteboard.history.changes.fromAria')}
            </Label>
            <Input
              id="changes-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label
              htmlFor="changes-to"
              className="text-xs text-muted-foreground"
            >
              {t('whiteboard.history.changes.toAria')}
            </Label>
            <Input
              id="changes-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Switch
              id="changes-layout"
              checked={includeLayout}
              onCheckedChange={setIncludeLayout}
            />
            <Label htmlFor="changes-layout" className="text-sm font-normal">
              {t('whiteboard.history.changes.showLayout')}
            </Label>
          </div>
          {filtered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearFilters}
            >
              <X className="size-4" />
              {t('whiteboard.history.changes.clear')}
            </Button>
          )}
        </div>
      </div>

      {list.isPending ? (
        <p className="text-sm text-muted-foreground">
          {t('whiteboard.history.changes.loading')}
        </p>
      ) : list.isError ? (
        <p className="text-sm text-destructive">
          {classifyQueryFailure({ error: list.error }) === 'forbidden'
            ? t('whiteboard.history.changes.noAccess')
            : t('whiteboard.history.changes.loadFailed')}
        </p>
      ) : (
        <ul
          className="space-y-2"
          aria-label={t('whiteboard.history.changes.list')}
        >
          {items.map((item) => (
            <li
              key={
                item.kind === 'event'
                  ? item.event.id
                  : `b:${item.batch.batchId}`
              }
            >
              {item.kind === 'event' ? (
                <EventRow event={item.event} />
              ) : (
                <BatchRow
                  whiteboardId={whiteboardId}
                  batch={item.batch}
                  tableName={filters.tableName}
                  includeLayout={includeLayout}
                />
              )}
            </li>
          ))}
          {items.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">
              {filtered
                ? t('whiteboard.history.changes.emptyFiltered')
                : t('whiteboard.history.changes.empty')}
            </li>
          )}
        </ul>
      )}

      {list.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage
            ? t('whiteboard.history.changes.loadingMore')
            : t('whiteboard.history.changes.loadMore')}
        </Button>
      )}
    </div>
  )
}
