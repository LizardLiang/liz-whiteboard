// src/components/whiteboard/BatchColumnForm.tsx
// SEC-BATCH-UX: Batch column creation form with per-row entries, BATCH_DENIED banner,
// and keyboard-reachable bisection affordance (SEC-BATCH-UX-01/02/03/05).
//
// BLOCKER-3 fix: Replaced all inline styles with Tailwind classes and shadcn/ui
// components (Button, Input, Alert, AlertDescription). No hardcoded color literals.
//
// HIGH-3 fix: Separate state for BATCH_DENIED denial vs generic errors. Bisection
// affordance only shown on confirmed BATCH_DENIED. Generic errors show a neutral message.

import React, { useCallback, useId, useRef, useState } from 'react'
import type { DataType } from '@/data/schema'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

const GENERIC_ERROR_MESSAGE =
  'Save failed. Please try again.'

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
 * - On generic errors (network, 500s): shows neutral "Save failed" message — no bisection.
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

  // HIGH-3 fix: separate state for RBAC denial vs generic errors
  const [denied, setDenied] = useState(false)
  const [genericError, setGenericError] = useState(false)
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
      setGenericError(false)
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
        // HIGH-3 fix: only show BATCH_DENIED banner + bisection for RBAC denials.
        // Network errors, 500s, validation errors show a neutral generic message.
        const errorCode =
          error instanceof Error &&
          'errorCode' in error &&
          (error as { errorCode: string }).errorCode
        if (errorCode === 'BATCH_DENIED' || (error instanceof Error && error.message.includes('BATCH_DENIED'))) {
          // SEC-BATCH-UX-01: input preserved — no form reset
          setDenied(true)
        } else {
          // Non-RBAC error — show neutral message, no bisection affordance
          setGenericError(true)
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
      className="flex flex-col gap-2 p-3"
    >
      {/* SEC-BATCH-UX-02: BATCH_DENIED denial banner with bisection affordance */}
      {denied && (
        <Alert
          variant="destructive"
          aria-live="assertive"
          aria-describedby={bannerId}
        >
          <AlertDescription id={bannerId} className="text-sm">
            {BATCH_DENIED_MESSAGE}
          </AlertDescription>
          {/* SEC-BATCH-UX-03: bisection affordance — only shown on RBAC denial */}
          {rows.length > 1 && (
            <div className="mt-2 flex gap-2">
              <Button
                ref={firstBisectRef}
                type="button"
                variant="outline"
                size="sm"
                aria-label="Try first half of batch"
                onClick={handleTryFirstHalf}
                disabled={submitting}
                className="border-destructive text-destructive hover:bg-destructive/10"
              >
                Try first half
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Try second half of batch"
                onClick={handleTrySecondHalf}
                disabled={submitting}
                className="border-destructive text-destructive hover:bg-destructive/10"
              >
                Try second half
              </Button>
            </div>
          )}
        </Alert>
      )}

      {/* Generic error banner (network errors, 500s, etc.) — no bisection */}
      {genericError && (
        <Alert variant="destructive" aria-live="assertive">
          <AlertDescription className="text-sm">
            {GENERIC_ERROR_MESSAGE}
          </AlertDescription>
        </Alert>
      )}

      {/* Row list */}
      <div role="list" aria-label="Column rows">
        {rows.map((row, idx) => (
          <div
            key={row.id}
            role="listitem"
            className="flex items-center gap-1.5 mb-1"
          >
            <label className="sr-only" htmlFor={`col-name-${row.id}`}>
              Column {idx + 1} name
            </label>
            <Input
              id={`col-name-${row.id}`}
              type="text"
              aria-label={`Column ${idx + 1} name`}
              placeholder="column name"
              value={row.name}
              onChange={(e) => updateRowName(row.id, e.target.value)}
              className="flex-1 h-7 text-xs px-2"
            />
            <label className="sr-only" htmlFor={`col-type-${row.id}`}>
              Column {idx + 1} type
            </label>
            <select
              id={`col-type-${row.id}`}
              aria-label={`Column ${idx + 1} type`}
              value={row.dataType}
              onChange={(e) => updateRowDataType(row.id, e.target.value as DataType)}
              className="text-xs px-1.5 py-1 border border-input rounded-md bg-background text-foreground max-w-[100px] focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove column ${idx + 1}`}
              onClick={() => removeRow(row.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </Button>
          </div>
        ))}
      </div>

      {/* Add row button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Add column row"
        onClick={addRow}
        className="self-start border-dashed"
      >
        + Add row
      </Button>

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        {onClose && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Cancel batch column creation"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          aria-label="Save all columns"
          disabled={submitting}
        >
          {submitting ? 'Saving…' : 'Save all'}
        </Button>
      </div>
    </form>
  )
}
