// src/lib/server-functions-project.ts
// Server functions for project operations

import { createServerFn } from '@tanstack/react-start'
import { prisma } from '@/db'
import { requireAuth } from '@/lib/auth/middleware'

/**
 * Fetch all projects accessible to the authenticated user.
 * The user's role on each project is enforced at the DB layer
 * (project.ownerId or ProjectMember membership) — no additional
 * per-resource RBAC check is needed for this listing endpoint.
 *
 * @requires authenticated
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
