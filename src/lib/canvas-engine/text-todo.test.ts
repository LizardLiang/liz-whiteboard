// src/lib/canvas-engine/text-todo.test.ts
import { describe, expect, it } from 'vitest'
import {
  TODO_DONE,
  TODO_OPEN,
  todoMarkerAt,
  todoShortcut,
  toggleChecklistLines,
  toggleTodoAt,
} from './text-todo'

describe('todoMarkerAt', () => {
  it('reads the marker at a line start', () => {
    expect(todoMarkerAt(`${TODO_OPEN} a`, 0)).toBe('open')
    expect(todoMarkerAt(`x\n${TODO_DONE} a`, 2)).toBe('done')
  })

  it('returns null for plain text and out-of-range indexes', () => {
    expect(todoMarkerAt('a', 0)).toBeNull()
    expect(todoMarkerAt('', 0)).toBeNull()
    expect(todoMarkerAt('a', 5)).toBeNull()
  })
})

describe('toggleTodoAt', () => {
  it('swaps one character for one character', () => {
    const open = `${TODO_OPEN} a`
    const done = toggleTodoAt(open, 0)
    expect(done).toBe(`${TODO_DONE} a`)
    expect(done.length).toBe(open.length)
    expect(toggleTodoAt(done, 0)).toBe(open)
  })

  it('leaves text unchanged when there is no marker at the index', () => {
    expect(toggleTodoAt('abc', 1)).toBe('abc')
  })
})

describe('toggleChecklistLines', () => {
  it('adds a marker to a plain line under the caret', () => {
    const result = toggleChecklistLines('a\nb', 0, 0)
    expect(result.text).toBe(`${TODO_OPEN} a\nb`)
    expect(result.edits).toEqual([{ at: 0, deleteCount: 0, insertLength: 2 }])
  })

  it('adds markers to every touched line, last line first', () => {
    const result = toggleChecklistLines('a\nb\nc', 0, 3)
    expect(result.text).toBe(`${TODO_OPEN} a\n${TODO_OPEN} b\nc`)
    expect(result.edits.map((edit) => edit.at)).toEqual([2, 0])
  })

  it('does not touch a line where the range ends at its first character', () => {
    expect(toggleChecklistLines('a\nb', 0, 2).text).toBe(`${TODO_OPEN} a\nb`)
  })

  it('leaves existing todo lines alone when adding to a mixed range', () => {
    const result = toggleChecklistLines(`${TODO_DONE} a\nb`, 0, 5)
    expect(result.text).toBe(`${TODO_DONE} a\n${TODO_OPEN} b`)
  })

  it('removes the marker and its space when every touched line is a todo', () => {
    const result = toggleChecklistLines(
      `${TODO_OPEN} a\n${TODO_DONE} b\nc`,
      0,
      5,
    )
    expect(result.text).toBe('a\nb\nc')
    expect(result.edits).toEqual([
      { at: 4, deleteCount: 2, insertLength: 0 },
      { at: 0, deleteCount: 2, insertLength: 0 },
    ])
  })

  it('removes a marker that has no following space', () => {
    expect(toggleChecklistLines(`${TODO_OPEN}a`, 0, 0).text).toBe('a')
  })

  it('works on empty text and on a line that follows a leading newline', () => {
    expect(toggleChecklistLines('', 0, 0).text).toBe(`${TODO_OPEN} `)
    expect(toggleChecklistLines('\nx', 0, 0).text).toBe(`${TODO_OPEN} \nx`)
  })

  it('accepts a range given in either order', () => {
    expect(toggleChecklistLines('a\nb', 3, 0).text).toBe(
      `${TODO_OPEN} a\n${TODO_OPEN} b`,
    )
  })
})

describe('todoShortcut', () => {
  it.each([
    ['[] ', TODO_OPEN],
    ['[ ] ', TODO_OPEN],
    ['[x] ', TODO_DONE],
    ['[X] ', TODO_DONE],
  ])('converts %s at a line start', (typed, marker) => {
    const text = `a\n${typed}`
    const result = todoShortcut(text, text.length)
    expect(result?.text).toBe(`a\n${marker} `)
    expect(result?.caret).toBe(4)
    expect(result?.edit).toEqual({
      at: 2,
      deleteCount: typed.length - 1,
      insertLength: 1,
    })
  })

  it('keeps the text after the caret', () => {
    const result = todoShortcut('[] tail', 3)
    expect(result?.text).toBe(`${TODO_OPEN} tail`)
    expect(result?.caret).toBe(2)
  })

  it('ignores brackets that are not at the line start', () => {
    expect(todoShortcut('a [] ', 5)).toBeNull()
    expect(todoShortcut('[]', 2)).toBeNull()
    expect(todoShortcut('[y] ', 4)).toBeNull()
  })
})
