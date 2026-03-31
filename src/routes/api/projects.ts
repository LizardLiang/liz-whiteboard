// src/routes/api/projects.ts
// TanStack Start server functions for Project CRUD operations

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createProject,
  deleteProject,
  findAllProjects,
  findAllProjectsWithTree,
  findProjectById,
  findProjectPageContent,
  updateProject,
} from '@/data/project'
import { createProjectSchema, updateProjectSchema } from '@/data/schema'

/**
 * Get all projects
 * Returns array of all projects ordered by creation date (newest first)
 */
export const getProjects = createServerFn({ method: 'GET' }).handler(
  async () => {
    try {
      const projects = await findAllProjects()
      return projects
    } catch (error) {
      throw new Error(
        `Failed to fetch projects: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Get all projects with their folder and whiteboard tree
 * Returns projects with nested folders and whiteboards for navigation
 */
export const getProjectsWithTree = createServerFn({
  method: 'GET',
}).handler(async () => {
  try {
    const projects = await findAllProjectsWithTree()
    return projects
  } catch (error) {
    throw new Error(
      `Failed to fetch project tree: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
})

/**
 * Get a single project by ID
 * @param projectId - Project UUID
 */
export const getProject = createServerFn({ method: 'GET' })
  .inputValidator((projectId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(projectId)
  })
  .handler(async ({ data: projectId }) => {
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
  })

/**
 * Create a new project
 * @param data - Project creation data (name, description)
 */
export const createProjectFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createProjectSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      const project = await createProject(data)
      return project
    } catch (error) {
      throw new Error(
        `Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

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
  .handler(async ({ data: params }) => {
    try {
      const project = await updateProject(params.id, params.data)
      return project
    } catch (error) {
      throw new Error(
        `Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })

/**
 * Get project page content (folders + whiteboards at a given level)
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
  .handler(async ({ data }) => {
    const content = await findProjectPageContent(data.projectId, data.folderId)
    if (!content) {
      throw new Error('Project not found')
    }
    return content
  })

/**
 * Delete a project by ID
 * Cascade deletes all folders and whiteboards within the project
 * @param projectId - Project UUID
 */
export const deleteProjectFn = createServerFn({ method: 'POST' })
  .inputValidator((projectId: string) => {
    const idSchema = z.string().uuid()
    return idSchema.parse(projectId)
  })
  .handler(async ({ data: projectId }) => {
    try {
      const project = await deleteProject(projectId)
      return project
    } catch (error) {
      throw new Error(
        `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  })
