// src/components/whiteboard/ImportSqlDialog.tsx
// Import SQL dialog for the whiteboard Toolbar (Issue #105) — lets the user
// pick a dialect and paste CREATE TABLE DDL, shows a live parse preview
// (table/column/relationship counts + warnings/errors), then hands the
// parsed AST to the caller's onImport for persistence. Mirrors
// ExportImageDialog's controlled-form shape: no business logic beyond
// parse+preview lives here.

import { useEffect, useMemo, useState } from 'react'
import type { Dialect } from '@/lib/ddl-generator'
import type { DiagramAST } from '@/lib/parser/ast'
import type { SqlParseResult } from '@/lib/parser/sql-ddl-parser'
import { DIALECTS } from '@/lib/ddl-generator'
import { parseSqlDdl } from '@/lib/parser/sql-ddl-parser'
import { debounce } from '@/hooks/use-collaboration'
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
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

const DIALECT_LABELS: Record<Dialect, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mssql: 'SQL Server (MSSQL)',
}

const PARSE_DEBOUNCE_MS = 300

export interface ImportSqlDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Called when the dialog should open/close */
  onOpenChange: (open: boolean) => void
  /** Runs when the dialog has closed; lets the opener take focus back. */
  onCloseAutoFocus?: (event: Event) => void
  /** Called with the parsed AST when the user confirms Import. Failure
   * handling is the caller's responsibility — rejecting keeps this dialog
   * open (with the error surfaced inline) so the user can retry, mirroring
   * the onCreateTable/onCreateRelationship contract in Toolbar.tsx. */
  onImport: (ast: DiagramAST) => void | Promise<void>
}

/**
 * Import SQL dialog — dialect selector + paste area + live preview
 * (counts/warnings/errors) + Cancel/Import actions.
 *
 * @example
 * ```tsx
 * <ImportSqlDialog
 *   open={importSqlOpen}
 *   onOpenChange={setImportSqlOpen}
 *   onImport={handleImportSql}
 * />
 * ```
 */
export function ImportSqlDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  onImport,
}: ImportSqlDialogProps) {
  const t = useT()
  const [dialect, setDialect] = useState<Dialect>('postgres')
  const [sql, setSql] = useState('')
  const [preview, setPreview] = useState<SqlParseResult | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // Stable across the component's lifetime — closes only over setPreview
  // (a stable setState setter) and the pure parseSqlDdl function.
  const debouncedParse = useMemo(
    () =>
      debounce((text: string, activeDialect: Dialect) => {
        setPreview(text.trim() ? parseSqlDdl(text, activeDialect) : null)
      }, PARSE_DEBOUNCE_MS),
    [],
  )

  useEffect(() => {
    debouncedParse(sql, dialect)
  }, [sql, dialect, debouncedParse])

  const resetForm = () => {
    setSql('')
    setPreview(null)
    setImportError(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm()
    onOpenChange(nextOpen)
  }

  const tableCount = preview?.ast.tables.length ?? 0
  const columnCount =
    preview?.ast.tables.reduce((sum, tb) => sum + tb.columns.length, 0) ?? 0
  const relationshipCount = preview?.ast.relationships.length ?? 0
  const canImport = tableCount > 0 && !isImporting

  const handleImportClick = async () => {
    if (!preview) return
    setIsImporting(true)
    setImportError(null)
    try {
      await onImport(preview.ast)
      resetForm()
      onOpenChange(false)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[600px]"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('whiteboard.importSql.title')}</DialogTitle>
          <DialogDescription>
            {t('whiteboard.importSql.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="import-sql-dialect">
              {t('whiteboard.importSql.dialect')}
            </Label>
            <Select
              value={dialect}
              onValueChange={(value) => setDialect(value as Dialect)}
            >
              <SelectTrigger id="import-sql-dialect">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIALECTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DIALECT_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="import-sql-text">SQL</Label>
            <Textarea
              id="import-sql-text"
              placeholder={
                'CREATE TABLE users (\n  id UUID PRIMARY KEY,\n  email VARCHAR(255) NOT NULL UNIQUE\n);'
              }
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
          </div>

          {preview && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <p className="font-medium">
                {t('whiteboard.importSql.summary', {
                  tables: t(
                    tableCount === 1
                      ? 'whiteboard.importSql.tablesOne'
                      : 'whiteboard.importSql.tablesOther',
                    { count: tableCount },
                  ),
                  columns: t(
                    columnCount === 1
                      ? 'whiteboard.importSql.columnsOne'
                      : 'whiteboard.importSql.columnsOther',
                    { count: columnCount },
                  ),
                  relationships: t(
                    relationshipCount === 1
                      ? 'whiteboard.importSql.relationshipsOne'
                      : 'whiteboard.importSql.relationshipsOther',
                    { count: relationshipCount },
                  ),
                })}
              </p>
              {preview.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-amber-600 dark:text-amber-500">
                  {preview.warnings.map((warning, i) => (
                    <li key={i}>{tError(t, warning)}</li>
                  ))}
                </ul>
              )}
              {preview.errors.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-destructive">
                  {preview.errors.map((error, i) => (
                    <li key={i}>
                      {t('whiteboard.importSql.line', {
                        line: error.line,
                        message: tError(t, error),
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {importError !== null && (
            <p className="text-sm text-destructive">
              {importError
                ? tError(t, importError)
                : t('whiteboard.importSql.failed')}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isImporting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleImportClick()}
            disabled={!canImport}
          >
            {isImporting
              ? t('whiteboard.importSql.importing')
              : t('whiteboard.importSql.import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
