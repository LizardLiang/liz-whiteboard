// src/components/layout/NavigatorDrawer.tsx
// Slide-over project navigator for board routes, with a pin to dock it

import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Menu, Pin } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { NAVIGATOR_SEARCH_ATTR } from '@/components/navigator/NavigatorSearch'
import { useNavigatorPin } from '@/hooks/use-navigator-pin'

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || !!el?.isContentEditable
}

/**
 * The ☰ button plus the drawer it opens. Opens with `[` too, closes on Esc,
 * outside click, or navigation.
 */
export function NavigatorDrawer() {
  const [open, setOpen] = useState(false)
  const { setPinned } = useNavigatorPin()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '[') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      setOpen((prev) => !prev)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Show project navigator"
          title="Show project navigator ([)"
        >
          <Menu className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 gap-0 p-0 sm:max-w-72"
        data-testid="navigator-drawer"
        onEscapeKeyDown={(event) => {
          // Esc in a filled search box clears the query; it must not also
          // close the drawer.
          const target = event.target as HTMLInputElement | null
          if (target?.hasAttribute(NAVIGATOR_SEARCH_ATTR) && target.value) {
            event.preventDefault()
          }
        }}
      >
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b py-2 pr-12">
          <SheetTitle className="text-sm">Navigator</SheetTitle>
          <SheetDescription className="sr-only">
            Browse projects, folders and boards
          </SheetDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Pin navigator"
            title="Pin navigator"
            onClick={() => {
              setPinned(true)
              setOpen(false)
            }}
          >
            <Pin className="h-4 w-4" />
          </Button>
        </SheetHeader>
        <Sidebar embedded />
      </SheetContent>
    </Sheet>
  )
}
