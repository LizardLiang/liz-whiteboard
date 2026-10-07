// src/components/layout/board-breadcrumb.ts
// Resolve a board's project > folder > board path from the navigator tree

interface TreeBoard {
  id: string
  name: string
}

interface TreeFolder {
  id: string
  name: string
  parentFolderId: string | null
  whiteboards: Array<TreeBoard>
  canvasBoards: Array<TreeBoard>
}

export interface TreeProject {
  name: string
  folders: Array<TreeFolder>
  whiteboards: Array<TreeBoard>
  canvasBoards: Array<TreeBoard>
}

const MAX_FOLDER_DEPTH = 32

/**
 * Names from the project down to the board, or null when the board is not in
 * the tree (still loading, or not visible to this user).
 */
export function findBoardPath(
  projects: ReadonlyArray<TreeProject> | undefined,
  boardId: string,
): Array<string> | null {
  if (!projects) return null
  const isBoard = (b: TreeBoard) => b.id === boardId

  for (const project of projects) {
    const rootBoard = [...project.whiteboards, ...project.canvasBoards].find(
      isBoard,
    )
    if (rootBoard) return [project.name, rootBoard.name]

    const folderById = new Map(project.folders.map((f) => [f.id, f]))
    for (const folder of project.folders) {
      const board = [...folder.whiteboards, ...folder.canvasBoards].find(
        isBoard,
      )
      if (!board) continue

      const names = [board.name]
      let current: TreeFolder | undefined = folder
      let depth = 0
      while (current && depth < MAX_FOLDER_DEPTH) {
        names.unshift(current.name)
        current = current.parentFolderId
          ? folderById.get(current.parentFolderId)
          : undefined
        depth += 1
      }
      return [project.name, ...names]
    }
  }
  return null
}
