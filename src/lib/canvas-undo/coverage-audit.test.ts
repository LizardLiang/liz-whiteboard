// src/lib/canvas-undo/coverage-audit.test.ts
// Automated coverage audit (board-undo tactical plan, Wave 5, step 13).
//
// Discharges the spec-delta's "Canvas Undo Covers Every Element Gesture"
// requirement's own enforcement clause verbatim:
//
//   "Coverage SHALL be enforced by an automated audit rather than by
//   inspection, so that a persistence site added later cannot silently
//   escape it."
//
// and its own scenario:
//
//   "WHEN a persistence site that writes canvas element content exists in
//   the source but appears in no undo coverage enumeration THEN the
//   coverage audit fails, rather than the gap being discovered when a
//   user's undo silently does nothing."
//
// DESIGN: this audit enumerates persistence sites by reading and scanning
// `src/data/canvas-element.ts` — the data-access layer every canvas element
// write funnels through (verified by grep across `src/`: `"CanvasElement"`,
// the table name, appears in exactly three other files, none of which write
// to it — `db.ts`'s column-migration guard, `schema-sql.ts`'s table
// definition, and a comment in `schema.ts`). Enumerating at the DATA layer,
// not the socket-event layer (`handlers.ts`'s `element:create`/`element:
// update`/`element:delete`), is what satisfies the requirement's own "SHALL
// NOT define it over any single transport or event name" clause: a future
// second transport (a REST endpoint, a batch-import job, a server function)
// that still funnels through `canvas-element.ts`'s exported functions is
// still caught by this audit; a NEW exported function in that file that
// performs its own write is caught too, because the scan below reads the
// file's actual exported function bodies, not a fixed list of names.
//
// The "undo registry" this checks coverage against is `UNDO_REGISTRY`
// below — hand-maintained, one entry per persistence site, naming the
// `CanvasUndoOperation` kind (`create`/`update`/`delete`, from undo-
// stack.ts) whose inverse reverses that site's write. A persistence site
// enumerated from source with no registry entry fails the test; a registry
// entry with no matching persistence site (the registry naming something
// that no longer exists, or was renamed) also fails, so the registry cannot
// silently drift stale in the other direction either.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DATA_LAYER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/canvas-element.ts',
)

/**
 * The undo mechanism's coverage registry. One entry per exported function in
 * `canvas-element.ts` that writes canvas element content, naming the
 * `CanvasUndoOperation` kind (undo-stack.ts) whose inverse reverses it.
 *
 * Kept here, not co-located with `undo-stack.ts`/`inverse.ts`/`use-canvas-
 * undo.ts` themselves, because this is a CROSS-CHECK of those modules
 * against the data layer's actual write sites — folding it into one of the
 * modules it is meant to check would let a change to that module silently
 * "self-approve".
 */
const UNDO_REGISTRY: Readonly<Record<string, 'create' | 'update' | 'delete'>> = {
  createCanvasElement: 'create',
  updateCanvasElement: 'update',
  deleteCanvasElement: 'delete',
}

/**
 * Markers proving an exported function's body actually writes to the
 * `CanvasElement` table, as opposed to merely reading it (`findCanvasElement
 * ById`, `findCanvasElementsByBoard`, `nextCanvasZIndex` all read only, and
 * must NOT be swept up as persistence sites).
 *
 * Matches this file's own established write shapes (`db.ts`'s `insert`/
 * `update` helpers, and a raw `DELETE FROM` for the one function with no
 * helper of its own) — the same three shapes every other mutating function
 * in this codebase's data layer uses (see `data/shape.ts`, `data/
 * connector.ts`).
 */
const WRITE_MARKERS: ReadonlyArray<RegExp> = [
  /\binsert\(\s*['"]CanvasElement['"]/,
  /\bupdate\(\s*['"]CanvasElement['"]/,
  /DELETE FROM "CanvasElement"/,
]

interface FunctionBlock {
  name: string
  body: string
}

/**
 * Split the data layer's source into one block per exported function,
 * spanning from its `export async function NAME(` declaration to the start
 * of the next one (or EOF). Good enough for this file's own consistent
 * house style — one exported function at a time, never nested — without
 * pulling in a full TS parser for a single-file enumeration.
 */
function splitExportedFunctions(source: string): Array<FunctionBlock> {
  const declPattern = /export async function (\w+)\(/g
  const matches: Array<{ name: string; index: number }> = []
  let match: RegExpExecArray | null
  while ((match = declPattern.exec(source))) {
    matches.push({ name: match[1], index: match.index })
  }
  return matches.map((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length
    return { name: m.name, body: source.slice(m.index, end) }
  })
}

/** Every exported function in the data layer whose body writes canvas element content. */
function findPersistenceSites(source: string): Array<string> {
  return splitExportedFunctions(source)
    .filter((fn) => WRITE_MARKERS.some((marker) => marker.test(fn.body)))
    .map((fn) => fn.name)
}

describe('canvas undo coverage audit', () => {
  it('finds at least one real persistence site (sanity — the scan itself is not vacuous)', () => {
    const source = readFileSync(DATA_LAYER_PATH, 'utf8')
    const sites = findPersistenceSites(source)
    expect(sites.length).toBeGreaterThan(0)
  })

  it('does not sweep up read-only functions as persistence sites', () => {
    const source = readFileSync(DATA_LAYER_PATH, 'utf8')
    const sites = findPersistenceSites(source)
    expect(sites).not.toContain('findCanvasElementsByBoard')
    expect(sites).not.toContain('findCanvasElementById')
    expect(sites).not.toContain('nextCanvasZIndex')
  })

  it('every persistence site found in source is covered by the undo registry', () => {
    const source = readFileSync(DATA_LAYER_PATH, 'utf8')
    const sites = findPersistenceSites(source)
    const uncovered = sites.filter((site) => !(site in UNDO_REGISTRY))
    expect(
      uncovered,
      `Persistence site(s) ${JSON.stringify(uncovered)} write canvas element ` +
        'content but have no entry in UNDO_REGISTRY (coverage-audit.test.ts). ' +
        'Add one naming the CanvasUndoOperation kind whose inverse reverses ' +
        'this write, or the gesture is silently unreversible.',
    ).toEqual([])
  })

  it('every undo registry entry names a persistence site that still exists in source', () => {
    const source = readFileSync(DATA_LAYER_PATH, 'utf8')
    const sites = new Set(findPersistenceSites(source))
    const stale = Object.keys(UNDO_REGISTRY).filter((name) => !sites.has(name))
    expect(
      stale,
      `UNDO_REGISTRY entry(ies) ${JSON.stringify(stale)} name a function ` +
        'that no longer writes canvas element content (renamed, removed, or ' +
        'no longer mutating) — the registry has drifted stale and should be ' +
        'updated to match the data layer.',
    ).toEqual([])
  })

  it('registers exactly the three known milestone-1 sites (create/update/delete)', () => {
    // Not a substitute for the two enumeration-based checks above — this is
    // an explicit pin so a passing audit is legible at a glance, matching
    // the plan's own "the canvas engine has three mutating persistence
    // sites" framing.
    const source = readFileSync(DATA_LAYER_PATH, 'utf8')
    const sites = findPersistenceSites(source).sort()
    expect(sites).toEqual(
      ['createCanvasElement', 'deleteCanvasElement', 'updateCanvasElement'].sort(),
    )
  })
})
