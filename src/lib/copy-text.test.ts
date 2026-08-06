// @vitest-environment jsdom
// src/lib/copy-text.test.ts
// Unit tests for copyText() — both the Clipboard API branch and the
// execCommand fallback branch used on non-secure (plain-HTTP LAN) origins.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './copy-text'

describe('copyText: navigator.clipboard available (secure context)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses navigator.clipboard.writeText and resolves true on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const result = await copyText('hello world')

    expect(writeText).toHaveBeenCalledWith('hello world')
    expect(result).toBe(true)
  })

  it('falls back to execCommand when navigator.clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    const result = await copyText('fallback text')

    expect(writeText).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(result).toBe(true)
  })
})

describe('copyText: navigator.clipboard absent (plain-HTTP LAN origin)', () => {
  let execCommandSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Simulate the non-secure-context shape: `navigator` exists (jsdom
    // provides it) but `navigator.clipboard` is undefined, exactly as it is
    // on a plain-HTTP LAN origin in a real browser.
    vi.stubGlobal('navigator', {})
    execCommandSpy = vi.fn().mockReturnValue(true)
    document.execCommand = execCommandSpy
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to a hidden textarea + execCommand("copy") and resolves true on success', async () => {
    const result = await copyText('lan copy text')

    expect(execCommandSpy).toHaveBeenCalledWith('copy')
    expect(result).toBe(true)
  })

  it('creates and removes a temporary textarea containing the text', async () => {
    let capturedValue: string | undefined
    execCommandSpy.mockImplementation(() => {
      const textarea = document.querySelector('textarea')
      capturedValue = textarea?.value
      return true
    })

    await copyText('captured value')

    expect(capturedValue).toBe('captured value')
    // Cleaned up afterward — no leftover textarea in the DOM.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('resolves false when execCommand fails', async () => {
    execCommandSpy.mockReturnValue(false)

    const result = await copyText('will not copy')

    expect(result).toBe(false)
  })

  it('resolves false when execCommand throws', async () => {
    execCommandSpy.mockImplementation(() => {
      throw new Error('not allowed')
    })

    const result = await copyText('will also not copy')

    expect(result).toBe(false)
  })
})
