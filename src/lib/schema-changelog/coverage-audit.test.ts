// src/lib/schema-changelog/coverage-audit.test.ts
// Coverage audit for the schema change log (mirrors
// src/lib/canvas-undo/coverage-audit.test.ts).
//
// The change log is complete only while every write to a table, column,
// relationship, table reference or area passes through an exported function in
// the data layer that takes a `ctx: ChangeContext`. This audit reads those
// files and fails when:
//   1. an exported write function has no `ctx: ChangeContext` parameter;
//   2. an exported write function is not called by schema-changelog.test.ts,
//      so no test checks that it records an event;
//   3. code outside src/data/ writes to one of the logged tables directly.
//
// PENDING_PHASE_2 lists the writers that do not log yet. The test also fails
// when a listed writer starts to log, so the entry must go in the same change.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../..')

const DATA_FILES = [
  'diagram-table.ts',
  'column.ts',
  'relationship.ts',
  'table-reference.ts',
  'area.ts',
  'whiteboard-snapshot.ts',
]

/** Writers that do not take a context yet. Phase 2 of the change log removes each entry. */
const PENDING_PHASE_2_WRITERS = new Set<string>()

/** Files outside src/data/ that still write to a logged table. Phase 2 removes each entry. */
const PENDING_PHASE_2_RAW_WRITERS = new Set<string>()

const WRITE_PATTERN =
  /\b(insert|update|transaction)\(|INSERT INTO|\bUPDATE "|DELETE FROM|\b(updateArea|createArea|deleteArea)\(/

interface ExportedFunction {
  file: string
  name: string
  signature: string
  body: string
}

function exportedFunctions(file: string): Array<ExportedFunction> {
  const text = readFileSync(join(SRC, 'data', file), 'utf8')
  const found: Array<ExportedFunction> = []
  const start = /^export (?:async )?function (\w+)/gm
  for (const match of text.matchAll(start)) {
    const from = match.index
    const end = text.indexOf('\n}\n', from)
    const source = text.slice(from, end === -1 ? undefined : end + 3)
    const open = source.indexOf('{', source.indexOf(')'))
    found.push({
      file,
      name: match[1],
      signature: source.slice(0, open),
      body: source.slice(open),
    })
  }
  return found
}

function writeFunctions(): Array<ExportedFunction> {
  return DATA_FILES.flatMap(exportedFunctions)
    .filter((fn) => WRITE_PATTERN.test(fn.body))
    .filter(
      // Saving a version writes a snapshot, not a schema entity.
      (fn) =>
        fn.file !== 'whiteboard-snapshot.ts' || /DiagramTable/.test(fn.body),
    )
}

function sourceFiles(dir: string): Array<string> {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry) ? [full] : []
  })
}

describe('schema change log coverage', () => {
  it('finds the write functions it audits', () => {
    const names = writeFunctions().map((fn) => fn.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'createDiagramTable',
        'deleteDiagramTable',
        'createColumn',
        'reorderColumns',
        'createRelationship',
        'createTableReference',
        'moveAreaAndMembers',
      ]),
    )
  })

  it('gives every exported write function a ctx: ChangeContext parameter', () => {
    const missing = writeFunctions()
      .filter((fn) => !/\bctx: ChangeContext\b/.test(fn.signature))
      .map((fn) => fn.name)
      .filter((name) => !PENDING_PHASE_2_WRITERS.has(name))
    expect(missing).toEqual([])
  })

  it('removes a pending writer from the list once it takes a context', () => {
    const logging = writeFunctions()
      .filter((fn) => /\bctx: ChangeContext\b/.test(fn.signature))
      .map((fn) => fn.name)
      .filter((name) => PENDING_PHASE_2_WRITERS.has(name))
    expect(logging).toEqual([])
  })

  it('records an event or passes the context on in every context-taking writer', () => {
    const silent = writeFunctions()
      .filter((fn) => /\bctx: ChangeContext\b/.test(fn.signature))
      .filter((fn) => !/\b(recordChange|recordUpdate|ctx)\b/.test(fn.body))
      .map((fn) => fn.name)
    expect(silent).toEqual([])
  })

  it('has a test that calls every context-taking writer', () => {
    const tests = readFileSync(join(HERE, 'schema-changelog.test.ts'), 'utf8')
    const untested = writeFunctions()
      .filter((fn) => /\bctx: ChangeContext\b/.test(fn.signature))
      .map((fn) => fn.name)
      .filter((name) => !new RegExp(`\\b${name}\\(`).test(tests))
    expect(untested).toEqual([])
  })

  it('has no direct write to a logged table outside src/data/', () => {
    const direct =
      /\b(?:update|insert)\('(?:DiagramTable|Column|Relationship|Area)'|(?:INSERT INTO|UPDATE|DELETE FROM) "(?:DiagramTable|Column|Relationship|Area)"/
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file))
      .filter(
        (file) =>
          !file.startsWith('data/') &&
          !file.startsWith('test/') &&
          !/\.test\.tsx?$/.test(file),
      )
      .filter((file) => direct.test(readFileSync(join(SRC, file), 'utf8')))
    const unexpected = offenders.filter(
      (file) => !PENDING_PHASE_2_RAW_WRITERS.has(file),
    )
    expect(unexpected).toEqual([])
    const resolved = [...PENDING_PHASE_2_RAW_WRITERS].filter(
      (file) => !offenders.includes(file),
    )
    expect(resolved).toEqual([])
  })
})
