// src/components/layout/use-tree-navigation.ts
// Shared tree query and "go to this folder or board" navigation

import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { TreeEntry, TreeProject } from './board-tree'
import { getProjectsWithTree } from '@/routes/api/projects'

/** The navigator tree, shared (same query key) with ProjectTree. */
export function useProjectTree(): ReadonlyArray<TreeProject> | undefined {
  const { data } = useQuery({
    queryKey: ['projects', 'tree'],
    queryFn: () => getProjectsWithTree(),
    // A board load reuses the cached tree instead of refetching it each time.
    staleTime: 1000 * 30,
  })
  return Array.isArray(data) ? (data as Array<TreeProject>) : undefined
}

/** Navigate to a board (right route per type) or a folder page. */
export function useOpenEntry() {
  const navigate = useNavigate()
  return useCallback(
    (entry: Pick<TreeEntry, 'type' | 'id' | 'projectId'>) => {
      switch (entry.type) {
        case 'whiteboard':
          return navigate({
            to: '/whiteboard/$whiteboardId',
            params: { whiteboardId: entry.id },
          })
        case 'canvas':
          return navigate({
            to: '/canvas/$boardId',
            params: { boardId: entry.id },
          })
        case 'folder':
          return navigate({
            to: '/project/$projectId/folder/$folderId',
            params: { projectId: entry.projectId, folderId: entry.id },
          })
      }
    },
    [navigate],
  )
}

/** Navigate to a project's own page. */
export function useOpenProject() {
  const navigate = useNavigate()
  return useCallback(
    (projectId: string) =>
      navigate({ to: '/project/$projectId', params: { projectId } }),
    [navigate],
  )
}
