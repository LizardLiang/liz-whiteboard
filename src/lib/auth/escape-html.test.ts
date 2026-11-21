// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildResetEmailHtml, escapeHtml } from './escape-html'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;',
    )
  })
})

describe('buildResetEmailHtml', () => {
  it('escapes the link and both translated strings', () => {
    const html = buildResetEmailHtml({
      intro: '<script>alert(1)</script>',
      link: 'https://x.test/r?token=a"><img src=x onerror=1>&b=2',
      outro: '<b>bye</b>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('token=a&quot;&gt;&lt;img')
    expect(html).toContain('&amp;b=2')
  })

  it('keeps a normal link intact', () => {
    const html = buildResetEmailHtml({
      intro: 'Reset',
      link: 'https://x.test/reset-password?token=abc',
      outro: 'Thanks',
    })
    expect(html).toBe(
      '<p>Reset</p><p><a href="https://x.test/reset-password?token=abc">https://x.test/reset-password?token=abc</a></p><p>Thanks</p>',
    )
  })
})
