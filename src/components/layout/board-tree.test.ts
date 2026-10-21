// src/components/layout/board-tree.test.ts
import { describe, expect, it } from 'vitest'
import { findBoardPath } from './board-breadcrumb'
import {
  buildSearchIndex,
  filterEntries,
  findBoardTrail,
  listChildren,
  locationName,
  parentFolderOf,
  searchIndex,
} from './board-tree'
import type { TreeProject } from './board-tree'

const projects: Array<TreeProject> = [
  {
    id: 'p1',
    name: 'Alpha',
    whiteboards: [{ id: 'w-root', name: 'Root Board' }],
    canvasBoards: [{ id: 'c-root', name: 'apple canvas' }],
    folders: [
      {
        id: 'f-docs',
        name: 'Docs',
        parentFolderId: null,
        whiteboards: [{ id: 'w-docs', name: 'Docs Board' }],
        canvasBoards: [],
      },
      {
        id: 'f-api',
        name: 'API',
        parentFolderId: 'f-docs',
        whiteboards: [{ id: 'w-orders', name: 'Orders ERD' }],
        canvasBoards: [{ id: 'c-flow', name: 'Order flow' }],
      },
      {
        id: 'f-archive',
        name: 'archive',
        parentFolderId: null,
        whiteboards: [],
        canvasBoards: [],
      },
    ],
  },
  {
    id: 'p2',
    name: 'Beta',
    whiteboards: [],
    canvasBoards: [{ id: 'c-beta', name: 'Beta order sketch' }],
    folders: [],
  },
]

describe('listChildren', () => {
  it('lists folders first, then boards, sorted by name', () => {
    const rows = listChildren(projects, 'p1', null)
    expect(rows.map((r) => `${r.type}:${r.name}`)).toEqual([
      'folder:archive',
      'folder:Docs',
      'canvas:apple canvas',
      'whiteboard:Root Board',
    ])
  })

  it('lists only the direct children of a folder', () => {
    const rows = listChildren(projects, 'p1', 'f-docs')
    expect(rows.map((r) => r.id)).toEqual(['f-api', 'w-docs'])
  })

  it('returns an empty list for an empty folder or an unknown project', () => {
    expect(listChildren(projects, 'p1', 'f-archive')).toEqual([])
    expect(listChildren(projects, 'nope', null)).toEqual([])
    expect(listChildren(undefined, 'p1', null)).toEqual([])
  })
})

describe('folder helpers', () => {
  it('resolves the parent folder and location names', () => {
    expect(parentFolderOf(projects, 'p1', 'f-api')).toBe('f-docs')
    expect(parentFolderOf(projects, 'p1', 'f-docs')).toBeNull()
    expect(parentFolderOf(projects, 'p1', 'missing')).toBeUndefined()
    expect(locationName(projects, 'p1', null)).toBe('Alpha')
    expect(locationName(projects, 'p1', 'f-api')).toBe('API')
  })

  it('filters entries by case-insensitive substring', () => {
    const rows = listChildren(projects, 'p1', null)
    expect(filterEntries(rows, ' DOC ').map((r) => r.id)).toEqual(['f-docs'])
    expect(filterEntries(rows, '')).toHaveLength(rows.length)
  })
})

describe('findBoardTrail / findBoardPath', () => {
  it('returns project and folder segments with ids', () => {
    const trail = findBoardTrail(projects, 'w-orders')
    expect(trail?.board).toMatchObject({ type: 'whiteboard', id: 'w-orders' })
    expect(trail?.segments.map((s) => [s.type, s.id, s.folderId])).toEqual([
      ['project', 'p1', null],
      ['folder', 'f-docs', 'f-docs'],
      ['folder', 'f-api', 'f-api'],
    ])
  })

  it('finds a canvas board at the project root', () => {
    const trail = findBoardTrail(projects, 'c-beta')
    expect(trail?.board.type).toBe('canvas')
    expect(trail?.segments).toHaveLength(1)
  })

  it('keeps the names-only path working', () => {
    expect(findBoardPath(projects, 'c-flow')).toEqual([
      'Alpha',
      'Docs',
      'API',
      'Order flow',
    ])
    expect(findBoardPath(projects, 'missing')).toBeNull()
    expect(findBoardPath(undefined, 'w-root')).toBeNull()
  })
})

describe('search index', () => {
  const index = buildSearchIndex(projects)

  it('indexes folders and boards with their paths', () => {
    expect(index.find((e) => e.id === 'f-api')?.path).toEqual(['Alpha', 'Docs'])
    expect(index.find((e) => e.id === 'c-flow')?.path).toEqual([
      'Alpha',
      'Docs',
      'API',
    ])
    expect(index.find((e) => e.id === 'w-root')?.path).toEqual(['Alpha'])
  })

  it('matches case-insensitively across projects, prefix matches first', () => {
    const rows = searchIndex(index, 'ORDER')
    expect(rows.map((r) => r.id)).toEqual(['c-flow', 'w-orders', 'c-beta'])
  })

  it('returns nothing for a blank query and honours the limit', () => {
    expect(searchIndex(index, '  ')).toEqual([])
    expect(searchIndex(index, 'o', 2)).toHaveLength(2)
    expect(buildSearchIndex(undefined)).toEqual([])
  })
})
