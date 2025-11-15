// src/hooks/use-theme.ts
// Theme management hook with localStorage persistence and cross-tab synchronization

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Theme mode options
 * - 'light': Force light mode
 * - 'dark': Force dark mode
 * - 'system': Follow system preference
 */
export type Theme = 'light' | 'dark' | 'system'

/**
 * Theme context value interface
 */
interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  resolvedTheme: 'light' | 'dark'
}

/**
 * Theme context
 */
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

/**
 * Get the resolved theme (actual applied theme)
 * Converts 'system' to 'light' or 'dark' based on system preference
 */
function getResolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    if (typeof window === 'undefined') return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  return theme
}

/**
 * Apply theme class to document root
 * Removes all theme classes and adds the resolved theme
 */
function applyTheme(theme: Theme): void {
  if (typeof window === 'undefined') return

  const root = window.document.documentElement
  const resolved = getResolvedTheme(theme)

  // Remove all theme classes
  root.classList.remove('light', 'dark')

  // Add resolved theme class
  root.classList.add(resolved)
}

/**
 * Get stored theme from localStorage
 * Returns 'system' if not set or invalid
 */
function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'

  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch (error) {
    console.error('Failed to read theme from localStorage:', error)
  }

  return 'system'
}

/**
 * Theme provider component
 * Manages theme state and applies theme classes to document root
 *
 * Features:
 * - Persists theme preference in localStorage
 * - Synchronizes theme across browser tabs
 * - Supports system preference detection
 * - Provides toggle function for quick theme switching
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ThemeProvider>
 *       <MyApp />
 *     </ThemeProvider>
 *   )
 * }
 * ```
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize theme from localStorage (use 'system' as default to avoid hydration mismatch)
  const [theme, setThemeState] = useState<Theme>('system')

  /**
   * Set theme and persist to localStorage
   */
  const setTheme = (newTheme: Theme) => {
    try {
      localStorage.setItem('theme', newTheme)
      setThemeState(newTheme)
    } catch (error) {
      console.error('Failed to save theme to localStorage:', error)
    }
  }

  /**
   * Toggle between light and dark modes
   * If current theme is 'system', toggles to opposite of resolved theme
   */
  const toggleTheme = () => {
    const resolved = getResolvedTheme(theme)
    const newTheme = resolved === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
  }

  /**
   * Load stored theme on mount (client-side only to avoid hydration mismatch)
   */
  useEffect(() => {
    const stored = getStoredTheme()
    if (stored !== theme) {
      setThemeState(stored)
    }
  }, [])

  /**
   * Apply theme when it changes
   */
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  /**
   * Listen for system theme preference changes (when theme is 'system')
   */
  useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = () => {
      // Re-apply theme when system preference changes
      applyTheme(theme)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  /**
   * Synchronize theme across browser tabs
   * Listens to localStorage 'storage' event
   */
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Only respond to theme changes from other tabs
      if (e.key === 'theme' && e.newValue) {
        const newTheme = e.newValue as Theme
        if (
          newTheme === 'light' ||
          newTheme === 'dark' ||
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          newTheme === 'system'
        ) {
          setThemeState(newTheme)
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme,
    resolvedTheme: getResolvedTheme(theme),
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/**
 * Custom hook for accessing theme context
 * Must be used within a ThemeProvider
 *
 * Features:
 * - Access current theme mode
 * - Change theme programmatically
 * - Toggle between light and dark modes
 * - Get resolved theme (light or dark)
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const { theme, setTheme, toggleTheme, resolvedTheme } = useTheme()
 *
 *   return (
 *     <button onClick={toggleTheme}>
 *       Current: {resolvedTheme}
 *     </button>
 *   )
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
