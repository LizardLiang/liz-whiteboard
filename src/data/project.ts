// src/data/project.ts
// Data access layer for Project entity

import { createProjectSchema, updateProjectSchema } from './schema'
import type { CreateProject, UpdateProject } from './schema'
import type { Project } from '@prisma/client'
import { prisma } from '@/db'

/**
 * Create a new project
 * @param data - Project creation data (validated with Zod)
 * @returns Created project
 * @throws Error if validation fails or database operation fails
 */
export async function createProject(data: CreateProject): Promise<Project> {
  // Validate input with Zod schema
  const validated = createProjectSchema.parse(data)

  try {
    const project = await prisma.project.create({
      data: validated,
    })
    return project
  } catch (error) {
    throw new Error(
      `Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all projects
 * @returns Array of all projects
 */
export async function findAllProjects(): Promise<Array<Project>> {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return projects
  } catch (error) {
    throw new Error(
      `Failed to fetch projects: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find all projects with their folder and whiteboard structure
 * @returns Array of projects with nested folders and whiteboards
 */
export async function findAllProjectsWithTree(): Promise<
  Array<
    Project & {
      folders: Array<{
        id: string
        name: string
        parentFolderId: string | null
        childFolders: Array<{ id: string; name: string }>
        whiteboards: Array<{ id: string; name: string }>
      }>
      whiteboards: Array<{ id: string; name: string }>
    }
  >
> {
  try {
    const projects = await prisma.project.findMany({
      include: {
        folders: {
          include: {
            childFolders: { select: { id: true, name: true } },
            whiteboards: { select: { id: true, name: true } },
          },
        },
        whiteboards: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return projects
  } catch (error) {
    throw new Error(
      `Failed to fetch project tree: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a project by ID
 * @param id - Project UUID
 * @returns Project or null if not found
 */
export async function findProjectById(id: string): Promise<Project | null> {
  try {
    const project = await prisma.project.findUnique({
      where: { id },
    })
    return project
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
    const project = await prisma.project.update({
      where: { id },
      data: validated,
    })
    return project
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
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    })
    if (!project) return null

    if (!folderId) {
      // Root view: folders and whiteboards directly under the project
      const [folders, whiteboards] = await Promise.all([
        prisma.folder.findMany({
          where: { projectId, parentFolderId: null },
          select: { id: true, name: true, createdAt: true },
          orderBy: { name: 'asc' },
        }),
        prisma.whiteboard.findMany({
          where: { projectId, folderId: null },
          select: {
            id: true,
            name: true,
            updatedAt: true,
            _count: { select: { tables: true } },
          },
          orderBy: { updatedAt: 'desc' },
        }),
      ])
      return {
        project,
        folders,
        whiteboards,
        breadcrumb: [],
      }
    }

    // Folder view: validate folder belongs to project
    const targetFolder = await prisma.folder.findUnique({
      where: { id: folderId },
      select: { id: true, name: true, projectId: true, parentFolderId: true },
    })
    if (!targetFolder || targetFolder.projectId !== projectId) {
      throw new Error('Folder not found')
    }

    // Fetch folders and whiteboards under this folder
    const [folders, whiteboards] = await Promise.all([
      prisma.folder.findMany({
        where: { parentFolderId: folderId },
        select: { id: true, name: true, createdAt: true },
        orderBy: { name: 'asc' },
      }),
      prisma.whiteboard.findMany({
        where: { folderId },
        select: {
          id: true,
          name: true,
          updatedAt: true,
          _count: { select: { tables: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ])

    // Build breadcrumb by walking up parentFolderId chain (depth-limited to 10)
    const breadcrumb: ProjectPageContent['breadcrumb'] = []
    let currentParentId: string | null = targetFolder.parentFolderId
    let depth = 0
    while (currentParentId && depth < 10) {
      const ancestor = await prisma.folder.findUnique({
        where: { id: currentParentId },
        select: { id: true, name: true, parentFolderId: true },
      })
      if (!ancestor) break
      breadcrumb.unshift({ id: ancestor.id, name: ancestor.name, type: 'folder' })
      currentParentId = ancestor.parentFolderId
      depth++
    }
    // Prepend project root
    breadcrumb.unshift({ id: project.id, name: project.name, type: 'project' })

    return {
      project,
      folders,
      whiteboards,
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
    const project = await prisma.project.delete({
      where: { id },
    })
    return project
  } catch (error) {
    throw new Error(
      `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
