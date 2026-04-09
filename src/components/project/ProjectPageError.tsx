// src/components/project/ProjectPageError.tsx
// Inline error banner with retry button for the project page.

import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface ProjectPageErrorProps {
  message: string
  onRetry?: () => void
}

export function ProjectPageError({ message, onRetry }: ProjectPageErrorProps) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription className="flex items-center gap-3">
        <span>{message}</span>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="shrink-0"
          >
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
