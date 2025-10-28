// src/data/folder.ts
// Data access layer for Folder entity

import { createFolderSchema, updateFolderSchema } from './schema'
import type { CreateFolder, UpdateFolder } from './schema'
import type { Folder } from '@prisma/client'
import { prisma } from '@/db'

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
    const folder = await prisma.folder.create({
      data: validated,
    })
    return folder
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
    const folders = await prisma.folder.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    })
    return folders
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
    const folders = await prisma.folder.findMany({
      where: { parentFolderId },
      orderBy: { name: 'asc' },
    })
    return folders
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
    const folder = await prisma.folder.findUnique({
      where: { id },
      include: {
        whiteboards: {
          select: { id: true, name: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        },
      },
    })
    return folder
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
    const folder = await prisma.folder.findUnique({
      where: { id },
    })
    return folder
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
    const folder = await prisma.folder.update({
      where: { id },
      data: validated,
    })
    return folder
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
    const folder = await prisma.folder.delete({
      where: { id },
    })
    return folder
  } catch (error) {
    throw new Error(
      `Failed to delete folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
