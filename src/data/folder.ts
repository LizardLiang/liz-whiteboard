// src/data/folder.ts
// Data access layer for Folder entity

import { createFolderSchema, updateFolderSchema } from './schema'
import type { CreateFolder, UpdateFolder } from './schema'
import type { Folder } from './models'
import { db, genId, insert, mapFolder, nowMs, update } from '@/db'

/**
 * Create a new folder
 * @param data - Folder creation data (validated with Zod)
 * @returns Created folder
 * @throws Error if validation fails or database operation fails
 */
export async function createFolder(data: CreateFolder): Promise<Folder> {
  // Validate input with Zod schema
  const validated = createFolderSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    insert('Folder', {
      id,
      name: validated.name,
      projectId: validated.projectId,
      parentFolderId: validated.parentFolderId ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    return mapFolder(
      db.prepare('SELECT * FROM "Folder" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to create folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all folders in a project
 * @param projectId - Project UUID
 * @returns Array of folders in the project
 */
export async function findFoldersByProjectId(
  projectId: string,
): Promise<Array<Folder>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Folder" WHERE "projectId" = ? ORDER BY "createdAt" ASC',
      )
      .all(projectId)
      .map((r) => mapFolder(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch folders: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find child folders of a parent folder
 * @param parentFolderId - Parent folder UUID
 * @returns Array of child folders
 */
export async function findChildFolders(
  parentFolderId: string,
): Promise<Array<Folder>> {
  try {
    return db
      .prepare(
        'SELECT * FROM "Folder" WHERE "parentFolderId" = ? ORDER BY "name" ASC',
      )
      .all(parentFolderId)
      .map((r) => mapFolder(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch child folders: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a folder by ID with its whiteboards
 * @param id - Folder UUID
 * @returns Folder with whiteboards or null if not found
 */
export async function findFolderByIdWithWhiteboards(id: string): Promise<
  | (Folder & {
      whiteboards: Array<{ id: string; name: string; updatedAt: Date }>
    })
  | null
> {
  try {
    const folder = mapFolder(
      db.prepare('SELECT * FROM "Folder" WHERE "id" = ?').get(id),
    )
    if (!folder) return null

    const whiteboards = db
      .prepare(
        'SELECT * FROM "Whiteboard" WHERE "folderId" = ? ORDER BY "updatedAt" DESC',
      )
      .all(id)
      .map((r) => ({
        id: r.id as string,
        name: r.name as string,
        updatedAt: new Date(Number(r.updatedAt)),
      }))

    return { ...folder, whiteboards }
  } catch (error) {
    throw new Error(
      `Failed to fetch folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a folder by ID
 * @param id - Folder UUID
 * @returns Folder or null if not found
 */
export async function findFolderById(id: string): Promise<Folder | null> {
  try {
    return mapFolder(
      db.prepare('SELECT * FROM "Folder" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a folder
 * @param id - Folder UUID
 * @param data - Partial folder data to update (validated with Zod)
 * @returns Updated folder
 * @throws Error if folder not found or validation fails
 */
export async function updateFolder(
  id: string,
  data: UpdateFolder,
): Promise<Folder> {
  // Validate input with Zod schema
  const validated = updateFolderSchema.parse(data)

  try {
    const values: Record<string, unknown> = { updatedAt: nowMs() }
    if (validated.name !== undefined) values.name = validated.name
    update('Folder', id, values)
    return mapFolder(
      db.prepare('SELECT * FROM "Folder" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a folder (cascade deletes child folders and whiteboards)
 * @param id - Folder UUID
 * @returns Deleted folder
 * @throws Error if folder not found
 */
export async function deleteFolder(id: string): Promise<Folder> {
  try {
    const existing = mapFolder(
      db.prepare('SELECT * FROM "Folder" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Folder not found')
    db.prepare('DELETE FROM "Folder" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
