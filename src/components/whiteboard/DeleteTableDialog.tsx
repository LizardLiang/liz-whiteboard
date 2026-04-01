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
            Delete table &ldquo;{tableName}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p>
                This will permanently delete {columnCount} column
                {columnCount !== 1 ? 's' : ''}.
              </p>
              {affectedRelationships.length > 0 && (
                <>
                  <p style={{ marginTop: '8px' }}>
                    It will also remove {affectedRelationships.length}{' '}
                    relationship{affectedRelationships.length !== 1 ? 's' : ''}:
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
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete table
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
