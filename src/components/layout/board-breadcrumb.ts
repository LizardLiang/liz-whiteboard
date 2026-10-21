// src/components/layout/board-breadcrumb.ts
// Resolve a board's project > folder > board path from the navigator tree

import { findBoardTrail } from './board-tree'
import type { TreeProject } from './board-tree'

export type { TreeProject } from './board-tree'

/**
 * Names from the project down to the board, or null when the board is not in
 * the tree (still loading, or not visible to this user).
 */
export function findBoardPath(
  projects: ReadonlyArray<TreeProject> | undefined,
  boardId: string,
): Array<string> | null {
  const trail = findBoardTrail(projects, boardId)
  if (!trail) return null
  return [...trail.segments.map((s) => s.name), trail.board.name]
}
