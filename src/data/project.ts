// src/data/project.ts
// Data access layer for Project entity

import { createProjectSchema, updateProjectSchema } from './schema'
import type { CreateProject, UpdateProject } from './schema'
import type { Project } from './models'
import { db, genId, insert, mapProject, nowMs, update } from '@/db'

/**
 * Create a new project
 * @param data - Project creation data (validated with Zod) + optional ownerId
 * @returns Created project
 * @throws Error if validation fails or database operation fails
 */
export async function createProject(
  data: CreateProject & { ownerId?: string },
): Promise<Project> {
  // Validate the base input fields with Zod schema
  const validated = createProjectSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    insert('Project', {
      id,
      name: validated.name,
      description: validated.description ?? null,
      ownerId: data.ownerId ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    return mapProject(
      db.prepare('SELECT * FROM "Project" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

// findAllProjects (unfiltered) removed — replaced by findAllProjectsForUser

/**
 * Find all projects accessible to a user.
 * Scoped to projects the user owns or is an explicit ProjectMember of.
 * @param userId - User UUID
 * @returns Array of projects owned by or shared with the user
 */
export async function findAllProjectsForUser(
  userId: string,
): Promise<Array<Project>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Project" WHERE "ownerId" = ? OR "id" IN (SELECT "projectId" FROM "ProjectMember" WHERE "userId" = ?) ORDER BY "createdAt" DESC',
      )
      .all(userId, userId)
      .map((r) => mapProject(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch projects: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * A tree-level board row, tagged with which board kind it is. Both
 * `Whiteboard` and `CanvasBoard` rows are mapped to this same shape so the
 * navigator can tell them apart without smuggling one kind through the
 * other's field — see navigator-create-canvas-board's discovery ledger
 * ("the tree payload can carry canvas boards in the whiteboard shape" was
 * the rejected reading; the `kind` tag is the fix).
 */
export interface TreeBoardRow {
  id: string
  name: string
  updatedAt: Date
  kind: 'whiteboard' | 'canvas'
}

/**
 * Find all projects with their folder, whiteboard, and canvas board
 * structure. Scoped to projects the user owns or is an explicit
 * ProjectMember of.
 *
 * `whiteboards` and `canvasBoards` stay as two separate arrays (each row
 * tagged with `kind` and carrying `updatedAt`) rather than one merged
 * field — the navigator components merge-and-sort them at render time
 * (`src/components/navigator/merge-boards.ts`) so a level's rows interleave
 * by `updatedAt` across both kinds, while other callers (e.g. the project
 * card counts on the home page) can keep reading `whiteboards.length`
 * unaffected by canvas boards.
 *
 * @param userId - User UUID
 * @returns Array of projects owned by or shared with the user, with nested folders, whiteboards, and canvas boards
 */
export async function findAllProjectsWithTreeForUser(userId: string): Promise<
  Array<
    Project & {
      folders: Array<{
        id: string
        name: string
        parentFolderId: string | null
        childFolders: Array<{ id: string; name: string }>
        whiteboards: Array<TreeBoardRow>
        canvasBoards: Array<TreeBoardRow>
      }>
      whiteboards: Array<TreeBoardRow>
      canvasBoards: Array<TreeBoardRow>
    }
  >
> {
  const mapBoardRow = (
    r: Record<string, unknown>,
    kind: TreeBoardRow['kind'],
  ): TreeBoardRow => ({
    id: r.id as string,
    name: r.name as string,
    updatedAt: new Date(Number(r.updatedAt)),
    kind,
  })

  try {
    const projects = db
      .prepare(
        'SELECT * FROM "Project" WHERE "ownerId" = ? OR "id" IN (SELECT "projectId" FROM "ProjectMember" WHERE "userId" = ?) ORDER BY "createdAt" DESC',
      )
      .all(userId, userId)
      .map((r) => mapProject(r)!)

    return projects.map((project) => {
      const folders = db
        .prepare('SELECT * FROM "Folder" WHERE "projectId" = ?')
        .all(project.id)
        .map((r) => {
          const folderId = r.id as string
          const childFolders = db
            .prepare(
              'SELECT "id", "name" FROM "Folder" WHERE "parentFolderId" = ?',
            )
            .all(folderId)
            .map((c) => ({ id: c.id as string, name: c.name as string }))
          const whiteboards = db
            .prepare(
              'SELECT "id", "name", "updatedAt" FROM "Whiteboard" WHERE "folderId" = ?',
            )
            .all(folderId)
            .map((w) => mapBoardRow(w, 'whiteboard'))
          const canvasBoards = db
            .prepare(
              'SELECT "id", "name", "updatedAt" FROM "CanvasBoard" WHERE "folderId" = ?',
            )
            .all(folderId)
            .map((c) => mapBoardRow(c, 'canvas'))
          return {
            id: folderId,
            name: r.name as string,
            parentFolderId: (r.parentFolderId as string | null) ?? null,
            childFolders,
            whiteboards,
            canvasBoards,
          }
        })

      const whiteboards = db
        .prepare(
          'SELECT "id", "name", "updatedAt" FROM "Whiteboard" WHERE "projectId" = ? AND "folderId" IS NULL',
        )
        .all(project.id)
        .map((w) => mapBoardRow(w, 'whiteboard'))

      const canvasBoards = db
        .prepare(
          'SELECT "id", "name", "updatedAt" FROM "CanvasBoard" WHERE "projectId" = ? AND "folderId" IS NULL',
        )
        .all(project.id)
        .map((c) => mapBoardRow(c, 'canvas'))

      return { ...project, folders, whiteboards, canvasBoards }
    })
  } catch (error) {
    throw new Error(
      `Failed to fetch project tree for user: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

// findAllProjectsWithTree (unfiltered) removed — replaced by findAllProjectsWithTreeForUser

/**
 * Find a project by ID
 * @param id - Project UUID
 * @returns Project or null if not found
 */
export async function findProjectById(id: string): Promise<Project | null> {
  try {
    return mapProject(
      db.prepare('SELECT * FROM "Project" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch project: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a project
 * @param id - Project UUID
 * @param data - Partial project data to update (validated with Zod)
 * @returns Updated project
 * @throws Error if project not found or validation fails
 */
export async function updateProject(
  id: string,
  data: UpdateProject,
): Promise<Project> {
  // Validate input with Zod schema
  const validated = updateProjectSchema.parse(data)

  try {
    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.name !== undefined) values.name = validated.name
    if (validated.description !== undefined)
      values.description = validated.description
    update('Project', id, values)
    return mapProject(
      db.prepare('SELECT * FROM "Project" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * ProjectPageContent return type for findProjectPageContent
 */
export interface ProjectPageContent {
  project: { id: string; name: string }
  folders: Array<{
    id: string
    name: string
    createdAt: Date
  }>
  whiteboards: Array<{
    id: string
    name: string
    updatedAt: Date
    _count: { tables: number }
  }>
  /**
   * Canvas boards at this level. A separate, non-interleaved array —
   * `ProjectContentGrid` renders these cards after the whiteboard cards
   * (grouped by kind), unlike the sidebar tree which interleaves by
   * `updatedAt` — see `findAllProjectsWithTreeForUser`'s doc comment.
   */
  canvasBoards: Array<{
    id: string
    name: string
    updatedAt: Date
    _count: { elements: number }
  }>
  breadcrumb: Array<{
    id: string
    name: string
    type: 'project' | 'folder'
  }>
  currentFolder?: { id: string; name: string }
}

/**
 * Find project page content (folders + whiteboards at a given level)
 * @param projectId - Project UUID
 * @param folderId - Optional folder UUID for folder view
 * @returns ProjectPageContent or null if project not found
 */
export async function findProjectPageContent(
  projectId: string,
  folderId?: string,
): Promise<ProjectPageContent | null> {
  // Batch COUNT(*) rows in `table` grouped by `parentIdColumn`, keyed into a
  // Map for O(1) lookup — replaces one COUNT(*) query per row (N+1) with a
  // single grouped query per board kind, per page load. An id absent from
  // the result had zero matching children (see the `?? 0` fallbacks below);
  // it is never dropped from the page's board list.
  const batchCounts = (
    table: string,
    parentIdColumn: string,
    parentIds: Array<string>,
  ): Map<string, number> => {
    const counts = new Map<string, number>()
    if (parentIds.length === 0) return counts
    const placeholders = parentIds.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT "${parentIdColumn}" AS "parentId", COUNT(*) AS "count" FROM "${table}" WHERE "${parentIdColumn}" IN (${placeholders}) GROUP BY "${parentIdColumn}"`,
      )
      .all(...parentIds)
    for (const r of rows) {
      counts.set(r.parentId as string, Number(r.count))
    }
    return counts
  }

  // Map whiteboard rows (id, name, updatedAt) + their table counts, batched
  // via a single grouped query instead of one COUNT per row.
  const mapWhiteboardRows = (
    rows: Array<Record<string, unknown>>,
  ): ProjectPageContent['whiteboards'] => {
    const counts = batchCounts(
      'DiagramTable',
      'whiteboardId',
      rows.map((r) => r.id as string),
    )
    return rows.map((r) => {
      const wbId = r.id as string
      return {
        id: wbId,
        name: r.name as string,
        updatedAt: new Date(Number(r.updatedAt)),
        _count: { tables: counts.get(wbId) ?? 0 },
      }
    })
  }

  const mapFolderRow = (r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    createdAt: new Date(Number(r.createdAt)),
  })

  // Map canvas board rows (id, name, updatedAt) + their element counts,
  // mirroring `mapWhiteboardRows`'s batched `_count.tables` approach.
  const mapCanvasBoardRows = (
    rows: Array<Record<string, unknown>>,
  ): ProjectPageContent['canvasBoards'] => {
    const counts = batchCounts(
      'CanvasElement',
      'boardId',
      rows.map((r) => r.id as string),
    )
    return rows.map((r) => {
      const boardId = r.id as string
      return {
        id: boardId,
        name: r.name as string,
        updatedAt: new Date(Number(r.updatedAt)),
        _count: { elements: counts.get(boardId) ?? 0 },
      }
    })
  }

  try {
    const projectRow = db
      .prepare('SELECT "id", "name" FROM "Project" WHERE "id" = ?')
      .get(projectId)
    if (!projectRow) return null
    const project = {
      id: projectRow.id as string,
      name: projectRow.name as string,
    }

    if (!folderId) {
      // Root view: folders, whiteboards, and canvas boards directly under
      // the project
      const folders = db
        .prepare(
          'SELECT "id", "name", "createdAt" FROM "Folder" WHERE "projectId" = ? AND "parentFolderId" IS NULL ORDER BY "name" ASC',
        )
        .all(projectId)
        .map(mapFolderRow)
      const whiteboards = mapWhiteboardRows(
        db
          .prepare(
            'SELECT "id", "name", "updatedAt" FROM "Whiteboard" WHERE "projectId" = ? AND "folderId" IS NULL ORDER BY "updatedAt" DESC',
          )
          .all(projectId),
      )
      const canvasBoards = mapCanvasBoardRows(
        db
          .prepare(
            'SELECT "id", "name", "updatedAt" FROM "CanvasBoard" WHERE "projectId" = ? AND "folderId" IS NULL ORDER BY "updatedAt" DESC',
          )
          .all(projectId),
      )
      return {
        project,
        folders,
        whiteboards,
        canvasBoards,
        breadcrumb: [],
      }
    }

    // Folder view: validate folder belongs to project
    const targetFolderRow = db
      .prepare(
        'SELECT "id", "name", "projectId", "parentFolderId" FROM "Folder" WHERE "id" = ?',
      )
      .get(folderId)
    if (!targetFolderRow || targetFolderRow.projectId !== projectId) {
      throw new Error('Folder not found')
    }
    const targetFolder = {
      id: targetFolderRow.id as string,
      name: targetFolderRow.name as string,
      parentFolderId: (targetFolderRow.parentFolderId as string | null) ?? null,
    }

    // Fetch folders and whiteboards under this folder (projectId added for defense-in-depth)
    const folders = db
      .prepare(
        'SELECT "id", "name", "createdAt" FROM "Folder" WHERE "projectId" = ? AND "parentFolderId" = ? ORDER BY "name" ASC',
      )
      .all(projectId, folderId)
      .map(mapFolderRow)
    const whiteboards = mapWhiteboardRows(
      db
        .prepare(
          'SELECT "id", "name", "updatedAt" FROM "Whiteboard" WHERE "projectId" = ? AND "folderId" = ? ORDER BY "updatedAt" DESC',
        )
        .all(projectId, folderId),
    )
    const canvasBoards = mapCanvasBoardRows(
      db
        .prepare(
          'SELECT "id", "name", "updatedAt" FROM "CanvasBoard" WHERE "projectId" = ? AND "folderId" = ? ORDER BY "updatedAt" DESC',
        )
        .all(projectId, folderId),
    )

    // Build breadcrumb via single recursive CTE (one round-trip, no N+1)
    // Starts at the target folder's parent and walks up to the root.
    const breadcrumb: ProjectPageContent['breadcrumb'] = []
    if (targetFolder.parentFolderId) {
      type AncestorRow = {
        id: string
        name: string
        parentFolderId: string | null
      }
      const ancestors = db
        .prepare(
          `WITH RECURSIVE ancestors AS (
            SELECT id, name, "parentFolderId", "projectId"
            FROM "Folder"
            WHERE id = ?
            UNION ALL
            SELECT f.id, f.name, f."parentFolderId", f."projectId"
            FROM "Folder" f
            INNER JOIN ancestors a ON f.id = a."parentFolderId"
          )
          SELECT id, name, "parentFolderId" FROM ancestors`,
        )
        .all(targetFolder.parentFolderId) as Array<AncestorRow>
      // CTE returns leaf→root order; reverse to get root→leaf for the breadcrumb trail
      for (const ancestor of ancestors.reverse()) {
        breadcrumb.push({
          id: ancestor.id,
          name: ancestor.name,
          type: 'folder',
        })
      }
    }
    // Prepend project root
    breadcrumb.unshift({ id: project.id, name: project.name, type: 'project' })

    return {
      project,
      folders,
      whiteboards,
      canvasBoards,
      breadcrumb,
      currentFolder: { id: targetFolder.id, name: targetFolder.name },
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Folder not found') {
      throw error
    }
    throw new Error(
      `Failed to fetch project page content: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a project (cascade deletes all folders and whiteboards)
 * @param id - Project UUID
 * @returns Deleted project
 * @throws Error if project not found
 */
export async function deleteProject(id: string): Promise<Project> {
  try {
    const existing = mapProject(
      db.prepare('SELECT * FROM "Project" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Project not found')
    db.prepare('DELETE FROM "Project" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
