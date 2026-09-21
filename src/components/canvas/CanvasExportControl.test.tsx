import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasExportControl } from './CanvasExportControl'
import { sceneFrom } from '@/lib/canvas-engine/scene'
import { exportCanvasScene } from '@/lib/export/canvas-export'

vi.mock('@/lib/export/canvas-export', () => ({
  exportCanvasScene: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const scene = sceneFrom([
  {
    id: 'shape',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    rotation: 0,
    zIndex: 0,
    text: 'Export me',
    style: {
      fill: '#fff',
      stroke: '#2563eb',
      strokeWidth: 2,
      fontSize: 16,
      color: '#0f172a',
      cornerRadius: 8,
      textAlign: 'left',
      verticalAlign: 'top',
    },
  },
])

function renderControl() {
  render(
    <CanvasExportControl
      scene={scene}
      theme="dark"
      filename="Board name"
      getBackgroundColor={() => 'rgb(2, 6, 23)'}
    />,
  )
}

describe('CanvasExportControl', () => {
  beforeEach(() => {
    vi.mocked(exportCanvasScene).mockReset().mockResolvedValue(undefined)
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('exports PNG with the resolved scene, theme, background, and filename', async () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: /export canvas/i }))
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }))

    await waitFor(() => expect(exportCanvasScene).toHaveBeenCalledTimes(1))
    expect(exportCanvasScene).toHaveBeenCalledWith({
      scene,
      theme: 'dark',
      format: 'png',
      background: 'solid',
      backgroundColor: 'rgb(2, 6, 23)',
      filename: 'Board name',
    })
  })

  it('exports transparent SVG', async () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: /export canvas/i }))
    fireEvent.click(screen.getByRole('combobox', { name: /format/i }))
    fireEvent.click(await screen.findByRole('option', { name: 'SVG' }))
    fireEvent.click(screen.getByRole('switch', { name: /transparent/i }))
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }))

    await waitFor(() => expect(exportCanvasScene).toHaveBeenCalledTimes(1))
    expect(exportCanvasScene).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'svg', background: 'transparent' }),
    )
  })
})
