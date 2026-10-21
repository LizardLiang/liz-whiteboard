// src/components/navigator/NavigatorSearch.tsx
// Search box for the navigator. While the query is non-empty its results
// replace `children` (the normal project tree).

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { buildSearchIndex, searchIndex } from '@/components/layout/board-tree'
import { EntryIcon } from '@/components/layout/entry-icon'
import {
  useOpenEntry,
  useProjectTree,
} from '@/components/layout/use-tree-navigation'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/** Marks the input so the drawer can leave Esc to "clear the query". */
export const NAVIGATOR_SEARCH_ATTR = 'data-navigator-search'

export function NavigatorSearch({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('')
  const projects = useProjectTree()
  const openEntry = useOpenEntry()

  const index = useMemo(() => buildSearchIndex(projects), [projects])
  const results = useMemo(() => searchIndex(index, query), [index, query])
  const searching = query.trim().length > 0

  return (
    <>
      <Command
        shouldFilter={false}
        label="Search boards and folders"
        className="h-auto overflow-visible bg-transparent"
      >
        <div className="sticky top-0 z-10 bg-background px-4 pb-2">
          <div className="rounded-md border">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search boards and folders..."
              aria-label="Search boards and folders"
              {...{ [NAVIGATOR_SEARCH_ATTR]: '' }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault()
                  event.stopPropagation()
                  setQuery('')
                }
              }}
            />
          </div>
        </div>
        {searching ? (
          <CommandList
            className="max-h-none px-4 pb-4"
            aria-label="Search results"
          >
            {results.length === 0 ? (
              <p
                role="status"
                className="py-6 text-center text-sm text-muted-foreground"
              >
                No boards or folders match "{query.trim()}"
              </p>
            ) : (
              <CommandGroup className="p-0">
                {results.map((entry) => (
                  <CommandItem
                    key={`${entry.type}-${entry.id}`}
                    value={`${entry.type}-${entry.id}`}
                    onSelect={() => {
                      setQuery('')
                      void openEntry(entry)
                    }}
                    className="items-start"
                    data-entry-name={entry.name}
                  >
                    <span className="mt-0.5 flex">
                      <EntryIcon type={entry.type} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{entry.name}</span>
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        data-testid="search-result-path"
                      >
                        {entry.path.join(' / ')}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        ) : null}
      </Command>
      {!searching && <div className="px-4 pb-4">{children}</div>}
    </>
  )
}
