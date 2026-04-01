/**
 * DataTypeSelector — searchable combobox for selecting column data types
 * Auto-opens on mount, selection commits immediately, Escape/click-outside cancels
 *
 * Uses shadcn Popover + Command (combobox pattern) to support filtering
 * across all 25 data types. Types are grouped by category.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DATA_TYPES, DATA_TYPE_LABELS } from './types'
import type { DataType } from '@/data/schema'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

export interface DataTypeSelectorProps {
  value: DataType
  onSelect: (dataType: DataType) => void
  onCancel: () => void
}

/**
 * Data types grouped by category for display in the combobox.
 * Each group has a heading label and an array of DataType values.
 */
const DATA_TYPE_GROUPS: Array<{ heading: string; types: DataType[] }> = [
  {
    heading: 'Numeric',
    types: ['int', 'bigint', 'smallint', 'float', 'double', 'decimal', 'serial', 'money'],
  },
  {
    heading: 'String',
    types: ['string', 'char', 'varchar', 'text'],
  },
  {
    heading: 'Boolean',
    types: ['boolean', 'bit'],
  },
  {
    heading: 'Date / Time',
    types: ['date', 'datetime', 'timestamp', 'time'],
  },
  {
    heading: 'Binary',
    types: ['binary', 'blob'],
  },
  {
    heading: 'Structured',
    types: ['json', 'xml', 'array', 'enum'],
  },
  {
    heading: 'Identity',
    types: ['uuid'],
  },
]

export function DataTypeSelector({
  value,
  onSelect,
  onCancel,
}: DataTypeSelectorProps) {
  const [open, setOpen] = useState(false)
  // Track whether a selection was made so we can distinguish close-via-select
  // from close-via-cancel (Escape or click outside)
  const selectionMadeRef = useRef(false)

  // Auto-open on mount
  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), 0)
    return () => clearTimeout(timer)
  }, [])

  const handleSelect = useCallback(
    (selectedValue: string) => {
      selectionMadeRef.current = true
      setOpen(false)
      onSelect(selectedValue as DataType)
    },
    [onSelect],
  )

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen)
      if (!isOpen && !selectionMadeRef.current) {
        // Closed without a selection (Escape or click outside) — cancel
        onCancel()
      }
      if (!isOpen) {
        selectionMadeRef.current = false
      }
    },
    [onCancel],
  )

  const currentLabel = DATA_TYPE_LABELS[value]

  return (
    <div
      className="nodrag nowheel"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ flexShrink: 0 }}
    >
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className="nodrag nowheel"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: '22px',
              fontSize: '11px',
              padding: '0 6px',
              minWidth: '80px',
              border: '1px solid var(--rf-edge-stroke-selected, #6366f1)',
              borderRadius: '3px',
              background: 'var(--rf-column-edit-bg, rgba(99,102,241,0.1))',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            type="button"
            role="combobox"
            aria-expanded={open}
          >
            {currentLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="nodrag nowheel p-0"
          style={{ width: '180px' }}
          align="start"
          sideOffset={2}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={() => handleOpenChange(false)}
          onEscapeKeyDown={() => handleOpenChange(false)}
        >
          <Command>
            <CommandInput
              placeholder="Search types..."
              className="h-8 text-xs"
            />
            <CommandList>
              <CommandEmpty>No type found.</CommandEmpty>
              {DATA_TYPE_GROUPS.map((group) => (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.types.map((dt) => (
                    <CommandItem
                      key={dt}
                      value={`${DATA_TYPE_LABELS[dt]} ${dt}`}
                      onSelect={() => handleSelect(dt)}
                      data-selected={dt === value}
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                    >
                      {DATA_TYPE_LABELS[dt]}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
