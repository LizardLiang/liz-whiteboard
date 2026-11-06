// src/components/whiteboard/ExportSchemaDialog.tsx
// Export dialog for the whiteboard Toolbar — lets the user pick a file
// format (Excel / JSON / XML) for the schema export (tables, columns and
// relationships) and, for Excel, the language of the sheet names and header
// row. Then triggers the download.

import { useState } from 'react'
import type {
  SchemaExportFormat,
  SchemaExportOptions,
} from '@/lib/export/schema-export'
import type { Locale } from '@/lib/i18n/resolve-locale'
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
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n/use-t'

/** Each language is named in its own language, like the header picker. */
const HEADER_LANGUAGES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
]

export interface ExportSchemaDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Called when the dialog should open/close */
  onOpenChange: (open: boolean) => void
  /** Runs when the dialog has closed; lets the opener take focus back. */
  onCloseAutoFocus?: (event: Event) => void
  /** Called with the chosen options. A rejection keeps the dialog open; the
   * caller owns the user-facing error. */
  onExport: (options: SchemaExportOptions) => void | Promise<void>
}

export function ExportSchemaDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  onExport,
}: ExportSchemaDialogProps) {
  const { t, locale } = useI18n()
  const [format, setFormat] = useState<SchemaExportFormat>('xlsx')
  // Follows the UI language until the user picks one.
  const [chosenLocale, setChosenLocale] = useState<Locale | null>(null)
  const headerLocale = chosenLocale ?? locale
  const [isExporting, setIsExporting] = useState(false)

  const handleExportClick = async () => {
    setIsExporting(true)
    try {
      await onExport({ format, headerLocale })
      onOpenChange(false)
    } catch {
      // The caller shows the error. The dialog stays open for a retry.
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px]"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('whiteboard.exportSchema.title')}</DialogTitle>
          <DialogDescription>
            {t('whiteboard.exportSchema.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="export-schema-format">
              {t('whiteboard.exportSchema.format')}
            </Label>
            <Select
              value={format}
              onValueChange={(value) => setFormat(value as SchemaExportFormat)}
            >
              <SelectTrigger id="export-schema-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">
                  {t('whiteboard.exportSchema.formatXlsx')}
                </SelectItem>
                <SelectItem value="json">JSON (.json)</SelectItem>
                <SelectItem value="xml">XML (.xml)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* JSON and XML keys are a machine-readable contract and stay
              English, so the language choice applies to Excel only. */}
          {format === 'xlsx' && (
            <div className="grid gap-2">
              <Label htmlFor="export-schema-header-language">
                {t('whiteboard.exportSchema.headerLanguage')}
              </Label>
              <Select
                value={headerLocale}
                onValueChange={(value) => setChosenLocale(value as Locale)}
              >
                <SelectTrigger
                  id="export-schema-header-language"
                  aria-describedby="export-schema-header-language-hint"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HEADER_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p
                id="export-schema-header-language-hint"
                className="text-sm text-muted-foreground"
              >
                {t('whiteboard.exportSchema.headerLanguageHint')}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleExportClick()}
            disabled={isExporting}
          >
            {isExporting
              ? t('whiteboard.exportSchema.exporting')
              : t('whiteboard.exportSchema.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
