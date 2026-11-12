// src/components/mcp/McpConnectPanel.tsx
// Multi-platform MCP client setup panel: platform picker (shadcn Tabs, so
// one component fits both a narrow toolbar popover and the full-width
// /settings/connections page), a copyable install command/config per
// platform, and a short register → sign in → approve explainer. Purely
// presentational — the endpoint URL is a prop so this stays testable without
// the auth-gated getMcpEndpointUrl() server fn (tactical plan:
// 2026-08-06-mcp-client-install-commands).
import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { MCP_PLATFORMS, MCP_TOOLSETS } from './mcp-platforms'
import type { McpPlatformId, McpToolset } from './mcp-platforms'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { copyText } from '@/lib/copy-text'
import { useT } from '@/lib/i18n/use-t'
import { cn } from '@/lib/utils'

// The platform table keeps English data (an accuracy-gated source list). The
// panel shows the translation for each platform's note and steps by id.
const STEP_KEY: Record<McpPlatformId, string> = {
  'claude-code': 'claudeCode',
  codex: 'codex',
  vscode: 'vscode',
  cursor: 'cursor',
  'claude-desktop': 'claudeDesktop',
  other: 'other',
}

const CONSENT_KEY: Record<McpPlatformId, string> = {
  'claude-code': 'cimd',
  codex: 'cimd',
  vscode: 'unverified',
  cursor: 'unverified',
  'claude-desktop': 'unverified',
  other: 'dcr',
}

const TRANSLATED_CONFIG_PATH: ReadonlySet<McpPlatformId> = new Set([
  'vscode',
  'other',
])

export interface McpConnectPanelProps {
  /** The user's MCP endpoint URL (from getMcpEndpointUrl()). */
  endpointUrl: string
  className?: string
}

export function McpConnectPanel({
  endpointUrl,
  className,
}: McpConnectPanelProps) {
  const t = useT()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // Empty = all tools (no header). One selection drives every client's snippet.
  const [toolsets, setToolsets] = useState<Array<McpToolset>>([])

  const toggleToolset = (name: McpToolset) =>
    setToolsets((current) =>
      current.includes(name)
        ? current.filter((n) => n !== name)
        : [...current, name],
    )

  // buildText() only depends on endpointUrl (stable across re-renders caused
  // by copiedId toggling on copy) — memoize per platform instead of calling
  // every platform's buildText() on every render.
  const platformTexts = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        MCP_PLATFORMS.map((platform) => [
          platform.id,
          platform.buildText(endpointUrl, toolsets),
        ]),
      ),
    [endpointUrl, toolsets],
  )

  const handleCopy = async (platformId: string, text: string) => {
    const ok = await copyText(text)
    if (ok) {
      setCopiedId(platformId)
      toast.success(t('canvas.mcp.copied'))
      window.setTimeout(() => {
        setCopiedId((current) => (current === platformId ? null : current))
      }, 2000)
    } else {
      toast.error(t('canvas.mcp.copyFailed'))
    }
  }

  return (
    <div className={cn('w-full', className)}>
      <Tabs defaultValue={MCP_PLATFORMS[0].id} className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60">
          {MCP_PLATFORMS.map((platform) => (
            <TabsTrigger
              key={platform.id}
              value={platform.id}
              className="text-xs"
            >
              {platform.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {MCP_PLATFORMS.map((platform) => {
          const text = platformTexts[platform.id]
          const isCopied = copiedId === platform.id
          return (
            <TabsContent
              key={platform.id}
              value={platform.id}
              className="space-y-3"
            >
              {platform.configPath && (
                <p className="text-xs text-muted-foreground">
                  {t('canvas.mcp.addTo')}{' '}
                  <code className="rounded bg-muted px-1 py-0.5">
                    {TRANSLATED_CONFIG_PATH.has(platform.id)
                      ? t(`canvas.mcp.configPath.${platform.id}`)
                      : platform.configPath}
                  </code>
                </p>
              )}

              {platform.supportsToolsets ? (
                <div
                  role="group"
                  aria-label={t('canvas.mcp.toolsets.label')}
                  className="space-y-1"
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-muted-foreground">
                      {t('canvas.mcp.toolsets.label')}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={toolsets.length === 0 ? 'default' : 'outline'}
                      className="h-6 px-2 text-xs"
                      aria-pressed={toolsets.length === 0}
                      onClick={() => setToolsets([])}
                    >
                      {t('canvas.mcp.toolsets.all')}
                    </Button>
                    {MCP_TOOLSETS.map((name) => {
                      const active = toolsets.includes(name)
                      return (
                        <Button
                          key={name}
                          type="button"
                          size="sm"
                          variant={active ? 'default' : 'outline'}
                          className="h-6 px-2 text-xs"
                          aria-pressed={active}
                          onClick={() => toggleToolset(name)}
                        >
                          {t(`canvas.mcp.toolsets.${name}`)}
                        </Button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('canvas.mcp.toolsets.hint')}
                    {platform.id === 'codex' && toolsets.length > 0
                      ? ` ${t('canvas.mcp.toolsets.codexExtra')}`
                      : ''}
                  </p>
                </div>
              ) : (
                platform.id === 'claude-desktop' && (
                  <p className="text-xs text-muted-foreground">
                    {t('canvas.mcp.toolsets.desktopNote')}
                  </p>
                )
              )}

              {/* Copy button sits BESIDE the command box (not absolutely
                  overlaid on top of it), so it never covers the text. The
                  command wraps instead of scrolling sideways, so a trailing
                  part such as the toolset header is always visible. */}
              <div className="flex items-start gap-2">
                <pre className="max-h-40 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted p-3 font-mono text-xs [overflow-wrap:anywhere]">
                  {text}
                </pre>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={t(
                    platform.kind === 'cli'
                      ? 'canvas.mcp.copyCommandAria'
                      : 'canvas.mcp.copyConfigAria',
                    { platform: platform.label },
                  )}
                  onClick={() => handleCopy(platform.id, text)}
                >
                  {isCopied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                {t(`canvas.mcp.consent.${CONSENT_KEY[platform.id]}`)}
              </p>

              <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                {platform.steps.map((step, index) => (
                  <li key={step}>
                    {t(
                      `canvas.mcp.steps.${STEP_KEY[platform.id]}.s${index + 1}`,
                    )}
                  </li>
                ))}
              </ol>
            </TabsContent>
          )
        })}
      </Tabs>

      <Link
        to="/settings/connections"
        className="mt-3 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {t('canvas.mcp.manage')}
      </Link>
    </div>
  )
}
