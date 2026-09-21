import { useCallback, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ExportImageDialog } from '@/components/whiteboard/ExportImageDialog'
import { exportCanvasScene } from '@/lib/export/canvas-export'
import type { ExportImageDialogOptions } from '@/components/whiteboard/ExportImageDialog'
import type { CanvasTheme } from '@/lib/canvas-engine/render'
import type { Scene } from '@/lib/canvas-engine/scene'

interface CanvasExportControlProps {
  scene: Scene
  theme: CanvasTheme
  filename?: string | null
  getBackgroundColor: () => string
}

export function CanvasExportControl({
  scene,
  theme,
  filename,
  getBackgroundColor,
}: CanvasExportControlProps) {
  const [open, setOpen] = useState(false)

  const handleExport = useCallback(
    async ({ format, background }: ExportImageDialogOptions) => {
      try {
        await exportCanvasScene({
          scene,
          theme,
          format,
          background,
          backgroundColor: getBackgroundColor(),
          filename,
        })
        toast.success('Canvas exported')
      } catch (error) {
        toast.error('Export failed', {
          description:
            error instanceof Error ? error.message : 'Please try again.',
        })
        throw error
      }
    },
    [filename, getBackgroundColor, scene, theme],
  )

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Export canvas as image"
        title="Export canvas as image"
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
