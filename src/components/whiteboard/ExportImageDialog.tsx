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

export interface ExportImageDialogOptions {
  format: ExportImageFormat
  background: ExportImageBackground
}

export interface ExportImageDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Called when the dialog should open/close */
  onOpenChange: (open: boolean) => void
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
  onExport,
}: ExportImageDialogProps) {
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
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export as Image</DialogTitle>
          <DialogDescription>
            Export the entire diagram at its natural size, regardless of the
            current zoom or pan position.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="export-format">Format</Label>
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
            <Label htmlFor="export-transparent">Transparent background</Label>
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
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleExportClick()}
            disabled={isExporting}
          >
            {isExporting ? 'Exporting…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
