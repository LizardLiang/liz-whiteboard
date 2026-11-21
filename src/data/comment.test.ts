// src/data/comment.test.ts
// The comment read/broadcast payload must never carry the author's email.

import { beforeEach, describe, expect, it } from 'vitest'

import { createComment } from './comment'
import {
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

beforeEach(() => resetDb())

describe('createComment payload', () => {
  it('carries the author display name but no email', async () => {
    const user = makeUser({ email: 'author@example.com' })
    const project = makeProject({ ownerId: user.id })
    const wb = makeWhiteboard({ projectId: project.id })

    const comment = await createComment(
      {
        whiteboardId: wb.id,
        targetType: 'point',
        positionX: 10,
        positionY: 20,
        body: 'hello',
      },
      user.id,
    )

    expect(comment.authorName).toBeTruthy()
    expect(comment).not.toHaveProperty('authorEmail')
    expect(JSON.stringify(comment)).not.toContain('author@example.com')
  })
})
