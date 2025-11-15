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
  updateProject,
} from '@/data/project'
import { createProjectSchema, updateProjectSchema } from '@/data/schema'

/**
 * Get all projects
 * Returns array of all projects ordered by creation date (newest first)
 */
export const getProjects = createServerFn('GET', async () => {
  try {
    const projects = await findAllProjects()
    return projects
  } catch (error) {
    throw new Error(
      `Failed to fetch projects: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
})

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
export const getProject = createServerFn('GET', async (projectId: string) => {
  // Validate UUID format
  const idSchema = z.string().uuid()
  idSchema.parse(projectId)

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
export const createProjectFn = createServerFn('POST', async (data: unknown) => {
  // Validate input with Zod schema
  const validated = createProjectSchema.parse(data)

  try {
    const project = await createProject(validated)
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
export const updateProjectFn = createServerFn(
  'PUT',
  async (params: { id: string; data: unknown }) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(params.id)

    // Validate update data with Zod schema
    const validated = updateProjectSchema.parse(params.data)

    try {
      const project = await updateProject(params.id, validated)
      return project
    } catch (error) {
      throw new Error(
        `Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)

/**
 * Delete a project by ID
 * Cascade deletes all folders and whiteboards within the project
 * @param projectId - Project UUID
 */
export const deleteProjectFn = createServerFn(
  'DELETE',
  async (projectId: string) => {
    // Validate UUID format
    const idSchema = z.string().uuid()
    idSchema.parse(projectId)

    try {
      const project = await deleteProject(projectId)
      return project
    } catch (error) {
      throw new Error(
        `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  },
)
