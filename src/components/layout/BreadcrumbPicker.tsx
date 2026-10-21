// src/components/layout/BreadcrumbPicker.tsx
// One breadcrumb ancestor as a button; opens a popover that lists the folders
// and boards under that path, with drill-down, filter and quick navigation

import { useMemo, useState } from 'react'
import { ArrowUpLeft, Check, ChevronRight, ExternalLink } from 'lucide-react'
import {
  filterEntries,
  listChildren,
  locationName,
  parentFolderOf,
} from './board-tree'
import { EntryIcon } from './entry-icon'
import { useOpenEntry, useOpenProject } from './use-tree-navigation'
import type { PathSegment, TreeProject } from './board-tree'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface BreadcrumbPickerProps {
  segment: PathSegment
  projects: ReadonlyArray<TreeProject> | undefined
  /** Board shown in the chip; marked in its parent folder's list. */
  currentBoardId: string
  className?: string
}

export function BreadcrumbPicker({
  segment,
  projects,
  currentBoardId,
  className,
}: BreadcrumbPickerProps) {
  const [open, setOpen] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(segment.folderId)
  const [query, setQuery] = useState('')
  const openEntry = useOpenEntry()
  const openProject = useOpenProject()

  const { projectId } = segment
  const rows = useMemo(
    () => filterEntries(listChildren(projects, projectId, folderId), query),
    [projects, projectId, folderId, query],
  )
  const hasChildren = useMemo(
    () => listChildren(projects, projectId, folderId).length > 0,
    [projects, projectId, folderId],
  )
  const here = locationName(projects, projectId, folderId) || segment.name
  const parent =
    folderId === null
      ? undefined
      : parentFolderOf(projects, projectId, folderId)
  const parentName =
    parent === undefined ? '' : locationName(projects, projectId, parent)

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setFolderId(segment.folderId)
      setQuery('')
    }
    setOpen(next)
  }

  const drillTo = (next: string | null) => {
    setFolderId(next)
    setQuery('')
  }

  const openHere = () => {
    setOpen(false)
    if (folderId === null) void openProject(projectId)
    else void openEntry({ type: 'folder', id: folderId, projectId })
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'max-w-32 truncate rounded px-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          aria-label={`Browse ${segment.name}`}
          aria-haspopup="dialog"
          data-testid="breadcrumb-segment"
        >
          {segment.name}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        aria-label={`Contents of ${here}`}
        data-testid="breadcrumb-picker"
      >
        <Command shouldFilter={false} label={`Contents of ${here}`}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={`Filter in ${here}...`}
            aria-label={`Filter contents of ${here}`}
          />
          <CommandList>
            {/* Hidden while filtering so Enter opens the first match. */}
            {!query && (
              <CommandGroup>
                {parent !== undefined && (
                  <CommandItem
                    value="__up"
                    onSelect={() => drillTo(parent)}
                    aria-label={`Back to ${parentName}`}
                  >
                    <ArrowUpLeft aria-hidden="true" />
                    <span className="truncate">Back to {parentName}</span>
                  </CommandItem>
                )}
                <CommandItem value="__open" onSelect={openHere}>
                  <ExternalLink aria-hidden="true" />
                  <span className="truncate">
                    Open {folderId === null ? 'project' : 'folder'} page
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {rows.map((entry) => (
                <CommandItem
                  key={`${entry.type}-${entry.id}`}
                  value={`${entry.type}-${entry.id}`}
                  onSelect={() => {
                    if (entry.type === 'folder') {
                      drillTo(entry.id)
                      return
                    }
                    setOpen(false)
                    void openEntry(entry)
                  }}
                  aria-current={
                    entry.id === currentBoardId ? 'page' : undefined
                  }
                  data-entry-name={entry.name}
                >
                  <EntryIcon type={entry.type} />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {entry.id === currentBoardId && (
                    <Check aria-label="Current board" className="size-4" />
                  )}
                  {entry.type === 'folder' && (
                    <ChevronRight aria-hidden="true" className="size-4" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {rows.length === 0 && (
              <p
                role="status"
                className="py-4 text-center text-sm text-muted-foreground"
              >
                {hasChildren ? 'No matches' : 'This folder is empty'}
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
