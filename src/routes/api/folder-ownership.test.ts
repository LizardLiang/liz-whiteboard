// @vitest-environment node
// src/routes/api/folder-ownership.test.ts
// M2: a folder id (or projectId) in a request body must never move a board or
// folder into a project the caller cannot write to.

import { beforeEach, describe, expect, it } from 'vitest'
import { updateWhiteboardSchema } from '@/data/schema'
import { createWhiteboard, updateWhiteboard } from '@/data/whiteboard'
import { createFolder } from '@/data/folder'
import { findProjectPageContent } from '@/data/project'
import { db } from '@/db'
import { ForbiddenError, assertFolderInProject } from '@/lib/auth/require-role'
import {
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

beforeEach(() => resetDb())

async function twoProjects() {
  const a = makeUser()
  const b = makeUser()
  const projectA = makeProject({ ownerId: a.id })
  const projectB = makeProject({ ownerId: b.id })
  const folderA = await createFolder({ name: 'A', projectId: projectA.id })
  const folderB = await createFolder({ name: 'B', projectId: projectB.id })
  return { a, b, projectA, projectB, folderA, folderB }
}

describe('updateWhiteboardSchema', () => {
  it('drops projectId so a board cannot be re-parented', async () => {
    const { projectA, projectB } = await twoProjects()
    const wb = makeWhiteboard({ projectId: projectA.id })
    const parsed = updateWhiteboardSchema.parse({
      name: 'x',
      projectId: projectB.id,
    })
    expect('projectId' in parsed).toBe(false)

    await updateWhiteboard(wb.id, {
      name: 'x',
      projectId: projectB.id,
    } as never)
    const row = db
      .prepare('SELECT "projectId" FROM "Whiteboard" WHERE "id" = ?')
      .get(wb.id) as { projectId: string }
    expect(row.projectId).toBe(projectA.id)
  })
})

describe('assertFolderInProject', () => {
  it('accepts no folder, null, and a folder of the same project', async () => {
    const { projectA, folderA } = await twoProjects()
    await expect(
      assertFolderInProject(undefined, projectA.id),
    ).resolves.toBeUndefined()
    await expect(
      assertFolderInProject(null, projectA.id),
    ).resolves.toBeUndefined()
    await expect(
      assertFolderInProject(folderA.id, projectA.id),
    ).resolves.toBeUndefined()
  })

  it('rejects a foreign folder and an unknown folder identically', async () => {
    const { projectA, folderB } = await twoProjects()
    await expect(
      assertFolderInProject(folderB.id, projectA.id),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      assertFolderInProject(
        '00000000-0000-4000-8000-000000000000',
        projectA.id,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('breadcrumb ancestors stay inside the project', () => {
  it('does not leak a foreign ancestor folder name', async () => {
    const { projectA, projectB, folderB } = await twoProjects()
    // Hostile data: a folder in A whose parent is a folder in B.
    const child = await createFolder({
      name: 'child',
      projectId: projectA.id,
      parentFolderId: folderB.id,
    })
    const page = await findProjectPageContent(projectA.id, child.id)
    expect(page).not.toBeNull()
    expect(page!.breadcrumb.filter((c) => c.type === 'folder')).toEqual([])
    void projectB
  })
})

describe('data-layer create still works for same-project folders', () => {
  it('files a whiteboard under a same-project folder', async () => {
    const { projectA, folderA } = await twoProjects()
    const wb = await createWhiteboard({
      name: 'ok',
      projectId: projectA.id,
      folderId: folderA.id,
    })
    expect(wb.folderId).toBe(folderA.id)
  })
})
