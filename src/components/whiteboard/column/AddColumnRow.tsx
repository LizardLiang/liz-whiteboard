/**
 * AddColumnRow — "+" button that expands to inline column creation form
 * Auto-focuses name input, Enter/blur creates, Escape discards
 * Default dataType: "string"
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Column } from '@prisma/client'
import type { DataType } from '@/data/schema'
import { DATA_TYPES, DATA_TYPE_LABELS } from './types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface AddColumnRowProps {
  tableId: string
  existingColumns: Array<Column>
  onCreate: (data: { name: string; dataType: DataType; order: number }) => Promise<void>
}

export function AddColumnRow({ tableId, existingColumns, onCreate }: AddColumnRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [name, setName] = useState('')
  const [dataType, setDataType] = useState<DataType>('string')
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const cancelledRef = useRef(false)
  // Tracks whether pointer went down inside this row — guards against spurious blur-create
  // when clicking the Radix Select trigger (pointerdown fires before blur)
  const mouseDownInsideRef = useRef(false)

  // Auto-focus when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isExpanded])

  // Canvas clicks don't blur focused inputs (canvas is non-focusable).
  // Document-level pointerdown listener closes the row when clicking outside.
  useEffect(() => {
    if (!isExpanded) {
      return
    }

    const handleOutside = (e: PointerEvent) => {
      const target = e.target as Element

      // Click was inside this row
      if (rowRef.current?.contains(target as Node)) {
        return
      }
      // Click was inside a Radix portal (SelectContent dropdown)
      if (target.closest?.('[data-radix-popper-content-wrapper]')) {
        return
      }
      // Click was inside a Radix ContextMenu trigger wrapper
      if (target.closest?.('[data-radix-context-menu-trigger]')) {
        const contextMenuTrigger = target.closest('[data-radix-context-menu-trigger]')
        if (contextMenuTrigger?.contains(rowRef.current as Node)) {
          return
        }
      }
      // Programmatically blur the input — handleBlur will call handleCreate/reset
      inputRef.current?.blur()
    }

    // Capture phase so stopPropagation in ReactFlow layers doesn't block us
    document.addEventListener('pointerdown', handleOutside, true)
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true)
    }
  }, [isExpanded])

  const reset = useCallback(() => {
    setName('')
    setDataType('string')
    setIsExpanded(false)
    cancelledRef.current = false
  }, [name, dataType, isExpanded])

  const handleCreate = useCallback(async (closeAfterSave = false) => {
    const trimmed = name.trim()
    if (!trimmed) {
      reset()
      return
    }

    const nextOrder =
      existingColumns.length > 0
        ? Math.max(...existingColumns.map((c) => c.order)) + 1
        : 0

    try {
      await onCreate({ name: trimmed, dataType, order: nextOrder })
    } catch (error) {
      console.error('Failed to create column:', error)
      return
    }

    if (closeAfterSave) {
      reset()
    } else {
      // Reset for rapid entry (Enter key)
      setName('')
      setDataType('string')
      if (inputRef.current) {
        inputRef.current.focus()
      }
    }
  }, [name, dataType, existingColumns, onCreate, reset, tableId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        cancelledRef.current = false
        handleCreate()
      } else if (e.key === 'Escape') {
        cancelledRef.current = true
        reset()
      }
    },
    [handleCreate, reset],
  )

  const handleBlur = useCallback(() => {
    // Skip if the user clicked elsewhere inside this row (e.g. type select).
    // mouseDownInsideRef is set on pointerdown (not mousedown) because Radix UI
    // uses pointerdown internally — which fires before blur.
    if (!cancelledRef.current && !mouseDownInsideRef.current) {
      handleCreate(true) // close after blur-triggered save
    }
    mouseDownInsideRef.current = false
  }, [handleCreate])

  const handlePlusClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsExpanded(true)
  }, [])

  if (!isExpanded) {
    return (
      <div
        style={{
          padding: '2px 8px 4px',
          borderTop: '1px solid var(--rf-table-border)',
        }}
      >
        <button
          type="button"
          aria-label="Add new column"
          onClick={handlePlusClick}
          className="nodrag nowheel"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--rf-table-text)',
            opacity: 0.5,
            fontSize: '16px',
            lineHeight: 1,
            padding: '4px 8px',
            transition: 'opacity 0.1s',
            width: '100%',
            textAlign: 'left',
            display: 'block',
            borderRadius: '4px',
          }}
          onMouseEnter={(e) => {
            const btn = e.currentTarget as HTMLButtonElement
            btn.style.opacity = '1'
            btn.style.background = 'var(--rf-column-edit-bg, rgba(99,102,241,0.07))'
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget as HTMLButtonElement
            btn.style.opacity = '0.5'
            btn.style.background = 'none'
          }}
        >
          +
        </button>
      </div>
    )
  }

  return (
    <div
      ref={rowRef}
      className="nodrag nowheel"
      style={{
        padding: '4px 8px',
        borderTop: '1px solid var(--rf-table-border)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: 'var(--rf-column-edit-bg, rgba(99,102,241,0.05))',
        minHeight: '36px',
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation()
      }}
    >
      <input
        ref={inputRef}
        type="text"
        placeholder="column name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="nodrag nowheel"
        style={{
          flex: 1,
          fontSize: '12px',
          padding: '2px 4px',
          border: '1px solid var(--rf-edge-stroke-selected, #6366f1)',
          borderRadius: '3px',
          background: 'transparent',
          color: 'var(--rf-table-text)',
          outline: 'none',
          minWidth: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        aria-label="Save column"
        className="nodrag nowheel"
        onPointerDown={(e) => {
          e.stopPropagation()
          mouseDownInsideRef.current = true
        }}
        onClick={(e) => {
          e.stopPropagation()
          cancelledRef.current = false
          handleCreate(true)
        }}
        style={{
          background: 'var(--rf-edge-stroke-selected, #6366f1)',
          border: 'none',
          borderRadius: '3px',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '14px',
          lineHeight: 1,
          padding: '3px 6px',
          flexShrink: 0,
        }}
      >
        ✓
      </button>
      <Select
        value={dataType}
        onValueChange={(val) => {
          setDataType(val as DataType)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
      >
        <SelectTrigger
          className="nodrag nowheel h-[28px] min-w-[80px] text-[11px] px-2 border-border/50 cursor-pointer"
          aria-label={dataType}
          onPointerDown={() => {
            mouseDownInsideRef.current = true
          }}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="nodrag nowheel">
          {DATA_TYPES.map((dt) => (
            <SelectItem key={dt} value={dt} className="text-xs">
              {DATA_TYPE_LABELS[dt]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
