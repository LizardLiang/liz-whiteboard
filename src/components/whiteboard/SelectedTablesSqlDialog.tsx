import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { copyText } from '@/lib/copy-text'
import {
  generateJoinQuerySql,
  getJoinQueryTree,
  type JoinQueryPlan,
  type JoinType,
} from '@/lib/join-query-generator'
import type { Dialect } from '@/lib/ddl-generator'

export interface SelectedTablesSqlDialogProps {
  plan: JoinQueryPlan
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DIALECT_LABELS: Record<Dialect, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mssql: 'Microsoft SQL Server',
}

export function SelectedTablesSqlDialog({
  plan,
  open,
  onOpenChange,
}: SelectedTablesSqlDialogProps) {
  const [dialect, setDialect] = useState<Dialect>('postgres')
  const [roots, setRoots] = useState<Record<string, string>>({})
  const [joinTypes, setJoinTypes] = useState<Record<string, JoinType>>({})
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [included, setIncluded] = useState<Array<string>>([])
  const tableById = useMemo(
    () => new Map(plan.tables.map((table) => [table.id, table])),
    [plan.tables],
  )
  const relationshipById = useMemo(
    () =>
      new Map(
        plan.relationships.map((relationship) => [
          relationship.id,
          relationship,
        ]),
      ),
    [plan.relationships],
  )

  const treeFor = (component: JoinQueryPlan['components'][number]) =>
    getJoinQueryTree(
      plan,
      component,
      roots[component.id] ?? component.defaultRootTableId,
    )

  const generated = useMemo(() => {
    try {
      return {
        sql: generateJoinQuerySql(plan, {
          dialect,
          rootTableIds: roots,
          joinTypes,
          relationshipChoices: choices,
          includedOmittedRelationshipIds: included,
        }),
        error: null,
      }
    } catch (error) {
      return {
        sql: '',
        error:
          error instanceof Error ? error.message : 'Could not generate SQL.',
      }
    }
  }, [plan, dialect, roots, joinTypes, choices, included])

  const describeRelationship = (relationshipId: string) => {
    const relationship = relationshipById.get(relationshipId)
    if (!relationship) return relationshipId
    const source = tableById.get(relationship.sourceTableId)
    const target = tableById.get(relationship.targetTableId)
    const sourceColumn = source?.columns.find(
      (column) => column.id === relationship.sourceColumnId,
    )
    const targetColumn = target?.columns.find(
      (column) => column.id === relationship.targetColumnId,
    )
    return `${source?.name}.${sourceColumn?.name} = ${target?.name}.${targetColumn?.name}`
  }

  const handleCopy = async () => {
    if (!generated.sql) return
    if (await copyText(generated.sql)) toast.success('SQL copied to clipboard')
    else toast.error('Could not copy — select and copy the SQL manually.')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        data-testid="selected-tables-sql-dialog"
      >
        <DialogHeader>
          <DialogTitle>Generate SQL</DialogTitle>
          <DialogDescription>
            Existing relationships become JOINs. Unconnected tables remain
            independent SELECT statements.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid max-w-xs gap-2">
            <Label>SQL dialect</Label>
            <Select
              value={dialect}
              onValueChange={(value) => setDialect(value as Dialect)}
            >
              <SelectTrigger aria-label="SQL dialect">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DIALECT_LABELS) as Array<Dialect>).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {DIALECT_LABELS[value]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {plan.components
            .filter((component) => component.tableIds.length > 1)
            .map((component, index) => (
              <section
                key={component.id}
                className="grid gap-3 rounded-md border p-3"
              >
                <h3 className="font-medium">JOIN group {index + 1}</h3>
                <div className="grid gap-2 sm:max-w-sm">
                  <Label>Root table</Label>
                  <Select
                    value={roots[component.id] ?? component.defaultRootTableId}
                    onValueChange={(value) =>
                      setRoots((current) => ({
                        ...current,
                        [component.id]: value,
                      }))
                    }
                  >
                    <SelectTrigger
                      aria-label={`Root table for group ${index + 1}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {component.tableIds.map((id) => (
                        <SelectItem key={id} value={id}>
                          {tableById.get(id)?.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {treeFor(component)
                  .filter((edge) => edge.relationships.length > 1)
                  .map((edge) => (
                    <div key={edge.key} className="grid gap-2 sm:max-w-xl">
                      <Label>
                        Relationship between{' '}
                        {edge.tableIds
                          .map((id) => tableById.get(id)?.name)
                          .join(' and ')}
                      </Label>
                      <Select
                        value={choices[edge.key]}
                        onValueChange={(value) =>
                          setChoices((current) => ({
                            ...current,
                            [edge.key]: value,
                          }))
                        }
                      >
                        <SelectTrigger
                          aria-label={`Relationship for ${edge.key}`}
                        >
                          <SelectValue placeholder="Choose columns" />
                        </SelectTrigger>
                        <SelectContent>
                          {edge.relationships.map((relationship) => (
                            <SelectItem
                              key={relationship.id}
                              value={relationship.id}
                            >
                              {describeRelationship(relationship.id)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}

                {treeFor(component).map((edge) => {
                  const relationshipId =
                    choices[edge.key] ?? edge.relationships[0]?.id
                  if (!relationshipId) return null
                  return (
                    <div
                      key={`join-${edge.key}`}
                      className="grid gap-2 sm:max-w-xs"
                    >
                      <Label>
                        JOIN type: {describeRelationship(relationshipId)}
                      </Label>
                      <Select
                        value={joinTypes[relationshipId] ?? 'INNER'}
                        onValueChange={(value) =>
                          setJoinTypes((current) => ({
                            ...current,
                            [relationshipId]: value as JoinType,
                          }))
                        }
                      >
                        <SelectTrigger
                          aria-label={`JOIN type for ${relationshipId}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            [
                              'INNER',
                              'LEFT',
                              'RIGHT',
                              ...(dialect === 'mysql' ? [] : ['FULL']),
                            ] as Array<JoinType>
                          ).map((type) => (
                            <SelectItem key={type} value={type}>
                              {type === 'FULL' ? 'FULL OUTER' : type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )
                })}

                {component.omittedRelationshipIds.length > 0 && (
                  <div className="grid gap-2">
                    <Label>Optional cycle conditions</Label>
                    {component.omittedRelationshipIds.map((id) => (
                      <label
                        key={id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={included.includes(id)}
                          onChange={(event) =>
                            setIncluded((current) =>
                              event.target.checked
                                ? [...current, id]
                                : current.filter(
                                    (candidate) => candidate !== id,
                                  ),
                            )
                          }
                        />
                        {describeRelationship(id)}
                      </label>
                    ))}
                  </div>
                )}
              </section>
            ))}

          {plan.components.some(
            (component) => component.tableIds.length === 1,
          ) && (
            <p className="text-sm text-muted-foreground">
              Independent SELECTs:{' '}
              {plan.components
                .filter((component) => component.tableIds.length === 1)
                .map((component) => tableById.get(component.tableIds[0])?.name)
                .join(', ')}
            </p>
          )}
          {plan.components.flatMap((component) => component.externalTableIds)
            .length > 0 && (
            <p className="text-sm text-muted-foreground">
              External tables are marked in the generated SQL preview.
            </p>
          )}
          {plan.skippedTables.map((table) => (
            <p key={table.id} className="text-sm text-destructive">
              Skipped {table.name}: {table.reason}
            </p>
          ))}
          {plan.notices.map((notice) => (
            <p key={notice} className="text-sm text-destructive">
              {notice}
            </p>
          ))}

          {generated.error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {generated.error}
            </p>
          ) : (
            <pre
              data-testid="generated-sql"
              className="max-h-80 overflow-auto rounded-md bg-muted p-4 text-xs"
            >
              <code>{generated.sql}</code>
            </pre>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleCopy} disabled={!generated.sql}>
            <Copy className="mr-2 h-4 w-4" />
            Copy SQL
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
