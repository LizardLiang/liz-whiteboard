// src/hooks/use-theme.ts
// Dark mode theme management hook using shadcn/ui theme system

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

/**
 * Theme provider component
 * Manages dark mode state and applies theme classes to document root
 *
 * Theme persistence:
 * - Stored in localStorage as 'ui-theme'
 * - Synced across browser tabs using storage events
 * - Respects system preference when theme is set to 'system'
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    // Initialize from localStorage or default to 'system'
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('ui-theme') as Theme | null
      return stored || 'system'
    }
    return 'system'
  })

  useEffect(() => {
    const root = window.document.documentElement

    // Remove existing theme classes
    root.classList.remove('light', 'dark')

    // Determine effective theme (resolve 'system' to light/dark)
    const effectiveTheme: 'light' | 'dark' =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme

    // Apply theme class to root element
    root.classList.add(effectiveTheme)
  }, [theme])

  useEffect(() => {
    // Listen for system theme changes when in 'system' mode
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = () => {
        const root = window.document.documentElement
        root.classList.remove('light', 'dark')
        root.classList.add(mediaQuery.matches ? 'dark' : 'light')
      }

      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme])

  useEffect(() => {
    // Sync theme across browser tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'ui-theme' && e.newValue) {
        setThemeState(e.newValue as Theme)
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const setTheme = (newTheme: Theme) => {
    localStorage.setItem('ui-theme', newTheme)
    setThemeState(newTheme)
  }

  const toggleTheme = () => {
    // Toggle between light and dark (ignore system for toggle)
    const currentEffective =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme

    const newTheme = currentEffective === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
  }

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/**
 * Hook to access theme context
 * Must be used within ThemeProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { theme, setTheme, toggleTheme } = useTheme();
 *   return <button onClick={toggleTheme}>Toggle Theme</button>;
 * }
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
