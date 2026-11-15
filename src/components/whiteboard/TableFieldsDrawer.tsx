// src/components/whiteboard/TableFieldsDrawer.tsx
// Non-modal right-hand drawer (floats inside the canvas wrapper, below the
// app header and above the bottom toolbar) listing the clicked table's fields as a
// markdown-style grid (Name | Type | Key | Nullable | Comment). It reads the
// live table passed by the caller, so canvas/socket edits show immediately.
// A plain fixed panel rather than shadcn Sheet: Sheet is a modal Radix Dialog
// whose overlay blocks the canvas, and the user must be able to click another
// table while this stays open.

import { useEffect } from 'react'
import { XIcon } from 'lucide-react'
import type { Column, DiagramTable } from '@/data/models'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n/use-t'

export type TableFieldsDrawerTable = DiagramTable & {
  columns: Array<Column>
}

interface TableFieldsDrawerProps {
  /** The table to show, or null/undefined when the drawer is closed. */
  table: TableFieldsDrawerTable | null | undefined
  onClose: () => void
}

export function TableFieldsDrawer({ table, onClose }: TableFieldsDrawerProps) {
  const { t } = useI18n()
  const open = !!table

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!table) return null

  const columns = [...table.columns].sort((a, b) => a.order - b.order)
  // overflow-wrap:anywhere (not break-words) so an unbroken value such as
  // `ENUM('draft','pending',…)` wraps inside its fixed-width column instead
  // of widening the table and pushing Comment out of view.
  const cell =
    'border border-border px-2 py-1.5 align-top text-left [overflow-wrap:anywhere]'

  return (
    <aside
      role="complementary"
      aria-labelledby="table-fields-drawer-title"
      data-testid="table-fields-drawer"
      className="absolute top-3 right-3 z-30 flex max-h-[calc(100%-5.75rem)] w-[calc(100%-1.5rem)] flex-col rounded-lg border bg-background text-foreground shadow-lg sm:w-[48rem]"
    >
      <header className="flex items-start justify-between gap-2 px-6 pt-6 pb-4">
        <div className="min-w-0">
          <h2
            id="table-fields-drawer-title"
            className="text-lg font-semibold [overflow-wrap:anywhere]"
          >
            {t('whiteboard.fieldsDrawer.title', { name: table.name })}
          </h2>
          <p className="mt-1 text-sm break-words text-muted-foreground">
            {table.description || t('whiteboard.fieldsDrawer.description')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('whiteboard.fieldsDrawer.close')}
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {columns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('whiteboard.fieldsDrawer.empty')}
          </p>
        ) : (
          <table
            className="w-full min-w-[40rem] table-fixed border-collapse text-sm"
            aria-label={t('whiteboard.fieldsDrawer.fieldList')}
          >
            {/* Fixed widths for the short columns; Comment takes the rest. */}
            <colgroup>
              <col className="w-[8.5rem]" />
              <col className="w-[7.5rem]" />
              <col className="w-[5.5rem]" />
              <col className="w-[5rem]" />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted">
                <th scope="col" className={cell}>
                  {t('whiteboard.fieldsDrawer.name')}
                </th>
                <th scope="col" className={cell}>
                  {t('whiteboard.fieldsDrawer.type')}
                </th>
                <th scope="col" className={cell}>
                  {t('whiteboard.fieldsDrawer.key')}
                </th>
                <th scope="col" className={cell}>
                  {t('whiteboard.fieldsDrawer.nullable')}
                </th>
                <th scope="col" className={cell}>
                  {t('whiteboard.fieldsDrawer.comment')}
                </th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col) => (
                <tr key={col.id} data-testid="fields-drawer-row">
                  <td className={`${cell} font-medium`}>{col.name}</td>
                  <td className={`${cell} font-mono text-xs`}>
                    {col.dataType}
                  </td>
                  <td className={cell}>
                    <div className="flex flex-wrap gap-1">
                      {col.isPrimaryKey && (
                        <Badge>{t('whiteboard.fieldsDrawer.pk')}</Badge>
                      )}
                      {col.isForeignKey && (
                        <Badge variant="secondary">
                          {t('whiteboard.fieldsDrawer.fk')}
                        </Badge>
                      )}
                      {col.isUnique && (
                        <Badge variant="outline">
                          {t('whiteboard.fieldsDrawer.uq')}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className={cell}>
                    {col.isNullable
                      ? t('whiteboard.fieldsDrawer.yes')
                      : t('whiteboard.fieldsDrawer.no')}
                  </td>
                  <td
                    className={`${cell} whitespace-pre-wrap`}
                    data-testid="fields-drawer-comment"
                  >
                    {col.description ? (
                      col.description
                    ) : (
                      <span
                        className="text-muted-foreground"
                        aria-label={t('whiteboard.fieldsDrawer.noComment')}
                      >
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  )
}
