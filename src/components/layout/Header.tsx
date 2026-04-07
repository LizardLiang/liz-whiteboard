// src/components/layout/Header.tsx
// Application header with branding, theme toggle, and logout

import { Link, useRouter } from '@tanstack/react-router'
import { Moon, Sun, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from '../../hooks/use-theme'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { logoutUser } from '@/routes/api/auth'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Application header component
 * Displays app branding, dark mode toggle, and logout button.
 */
export function Header() {
  const { resolvedTheme, toggleTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const isDark = resolvedTheme === 'dark'
  const router = useRouter()
  const queryClient = useQueryClient()

  // Avoid hydration mismatch by only rendering theme-dependent UI after mount
  useEffect(() => {
    setMounted(true)
  }, [])

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await logoutUser()
      // Clear all cached queries so stale data is not shown after logout
      queryClient.clear()
      router.navigate({ to: '/login' })
    } catch {
      // Swallow logout errors — navigate to login regardless
      queryClient.clear()
      router.navigate({ to: '/login' })
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <header className="border-b bg-background">
      <div className="flex h-16 items-center px-6 gap-4">
        {/* App Logo/Branding */}
        <Link
          to="/"
          className="flex items-center gap-2 font-semibold text-lg hover:opacity-80 transition-opacity"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          <span>ER Whiteboard</span>
          <span className="ml-1 text-xs text-muted-foreground font-normal">
            v0.1.0
          </span>
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Dark Mode Toggle with Switch */}
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {mounted ? (
            <Switch
              checked={isDark}
              onCheckedChange={toggleTheme}
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            />
          ) : (
            <Switch
              checked={false}
              onCheckedChange={() => {}}
              aria-label="Theme toggle loading"
              disabled
            />
          )}
          <Moon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>

        {/* Logout button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          disabled={isLoggingOut}
          aria-label="Log out"
          className="gap-2"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">
            {isLoggingOut ? 'Logging out...' : 'Log out'}
          </span>
        </Button>
      </div>
    </header>
  )
}
