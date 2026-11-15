// src/components/whiteboard/field-window/FieldsGrid.tsx
// The field list of one table as a markdown-style grid
// (Name | Type | Key | Nullable | Comment). Pure presentation: the caller
// passes the live table, so canvas and socket edits show immediately.

import type { Column, DiagramTable } from '@/data/models'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/lib/i18n/use-t'

export type FieldsGridTable = DiagramTable & {
  columns: Array<Column>
}

export function FieldsGrid({ table }: { table: FieldsGridTable }) {
  const { t } = useI18n()
  const columns = [...table.columns].sort((a, b) => a.order - b.order)
  // overflow-wrap:anywhere (not break-words) so an unbroken value such as
  // `ENUM('draft','pending',…)` wraps inside its fixed-width column instead
  // of widening the table and pushing Comment out of view.
  const cell =
    'border border-border px-2 py-1.5 align-top text-left [overflow-wrap:anywhere]'

  return columns.length === 0 ? (
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
            <td className={`${cell} font-mono text-xs`}>{col.dataType}</td>
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
  )
}
