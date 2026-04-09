// src/components/project/ProjectPageSkeleton.tsx
// Loading skeleton for the project page grid.
// Shows 4 skeleton cards matching the grid dimensions.

import { Skeleton } from '@/components/ui/skeleton'

export function ProjectPageSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border bg-card shadow-sm p-6 flex flex-col gap-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-5 w-32" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}
