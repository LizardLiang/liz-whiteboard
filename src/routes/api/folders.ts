// src/routes/api/folders.ts
// TanStack Start server functions for Folder CRUD operations

import { createServerFn } from '@tanstack/start'
import { z } from 'zod'
import {
  createFolder,
  deleteFolder,
  findChildFolders,
  findFolderById,
  findFolderByIdWithWhiteboards,
  findFoldersByProjectId,
  updateFolder,
} from '@/data/folder'
import { createFolderSchema, updateFolderSchema } from '@/data/schema'

/**
 * Get all folders in a project
 * @param projectId - Project UUID
 */
export const getFoldersByProject = createServerFn(
  'GET',
  async (projectId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(projectId)

    try {
      const folders = await findFoldersByProjectId(projectId)
      return folders
    } catch (error) {
      throw new Error(
        `Failed to fetch folders: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Get child folders of a parent folder
 * @param parentFolderId - Parent folder UUID
 */
export const getChildFolders = createServerFn(
  'GET',
  async (parentFolderId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(parentFolderId)

    try {
      const folders = await findChildFolders(parentFolderId)
      return folders
    } catch (error) {
      throw new Error(
        `Failed to fetch child folders: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Get a single folder by ID with its whiteboards
 * @param folderId - Folder UUID
 */
export const getFolder = createServerFn('GET', async (folderId: string) => {
  // Validate UUID format
  const idSchema = z.string().uuid()
  idSchema.parse(folderId)

  try {
    const folder = await findFolderByIdWithWhiteboards(folderId)
    if (!folder) {
      throw new Error('Folder not found')
    }
    return folder
  } catch (error) {
    throw new Error(
      `Failed to fetch folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
})

/**
 * Get a single folder by ID (without relations)
 * @param folderId - Folder UUID
 */
export const getFolderById = createServerFn('GET', async (folderId: string) => {
  // Validate UUID format
  const idSchema = z.string().uuid()
  idSchema.parse(folderId)

  try {
    const folder = await findFolderById(folderId)
    if (!folder) {
      throw new Error('Folder not found')
    }
    return folder
  } catch (error) {
    throw new Error(
      `Failed to fetch folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
})

/**
 * Create a new folder
 * @param data - Folder creation data (name, projectId, optional parentFolderId)
 */
export const createFolderFn = createServerFn('POST', async (data: unknown) => {
  // Validate input with Zod schema
  const validated = createFolderSchema.parse(data)

  try {
    const folder = await createFolder(validated)
    return folder
  } catch (error) {
    throw new Error(
      `Failed to create folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
})

/**
 * Update an existing folder
 * @param params - Object with id and data fields
 */
export const updateFolderFn = createServerFn(
  'PUT',
  async (params: { id: string; data: unknown }) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(params.id)

    // Validate update data with Zod schema
    const validated = updateFolderSchema.parse(params.data)

    try {
      const folder = await updateFolder(params.id, validated)
      return folder
    } catch (error) {
      throw new Error(
        `Failed to update folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Delete a folder by ID
 * Cascade deletes all child folders and whiteboards within the folder
 * @param folderId - Folder UUID
 */
export const deleteFolderFn = createServerFn(
  'DELETE',
  async (folderId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(folderId)

    try {
      const folder = await deleteFolder(folderId)
      return folder
    } catch (error) {
      throw new Error(
        `Failed to delete folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)
