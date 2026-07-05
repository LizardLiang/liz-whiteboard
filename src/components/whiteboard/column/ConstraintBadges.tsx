/**
 * ConstraintBadges — clickable PK/N/U badges and non-clickable FK badge
 * Per-constraint 250ms debounce on emit (optimistic update is immediate)
 * PK toggle ON updates local N/U state for immediate UI feedback;
 * the cascade (isNullable=false + isUnique=true) is handled server-side
 * via handleToggleConstraint in TableNode — only ONE emit fires here.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useWhiteboardPermissions } from '../whiteboard-permissions-context'

export interface ConstraintBadgesProps {
  isPrimaryKey: boolean
  isNullable: boolean
  isUnique: boolean
  isForeignKey: boolean
  onToggle: (
    constraint: 'isPrimaryKey' | 'isNullable' | 'isUnique',
    value: boolean,
  ) => void
}

type Constraint = 'isPrimaryKey' | 'isNullable' | 'isUnique'

export const ConstraintBadges = memo(
  ({
    isPrimaryKey,
    isNullable,
    isUnique,
    isForeignKey,
    onToggle,
  }: ConstraintBadgesProps) => {
    const { canEdit } = useWhiteboardPermissions()

    // Local optimistic state mirrors the props initially
    const [localPK, setLocalPK] = useState(isPrimaryKey)
    const [localN, setLocalN] = useState(isNullable)
    const [localU, setLocalU] = useState(isUnique)

    // Sync local state when props change (from server or parent updates)
    useEffect(() => {
      setLocalPK(isPrimaryKey)
    }, [isPrimaryKey])
    useEffect(() => {
      setLocalN(isNullable)
    }, [isNullable])
    useEffect(() => {
      setLocalU(isUnique)
    }, [isUnique])

    // Per-constraint debounce timers
    const timers = useRef<Map<Constraint, ReturnType<typeof setTimeout>>>(
      new Map(),
    )

    const debouncedEmit = useCallback(
      (constraint: Constraint, value: boolean) => {
        const existing = timers.current.get(constraint)
        if (existing) clearTimeout(existing)
        const id = setTimeout(() => {
          onToggle(constraint, value)
          timers.current.delete(constraint)
        }, 250)
        timers.current.set(constraint, id)
      },
      [onToggle],
    )

    // Clear timers on unmount
    useEffect(() => {
      const t = timers.current
      return () => {
        t.forEach((id) => clearTimeout(id))
      }
    }, [])

    const handlePKClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        const newVal = !localPK
        // Optimistic update
        setLocalPK(newVal)
        if (newVal) {
          // PK ON: update local visual state for immediate UI feedback.
          setLocalN(false)
          setLocalU(true)
          // Also emit the cascade constraints
          debouncedEmit('isNullable', false)
          debouncedEmit('isUnique', true)
        }
        debouncedEmit('isPrimaryKey', newVal)
      },
      [localPK, debouncedEmit],
    )

    const handleNClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        const newVal = !localN
        setLocalN(newVal)
        debouncedEmit('isNullable', newVal)
      },
      [localN, debouncedEmit],
    )

    const handleUClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        const newVal = !localU
        setLocalU(newVal)
        debouncedEmit('isUnique', newVal)
      },
      [localU, debouncedEmit],
    )

    const badgeBase: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '9px',
      fontWeight: 700,
      padding: '0 3px',
      borderRadius: '2px',
      minWidth: '16px',
      height: '14px',
      cursor: 'pointer',
      flexShrink: 0,
      lineHeight: 1,
      userSelect: 'none',
    }

    return (
      <div
        className="nodrag nowheel"
        style={{ display: 'flex', gap: '2px', flexShrink: 0, width: '72px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* PK Badge — always visible; active amber style when isPK, outline style when not.
            Non-interactive static badge when !canEdit (schema info stays visible, toggle removed). */}
        <span
          role={canEdit ? 'button' : undefined}
          aria-pressed={canEdit ? localPK : undefined}
          aria-label={
            canEdit
              ? `Toggle primary key, currently ${localPK ? 'enabled' : 'disabled'}`
              : `Primary key ${localPK ? 'enabled' : 'disabled'}`
          }
          onClick={canEdit ? handlePKClick : undefined}
          style={{
            ...badgeBase,
            cursor: canEdit ? 'pointer' : 'default',
            background: localPK
              ? 'var(--rf-primary-key-color, #f59e0b)'
              : 'transparent',
            color: localPK ? '#fff' : 'var(--rf-table-text)',
            border: `1px solid ${localPK ? 'var(--rf-primary-key-color, #f59e0b)' : 'var(--rf-table-border, #e2e8f0)'}`,
            opacity: localPK ? 1 : 0.4,
          }}
        >
          PK
        </span>

        {/* FK Badge — visible only when true, not clickable */}
        {isForeignKey && (
          <span
            style={{
              ...badgeBase,
              cursor: 'default',
              background: 'var(--rf-foreign-key-color, #6366f1)',
              color: '#fff',
              border: '1px solid var(--rf-foreign-key-color, #6366f1)',
            }}
            title="Foreign Key (managed via relationships)"
          >
            FK
          </span>
        )}

        {/* N (Nullable) Badge — always visible. Non-interactive when !canEdit. */}
        <span
          role={canEdit ? 'button' : undefined}
          aria-pressed={canEdit ? localN : undefined}
          aria-label={
            canEdit
              ? `Toggle nullable, currently ${localN ? 'enabled' : 'disabled'}`
              : `Nullable ${localN ? 'enabled' : 'disabled'}`
          }
          onClick={canEdit ? handleNClick : undefined}
          style={{
            ...badgeBase,
            cursor: canEdit ? 'pointer' : 'default',
            background: localN
              ? 'var(--rf-nullable-color, #94a3b8)'
              : 'transparent',
            color: localN ? '#fff' : 'var(--rf-table-text)',
            border: `1px solid ${localN ? 'var(--rf-nullable-color, #94a3b8)' : 'var(--rf-table-border, #e2e8f0)'}`,
            opacity: localN ? 1 : 0.4,
          }}
        >
          N
        </span>

        {/* U (Unique) Badge — always visible. Non-interactive when !canEdit. */}
        <span
          role={canEdit ? 'button' : undefined}
          aria-pressed={canEdit ? localU : undefined}
          aria-label={
            canEdit
              ? `Toggle unique, currently ${localU ? 'enabled' : 'disabled'}`
              : `Unique ${localU ? 'enabled' : 'disabled'}`
          }
          onClick={canEdit ? handleUClick : undefined}
          style={{
            ...badgeBase,
            cursor: canEdit ? 'pointer' : 'default',
            background: localU
              ? 'var(--rf-unique-color, #10b981)'
              : 'transparent',
            color: localU ? '#fff' : 'var(--rf-table-text)',
            border: `1px solid ${localU ? 'var(--rf-unique-color, #10b981)' : 'var(--rf-table-border, #e2e8f0)'}`,
            opacity: localU ? 1 : 0.4,
          }}
        >
          U
        </span>
      </div>
    )
  },
)

ConstraintBadges.displayName = 'ConstraintBadges'
