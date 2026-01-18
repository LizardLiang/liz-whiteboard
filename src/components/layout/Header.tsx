// src/components/layout/Header.tsx
// Application header with branding and theme toggle

import { Link } from '@tanstack/react-router'
import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from '../../hooks/use-theme'
import { Switch } from '@/components/ui/switch'

/**
 * Application header component
 * Displays app branding and provides dark mode toggle
 */
export function Header() {
  const { resolvedTheme, toggleTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const isDark = resolvedTheme === 'dark'

  // Avoid hydration mismatch by only rendering theme-dependent UI after mount
  useEffect(() => {
    setMounted(true)
  }, [])

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
      </div>
    </header>
  )
}
