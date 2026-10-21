// src/components/layout/entry-icon.tsx
// Distinct icon per tree entry type (folder / whiteboard / canvas)

import { Folder, PenTool, Table2 } from 'lucide-react'
import type { TreeEntryType } from './board-tree'

const LABEL: Record<TreeEntryType, string> = {
  folder: 'Folder',
  whiteboard: 'Whiteboard',
  canvas: 'Canvas',
}

export function EntryIcon({ type }: { type: TreeEntryType }) {
  const Icon =
    type === 'folder' ? Folder : type === 'whiteboard' ? Table2 : PenTool
  return (
    <>
      <Icon aria-hidden="true" data-entry-type={type} />
      <span className="sr-only">{LABEL[type]}: </span>
    </>
  )
}
