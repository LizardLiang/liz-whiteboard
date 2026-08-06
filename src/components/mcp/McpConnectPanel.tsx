// src/components/mcp/McpConnectPanel.tsx
// Multi-platform MCP client setup panel: platform picker (shadcn Tabs, so
// one component fits both a narrow toolbar popover and the full-width
// /settings/connections page), a copyable install command/config per
// platform, and a short register → sign in → approve explainer. Purely
// presentational — the endpoint URL is a prop so this stays testable without
// the auth-gated getMcpEndpointUrl() server fn (tactical plan:
// 2026-08-06-mcp-client-install-commands).
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { MCP_PLATFORMS } from './mcp-platforms'
import { Button } from '@/components/ui/button'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { copyText } from '@/lib/copy-text'
import { cn } from '@/lib/utils'

export interface McpConnectPanelProps {
  /** The user's MCP endpoint URL (from getMcpEndpointUrl()). */
  endpointUrl: string
  className?: string
}

export function McpConnectPanel({
  endpointUrl,
  className,
}: McpConnectPanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopy = async (platformId: string, text: string) => {
    const ok = await copyText(text)
    if (ok) {
      setCopiedId(platformId)
      toast.success('Copied to clipboard')
      window.setTimeout(() => {
        setCopiedId((current) => (current === platformId ? null : current))
      }, 2000)
    } else {
      toast.error('Could not copy — select and copy the text manually.')
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
          const text = platform.buildText(endpointUrl)
          const isCopied = copiedId === platform.id
          return (
            <TabsContent
              key={platform.id}
              value={platform.id}
              className="space-y-3"
            >
              {platform.configPath && (
                <p className="text-xs text-muted-foreground">
                  Add to{' '}
                  <code className="rounded bg-muted px-1 py-0.5">
                    {platform.configPath}
                  </code>
                </p>
              )}

              {/* Copy button sits BESIDE the command box (not absolutely
                  overlaid on top of it) — a long single-line CLI command
                  scrolls horizontally under an overlaid button and visually
                  collides with it in the narrow toolbar popover width. */}
              <div className="flex items-start gap-2">
                <pre className="max-h-40 flex-1 overflow-x-auto whitespace-pre rounded-md border bg-muted p-3 font-mono text-xs">
                  {text}
                </pre>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={`Copy ${platform.label} ${
                    platform.kind === 'cli' ? 'command' : 'config'
                  }`}
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
                {platform.consentNote}
              </p>

              <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                {platform.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
