// src/components/navigator/merge-boards.ts
// Shared helper for the navigator sidebar (ProjectTree.tsx, FolderItem.tsx):
// interleave a level's whiteboard rows and canvas board rows into one list,
// most-recently-updated first, ACROSS both kinds.
//
// The data layer (`findAllProjectsWithTreeForUser`) deliberately keeps
// `whiteboards` and `canvasBoards` as two separate, per-kind-sorted arrays
// rather than merging them itself — see that function's doc comment. The
// merge happens here, at the one place that actually needs a single ordered
// row list to render.

import type { TreeBoardRow } from '@/data/project'

/**
 * Merge two per-kind row arrays into one list sorted by `updatedAt` DESC.
 * Stable for equal timestamps (Array.prototype.sort is a stable sort in
 * every JS engine this project targets).
 */
export function mergeBoardsByUpdatedAt(
  whiteboards: Array<TreeBoardRow>,
  canvasBoards: Array<TreeBoardRow>,
): Array<TreeBoardRow> {
  return [...whiteboards, ...canvasBoards].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  )
}
