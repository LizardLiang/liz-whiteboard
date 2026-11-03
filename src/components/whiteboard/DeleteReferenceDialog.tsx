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
import { useT } from '@/lib/i18n/use-t'

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
  const t = useT()
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
            {t('whiteboard.deleteReference.title', { name: tableName })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p>
                {t('whiteboard.deleteReference.boardOnly')}{' '}
                {sourceWhiteboardName
                  ? t('whiteboard.deleteReference.tableStays', {
                      source: sourceWhiteboardName,
                    })
                  : t('whiteboard.deleteReference.ownerUnchanged')}
              </p>
              {affectedRelationships > 0 && (
                <p style={{ marginTop: '8px' }}>
                  {t(
                    affectedRelationships === 1
                      ? 'whiteboard.deleteReference.relationshipsOne'
                      : 'whiteboard.deleteReference.relationshipsOther',
                    { count: affectedRelationships },
                  )}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t('whiteboard.deleteReference.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
