// src/lib/canvas-engine/text-todo.ts
// Todo lines in canvas text: a line that starts with ☐ is an open todo, one
// that starts with ☑ is done. The state lives in the text itself, so a toggle
// swaps one character for one character and run offsets stay valid.
//
// Pure module: no React, no DOM, no canvas.

export const TODO_OPEN = '☐'
export const TODO_DONE = '☑'

export type TodoState = 'open' | 'done'

/** One text edit: `deleteCount` characters at `at` replaced by `insertLength`. */
export interface TodoEdit {
  at: number
  deleteCount: number
  insertLength: number
}

/** The state of a todo marker at `lineStart`, or null when the line has none. */
export function todoMarkerAt(
  text: string,
  lineStart: number,
): TodoState | null {
  const char = text[lineStart]
  if (char === TODO_OPEN) return 'open'
  if (char === TODO_DONE) return 'done'
  return null
}

/** Index of the first character of the hard line that holds `index`. */
function lineStartOf(text: string, index: number): number {
  // lastIndexOf clamps a negative start to 0, which would match a newline at 0.
  return index <= 0 ? 0 : text.lastIndexOf('\n', index - 1) + 1
}

/**
 * Swap the marker at `index` between open and done. Anything else at `index`
 * leaves the text unchanged.
 */
export function toggleTodoAt(text: string, index: number): string {
  const state = todoMarkerAt(text, index)
  if (state === null) return text
  const next = state === 'open' ? TODO_DONE : TODO_OPEN
  return text.slice(0, index) + next + text.slice(index + 1)
}

/**
 * Turn the lines under `[start, end]` into todo lines, or turn them back into
 * plain lines when every one of them is already a todo.
 *
 * `edits` are given in the order to apply them (last line first), so each `at`
 * is valid against the text as it stands when that edit is applied — feed them
 * to `remapRuns` one by one.
 */
export function toggleChecklistLines(
  text: string,
  start: number,
  end: number,
): { text: string; edits: Array<TodoEdit> } {
  const from = Math.min(start, end)
  const to = Math.max(start, end)

  const lineStarts: Array<number> = []
  let cursor = lineStartOf(text, from)
  for (;;) {
    // A range that ends exactly where a line begins does not touch that line.
    if (lineStarts.length > 0 && cursor === to && to > from) break
    lineStarts.push(cursor)
    const newline = text.indexOf('\n', cursor)
    if (newline === -1) break
    cursor = newline + 1
    if (cursor > to) break
  }

  const removing = lineStarts.every((at) => todoMarkerAt(text, at) !== null)
  const edits: Array<TodoEdit> = []
  let result = text
  for (let i = lineStarts.length - 1; i >= 0; i -= 1) {
    const at = lineStarts[i]
    if (removing) {
      const deleteCount = result[at + 1] === ' ' ? 2 : 1
      result = result.slice(0, at) + result.slice(at + deleteCount)
      edits.push({ at, deleteCount, insertLength: 0 })
    } else if (todoMarkerAt(result, at) === null) {
      result = result.slice(0, at) + `${TODO_OPEN} ` + result.slice(at)
      edits.push({ at, deleteCount: 0, insertLength: 2 })
    }
  }
  return { text: result, edits }
}

/**
 * Convert "[] ", "[ ] ", "[x] " or "[X] " just typed at a line start into a
 * marker. `caret` sits right after the typed space; the space stays and the
 * caret ends up after it. Returns null when the text before the caret is
 * anything else.
 */
export function todoShortcut(
  text: string,
  caret: number,
): { text: string; caret: number; edit: TodoEdit } | null {
  const lineStart = lineStartOf(text, caret)
  const typed = text.slice(lineStart, caret)
  let state: TodoState
  if (typed === '[] ' || typed === '[ ] ') state = 'open'
  else if (typed === '[x] ' || typed === '[X] ') state = 'done'
  else return null

  const bracketLength = typed.length - 1
  const marker = state === 'open' ? TODO_OPEN : TODO_DONE
  return {
    text:
      text.slice(0, lineStart) + marker + text.slice(lineStart + bracketLength),
    caret: lineStart + 2,
    edit: { at: lineStart, deleteCount: bracketLength, insertLength: 1 },
  }
}
