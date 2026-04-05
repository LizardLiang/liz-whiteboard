// src/routes/api/folders.ts
// TanStack Start server functions for Folder CRUD operations

import { createServerFn } from '@tanstack/react-start'
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
import { requireAuth } from '@/lib/auth/middleware'

/**
 * Get all folders in a project
 * @param projectId - Project UUID
 */
export const getFoldersByProject = createServerFn({ method: 'GET' })
  .inputValidator((projectId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(projectId)
  })
  .handler(
    requireAuth(async (_ctx, projectId) => {
      try {
        const folders = await findFoldersByProjectId(projectId)
        return folders
      } catch (error) {
        throw new Error(
          `Failed to fetch folders: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get child folders of a parent folder
 * @param parentFolderId - Parent folder UUID
 */
export const getChildFolders = createServerFn({ method: 'GET' })
  .inputValidator((parentFolderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(parentFolderId)
  })
  .handler(
    requireAuth(async (_ctx, parentFolderId) => {
      try {
        const folders = await findChildFolders(parentFolderId)
        return folders
      } catch (error) {
        throw new Error(
          `Failed to fetch child folders: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get a single folder by ID with its whiteboards
 * @param folderId - Folder UUID
 */
export const getFolder = createServerFn({ method: 'GET' })
  .inputValidator((folderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(folderId)
  })
  .handler(
    requireAuth(async (_ctx, folderId) => {
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
    }),
  )

/**
 * Get a single folder by ID (without relations)
 * @param folderId - Folder UUID
 */
export const getFolderById = createServerFn({ method: 'GET' })
  .inputValidator((folderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(folderId)
  })
  .handler(
    requireAuth(async (_ctx, folderId) => {
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
    }),
  )

/**
 * Create a new folder
 * @param data - Folder creation data (name, projectId, optional parentFolderId)
 */
export const createFolderFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createFolderSchema.parse(data))
  .handler(
    requireAuth(async (_ctx, data) => {
      try {
        const folder = await createFolder(data)
        return folder
      } catch (error) {
        throw new Error(
          `Failed to create folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update an existing folder
 * @param params - Object with id and data fields
 */
export const updateFolderFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      data: updateFolderSchema,
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async (_ctx, params) => {
      try {
        const folder = await updateFolder(params.id, params.data)
        return folder
      } catch (error) {
        throw new Error(
          `Failed to update folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Delete a folder by ID
 * Cascade deletes all child folders and whiteboards within the folder
 * @param folderId - Folder UUID
 */
export const deleteFolderFn = createServerFn({ method: 'POST' })
  .inputValidator((folderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(folderId)
  })
  .handler(
    requireAuth(async (_ctx, folderId) => {
      try {
        const folder = await deleteFolder(folderId)
        return folder
      } catch (error) {
        throw new Error(
          `Failed to delete folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )
