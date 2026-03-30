/**
 * AddColumnRow — "+" button that expands to inline column creation form
 * Auto-focuses name input, Enter/blur creates, Escape discards
 * Default dataType: "string"
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Column } from '@prisma/client'
import type { DataType } from '@/data/schema'
import { DataTypeSelector } from './DataTypeSelector'

export interface AddColumnRowProps {
  tableId: string
  existingColumns: Array<Column>
  onCreate: (data: { name: string; dataType: DataType; order: number }) => Promise<void>
}

export function AddColumnRow({ tableId: _tableId, existingColumns, onCreate }: AddColumnRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [name, setName] = useState('')
  const [dataType, setDataType] = useState<DataType>('string')
  const [isSelectingType, setIsSelectingType] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)

  // Auto-focus when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isExpanded])

  const reset = useCallback(() => {
    setName('')
    setDataType('string')
    setIsExpanded(false)
    setIsSelectingType(false)
    cancelledRef.current = false
  }, [])

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      reset()
      return
    }

    const nextOrder =
      existingColumns.length > 0
        ? Math.max(...existingColumns.map((c) => c.order)) + 1
        : 0

    await onCreate({ name: trimmed, dataType, order: nextOrder })

    // Reset for rapid entry (PRD REQ-09 AC-09b)
    setName('')
    setDataType('string')
    setIsSelectingType(false)
    // Keep expanded for rapid entry — user can Escape to close
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [name, dataType, existingColumns, onCreate, reset])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        cancelledRef.current = false
        handleCreate()
      } else if (e.key === 'Escape') {
        cancelledRef.current = true
        reset()
      } else if (e.key === 'Tab') {
        // Tab moves to data type selector
        e.preventDefault()
        setIsSelectingType(true)
      }
    },
    [handleCreate, reset],
  )

  const handleBlur = useCallback(() => {
    if (!cancelledRef.current && !isSelectingType) {
      handleCreate()
    }
  }, [handleCreate, isSelectingType])

  const handlePlusClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsExpanded(true)
  }, [])

  if (!isExpanded) {
    return (
      <div
        style={{
          padding: '4px 16px',
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
            fontSize: '18px',
            lineHeight: 1,
            padding: '0 2px',
            transition: 'opacity 0.1s',
            width: '100%',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.5'
          }}
        >
          +
        </button>
      </div>
    )
  }

  return (
    <div
      className="nodrag nowheel"
      style={{
        padding: '4px 8px',
        borderTop: '1px solid var(--rf-table-border)',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'var(--rf-column-edit-bg, rgba(99,102,241,0.05))',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isSelectingType ? (
        <DataTypeSelector
          value={dataType}
          onSelect={(dt) => {
            setDataType(dt)
            setIsSelectingType(false)
            // Focus back on name input after type selection
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          onCancel={() => {
            setIsSelectingType(false)
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
        />
      ) : (
        <>
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
            onClick={(e) => {
              e.stopPropagation()
              setIsSelectingType(true)
            }}
            className="nodrag nowheel"
            style={{
              fontSize: '10px',
              padding: '2px 4px',
              border: '1px solid var(--rf-table-border)',
              borderRadius: '3px',
              background: 'transparent',
              color: 'var(--rf-table-text)',
              cursor: 'pointer',
              flexShrink: 0,
              opacity: 0.7,
            }}
          >
            {dataType}
          </button>
        </>
      )}
    </div>
  )
}
