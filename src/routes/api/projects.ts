// src/routes/api/projects.ts
// TanStack Start server functions for Project CRUD operations

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createProject,
  deleteProject,
  findAllProjectsForUser,
  findAllProjectsWithTreeForUser,
  findProjectById,
  findProjectPageContent,
  updateProject,
} from '@/data/project'
import { createProjectSchema, updateProjectSchema } from '@/data/schema'
import { requireAuth } from '@/lib/auth/middleware'
import { findEffectiveRole } from '@/data/permission'
import { hasMinimumRole } from '@/lib/auth/permissions'

/**
 * Get all projects accessible to the authenticated user
 * Returns projects the user owns or has membership in
 */
export const getProjects = createServerFn({ method: 'GET' }).handler(
  requireAuth(async ({ user }) => {
    try {
      const projects = await findAllProjectsForUser(user.id)
      return projects
    } catch (error) {
      throw new Error(
        `Failed to fetch projects: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }),
)

/**
 * Get all projects with their folder and whiteboard tree (filtered to user's accessible projects)
 * Returns projects with nested folders and whiteboards for navigation
 */
export const getProjectsWithTree = createServerFn({
  method: 'GET',
}).handler(
  requireAuth(async ({ user }) => {
    try {
      const projects = await findAllProjectsWithTreeForUser(user.id)
      return projects
    } catch (error) {
      throw new Error(
        `Failed to fetch project tree: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }),
)

/**
 * Get a single project by ID
 * Requires VIEWER+ role on the project.
 * @param projectId - Project UUID
 */
export const getProject = createServerFn({ method: 'GET' })
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
        const project = await findProjectById(projectId)
        if (!project) {
          throw new Error('Project not found')
        }
        return project
      } catch (error) {
        throw new Error(
          `Failed to fetch project: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Create a new project
 * @param data - Project creation data (name, description)
 */
export const createProjectFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createProjectSchema.parse(data))
  .handler(
    requireAuth(async ({ user }, data) => {
      try {
        const project = await createProject({ ...data, ownerId: user.id })
        return project
      } catch (error) {
        throw new Error(
          `Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Update an existing project
 * @param params - Object with id and data fields
 */
export const updateProjectFn = createServerFn({ method: 'POST' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      id: z.string().uuid(),
      data: updateProjectSchema,
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async ({ user }, params) => {
      // Requires ADMIN+ role to update project settings
      const role = await findEffectiveRole(user.id, params.id)
      if (!hasMinimumRole(role, 'ADMIN')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
      try {
        const project = await updateProject(params.id, params.data)
        return project
      } catch (error) {
        throw new Error(
          `Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )

/**
 * Get project page content (folders + whiteboards at a given level)
 * Requires VIEWER+ role on the project.
 * @param params - Object with projectId and optional folderId
 */
export const getProjectPageContent = createServerFn({ method: 'GET' })
  .inputValidator((params: unknown) => {
    const schema = z.object({
      projectId: z.string().uuid(),
      folderId: z.string().uuid().optional(),
    })
    return schema.parse(params)
  })
  .handler(
    requireAuth(async ({ user }, data) => {
      const role = await findEffectiveRole(user.id, data.projectId)
      if (!hasMinimumRole(role, 'VIEWER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
      const content = await findProjectPageContent(
        data.projectId,
        data.folderId,
      )
      if (!content) {
        throw new Error('Project not found')
      }
      return content
    }),
  )

/**
 * Delete a project by ID
 * Only OWNER can delete a project.
 * Cascade deletes all folders and whiteboards within the project
 * @param projectId - Project UUID
 */
export const deleteProjectFn = createServerFn({ method: 'POST' })
  .inputValidator((projectId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(projectId)
  })
  .handler(
    requireAuth(async ({ user }, projectId) => {
      // Only OWNER can delete a project
      const role = await findEffectiveRole(user.id, projectId)
      if (!hasMinimumRole(role, 'OWNER')) {
        return {
          error: 'FORBIDDEN',
          status: 403,
          message: 'Access denied',
        } as const
      }
      try {
        const project = await deleteProject(projectId)
        return project
      } catch (error) {
        throw new Error(
          `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }),
  )
