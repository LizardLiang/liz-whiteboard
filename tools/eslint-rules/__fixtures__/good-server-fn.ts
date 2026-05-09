// Good fixture: createServerFn with proper @requires tags and requireServerFnRole calls

import { createServerFn } from '@tanstack/react-start'

declare function requireAuth(fn: any): any
declare function requireServerFnRole(userId: string, projectId: string | null, role: string): Promise<void>
declare function getWhiteboardProjectId(id: string): Promise<string | null>

/**
 * Get whiteboard by ID.
 * @requires editor
 */
export const getWhiteboardFn = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(
    requireAuth(async ({ user }: any, id: string) => {
      const projectId = await getWhiteboardProjectId(id)
      await requireServerFnRole(user.id, projectId, 'EDITOR')
      return { id }
    }),
  )

/**
 * Login endpoint — pre-auth, no RBAC check needed.
 * @requires authenticated
 */
export const loginFn = createServerFn({ method: 'POST' })
  .inputValidator((data: any) => data)
  .handler(async ({ data }: any) => {
    return { success: true }
  })

/**
 * Register endpoint — unauthenticated.
 * @requires unauthenticated
 */
export const registerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: any) => data)
  .handler(async ({ data }: any) => {
    return { success: true }
  })
