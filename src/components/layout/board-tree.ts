// src/components/layout/board-tree.ts
// Pure tree-walking helpers for the breadcrumb picker and the navigator search

export interface TreeBoard {
  id: string
  name: string
}

export interface TreeFolder {
  id: string
  name: string
  parentFolderId: string | null
  whiteboards: Array<TreeBoard>
  canvasBoards: Array<TreeBoard>
}

export interface TreeProject {
  id: string
  name: string
  folders: Array<TreeFolder>
  whiteboards: Array<TreeBoard>
  canvasBoards: Array<TreeBoard>
}

export type TreeEntryType = 'folder' | 'whiteboard' | 'canvas'

export interface TreeEntry {
  type: TreeEntryType
  id: string
  name: string
  projectId: string
}

export interface PathSegment {
  type: 'project' | 'folder'
  /** Project id for a project segment, folder id for a folder segment. */
  id: string
  name: string
  projectId: string
  /** Folder id the segment points at, null for the project root. */
  folderId: string | null
}

export interface SearchEntry extends TreeEntry {
  /** Names from the project down to (and excluding) the entry. */
  path: Array<string>
}

export const MAX_FOLDER_DEPTH = 32
export const MAX_SEARCH_RESULTS = 50

const TYPE_ORDER: Record<TreeEntryType, number> = {
  folder: 0,
  whiteboard: 1,
  canvas: 1,
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function compareEntries(a: TreeEntry, b: TreeEntry): number {
  return TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || compareNames(a.name, b.name)
}

function boardEntries(
  whiteboards: ReadonlyArray<TreeBoard>,
  canvasBoards: ReadonlyArray<TreeBoard>,
  projectId: string,
): Array<TreeEntry> {
  return [
    ...whiteboards.map((b) => ({
      type: 'whiteboard' as const,
      id: b.id,
      name: b.name,
      projectId,
    })),
    ...canvasBoards.map((b) => ({
      type: 'canvas' as const,
      id: b.id,
      name: b.name,
      projectId,
    })),
  ]
}

/**
 * Direct children of a project root (`folderId` null) or of a folder:
 * sub-folders first, then boards, each group sorted by name.
 */
export function listChildren(
  projects: ReadonlyArray<TreeProject> | undefined,
  projectId: string,
  folderId: string | null,
): Array<TreeEntry> {
  const project = projects?.find((p) => p.id === projectId)
  if (!project) return []

  const folders: Array<TreeEntry> = project.folders
    .filter((f) => f.parentFolderId === folderId && f.id !== folderId)
    .map((f) => ({
      type: 'folder' as const,
      id: f.id,
      name: f.name,
      projectId,
    }))

  let boards: Array<TreeEntry>
  if (folderId === null) {
    boards = boardEntries(project.whiteboards, project.canvasBoards, projectId)
  } else {
    const folder = project.folders.find((f) => f.id === folderId)
    boards = folder
      ? boardEntries(folder.whiteboards, folder.canvasBoards, projectId)
      : []
  }
  return [...folders, ...boards].sort(compareEntries)
}

/** Parent folder id of a folder (null = project root), undefined when unknown. */
export function parentFolderOf(
  projects: ReadonlyArray<TreeProject> | undefined,
  projectId: string,
  folderId: string,
): string | null | undefined {
  const folder = projects
    ?.find((p) => p.id === projectId)
    ?.folders.find((f) => f.id === folderId)
  return folder ? folder.parentFolderId : undefined
}

/** Name of a project root or folder, for labelling the current location. */
export function locationName(
  projects: ReadonlyArray<TreeProject> | undefined,
  projectId: string,
  folderId: string | null,
): string {
  const project = projects?.find((p) => p.id === projectId)
  if (!project) return ''
  if (folderId === null) return project.name
  return project.folders.find((f) => f.id === folderId)?.name ?? ''
}

/** Case-insensitive substring filter that keeps the incoming order. */
export function filterEntries<T extends { name: string }>(
  entries: ReadonlyArray<T>,
  query: string,
): Array<T> {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...entries]
  return entries.filter((e) => e.name.toLowerCase().includes(needle))
}

/**
 * Project segment followed by one segment per folder, down to the board's
 * parent. Null when the board is not in the tree.
 */
export function findBoardTrail(
  projects: ReadonlyArray<TreeProject> | undefined,
  boardId: string,
): { board: TreeEntry; segments: Array<PathSegment> } | null {
  if (!projects) return null

  for (const project of projects) {
    const projectSegment: PathSegment = {
      type: 'project',
      id: project.id,
      name: project.name,
      projectId: project.id,
      folderId: null,
    }
    const rootBoard = boardEntries(
      project.whiteboards,
      project.canvasBoards,
      project.id,
    ).find((e) => e.id === boardId)
    if (rootBoard) return { board: rootBoard, segments: [projectSegment] }

    const folderById = new Map(project.folders.map((f) => [f.id, f]))
    for (const folder of project.folders) {
      const board = boardEntries(
        folder.whiteboards,
        folder.canvasBoards,
        project.id,
      ).find((e) => e.id === boardId)
      if (!board) continue

      const folderSegments: Array<PathSegment> = []
      let current: TreeFolder | undefined = folder
      let depth = 0
      while (current && depth < MAX_FOLDER_DEPTH) {
        folderSegments.unshift({
          type: 'folder',
          id: current.id,
          name: current.name,
          projectId: project.id,
          folderId: current.id,
        })
        current = current.parentFolderId
          ? folderById.get(current.parentFolderId)
          : undefined
        depth += 1
      }
      return { board, segments: [projectSegment, ...folderSegments] }
    }
  }
  return null
}

/** Every folder and board across all projects, each with its path. */
export function buildSearchIndex(
  projects: ReadonlyArray<TreeProject> | undefined,
): Array<SearchEntry> {
  if (!projects) return []
  const index: Array<SearchEntry> = []

  for (const project of projects) {
    const folderById = new Map(project.folders.map((f) => [f.id, f]))
    const pathCache = new Map<string, Array<string>>()
    // Names from the project down to and including `folder`.
    const folderPath = (folder: TreeFolder): Array<string> => {
      const cached = pathCache.get(folder.id)
      if (cached) return cached
      const names: Array<string> = []
      let current: TreeFolder | undefined = folder
      let depth = 0
      while (current && depth < MAX_FOLDER_DEPTH) {
        names.unshift(current.name)
        current = current.parentFolderId
          ? folderById.get(current.parentFolderId)
          : undefined
        depth += 1
      }
      const full = [project.name, ...names]
      pathCache.set(folder.id, full)
      return full
    }

    for (const entry of boardEntries(
      project.whiteboards,
      project.canvasBoards,
      project.id,
    )) {
      index.push({ ...entry, path: [project.name] })
    }
    for (const folder of project.folders) {
      const parent = folder.parentFolderId
        ? folderById.get(folder.parentFolderId)
        : undefined
      index.push({
        type: 'folder',
        id: folder.id,
        name: folder.name,
        projectId: project.id,
        path: parent ? folderPath(parent) : [project.name],
      })
      for (const entry of boardEntries(
        folder.whiteboards,
        folder.canvasBoards,
        project.id,
      )) {
        index.push({ ...entry, path: folderPath(folder) })
      }
    }
  }
  return index
}

/**
 * Case-insensitive substring search on names. Names that start with the query
 * rank first, then name order; capped so a one-letter query stays cheap.
 */
export function searchIndex(
  index: ReadonlyArray<SearchEntry>,
  query: string,
  limit: number = MAX_SEARCH_RESULTS,
): Array<SearchEntry> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return index
    .filter((e) => e.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      const aPrefix = a.name.toLowerCase().startsWith(needle) ? 0 : 1
      const bPrefix = b.name.toLowerCase().startsWith(needle) ? 0 : 1
      return aPrefix - bPrefix || compareNames(a.name, b.name)
    })
    .slice(0, limit)
}
