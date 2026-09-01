// @vitest-environment jsdom
// src/components/navigator/FolderItem.test.tsx
// Unit coverage for FolderItem's handleDrop two-key routing — the highest
// -priority risk in the navigator-create-canvas-board tactical plan (step 8:
// "In FolderItem.handleDrop, read both keys and route each to its own
// mutation — never let a canvas id reach updateWhiteboardFn"). Previously
// verified only by the slow e2e (canvas-board-create.spec.ts's "move into a
// folder" step) — this file had no unit test coverage at all before now.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FolderItem } from './FolderItem'
import type { FolderWithChildren } from './FolderItem'

function makeFolder(
  overrides: Partial<FolderWithChildren> = {},
): FolderWithChildren {
  return {
    id: 'folder-001',
    name: 'Test Folder',
    projectId: 'proj-001',
    parentFolderId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    childFolders: [],
    whiteboards: [],
    canvasBoards: [],
    ...overrides,
  }
}

/** Minimal DataTransfer stand-in — jsdom's DragEvent does not implement a
 * real one, so tests inject this via fireEvent's eventProperties, mirroring
 * the `getData` surface FolderItem.handleDrop actually reads. */
function makeDataTransfer(data: Record<string, string>) {
  return {
    getData: (key: string) => data[key] ?? '',
    setData: vi.fn(),
    dropEffect: 'move',
    effectAllowed: 'move',
  }
}

function renderFolderItem() {
  const onWhiteboardDrop = vi.fn()
  const onCanvasBoardDrop = vi.fn()

  render(
    <FolderItem
      folder={makeFolder()}
      onWhiteboardDrop={onWhiteboardDrop}
      onCanvasBoardDrop={onCanvasBoardDrop}
    />,
  )

  // The folder row's own wrapping div (className="group relative ...")
  // carries the onDrop handler — see FolderItem.tsx.
  const folderRow = screen.getByText('Test Folder').closest('div.group')
  if (!folderRow) throw new Error('folder drop-zone row not found in DOM')

  return { onWhiteboardDrop, onCanvasBoardDrop, folderRow }
}

describe('FolderItem handleDrop routing', () => {
  it('a drop carrying whiteboardId calls onWhiteboardDrop and not onCanvasBoardDrop', () => {
    const { onWhiteboardDrop, onCanvasBoardDrop, folderRow } =
      renderFolderItem()

    fireEvent.drop(folderRow, {
      dataTransfer: makeDataTransfer({ whiteboardId: 'wb-123' }),
    })

    expect(onWhiteboardDrop).toHaveBeenCalledWith('wb-123', 'folder-001')
    expect(onCanvasBoardDrop).not.toHaveBeenCalled()
  })

  it('a drop carrying canvasBoardId calls onCanvasBoardDrop and not onWhiteboardDrop', () => {
    const { onWhiteboardDrop, onCanvasBoardDrop, folderRow } =
      renderFolderItem()

    fireEvent.drop(folderRow, {
      dataTransfer: makeDataTransfer({ canvasBoardId: 'cb-456' }),
    })

    expect(onCanvasBoardDrop).toHaveBeenCalledWith('cb-456', 'folder-001')
    expect(onWhiteboardDrop).not.toHaveBeenCalled()
  })

  it('a drop carrying neither key calls neither handler', () => {
    const { onWhiteboardDrop, onCanvasBoardDrop, folderRow } =
      renderFolderItem()

    fireEvent.drop(folderRow, {
      dataTransfer: makeDataTransfer({}),
    })

    expect(onWhiteboardDrop).not.toHaveBeenCalled()
    expect(onCanvasBoardDrop).not.toHaveBeenCalled()
  })
})
