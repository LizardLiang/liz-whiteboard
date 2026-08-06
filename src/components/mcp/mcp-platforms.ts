// src/components/mcp/mcp-platforms.ts
// Per-platform MCP client install command/config strings shown by
// McpConnectPanel. Every entry is sourced against current official
// documentation (see the comment above each platform) — this table is a
// hard accuracy gate (tactical plan: 2026-08-06-mcp-client-install-commands).
// Do not add a platform without a citable source, and do not guess a flag —
// dropping a platform is the correct outcome when it can't be confirmed.

export type McpPlatformId =
  | 'claude-code'
  | 'codex'
  | 'vscode'
  | 'cursor'
  | 'claude-desktop'
  | 'other'

export interface McpPlatform {
  id: McpPlatformId
  label: string
  /** 'cli' = a single shell command to run. 'config' = a JSON block to add
   * to a config file (see configPath). 'manual' = no command — steps
   * describes a UI flow instead, and buildText returns the URL to paste. */
  kind: 'cli' | 'config' | 'manual'
  /** File the config block should be added to (kind: 'config' only). */
  configPath?: string
  /** Renders the copyable command/config text for a given MCP endpoint URL. */
  buildText: (endpointUrl: string) => string
  /** Whether the user sees an OAuth consent/approval screen after signing
   * in. Claude Code pins its identity via CIMD and skips it (CIMD-verified
   * in this project — see .claude/.Arena/insights/vscode-codex-mcp-oauth-
   * 2026-08-06.md); every other client here falls back to Dynamic Client
   * Registration, which does not skip it. */
  consentNote: string
  steps: Array<string>
}

// Shared by the four platforms below that register via Dynamic Client
// Registration and show the same one-time consent screen after sign-in
// (Claude Code's CIMD note and the generic "Other" note genuinely differ
// and are not deduplicated here).
const DCR_CONSENT_NOTE =
  'Registers via Dynamic Client Registration — approve the one-time consent screen after signing in.'

export const MCP_PLATFORMS: Array<McpPlatform> = [
  {
    // Pre-confirmed by the existing single-platform button this feature
    // generalises: src/components/whiteboard/Toolbar.tsx:869.
    id: 'claude-code',
    label: 'Claude Code',
    kind: 'cli',
    buildText: (url) =>
      `claude mcp add --transport http liz-whiteboard '${url}'`,
    consentNote:
      'Uses CIMD client identity — no separate consent screen after sign-in.',
    steps: [
      'Run the command above in your terminal.',
      'A browser window opens — sign in with your ER Whiteboard account.',
      "You're connected. Ask Claude Code about your diagram.",
    ],
  },
  {
    // Source: .claude/.Arena/insights/vscode-codex-mcp-oauth-2026-08-06.md,
    // citing codex-rs/cli/src/mcp_cmd.rs (`--url` flag) and
    // https://learn.chatgpt.com/docs/extend/mcp?surface=cli. Codex does not
    // wire up CIMD in its production OAuth path, so it registers via DCR.
    id: 'codex',
    label: 'Codex',
    kind: 'cli',
    buildText: (url) => `codex mcp add liz-whiteboard --url '${url}'`,
    consentNote: DCR_CONSENT_NOTE,
    steps: [
      'Run the command above in your terminal.',
      'A browser window opens — sign in with your ER Whiteboard account, then approve access.',
      "You're connected. Ask Codex about your diagram.",
    ],
  },
  {
    // Source: https://code.visualstudio.com/docs/agent-customization/
    // mcp-servers — manual-configuration section documents the "servers"
    // key with {"type":"http","url":...} for remote MCP servers. The
    // CLI's `--add-mcp` flag is only documented there with a stdio example,
    // so a CLI one-liner is not shipped for VS Code (hard gate: don't guess
    // whether `--add-mcp` accepts a "type":"http" payload).
    id: 'vscode',
    label: 'VS Code',
    kind: 'config',
    configPath: '.vscode/mcp.json (or your user mcp.json)',
    buildText: (url) =>
      JSON.stringify(
        { servers: { 'liz-whiteboard': { type: 'http', url } } },
        null,
        2,
      ),
    consentNote: DCR_CONSENT_NOTE,
    steps: [
      'Add the block above to the file shown, or run "MCP: Add Server" from the Command Palette and choose HTTP.',
      'VS Code opens a browser window — sign in with your ER Whiteboard account, then approve access.',
      "You're connected. Ask Copilot Chat about your diagram.",
    ],
  },
  {
    // Source: https://cursor.com/docs (context/mcp) — remote server entries
    // use the "mcpServers" key with a "url" field; no CLI or deeplink is
    // documented, only the mcp.json file.
    id: 'cursor',
    label: 'Cursor',
    kind: 'config',
    configPath: '~/.cursor/mcp.json',
    buildText: (url) =>
      JSON.stringify({ mcpServers: { 'liz-whiteboard': { url } } }, null, 2),
    consentNote: DCR_CONSENT_NOTE,
    steps: [
      'Add the block above to the file shown.',
      'Cursor opens a browser window — sign in with your ER Whiteboard account, then approve access.',
      "You're connected. Ask Cursor about your diagram.",
    ],
  },
  {
    // Source: https://modelcontextprotocol.io/docs/develop/connect-remote-
    // servers (Desktop steps) and https://support.claude.com/en/articles/
    // 11175166-get-started-with-custom-connectors-using-remote-mcp. No CLI —
    // the URL is pasted into the "Add custom connector" dialog.
    id: 'claude-desktop',
    label: 'Claude Desktop',
    kind: 'manual',
    buildText: (url) => url,
    consentNote: DCR_CONSENT_NOTE,
    steps: [
      'In the Claude Desktop app, open Settings (menu icon → File → Settings, or Ctrl+,), then click "Connectors".',
      'Click "Add" (top-right), then "Add custom connector".',
      'Paste the URL above, click "Add", then sign in and approve access.',
    ],
  },
  {
    // Generic fallback for any MCP-compatible client not listed above.
    // Source: the "mcpServers" key appears on modelcontextprotocol.io's own
    // local-server example (https://modelcontextprotocol.io/docs/develop/
    // connect-local-servers) and is reused for remote "url" entries by
    // Cursor's docs (see above) — the MCP spec itself only standardizes the
    // wire protocol, not a config-file schema, so this is a documented
    // convention rather than a spec-mandated shape (VS Code, for example,
    // uses a different top-level key — already covered by its own entry).
    id: 'other',
    label: 'Other (mcp.json)',
    kind: 'config',
    configPath: "your client's MCP config file",
    buildText: (url) =>
      JSON.stringify({ mcpServers: { 'liz-whiteboard': { url } } }, null, 2),
    consentNote:
      'Most MCP clients register via Dynamic Client Registration and show a one-time consent screen after sign-in.',
    steps: [
      'Add the block above to your client\'s MCP config file (the key may be "mcpServers" or "servers" — check your client\'s docs if this doesn\'t work).',
      'Your client opens a browser window — sign in with your ER Whiteboard account, then approve access if prompted.',
      "You're connected.",
    ],
  },
]
