/**
 * Unit tests for Project data access layer
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Project } from '@prisma/client'
import * as projectModule from './project'
import type { CreateProject, UpdateProject } from './schema'

// Mock the prisma import
vi.mock('@/db', () => ({
  prisma: {
    project: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { prisma } from '@/db'

const mockProject: Project = {
  id: 'proj-1',
  name: 'Test Project',
  description: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

describe('Project Data Access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createProject', () => {
    it('should create a project with valid data', async () => {
      const createData: CreateProject = {
        name: 'New Project',
      }

      vi.mocked(prisma.project.create).mockResolvedValue(mockProject)

      const result = await projectModule.createProject(createData)

      expect(prisma.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'New Project',
        }),
      })
      expect(result).toEqual(mockProject)
    })

    it('should create a project with description', async () => {
      const createData: CreateProject = {
        name: 'New Project',
        description: 'Project description',
      }

      const projectWithDescription = {
        ...mockProject,
        description: 'Project description',
      }

      vi.mocked(prisma.project.create).mockResolvedValue(projectWithDescription)

      const result = await projectModule.createProject(createData)

      expect(result.description).toBe('Project description')
    })

    it('should throw error on database failure', async () => {
      const createData: CreateProject = {
        name: 'New Project',
      }

      vi.mocked(prisma.project.create).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(projectModule.createProject(createData)).rejects.toThrow(
        'Failed to create project',
      )
    })

    it('should validate input with Zod schema', async () => {
      const invalidData = {
        name: '', // Empty name should fail validation
      } as CreateProject

      await expect(projectModule.createProject(invalidData)).rejects.toThrow()
    })
  })

  describe('findAllProjects', () => {
    it('should find all projects ordered by creation date', async () => {
      const projects = [mockProject]
      vi.mocked(prisma.project.findMany).mockResolvedValue(projects)

      const result = await projectModule.findAllProjects()

      expect(prisma.project.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      })
      expect(result).toEqual(projects)
    })

    it('should return empty array if no projects found', async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([])

      const result = await projectModule.findAllProjects()

      expect(result).toEqual([])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.project.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(projectModule.findAllProjects()).rejects.toThrow(
        'Failed to fetch projects',
      )
    })
  })

  describe('findAllProjectsWithTree', () => {
    it('should find projects with nested folder and whiteboard structure', async () => {
      const projectWithTree = {
        ...mockProject,
        folders: [
          {
            id: 'folder-1',
            name: 'Folder 1',
            parentFolderId: null,
            childFolders: [],
            whiteboards: [{ id: 'wb-1', name: 'Whiteboard 1' }],
          },
        ],
        whiteboards: [{ id: 'wb-2', name: 'Whiteboard 2' }],
      }

      vi.mocked(prisma.project.findMany).mockResolvedValue([
        projectWithTree as any,
      ])

      const result = await projectModule.findAllProjectsWithTree()

      expect(prisma.project.findMany).toHaveBeenCalledWith({
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
      expect(result).toEqual([projectWithTree])
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.project.findMany).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(projectModule.findAllProjectsWithTree()).rejects.toThrow(
        'Failed to fetch project tree',
      )
    })
  })

  describe('findProjectById', () => {
    it('should find project by ID', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(mockProject)

      const result = await projectModule.findProjectById('proj-1')

      expect(prisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
      })
      expect(result).toEqual(mockProject)
    })

    it('should return null if project not found', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(null)

      const result = await projectModule.findProjectById('nonexistent')

      expect(result).toBeNull()
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.project.findUnique).mockRejectedValue(
        new Error('Database error'),
      )

      await expect(projectModule.findProjectById('proj-1')).rejects.toThrow(
        'Failed to fetch project',
      )
    })
  })

  describe('updateProject', () => {
    it('should update project with valid data', async () => {
      const updateData: UpdateProject = {
        name: 'Updated Name',
        description: 'Updated description',
      }

      const updatedProject = {
        ...mockProject,
        ...updateData,
      }

      vi.mocked(prisma.project.update).mockResolvedValue(updatedProject)

      const result = await projectModule.updateProject('proj-1', updateData)

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: updateData,
      })
      expect(result).toEqual(updatedProject)
    })

    it('should update only name', async () => {
      const updateData: UpdateProject = {
        name: 'New Name Only',
      }

      const updatedProject = {
        ...mockProject,
        name: 'New Name Only',
      }

      vi.mocked(prisma.project.update).mockResolvedValue(updatedProject)

      const result = await projectModule.updateProject('proj-1', updateData)

      expect(result.name).toBe('New Name Only')
    })

    it('should throw error on database failure', async () => {
      vi.mocked(prisma.project.update).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(
        projectModule.updateProject('proj-1', { name: 'Test' }),
      ).rejects.toThrow('Failed to update project')
    })
  })

  describe('deleteProject', () => {
    it('should delete project', async () => {
      vi.mocked(prisma.project.delete).mockResolvedValue(mockProject)

      const result = await projectModule.deleteProject('proj-1')

      expect(prisma.project.delete).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
      })
      expect(result).toEqual(mockProject)
    })

    it('should throw error if project not found', async () => {
      vi.mocked(prisma.project.delete).mockRejectedValue(
        new Error('Not found'),
      )

      await expect(
        projectModule.deleteProject('nonexistent'),
      ).rejects.toThrow('Failed to delete project')
    })
  })
})
