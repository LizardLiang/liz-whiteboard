// @vitest-environment node
// src/components/mcp/mcp-platforms.test.ts
// Unit tests for the MCP_PLATFORMS command/config table — every command must
// embed the endpoint URL verbatim and produce distinct text per platform
// (tactical plan: 2026-08-06-mcp-client-install-commands, command-accuracy
// gate).

import { describe, expect, it } from 'vitest'
import { MCP_PLATFORMS } from './mcp-platforms'

const URL = 'https://whiteboard.example.com/mcp'

describe('MCP_PLATFORMS', () => {
  it('has exactly the 6 verified platforms', () => {
    const ids = MCP_PLATFORMS.map((p) => p.id)
    expect(ids).toEqual([
      'claude-code',
      'codex',
      'vscode',
      'cursor',
      'claude-desktop',
      'other',
    ])
  })

  it('every platform embeds the endpoint URL verbatim in its command/config text', () => {
    for (const platform of MCP_PLATFORMS) {
      expect(platform.buildText(URL)).toContain(URL)
    }
  })

  it('every platform produces distinct text for distinct URLs', () => {
    const urlA = 'https://a.example.com/mcp'
    const urlB = 'https://b.example.com/mcp'
    for (const platform of MCP_PLATFORMS) {
      expect(platform.buildText(urlA)).not.toBe(platform.buildText(urlB))
    }
  })

  it('every platform has a non-empty label, consent note, and at least one step', () => {
    for (const platform of MCP_PLATFORMS) {
      expect(platform.label.length).toBeGreaterThan(0)
      expect(platform.consentNote.length).toBeGreaterThan(0)
      expect(platform.steps.length).toBeGreaterThan(0)
    }
  })

  it('config-kind platforms declare a configPath', () => {
    for (const platform of MCP_PLATFORMS.filter((p) => p.kind === 'config')) {
      expect(platform.configPath).toBeTruthy()
    }
  })

  it('claude-code is the only platform without a consent screen', () => {
    const claudeCode = MCP_PLATFORMS.find((p) => p.id === 'claude-code')
    expect(claudeCode?.consentNote).toMatch(/no separate consent screen/i)

    const others = MCP_PLATFORMS.filter((p) => p.id !== 'claude-code')
    for (const platform of others) {
      expect(platform.consentNote).not.toMatch(/no separate consent screen/i)
    }
  })

  it('config-kind platforms produce valid JSON', () => {
    for (const platform of MCP_PLATFORMS.filter((p) => p.kind === 'config')) {
      expect(() => JSON.parse(platform.buildText(URL))).not.toThrow()
    }
  })

  it('vscode config uses the "servers" key with type "http"', () => {
    const vscode = MCP_PLATFORMS.find((p) => p.id === 'vscode')
    const parsed = JSON.parse(vscode!.buildText(URL))
    expect(parsed.servers['liz-whiteboard'].type).toBe('http')
    expect(parsed.servers['liz-whiteboard'].url).toBe(URL)
  })

  it('cursor and other configs use the "mcpServers" key', () => {
    for (const id of ['cursor', 'other'] as const) {
      const platform = MCP_PLATFORMS.find((p) => p.id === id)
      const parsed = JSON.parse(platform!.buildText(URL))
      expect(parsed.mcpServers['liz-whiteboard'].url).toBe(URL)
    }
  })

  it('claude-desktop is manual with no configPath and buildText returns the raw URL', () => {
    const claudeDesktop = MCP_PLATFORMS.find((p) => p.id === 'claude-desktop')
    expect(claudeDesktop?.kind).toBe('manual')
    expect(claudeDesktop?.configPath).toBeUndefined()
    expect(claudeDesktop?.buildText(URL)).toBe(URL)
  })
})
