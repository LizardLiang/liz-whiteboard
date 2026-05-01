// src/components/whiteboard/AutoLayoutConfirmDialog.tsx
// Pre-run confirmation dialog for Auto Layout when there are > 50 tables.
// Built from shadcn AlertDialog primitives (Radix) which already provide:
//   - role="alertdialog" on the content element
//   - focus trap
//   - Esc key → onOpenChange(false) → calls onCancel
//   - focus return to trigger on close
// All FR-011 accessibility requirements are satisfied without manual role overrides.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface AutoLayoutConfirmDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Number of tables on the whiteboard (shown in body text) */
  tableCount: number
  /** Called when the user confirms — closes dialog AND runs layout */
  onConfirm: () => void
  /** Called when the user cancels or presses Esc — no layout runs */
  onCancel: () => void
}

/**
 * Pre-run confirmation dialog shown when tableCount > 50.
 *
 * A11y (FR-011):
 * - role="alertdialog" — provided by AlertDialogContent (Radix)
 * - aria-labelledby pointing to the title — provided by Radix
 * - aria-describedby pointing to the description — provided by Radix
 * - focus trap — provided by Radix
 * - Initial focus on "Run Layout" button via autoFocus
 * - Esc closes dialog and calls onCancel — provided by Radix onOpenChange hook
 * - Focus returns to the trigger (toolbar Auto Layout button) on close — provided by Radix
 */
export function AutoLayoutConfirmDialog({
  open,
  tableCount,
  onConfirm,
  onCancel,
}: AutoLayoutConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      // Radix calls onOpenChange(false) on Esc key; wire that to onCancel
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apply Auto Layout?</AlertDialogTitle>
          <AlertDialogDescription>
            This whiteboard has {tableCount} tables. Auto Layout may take
            several seconds and cannot be cancelled once started. Existing
            positions will be overwritten. Continue?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          {/* autoFocus ensures the "Run Layout" button receives initial focus
              when the dialog opens — satisfies FR-011 a11y AC (c). */}
          <AlertDialogAction autoFocus onClick={onConfirm}>
            Run Layout
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
