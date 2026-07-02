// src/data/project.test.ts
// Integration tests for findProjectPageContent (and related project reads)
// against a real in-memory SQLite database (DATABASE_URL=:memory:).
// Verifies folder/whiteboard filtering, breadcrumb via recursive CTE, and
// _count.tables — the behaviors the original mock-based tests asserted.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  findAllProjectsForUser,
  findAllProjectsWithTreeForUser,
  findProjectPageContent,
} from './project'
import { createProjectMember } from './permission'
import { db, genId, nowMs } from '@/db'
import {
  makeProject,
  makeTable,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

/** Insert a Folder row directly (no fixture maker exists for folders). */
function makeFolder(opts: {
  projectId: string
  name?: string
  parentFolderId?: string | null
}): { id: string } {
  const id = genId()
  const ts = nowMs()
  db.prepare(
    'INSERT INTO "Folder" ("id","name","projectId","parentFolderId","createdAt","updatedAt") VALUES (?,?,?,?,?,?)',
  ).run(
    id,
    opts.name ?? 'Test Folder',
    opts.projectId,
    opts.parentFolderId ?? null,
    ts,
    ts,
  )
  return { id }
}

/** Put a whiteboard inside a folder (the maker always creates root-level ones). */
function moveWhiteboardToFolder(whiteboardId: string, folderId: string): void {
  db.prepare('UPDATE "Whiteboard" SET "folderId" = ? WHERE "id" = ?').run(
    folderId,
    whiteboardId,
  )
}

beforeEach(() => resetDb())

describe('findProjectPageContent', () => {
  describe('TC-09-07: returns null when projectId does not exist', () => {
    it('returns null for non-existent project', async () => {
      const result = await findProjectPageContent(genId())
      expect(result).toBeNull()
    })
  })

  describe('root view (no folderId)', () => {
    it('TC-09-01: returns only folders with parentFolderId = null', async () => {
      const p = makeProject({ name: 'Test Project' })
      const root = makeFolder({ projectId: p.id, name: 'Root Folder' })
      // A nested folder must NOT appear in the root view.
      makeFolder({
        projectId: p.id,
        name: 'Nested Folder',
        parentFolderId: root.id,
      })

      const result = await findProjectPageContent(p.id)

      expect(result).not.toBeNull()
      expect(result!.folders).toHaveLength(1)
      expect(result!.folders[0].name).toBe('Root Folder')
    })

    it('TC-09-02: returns only whiteboards with folderId = null', async () => {
      const p = makeProject()
      const folder = makeFolder({ projectId: p.id })
      makeWhiteboard({ projectId: p.id, name: 'Root WB' })
      const nested = makeWhiteboard({ projectId: p.id, name: 'Nested WB' })
      moveWhiteboardToFolder(nested.id, folder.id)

      const result = await findProjectPageContent(p.id)

      expect(result).not.toBeNull()
      expect(result!.whiteboards).toHaveLength(1)
      expect(result!.whiteboards[0].name).toBe('Root WB')
    })

    it('TC-09-03: returns whiteboards with _count.tables', async () => {
      const p = makeProject()
      const wb = makeWhiteboard({ projectId: p.id, name: 'Schema Design' })
      makeTable({ whiteboardId: wb.id, name: 'users' })
      makeTable({ whiteboardId: wb.id, name: 'orders' })
      makeTable({ whiteboardId: wb.id, name: 'products' })

      const result = await findProjectPageContent(p.id)

      expect(result).not.toBeNull()
      expect(result!.whiteboards[0]._count.tables).toBe(3)
    })

    it('TC-09-04: breadcrumb is empty for root view', async () => {
      const p = makeProject()
      const result = await findProjectPageContent(p.id)

      expect(result).not.toBeNull()
      expect(result!.breadcrumb).toEqual([])
    })

    it('returns project, folders and whiteboards with real shapes', async () => {
      const p = makeProject({ name: 'Test Project' })
      makeFolder({ projectId: p.id, name: 'Alpha Folder' })
      const wb = makeWhiteboard({ projectId: p.id, name: 'Schema Design' })

      const result = await findProjectPageContent(p.id)

      expect(result).not.toBeNull()
      expect(result!.project).toEqual({ id: p.id, name: 'Test Project' })
      expect(result!.folders[0]).toEqual(
        expect.objectContaining({ name: 'Alpha Folder' }),
      )
      // Mapper returns a real Date for createdAt.
      expect(result!.folders[0].createdAt).toBeInstanceOf(Date)
      expect(result!.whiteboards[0]).toEqual(
        expect.objectContaining({ id: wb.id, name: 'Schema Design' }),
      )
      expect(result!.whiteboards[0].updatedAt).toBeInstanceOf(Date)
    })

    it('orders folders by name ASC', async () => {
      const p = makeProject()
      makeFolder({ projectId: p.id, name: 'Beta' })
      makeFolder({ projectId: p.id, name: 'Alpha' })

      const result = await findProjectPageContent(p.id)

      expect(result!.folders.map((f) => f.name)).toEqual(['Alpha', 'Beta'])
    })
  })

  describe('folder view (with folderId)', () => {
    it('TC-09-05: returns child folders and whiteboards for the folder', async () => {
      const p = makeProject()
      const folder = makeFolder({ projectId: p.id, name: 'Alpha Folder' })
      const child = makeFolder({
        projectId: p.id,
        name: 'Child Folder',
        parentFolderId: folder.id,
      })
      const wb = makeWhiteboard({ projectId: p.id, name: 'Folder WB' })
      moveWhiteboardToFolder(wb.id, folder.id)
      // A root-level whiteboard must NOT leak into the folder view.
      makeWhiteboard({ projectId: p.id, name: 'Root WB' })

      const result = await findProjectPageContent(p.id, folder.id)

      expect(result).not.toBeNull()
      expect(result!.folders).toHaveLength(1)
      expect(result!.folders[0].id).toBe(child.id)
      expect(result!.whiteboards).toHaveLength(1)
      expect(result!.whiteboards[0].id).toBe(wb.id)
      expect(result!.currentFolder).toEqual({
        id: folder.id,
        name: 'Alpha Folder',
      })
    })

    it('TC-09-06: breadcrumb has only project root when folder has no parent', async () => {
      const p = makeProject({ name: 'Test Project' })
      const folder = makeFolder({ projectId: p.id, name: 'Alpha Folder' })

      const result = await findProjectPageContent(p.id, folder.id)

      expect(result).not.toBeNull()
      expect(result!.breadcrumb).toEqual([
        { id: p.id, name: 'Test Project', type: 'project' },
      ])
    })

    it('TC-09-06: breadcrumb includes ancestor folders in root→leaf order', async () => {
      const p = makeProject({ name: 'Test Project' })
      const parent = makeFolder({ projectId: p.id, name: 'Parent Folder' })
      const child = makeFolder({
        projectId: p.id,
        name: 'Child Folder',
        parentFolderId: parent.id,
      })

      const result = await findProjectPageContent(p.id, child.id)

      expect(result).not.toBeNull()
      const breadcrumb = result!.breadcrumb
      expect(breadcrumb[0]).toEqual({
        id: p.id,
        name: 'Test Project',
        type: 'project',
      })
      expect(breadcrumb[1]).toEqual({
        id: parent.id,
        name: 'Parent Folder',
        type: 'folder',
      })
      expect(breadcrumb).toHaveLength(2)
    })

    it('TC-09-06: breadcrumb walks a multi-level ancestor chain', async () => {
      const p = makeProject({ name: 'Test Project' })
      const grandparent = makeFolder({ projectId: p.id, name: 'Grandparent' })
      const parent = makeFolder({
        projectId: p.id,
        name: 'Parent',
        parentFolderId: grandparent.id,
      })
      const child = makeFolder({
        projectId: p.id,
        name: 'Child',
        parentFolderId: parent.id,
      })

      const result = await findProjectPageContent(p.id, child.id)

      expect(result!.breadcrumb.map((b) => b.name)).toEqual([
        'Test Project',
        'Grandparent',
        'Parent',
      ])
    })

    it('TC-09-08: throws "Folder not found" for cross-project folder access', async () => {
      const p1 = makeProject({ name: 'Project One' })
      const p2 = makeProject({ name: 'Project Two' })
      const otherFolder = makeFolder({ projectId: p2.id, name: 'Other Folder' })

      await expect(
        findProjectPageContent(p1.id, otherFolder.id),
      ).rejects.toThrow('Folder not found')
    })

    it('TC-09-08: throws "Folder not found" when folderId does not exist', async () => {
      const p = makeProject()

      await expect(
        findProjectPageContent(p.id, genId()),
      ).rejects.toThrow('Folder not found')
    })
  })
})

describe('findAllProjectsWithTreeForUser', () => {
  it('returns all projects with nested folders and whiteboards', async () => {
    const user = makeUser()
    const p = makeProject({ name: 'Tree Project', ownerId: user.id })
    const folder = makeFolder({ projectId: p.id, name: 'F1' })
    const childFolder = makeFolder({
      projectId: p.id,
      name: 'F1-child',
      parentFolderId: folder.id,
    })
    const rootWb = makeWhiteboard({ projectId: p.id, name: 'Root WB' })
    const folderWb = makeWhiteboard({ projectId: p.id, name: 'Folder WB' })
    moveWhiteboardToFolder(folderWb.id, folder.id)

    const tree = await findAllProjectsWithTreeForUser(user.id)

    expect(tree).toHaveLength(1)
    const proj = tree[0]
    expect(proj.id).toBe(p.id)
    expect(proj.name).toBe('Tree Project')

    // Project-level whiteboards include all whiteboards in the project.
    expect(proj.whiteboards.map((w) => w.id).sort()).toEqual(
      [rootWb.id, folderWb.id].sort(),
    )

    expect(proj.folders).toHaveLength(2)
    const f1 = proj.folders.find((f) => f.id === folder.id)!
    expect(f1.parentFolderId).toBeNull()
    expect(f1.childFolders).toEqual([{ id: childFolder.id, name: 'F1-child' }])
    expect(f1.whiteboards).toEqual([{ id: folderWb.id, name: 'Folder WB' }])
  })

  it('returns an empty array when there are no projects', async () => {
    const user = makeUser()
    const tree = await findAllProjectsWithTreeForUser(user.id)
    expect(tree).toEqual([])
  })

  it('excludes projects owned by a different, unrelated user', async () => {
    const user = makeUser()
    const otherUser = makeUser()
    const ownProject = makeProject({ name: 'Mine', ownerId: user.id })
    makeProject({ name: 'Not Mine', ownerId: otherUser.id })

    const tree = await findAllProjectsWithTreeForUser(user.id)

    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe(ownProject.id)
  })

  it('includes projects the user is an explicit ProjectMember of', async () => {
    const owner = makeUser()
    const member = makeUser()
    const sharedProject = makeProject({ name: 'Shared', ownerId: owner.id })
    await createProjectMember({
      projectId: sharedProject.id,
      userId: member.id,
      role: 'VIEWER',
    })

    const tree = await findAllProjectsWithTreeForUser(member.id)

    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe(sharedProject.id)
  })
})

describe('findAllProjectsForUser', () => {
  it('returns projects owned by the user', async () => {
    const user = makeUser()
    const p = makeProject({ name: 'Mine', ownerId: user.id })

    const projects = await findAllProjectsForUser(user.id)

    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe(p.id)
  })

  it('returns projects the user is an explicit ProjectMember of', async () => {
    const owner = makeUser()
    const member = makeUser()
    const sharedProject = makeProject({ name: 'Shared', ownerId: owner.id })
    await createProjectMember({
      projectId: sharedProject.id,
      userId: member.id,
      role: 'EDITOR',
    })

    const projects = await findAllProjectsForUser(member.id)

    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe(sharedProject.id)
  })

  it('excludes projects owned by a different, unrelated user', async () => {
    const user = makeUser()
    const otherUser = makeUser()
    const ownProject = makeProject({ name: 'Mine', ownerId: user.id })
    makeProject({ name: 'Not Mine', ownerId: otherUser.id })

    const projects = await findAllProjectsForUser(user.id)

    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe(ownProject.id)
  })

  it('returns an empty array when there are no accessible projects', async () => {
    const user = makeUser()
    const otherUser = makeUser()
    makeProject({ name: 'Not Mine', ownerId: otherUser.id })

    const projects = await findAllProjectsForUser(user.id)
    expect(projects).toEqual([])
  })
})
