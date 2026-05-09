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
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { getFolderProjectId } from '@/data/resolve-project'

/**
 * Get all folders in a project
 * Requires VIEWER+ role on the project.
 * @param projectId - Project UUID
 * @requires viewer
 */
export const getFoldersByProject = createServerFn({ method: 'GET' })
  .inputValidator((projectId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(projectId)
  })
  .handler(
    requireAuth(async ({ user }, projectId) => {
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires VIEWER+ role on the folder's project.
 * @param parentFolderId - Parent folder UUID
 * @requires viewer
 */
export const getChildFolders = createServerFn({ method: 'GET' })
  .inputValidator((parentFolderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(parentFolderId)
  })
  .handler(
    requireAuth(async ({ user }, parentFolderId) => {
      const projectId = await getFolderProjectId(parentFolderId)
      if (!projectId) {
        throw new Error('Folder not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires VIEWER+ role on the folder's project.
 * @param folderId - Folder UUID
 * @requires viewer
 */
export const getFolder = createServerFn({ method: 'GET' })
  .inputValidator((folderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(folderId)
  })
  .handler(
    requireAuth(async ({ user }, folderId) => {
      const projectId = await getFolderProjectId(folderId)
      if (!projectId) {
        throw new Error('Folder not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires VIEWER+ role on the folder's project.
 * @param folderId - Folder UUID
 * @requires viewer
 */
export const getFolderById = createServerFn({ method: 'GET' })
  .inputValidator((folderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(folderId)
  })
  .handler(
    requireAuth(async ({ user }, folderId) => {
      const projectId = await getFolderProjectId(folderId)
      if (!projectId) {
        throw new Error('Folder not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires EDITOR+ role on the project.
 * @param data - Folder creation data (name, projectId, optional parentFolderId)
 * @requires editor
 */
export const createFolderFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createFolderSchema.parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      const role = await findEffectiveRole(user.id, data.projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires EDITOR+ role on the folder's project.
 * @param params - Object with id and data fields
 * @requires editor
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
    requireAuth(async ({ user }, params) => {
      const projectId = await getFolderProjectId(params.id)
      if (!projectId) {
        throw new Error('Folder not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
 * Requires EDITOR+ role on the folder's project.
 * Cascade deletes all child folders and whiteboards within the folder
 * @param folderId - Folder UUID
 * @requires editor
 */
export const deleteFolderFn = createServerFn({ method: 'POST' })
  .inputValidator((folderId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(folderId)
  })
  .handler(
    requireAuth(async ({ user }, folderId) => {
      const projectId = await getFolderProjectId(folderId)
      if (!projectId) {
        throw new Error('Folder not found')
      }
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'EDITOR')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
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
