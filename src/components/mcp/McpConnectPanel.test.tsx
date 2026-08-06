// @vitest-environment jsdom
// src/components/mcp/McpConnectPanel.test.tsx
// Render-level tests for the multi-platform MCP connect panel: platform
// switching changes the visible command, the command contains the endpoint
// URL, and copying surfaces success/failure state truthfully (tactical
// plan: 2026-08-06-mcp-client-install-commands).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { McpConnectPanel } from './McpConnectPanel'
import { MCP_PLATFORMS } from './mcp-platforms'

const copyTextMock = vi.fn()

vi.mock('@/lib/copy-text', () => ({
  copyText: (text: string) => copyTextMock(text),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: Array<unknown>) => toastSuccess(...args),
    error: (...args: Array<unknown>) => toastError(...args),
  },
}))

const ENDPOINT_URL = 'https://whiteboard.example.com/mcp'

beforeEach(() => {
  copyTextMock.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('McpConnectPanel', () => {
  it('renders a tab for every verified platform', () => {
    render(<McpConnectPanel endpointUrl={ENDPOINT_URL} />)
    for (const platform of MCP_PLATFORMS) {
      expect(
        screen.getByRole('tab', { name: platform.label }),
      ).toBeTruthy()
    }
  })

  it('shows the Claude Code command by default, containing the endpoint URL', () => {
    render(<McpConnectPanel endpointUrl={ENDPOINT_URL} />)
    expect(screen.getByText(new RegExp(ENDPOINT_URL))).toBeTruthy()
    expect(screen.getByText(/claude mcp add/)).toBeTruthy()
  })

  it('switching platforms changes the visible command text', () => {
    render(<McpConnectPanel endpointUrl={ENDPOINT_URL} />)

    // Radix Tabs activates on mousedown (not click) — see
    // @radix-ui/react-tabs's Trigger implementation.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Codex' }))

    expect(screen.getByText(/codex mcp add/)).toBeTruthy()
    expect(screen.queryByText(/claude mcp add/)).toBeNull()
  })

  it('every platform tab shows text unique to that platform and the endpoint URL', () => {
    render(<McpConnectPanel endpointUrl={ENDPOINT_URL} />)

    for (const platform of MCP_PLATFORMS) {
      fireEvent.mouseDown(screen.getByRole('tab', { name: platform.label }))
      expect(screen.getByText(new RegExp(ENDPOINT_URL))).toBeTruthy()
      // The active tab's own text must be present, and it must be the ONLY
      // one present — proof the panel actually switched rather than the
      // first tab's content silently staying mounted.
      const others = MCP_PLATFORMS.filter((p) => p.id !== platform.id)
      for (const other of others) {
        // consentNote differs per platform and only appears when that tab
        // is active — a reliable "this tab, and only this tab, is active"
        // signal that doesn't depend on command syntax differing.
        if (other.consentNote !== platform.consentNote) {
          expect(screen.queryByText(other.consentNote)).toBeNull()
        }
      }
    }
  })

  it('copies the visible command and shows a success confirmation', async () => {
    copyTextMock.mockResolvedValueOnce(true)
    render(<McpConnectPanel endpointUrl={ENDPOINT_URL} />)

    const copyButton = screen.getByRole('button', {
      name: /copy claude code command/i,
    })
    fireEvent.click(copyButton)

    await screen.findByRole('button', { name: /copy claude code command/i })
    expect(copyTextMock).toHaveBeenCalledWith(
      expect.stringContaining(ENDPOINT_URL),
    )
  })

  it('shows a failure toast (not a success one) when copy fails', async () => {
    copyTextMock.mockResolvedValueOnce(false)
    toastSuccess.mockClear()
    toastError.mockClear()
    render(<McpConnectPanel endpointUrl={ENDPOINT_URL} />)

    fireEvent.click(
      screen.getByRole('button', { name: /copy claude code command/i }),
    )

    await vi.waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('shows the config file path for config-kind platforms', () => {
    render(<McpConnectPanel endpointUrl={ENDPOINT_URL} />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Cursor' }))
    expect(screen.getByText('~/.cursor/mcp.json')).toBeTruthy()
  })
})
