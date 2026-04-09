// src/lib/server-functions-project.ts
// Server functions for project operations

import { createServerFn } from '@tanstack/react-start'
import { prisma } from '@/db'
import { requireAuth } from '@/lib/auth/middleware'

/**
 * Server function to fetch all projects with their whiteboards
 */
export const getAllProjects = createServerFn({
  method: 'GET',
}).handler(
  requireAuth(async () => {
    try {
      const projects = await prisma.project.findMany({
        include: {
          whiteboards: {
            orderBy: { updatedAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      return projects
    } catch (error) {
      console.error('Error fetching projects:', error)
      throw error
    }
  }),
)
