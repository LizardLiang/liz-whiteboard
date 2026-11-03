// src/components/layout/Header.tsx
// Application header with branding, theme toggle, and logout

import { Link, useRouter } from '@tanstack/react-router'
import { Languages, LogOut, Moon, Settings, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTheme } from '../../hooks/use-theme'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { logoutUser } from '@/routes/api/auth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/lib/i18n/use-t'
import { isLocale } from '@/lib/i18n/resolve-locale'

declare const __APP_VERSION__: string

/**
 * Application header component
 * Displays app branding, dark mode toggle, and logout button.
 */
export function Header() {
  const { resolvedTheme, toggleTheme } = useTheme()
  const { t, locale, setLocale } = useI18n()
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
          <span>{t('common.appName')}</span>
          <span className="ml-1 text-xs text-muted-foreground font-normal">
            v{__APP_VERSION__}
          </span>
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Language picker: each option is shown in its own language */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              aria-label={t('header.language')}
            >
              <Languages className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {locale === 'zh-TW' ? '繁體中文' : 'English'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(v) => {
                if (isLocale(v)) setLocale(v)
              }}
            >
              <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="zh-TW">
                繁體中文
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Dark Mode Toggle with Switch */}
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {mounted ? (
            <Switch
              checked={isDark}
              onCheckedChange={toggleTheme}
              aria-label={
                isDark ? t('header.switchToLight') : t('header.switchToDark')
              }
            />
          ) : (
            <Switch
              checked={false}
              onCheckedChange={() => {}}
              aria-label={t('header.themeLoading')}
              disabled
            />
          )}
          <Moon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>

        {/* Connected applications (OAuth revocation) */}
        <Button variant="ghost" size="sm" className="gap-2" asChild>
          <Link
            to="/settings/connections"
            aria-label={t('header.connectedApplications')}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('header.connections')}</span>
          </Link>
        </Button>

        {/* Logout button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          disabled={isLoggingOut}
          aria-label={t('header.logout')}
          className="gap-2"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">
            {isLoggingOut ? t('header.loggingOut') : t('header.logout')}
          </span>
        </Button>
      </div>
    </header>
  )
}
