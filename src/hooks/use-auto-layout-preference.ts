// src/hooks/use-auto-layout-preference.ts
// Hook to manage user preference for automatic layout

import { useCallback, useEffect, useState } from 'react'

/**
 * Local storage key for auto-layout preference
 */
const AUTO_LAYOUT_PREFERENCE_KEY = 'liz-whiteboard:auto-layout-enabled'

/**
 * Hook to manage auto-layout preference
 * Stores preference in localStorage and provides methods to get/set
 *
 * @returns Auto-layout preference state and setter
 *
 * @example
 * ```tsx
 * const { autoLayoutEnabled, setAutoLayoutEnabled } = useAutoLayoutPreference();
 *
 * // Check if auto-layout is enabled
 * if (autoLayoutEnabled) {
 *   // Trigger layout after adding tables
 * }
 *
 * // Toggle preference
 * <Switch
 *   checked={autoLayoutEnabled}
 *   onCheckedChange={setAutoLayoutEnabled}
 * />
 * ```
 */
export function useAutoLayoutPreference() {
  const [autoLayoutEnabled, setAutoLayoutEnabledState] = useState<boolean>(
    () => {
      // Initialize from localStorage
      if (typeof window === 'undefined') return true

      const stored = localStorage.getItem(AUTO_LAYOUT_PREFERENCE_KEY)
      if (stored === null) return true // Default to enabled

      return stored === 'true'
    },
  )

  /**
   * Update auto-layout preference
   * Persists to localStorage
   */
  const setAutoLayoutEnabled = useCallback((enabled: boolean) => {
    setAutoLayoutEnabledState(enabled)
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTO_LAYOUT_PREFERENCE_KEY, String(enabled))
    }
  }, [])

  /**
   * Sync preference across tabs using storage events
   */
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === AUTO_LAYOUT_PREFERENCE_KEY && event.newValue !== null) {
        setAutoLayoutEnabledState(event.newValue === 'true')
      }
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  return {
    autoLayoutEnabled,
    setAutoLayoutEnabled,
  }
}
