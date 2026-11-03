import { useCallback, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import type { ExportImageDialogOptions } from '@/components/whiteboard/ExportImageDialog'
import type { CanvasTheme, DiagramStyle } from '@/lib/canvas-engine/render'
import type { Scene } from '@/lib/canvas-engine/scene'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n/use-t'
import { ExportImageDialog } from '@/components/whiteboard/ExportImageDialog'
import { exportCanvasScene } from '@/lib/export/canvas-export'

interface CanvasExportControlProps {
  scene: Scene
  theme: CanvasTheme
  diagramStyle?: DiagramStyle
  filename?: string | null
  getBackgroundColor: () => string
}

export function CanvasExportControl({
  scene,
  theme,
  diagramStyle,
  filename,
  getBackgroundColor,
}: CanvasExportControlProps) {
  const t = useT()
  const [open, setOpen] = useState(false)

  const handleExport = useCallback(
    async ({ format, background }: ExportImageDialogOptions) => {
      try {
        await exportCanvasScene({
          scene,
          theme,
          diagramStyle,
          format,
          background,
          backgroundColor: getBackgroundColor(),
          filename,
        })
        toast.success(t('canvas.export.success'))
      } catch (error) {
        toast.error(t('canvas.export.failed'), {
          description:
            error instanceof Error
              ? error.message
              : t('canvas.export.tryAgain'),
        })
        throw error
      }
    },
    [diagramStyle, filename, getBackgroundColor, scene, t, theme],
  )

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={t('canvas.export.aria')}
        title={t('canvas.export.aria')}
        onClick={() => setOpen(true)}
      >
        <Download className="h-4 w-4" />
      </Button>
      <ExportImageDialog
        open={open}
        onOpenChange={setOpen}
        onExport={handleExport}
      />
    </>
  )
}
