/**
 * ExternalTablePicker — choose what a cross-file reference points at
 * (LizMeter #83).
 *
 * Three dependent steps: file → table → column(s). Each step is a filterable
 * `Command` list rather than a plain `Select`, because a project with fifty
 * files of a hundred tables makes an unfiltered dropdown unusable.
 *
 * Used for both creating a reference (opened at the drop point) and
 * re-targeting an existing one. Re-targeting can delete relationship lines, so
 * the caller passes `pendingDeleteCount` and this component names the number
 * before the confirm button applies anything.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, KeyRound, Link2 } from 'lucide-react'

import type {
  ReferenceTargetFile,
  ReferenceTargetTable,
} from '@/data/table-reference'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface ExternalTablePickerSelection {
  sourceWhiteboardId: string
  sourceTableId: string
  sourceColumnIds: Array<string>
}

export interface ExternalTablePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Other files of this project, with their tables and columns. */
  targets: Array<ReferenceTargetFile>
  /** True while `targets` is still loading. */
  isLoading?: boolean
  /** Pre-selected values when re-targeting an existing reference. */
  initial?: Partial<ExternalTablePickerSelection>
  /**
   * How many relationship lines the caller will delete if this selection is
   * confirmed. Rendered as a warning; 0 hides it.
   */
  pendingDeleteCount?: number
  onConfirm: (selection: ExternalTablePickerSelection) => void
}

export function ExternalTablePicker({
  open,
  onOpenChange,
  targets,
  isLoading = false,
  initial,
  pendingDeleteCount = 0,
  onConfirm,
}: ExternalTablePickerProps) {
  const [fileId, setFileId] = useState<string | null>(
    initial?.sourceWhiteboardId ?? null,
  )
  const [tableId, setTableId] = useState<string | null>(
    initial?.sourceTableId ?? null,
  )
  const [columnIds, setColumnIds] = useState<Array<string>>(
    initial?.sourceColumnIds ?? [],
  )

  // Reset to the caller's starting point every time the dialog opens, so a
  // cancelled pick never leaks into the next one.
  useEffect(() => {
    if (!open) return
    setFileId(initial?.sourceWhiteboardId ?? null)
    setTableId(initial?.sourceTableId ?? null)
    setColumnIds(initial?.sourceColumnIds ?? [])
  }, [
    open,
    initial?.sourceWhiteboardId,
    initial?.sourceTableId,
    initial?.sourceColumnIds,
  ])

  const file = useMemo(
    () => targets.find((t) => t.whiteboardId === fileId) ?? null,
    [targets, fileId],
  )
  const table = useMemo<ReferenceTargetTable | null>(
    () => file?.tables.find((t) => t.id === tableId) ?? null,
    [file, tableId],
  )

  const step: 'file' | 'table' | 'column' = !file
    ? 'file'
    : !table
      ? 'table'
      : 'column'

  const toggleColumn = (id: string) => {
    setColumnIds((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    )
  }

  const goBack = () => {
    if (step === 'column') {
      setTableId(null)
      setColumnIds([])
      return
    }
    if (step === 'table') setFileId(null)
  }

  const canConfirm = Boolean(file && table && columnIds.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial?.sourceTableId
              ? 'Change referenced table'
              : 'Reference a table from another file'}
          </DialogTitle>
          <DialogDescription>
            {step === 'file'
              ? 'Pick the file the table lives in. Only files in this project are shown.'
              : step === 'table'
                ? `Pick the table in ${file?.whiteboardName}.`
                : `Pick the columns of ${table?.name} you want to connect to.`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : targets.length === 0 ? (
          // A single-file project has nothing to reference. Say why, rather
          // than showing an empty list that reads like a loading failure.
          <p className="py-6 text-center text-sm text-muted-foreground">
            This project has no other files yet. Create a second file to
            reference a table from it.
          </p>
        ) : (
          <Command className="rounded-md border">
            <CommandInput
              placeholder={
                step === 'file'
                  ? 'Search files…'
                  : step === 'table'
                    ? 'Search tables…'
                    : 'Search columns…'
              }
            />
            <CommandList>
              <CommandEmpty>Nothing matches.</CommandEmpty>

              {step === 'file' && (
                <CommandGroup heading="Files">
                  {targets.map((target) => (
                    <CommandItem
                      key={target.whiteboardId}
                      value={target.whiteboardName}
                      onSelect={() => setFileId(target.whiteboardId)}
                    >
                      <span>{target.whiteboardName}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {target.tables.length} table
                        {target.tables.length === 1 ? '' : 's'}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {step === 'table' && file && (
                <CommandGroup heading={file.whiteboardName}>
                  {file.tables.map((candidate) => (
                    <CommandItem
                      key={candidate.id}
                      value={candidate.name}
                      onSelect={() => setTableId(candidate.id)}
                    >
                      <span>{candidate.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {candidate.columns.length} column
                        {candidate.columns.length === 1 ? '' : 's'}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {step === 'column' && table && (
                <CommandGroup heading={table.name}>
                  {table.columns.map((column) => {
                    const picked = columnIds.includes(column.id)
                    return (
                      <CommandItem
                        key={column.id}
                        value={column.name}
                        onSelect={() => toggleColumn(column.id)}
                        data-picked={picked ? 'true' : 'false'}
                      >
                        <input
                          type="checkbox"
                          checked={picked}
                          readOnly
                          tabIndex={-1}
                          aria-label={`Use ${column.name}`}
                        />
                        {column.isPrimaryKey ? (
                          <KeyRound size={12} aria-label="Primary key" />
                        ) : column.isForeignKey ? (
                          <Link2 size={12} aria-label="Foreign key" />
                        ) : null}
                        <span>{column.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {column.dataType}
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        )}

        {pendingDeleteCount > 0 && step === 'column' && (
          <p className="text-sm text-destructive">
            This change deletes {pendingDeleteCount} relationship
            {pendingDeleteCount === 1 ? '' : 's'} drawn from this reference.
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={step === 'file'}
          >
            <ArrowLeft size={14} />
            Back
          </Button>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              if (!file || !table) return
              onConfirm({
                sourceWhiteboardId: file.whiteboardId,
                sourceTableId: table.id,
                sourceColumnIds: columnIds,
              })
            }}
          >
            {initial?.sourceTableId ? 'Change reference' : 'Add reference'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
