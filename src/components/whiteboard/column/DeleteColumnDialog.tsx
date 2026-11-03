/**
 * DeleteColumnDialog — AlertDialog for confirming column deletion
 * Lists affected relationships with source/target table and column names
 * Extra warning for FK columns
 */

import type { Column } from '@/data/models'
import type { ColumnRelationship } from './types'
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

export interface DeleteColumnDialogProps {
  column: Column
  affectedRelationships: Array<ColumnRelationship>
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteColumnDialog({
  column,
  affectedRelationships,
  onConfirm,
  onCancel,
}: DeleteColumnDialogProps) {
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
            {t('whiteboard.deleteColumn.title', { name: column.name })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p>
                {t(
                  affectedRelationships.length === 1
                    ? 'whiteboard.deleteColumn.involvedOne'
                    : 'whiteboard.deleteColumn.involvedOther',
                  { count: affectedRelationships.length },
                )}
              </p>
              <ul
                style={{
                  margin: '8px 0',
                  paddingLeft: '16px',
                  listStyleType: 'disc',
                }}
              >
                {affectedRelationships.map((rel) => (
                  <li
                    key={rel.id}
                    style={{ fontSize: '13px', marginBottom: '4px' }}
                  >
                    {rel.sourceTableName}.{rel.sourceColumnName} &rarr;{' '}
                    {rel.targetTableName}.{rel.targetColumnName}
                    <span
                      style={{
                        opacity: 0.6,
                        fontSize: '11px',
                        marginLeft: '4px',
                      }}
                    >
                      ({rel.cardinality})
                    </span>
                  </li>
                ))}
              </ul>

              {column.isForeignKey && (
                <p
                  style={{
                    marginTop: '8px',
                    padding: '6px 8px',
                    borderRadius: '4px',
                    background: 'rgba(239,68,68,0.1)',
                    color: 'var(--destructive)',
                    fontSize: '13px',
                  }}
                >
                  {t('whiteboard.deleteColumn.fkWarning')}
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
            {t('whiteboard.deleteColumn.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
