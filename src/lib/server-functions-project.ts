// src/lib/server-functions-project.ts
// Server functions for project operations

import { createServerFn } from '@tanstack/react-start'
import { findAllProjectsForUser } from '@/data/project'
import { findWhiteboardsByProjectId } from '@/data/whiteboard'
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
  requireAuth(async ({ user }) => {
    try {
      const projects = await findAllProjectsForUser(user.id)
      return Promise.all(
        projects.map(async (project) => ({
          ...project,
          whiteboards: await findWhiteboardsByProjectId(project.id),
        })),
      )
    } catch (error) {
      console.error('Error fetching projects:', error)
      throw error
    }
  }),
)
