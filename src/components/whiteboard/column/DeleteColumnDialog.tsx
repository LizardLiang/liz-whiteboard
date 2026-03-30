/**
 * DeleteColumnDialog — AlertDialog for confirming column deletion
 * Lists affected relationships with source/target table and column names
 * Extra warning for FK columns
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
import type { Column } from '@prisma/client'
import type { ColumnRelationship } from './types'

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
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete column &ldquo;{column.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p>
                This column is involved in {affectedRelationships.length}{' '}
                relationship{affectedRelationships.length !== 1 ? 's' : ''}. Deleting it will also remove:
              </p>
              <ul
                style={{
                  margin: '8px 0',
                  paddingLeft: '16px',
                  listStyleType: 'disc',
                }}
              >
                {affectedRelationships.map((rel) => (
                  <li key={rel.id} style={{ fontSize: '13px', marginBottom: '4px' }}>
                    {rel.sourceTableName}.{rel.sourceColumnName} &rarr;{' '}
                    {rel.targetTableName}.{rel.targetColumnName}
                    <span style={{ opacity: 0.6, fontSize: '11px', marginLeft: '4px' }}>
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
                  Warning: This column is a foreign key. Deleting it will break the
                  relationship referencing this column.
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
            Delete column
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
