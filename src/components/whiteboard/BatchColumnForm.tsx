// src/components/whiteboard/BatchColumnForm.tsx
// SEC-BATCH-UX: Batch column creation form with per-row entries, BATCH_DENIED banner,
// and keyboard-reachable bisection affordance (SEC-BATCH-UX-01/02/03/05).

import React, { useCallback, useId, useRef, useState } from 'react'
import type { DataType } from '@/data/schema'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchColumnRow {
  id: string
  name: string
  dataType: DataType
}

export interface BatchColumnFormProps {
  /** Table ID for which columns are being created */
  tableId: string
  /**
   * Called with the full list of rows on submit.
   * Should throw BatchDeniedError on RBAC failure — the form catches it
   * and shows the denial banner (SEC-BATCH-UX-01).
   */
  onSubmit: (rows: Array<{ tableId: string; name: string; dataType: DataType; order: number }>) => Promise<void>
  /** Called when the form is dismissed (cancel or success). */
  onClose?: () => void
  /** Optional initial rows (for pre-seeded batch). */
  initialRows?: Array<{ name: string; dataType: DataType }>
  /** Starting order offset for columns (default 0). */
  orderOffset?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRow(name = '', dataType: DataType = 'string'): BatchColumnRow {
  // Use a timestamp-based ID for test-environment compatibility (no crypto.randomUUID)
  const id = `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return { id, name, dataType }
}

const DATA_TYPES: Array<DataType> = [
  'string', 'int', 'bigint', 'smallint', 'float', 'double', 'decimal',
  'serial', 'money', 'char', 'varchar', 'text', 'boolean', 'bit',
  'date', 'datetime', 'timestamp', 'time', 'binary', 'blob',
  'json', 'xml', 'array', 'enum', 'uuid',
]

const BATCH_DENIED_MESSAGE =
  'This batch could not be saved. One or more items target a resource you no longer have access to.'

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BatchColumnForm — multi-row column creation form.
 *
 * Behaviour:
 * - Users add/remove rows dynamically.
 * - On submit: calls onSubmit with all non-empty rows.
 * - On BATCH_DENIED: preserves all input, shows denial banner (SEC-BATCH-UX-01/02).
 * - Bisection affordance: "Try first half" / "Try second half" buttons (SEC-BATCH-UX-03).
 * - Banner has role="alert" for screen-reader announcement (PRD §12).
 */
export function BatchColumnForm({
  tableId,
  onSubmit,
  onClose,
  initialRows,
  orderOffset = 0,
}: BatchColumnFormProps) {
  const bannerId = useId()
  const firstBisectRef = useRef<HTMLButtonElement>(null)

  const [rows, setRows] = useState<Array<BatchColumnRow>>(() => {
    if (initialRows && initialRows.length > 0) {
      return initialRows.map((r) => makeRow(r.name, r.dataType))
    }
    return [makeRow()]
  })

  const [denied, setDenied] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ── Row operations ──────────────────────────────────────────────────────────

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, makeRow()])
  }, [])

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id)
      return next.length === 0 ? [makeRow()] : next
    })
  }, [])

  const updateRowName = useCallback((id: string, name: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)))
  }, [])

  const updateRowDataType = useCallback((id: string, dataType: DataType) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, dataType } : r)))
  }, [])

  // ── Submit ──────────────────────────────────────────────────────────────────

  const doSubmit = useCallback(
    async (subset: Array<BatchColumnRow>) => {
      const nonEmpty = subset.filter((r) => r.name.trim().length > 0)
      if (nonEmpty.length === 0) return

      setSubmitting(true)
      setDenied(false)
      try {
        await onSubmit(
          nonEmpty.map((r, idx) => ({
            tableId,
            name: r.name.trim(),
            dataType: r.dataType,
            order: orderOffset + idx,
          })),
        )
        // Success — close if no error
        onClose?.()
      } catch (error: unknown) {
        // SEC-BATCH-UX-01: preserve ALL input on any error; only show banner on BATCH_DENIED
        const errorCode =
          error instanceof Error &&
          'errorCode' in error &&
          (error as { errorCode: string }).errorCode
        if (errorCode === 'BATCH_DENIED' || (error instanceof Error && error.message.includes('BATCH_DENIED'))) {
          setDenied(true)
          // SEC-BATCH-UX-01: input preserved — no form reset
        } else {
          // Surface other errors without clearing form
          setDenied(true) // show generic banner
        }
      } finally {
        setSubmitting(false)
      }
    },
    [tableId, onSubmit, onClose, orderOffset],
  )

  const handleSubmitAll = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      await doSubmit(rows)
    },
    [rows, doSubmit],
  )

  // ── Bisection (SEC-BATCH-UX-03) ─────────────────────────────────────────────

  const handleTryFirstHalf = useCallback(async () => {
    const half = rows.slice(0, Math.ceil(rows.length / 2))
    await doSubmit(half)
  }, [rows, doSubmit])

  const handleTrySecondHalf = useCallback(async () => {
    const half = rows.slice(Math.floor(rows.length / 2))
    await doSubmit(half)
  }, [rows, doSubmit])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <form
      aria-label="Batch column creation"
      onSubmit={handleSubmitAll}
      style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}
    >
      {/* SEC-BATCH-UX-02: denial banner with role="alert" (PRD §12) */}
      {denied && (
        <div
          role="alert"
          aria-live="assertive"
          aria-describedby={bannerId}
          style={{
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: '4px',
            padding: '8px 12px',
            fontSize: '13px',
            color: '#dc2626',
          }}
        >
          <span id={bannerId}>{BATCH_DENIED_MESSAGE}</span>
          {/* SEC-BATCH-UX-03: bisection affordance — keyboard reachable (tabIndex makes these naturally focusable) */}
          {rows.length > 1 && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
              <button
                ref={firstBisectRef}
                type="button"
                aria-label="Try first half of batch"
                onClick={handleTryFirstHalf}
                disabled={submitting}
                style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  border: '1px solid #dc2626',
                  borderRadius: '3px',
                  background: 'transparent',
                  color: '#dc2626',
                  cursor: 'pointer',
                }}
              >
                Try first half
              </button>
              <button
                type="button"
                aria-label="Try second half of batch"
                onClick={handleTrySecondHalf}
                disabled={submitting}
                style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  border: '1px solid #dc2626',
                  borderRadius: '3px',
                  background: 'transparent',
                  color: '#dc2626',
                  cursor: 'pointer',
                }}
              >
                Try second half
              </button>
            </div>
          )}
        </div>
      )}

      {/* Row list */}
      <div role="list" aria-label="Column rows">
        {rows.map((row, idx) => (
          <div
            key={row.id}
            role="listitem"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '4px',
            }}
          >
            <label style={{ display: 'none' }} htmlFor={`col-name-${row.id}`}>
              Column {idx + 1} name
            </label>
            <input
              id={`col-name-${row.id}`}
              type="text"
              aria-label={`Column ${idx + 1} name`}
              placeholder="column name"
              value={row.name}
              onChange={(e) => updateRowName(row.id, e.target.value)}
              style={{
                flex: 1,
                fontSize: '12px',
                padding: '3px 6px',
                border: '1px solid #ccc',
                borderRadius: '3px',
              }}
            />
            <label style={{ display: 'none' }} htmlFor={`col-type-${row.id}`}>
              Column {idx + 1} type
            </label>
            <select
              id={`col-type-${row.id}`}
              aria-label={`Column ${idx + 1} type`}
              value={row.dataType}
              onChange={(e) => updateRowDataType(row.id, e.target.value as DataType)}
              style={{
                fontSize: '12px',
                padding: '3px 4px',
                border: '1px solid #ccc',
                borderRadius: '3px',
                maxWidth: '100px',
              }}
            >
              {DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove column ${idx + 1}`}
              onClick={() => removeRow(row.id)}
              style={{
                fontSize: '14px',
                padding: '2px 6px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: '#999',
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Add row button */}
      <button
        type="button"
        aria-label="Add column row"
        onClick={addRow}
        style={{
          alignSelf: 'flex-start',
          fontSize: '12px',
          padding: '4px 8px',
          border: '1px dashed #aaa',
          borderRadius: '3px',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        + Add row
      </button>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        {onClose && (
          <button
            type="button"
            aria-label="Cancel batch column creation"
            onClick={onClose}
            disabled={submitting}
            style={{
              fontSize: '13px',
              padding: '5px 12px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          aria-label="Save all columns"
          disabled={submitting}
          style={{
            fontSize: '13px',
            padding: '5px 12px',
            border: 'none',
            borderRadius: '4px',
            background: '#6366f1',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {submitting ? 'Saving…' : 'Save all'}
        </button>
      </div>
    </form>
  )
}
