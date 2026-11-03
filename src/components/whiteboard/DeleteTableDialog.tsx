/**
 * DeleteTableDialog — AlertDialog for confirming table deletion
 * Lists affected column count and relationships before deletion
 */

import type { ColumnRelationship } from './column/types'
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

/**
 * Re-export ColumnRelationship as TableRelationship for semantic clarity.
 * Both table and column deletion dialogs display the same relationship shape.
 */
export type TableRelationship = ColumnRelationship

export interface DeleteTableDialogProps {
  tableName: string
  columnCount: number
  affectedRelationships: Array<TableRelationship>
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteTableDialog({
  tableName,
  columnCount,
  affectedRelationships,
  onConfirm,
  onCancel,
}: DeleteTableDialogProps) {
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
            {t('whiteboard.deleteTable.title', { name: tableName })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p>
                {t(
                  columnCount === 1
                    ? 'whiteboard.deleteTable.columnsOne'
                    : 'whiteboard.deleteTable.columnsOther',
                  { count: columnCount },
                )}
              </p>
              {affectedRelationships.length > 0 && (
                <>
                  <p style={{ marginTop: '8px' }}>
                    {t(
                      affectedRelationships.length === 1
                        ? 'whiteboard.deleteTable.relationshipsOne'
                        : 'whiteboard.deleteTable.relationshipsOther',
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
                </>
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
            {t('whiteboard.deleteTable.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
