/**
 * DataTypeSelector — dropdown selector restricted to 8 valid Zod data types
 * Auto-opens on mount, selection commits immediately, Escape cancels
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DataType } from '@/data/schema'
import { DATA_TYPES, DATA_TYPE_LABELS } from './types'

export interface DataTypeSelectorProps {
  value: DataType
  onSelect: (dataType: DataType) => void
  onCancel: () => void
}

export function DataTypeSelector({
  value,
  onSelect,
  onCancel,
}: DataTypeSelectorProps) {
  const [open, setOpen] = useState(false)

  // Auto-open on mount
  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), 0)
    return () => clearTimeout(timer)
  }, [])

  const handleValueChange = useCallback(
    (newValue: string) => {
      onSelect(newValue as DataType)
    },
    [onSelect],
  )

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen)
      if (!isOpen) {
        // If closed without selection (Escape or click outside), cancel
        // The selection is committed immediately via onValueChange
        // so closing without a new value means cancel
        onCancel()
      }
    },
    [onCancel],
  )

  return (
    <div
      className="nodrag nowheel"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ flexShrink: 0 }}
    >
      <Select
        open={open}
        onOpenChange={handleOpenChange}
        value={value}
        onValueChange={handleValueChange}
      >
        <SelectTrigger
          className="nodrag nowheel"
          style={{
            height: '22px',
            fontSize: '11px',
            padding: '0 6px',
            minWidth: '80px',
            border: '1px solid var(--rf-edge-stroke-selected, #6366f1)',
            borderRadius: '3px',
            background: 'var(--rf-column-edit-bg, rgba(99,102,241,0.1))',
          }}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATA_TYPES.map((dt) => (
            <SelectItem key={dt} value={dt}>
              {DATA_TYPE_LABELS[dt]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
