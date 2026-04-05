// src/components/auth/SessionExpiredModal.tsx
// Modal shown when a session expires (HTTP 401 or WebSocket session_expired event)

import { useRouter } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAuthContext } from './AuthContext'

/**
 * SessionExpiredModal renders a dialog when the user's session has expired.
 * Focus is automatically trapped by the Radix Dialog primitive.
 * Pressing Escape or clicking "Log in again" navigates to /login with redirect param.
 *
 * Mount this at the root level inside AuthProvider.
 */
export function SessionExpiredModal() {
  const { sessionExpired, dismissSessionExpired } = useAuthContext()
  const router = useRouter()

  const handleLogin = () => {
    dismissSessionExpired()
    const currentPath =
      typeof window !== 'undefined' ? window.location.pathname : '/'
    router.navigate({
      to: '/login',
      search: { redirect: currentPath },
    })
  }

  return (
    <Dialog open={sessionExpired} onOpenChange={(open) => !open && handleLogin()}>
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={handleLogin}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Your session has expired</DialogTitle>
          <DialogDescription>
            You have been logged out due to inactivity. Please log in again to
            continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={handleLogin} className="w-full">
            Log in again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
