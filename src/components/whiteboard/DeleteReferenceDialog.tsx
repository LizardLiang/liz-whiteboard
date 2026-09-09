/**
 * DeleteReferenceDialog — confirms removing a cross-file table reference
 * (LizMeter #83).
 *
 * Worded apart from DeleteTableDialog on purpose: removing a reference deletes
 * nothing in the file that owns the table, only the pointer on THIS board and
 * whatever relationships were drawn to it.
 */

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

export interface DeleteReferenceDialogProps {
  /** The referenced table's name, as it reads on the node. */
  tableName: string
  /** The file that actually owns it. */
  sourceWhiteboardName: string | null
  /** How many relationships on this board point at the reference. */
  affectedRelationships: number
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteReferenceDialog({
  tableName,
  sourceWhiteboardName,
  affectedRelationships,
  onConfirm,
  onCancel,
}: DeleteReferenceDialogProps) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove the reference to &ldquo;{tableName}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p>
                This removes the reference from this board only.{' '}
                {sourceWhiteboardName
                  ? `The table stays exactly as it is in ${sourceWhiteboardName}.`
                  : 'Nothing in the file that owns the table changes.'}
              </p>
              {affectedRelationships > 0 && (
                <p style={{ marginTop: '8px' }}>
                  {affectedRelationships} relationship
                  {affectedRelationships !== 1 ? 's' : ''} drawn to it{' '}
                  {affectedRelationships !== 1 ? 'are' : 'is'} removed as well.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Remove reference
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
