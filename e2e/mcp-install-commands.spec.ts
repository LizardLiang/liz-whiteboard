// e2e/mcp-install-commands.spec.ts
// End-to-end coverage for the multi-platform MCP client connect panel
// (tactical plan: 2026-08-06-mcp-client-install-commands): the toolbar
// popover shows a per-platform install command containing the live endpoint
// URL, switching platforms changes the visible command, copying surfaces a
// truthful confirmation (via the copyText() clipboard fix), and the same
// panel renders on /settings/connections. Auth + seed data come from
// global-setup (storageState), same as version-history.spec.ts.
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Page } from '@playwright/test'

// Clipboard permissions are granted at the BROWSER CONTEXT level (not
// asserted via OS clipboard contents — CLAUDE.md's e2e rule) so
// navigator.clipboard.writeText()/readText() work in Chromium and copyText()
// exercises its primary (non-fallback) branch here.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  await expect(tableNode(page, 'users').first()).toBeVisible()
}

async function openMcpPopover(page: Page) {
  await page.getByRole('button', { name: 'Connect an MCP client' }).click()
  await expect(page.getByRole('tab', { name: 'Claude Code' })).toBeVisible()
}

test.describe('MCP client install commands (tactical plan: 2026-08-06-mcp-client-install-commands)', () => {
  test('toolbar popover: platform switch changes the command, copy confirms truthfully', async ({
    page,
  }) => {
    await openWhiteboard(page)
    await openMcpPopover(page)

    // Claude Code is the default tab; its command embeds the live endpoint
    // URL (env-driven — MCP_RESOURCE_URI, defaulting to
    // http://localhost:8080/mcp when unset — not a hardcoded string).
    const claudeCommand = page.getByText(
      /claude mcp add --transport http liz-whiteboard/,
    )
    await expect(claudeCommand).toBeVisible()
    const claudeText = (await claudeCommand.textContent()) ?? ''
    expect(claudeText).toMatch(/https?:\/\/\S+\/mcp/)

    // Switching to Codex changes the visible command (proves the platform
    // picker actually swaps content, not just the active tab styling).
    await page.getByRole('tab', { name: 'Codex' }).click()
    const codexCommand = page.getByText(/codex mcp add liz-whiteboard --url/)
    await expect(codexCommand).toBeVisible()
    await expect(claudeCommand).not.toBeVisible()

    // Copying surfaces a truthful success confirmation (a toast) — proof
    // copyText() actually ran and reported success, not an assumed one.
    await page.getByRole('button', { name: /copy codex command/i }).click()
    await expect(page.getByText('Copied to clipboard')).toBeVisible()

    // The clipboard genuinely contains the Codex command (context-level
    // permission grant above lets us assert this directly).
    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    )
    expect(clipboardText).toContain('codex mcp add liz-whiteboard --url')
  })

  test('switching to a config-kind platform (Cursor) shows its config file path and JSON', async ({
    page,
  }) => {
    await openWhiteboard(page)
    await openMcpPopover(page)

    await page.getByRole('tab', { name: 'Cursor' }).click()
    await expect(page.getByText('~/.cursor/mcp.json')).toBeVisible()
    await expect(page.getByText(/"mcpServers"/)).toBeVisible()
  })

  test('/settings/connections renders the same connect panel', async ({
    page,
  }) => {
    await page.goto('/settings/connections')
    await expect(
      page.getByRole('heading', { name: 'Connected applications' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Connect an MCP client' }),
    ).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Claude Code' })).toBeVisible()
    await expect(
      page.getByText(/claude mcp add --transport http liz-whiteboard/),
    ).toBeVisible()
  })
})
