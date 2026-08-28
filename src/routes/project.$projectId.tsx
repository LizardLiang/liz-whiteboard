// src/routes/project.$projectId.tsx
// Project layout route — renders the matched child route via <Outlet />:
// project.$projectId.index.tsx for the project root, or
// project.$projectId.folder.$folderId.tsx for a folder page.
//
// This segment (`/project/$projectId`) is the PARENT of the folder route in
// the generated route tree (`getParentRoute: () => ProjectProjectIdRoute` in
// routeTree.gen.ts), so it must render <Outlet /> for the folder route's own
// content to ever appear. Before this split, the project root page's JSX
// lived directly on this route with no <Outlet />, so navigating to
// `/project/$projectId/folder/$folderId` silently re-rendered this same
// parent content instead of FolderPage — traced to 44214f5, fixed here.

import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/project/$projectId')({
  component: ProjectLayout,
})

function ProjectLayout() {
  return <Outlet />
}
