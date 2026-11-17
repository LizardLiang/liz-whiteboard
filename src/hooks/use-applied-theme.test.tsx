import { useEffect } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useAppliedTheme } from './use-applied-theme'
import { ThemeProvider, useTheme } from './use-theme'

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.classList.remove('light', 'dark')
})

/** What an effect keyed on each source sees on <html> when it runs. */
function Probe(props: {
  seen: { resolved: Array<string>; applied: Array<string> }
  api: { toggle?: () => void }
}) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const applied = useAppliedTheme()
  props.api.toggle = toggleTheme
  useEffect(() => {
    props.seen.resolved.push(
      `${resolvedTheme}:${document.documentElement.className}`,
    )
  }, [resolvedTheme, props.seen])
  useEffect(() => {
    props.seen.applied.push(`${applied}:${document.documentElement.className}`)
  }, [applied, props.seen])
  return null
}

describe('useAppliedTheme', () => {
  it('changes only after the class is on <html>, unlike resolvedTheme', async () => {
    localStorage.setItem('theme', 'light')
    const seen = { resolved: [] as Array<string>, applied: [] as Array<string> }
    const api: { toggle?: () => void } = {}
    render(
      <ThemeProvider>
        <Probe seen={seen} api={api} />
      </ThemeProvider>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.documentElement.className).toBe('light')

    await act(async () => {
      api.toggle!()
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.documentElement.className).toBe('dark')

    // An effect keyed on resolvedTheme ran with the previous class still set:
    // the race that painted the canvas with the old palette.
    expect(seen.resolved).toContain('dark:light')
    // An effect keyed on the applied theme only ever sees its own class.
    expect(seen.applied.at(-1)).toBe('dark:dark')
  })
})
