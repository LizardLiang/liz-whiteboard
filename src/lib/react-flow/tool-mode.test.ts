// src/lib/react-flow/tool-mode.test.ts
// UNIT-08 (P2, recommended): table-driven coverage for isDrawTool/DRAW_TOOLS/
// TOOL_TO_SHAPE_KIND — guards against the 'comment' tool regressing into
// "is a draw tool" during the D-1 migration.

import { describe, expect, it } from 'vitest'
import { DRAW_TOOLS, TOOL_TO_SHAPE_KIND, isDrawTool } from './tool-mode'
import type { ToolMode } from './tool-mode'

describe('isDrawTool', () => {
  const ALL_TOOL_MODES: Array<ToolMode> = [
    'select',
    'rectangle',
    'ellipse',
    'diamond',
    'arrow',
    'text',
    'comment',
  ]

  it.each(ALL_TOOL_MODES)('classifies %s correctly', (tool) => {
    const expected = (DRAW_TOOLS as ReadonlyArray<string>).includes(tool)
    expect(isDrawTool(tool)).toBe(expected)
  })

  it("'select' is never a draw tool", () => {
    expect(isDrawTool('select')).toBe(false)
  })

  it("'comment' is never a draw tool (D-1 migration guard)", () => {
    expect(isDrawTool('comment')).toBe(false)
  })

  it('all five DRAW_TOOLS entries are draw tools', () => {
    for (const t of DRAW_TOOLS) {
      expect(isDrawTool(t)).toBe(true)
    }
  })
})

describe('TOOL_TO_SHAPE_KIND', () => {
  it('maps every draw tool to a ShapeKind, with arrow -> line', () => {
    expect(TOOL_TO_SHAPE_KIND.rectangle).toBe('rectangle')
    expect(TOOL_TO_SHAPE_KIND.ellipse).toBe('ellipse')
    expect(TOOL_TO_SHAPE_KIND.diamond).toBe('diamond')
    expect(TOOL_TO_SHAPE_KIND.arrow).toBe('line')
    expect(TOOL_TO_SHAPE_KIND.text).toBe('text')
  })

  it('has exactly one entry per DRAW_TOOLS member', () => {
    expect(Object.keys(TOOL_TO_SHAPE_KIND).sort()).toEqual(
      [...DRAW_TOOLS].sort(),
    )
  })
})
