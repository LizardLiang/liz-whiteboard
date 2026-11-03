// src/components/whiteboard/ExportImageDialog.tsx
// Export dialog for the whiteboard Toolbar (Issue #104) — lets the user pick
// an image format (PNG/SVG) and a background mode (solid theme color /
// transparent) before triggering the export.

import { useState } from 'react'
import type {
  ExportImageBackground,
  ExportImageFormat,
} from '@/lib/export/export-image'
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
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n/use-t'

export interface ExportImageDialogOptions {
  format: ExportImageFormat
  background: ExportImageBackground
}

export interface ExportImageDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Called when the dialog should open/close */
  onOpenChange: (open: boolean) => void
  /** Runs when the dialog has closed; lets the opener take focus back. */
  onCloseAutoFocus?: (event: Event) => void
  /** Called when the user confirms the export with the chosen options.
   * Failure handling (toast, etc.) is the caller's responsibility — this
   * dialog is a pure controlled form. */
  onExport: (options: ExportImageDialogOptions) => void | Promise<void>
}

/**
 * Export dialog — format selector + background toggle + Export action.
 *
 * @example
 * ```tsx
 * <ExportImageDialog
 *   open={exportDialogOpen}
 *   onOpenChange={setExportDialogOpen}
 *   onExport={handleExport}
 * />
 * ```
 */
export function ExportImageDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  onExport,
}: ExportImageDialogProps) {
  const t = useT()
  const [format, setFormat] = useState<ExportImageFormat>('png')
  const [transparent, setTransparent] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const handleExportClick = async () => {
    setIsExporting(true)
    try {
      await onExport({
        format,
        background: transparent ? 'transparent' : 'solid',
      })
      onOpenChange(false)
    } catch {
      // The caller owns the user-facing error. A failed export leaves the
      // controlled dialog open so the user can retry or choose another format.
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
          <DialogTitle>{t('whiteboard.exportImage.title')}</DialogTitle>
          <DialogDescription>
            {t('whiteboard.exportImage.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="export-format">
              {t('whiteboard.exportImage.format')}
            </Label>
            <Select
              value={format}
              onValueChange={(value) => setFormat(value as ExportImageFormat)}
            >
              <SelectTrigger id="export-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="svg">SVG</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="export-transparent">
              {t('whiteboard.exportImage.transparent')}
            </Label>
            <Switch
              id="export-transparent"
              checked={transparent}
              onCheckedChange={setTransparent}
            />
          </div>
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
              ? t('whiteboard.exportImage.exporting')
              : t('whiteboard.exportImage.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
