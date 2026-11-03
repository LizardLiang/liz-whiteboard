// src/components/project/ProjectPageError.tsx
// Inline error banner with retry button for the project page.

import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n/use-t'

interface ProjectPageErrorProps {
  message: string
  onRetry?: () => void
}

export function ProjectPageError({ message, onRetry }: ProjectPageErrorProps) {
  const t = useT()
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{t('common.error')}</AlertTitle>
      <AlertDescription className="flex items-center gap-3">
        <span>{message}</span>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="shrink-0"
          >
            {t('common.retry')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
