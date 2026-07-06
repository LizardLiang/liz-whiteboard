// src/routes/api/history.test.ts
// Server-function handler tests for whiteboard version history / snapshots
// (GH #107): save/list/get/restore. Mirrors src/routes/api/share.test.ts's
// pattern — imports and calls the REAL exported handler functions from
// src/lib/history/handlers.ts directly, against the real (in-memory) test
// DB, including their EDITOR+/VIEWER+ gating logic running through the real
// findEffectiveRole/hasMinimumRole resolution against actually-seeded
// ProjectMember rows.

import { beforeEach, describe, expect, it } from 'vitest'

import type { AuthContext } from '@/lib/auth/middleware'
import {
  getSnapshotHandler,
  listSnapshotsHandler,
  restoreSnapshotHandler,
  saveSnapshotHandler,
} from '@/lib/history/handlers'
import { ForbiddenError } from '@/lib/auth/require-role'
import { upsertProjectMember } from '@/data/permission'
import {
  createDiagramTable,
  findDiagramTablesByWhiteboardId,
} from '@/data/diagram-table'
import { createColumn } from '@/data/column'
import { createRelationship } from '@/data/relationship'
import { createArea } from '@/data/area'
import {
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function ctxFor(userId: string): AuthContext {
  return {
    user: {
      id: userId,
      username: `user-${userId.slice(0, 6)}`,
      email: `${userId}@example.com`,
    },
    session: {
      id: 'test-session',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  }
}

/** Seed a small but representative diagram: 2 tables, 1 relationship, 1 area. */
async function seedDiagram(whiteboardId: string) {
  const t1 = await createDiagramTable({
    whiteboardId,
    name: 'users',
    positionX: 0,
    positionY: 0,
  })
  const c1 = await createColumn({
    tableId: t1.id,
    name: 'id',
    dataType: 'uuid',
    isPrimaryKey: true,
    isForeignKey: false,
    isUnique: true,
    isNullable: false,
    order: 0,
  })
  const t2 = await createDiagramTable({
    whiteboardId,
    name: 'posts',
    positionX: 100,
    positionY: 100,
  })
  const c2 = await createColumn({
    tableId: t2.id,
    name: 'user_id',
    dataType: 'uuid',
    isForeignKey: true,
    isPrimaryKey: false,
    isUnique: false,
    isNullable: false,
    order: 0,
  })
  const rel = await createRelationship({
    whiteboardId,
    sourceTableId: t1.id,
    targetTableId: t2.id,
    sourceColumnId: c1.id,
    targetColumnId: c2.id,
    cardinality: 'ONE_TO_MANY',
  })
  const area = await createArea({
    whiteboardId,
    name: 'Core',
    color: 'blue',
    positionX: 0,
    positionY: 0,
    width: 400,
    height: 300,
    memberTableIds: [t1.id, t2.id],
  })
  return { t1, c1, t2, c2, rel, area }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeded fixtures
// ─────────────────────────────────────────────────────────────────────────────

let OWNER_ID = ''
let EDITOR_ID = ''
let VIEWER_ID = ''
let PROJECT_ID = ''
let WHITEBOARD_ID = ''

beforeEach(async () => {
  resetDb()
  OWNER_ID = makeUser({ username: 'owner', email: 'owner@example.com' }).id
  EDITOR_ID = makeUser({ username: 'editor', email: 'editor@example.com' }).id
  VIEWER_ID = makeUser({ username: 'viewer', email: 'viewer@example.com' }).id
  PROJECT_ID = makeProject({ name: 'Test Project', ownerId: OWNER_ID }).id
  WHITEBOARD_ID = makeWhiteboard({
    projectId: PROJECT_ID,
    name: 'Test Whiteboard',
  }).id

  await upsertProjectMember({
    projectId: PROJECT_ID,
    userId: EDITOR_ID,
    role: 'EDITOR',
  })
  await upsertProjectMember({
    projectId: PROJECT_ID,
    userId: VIEWER_ID,
    role: 'VIEWER',
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// saveSnapshotHandler (AC1, AC6)
// ─────────────────────────────────────────────────────────────────────────────

describe('saveSnapshotHandler', () => {
  it('EDITOR can save a version capturing the full diagram state (AC1)', async () => {
    await seedDiagram(WHITEBOARD_ID)

    const result = await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
      label: 'My version',
    })

    expect(result).toMatchObject({ success: true })
    expect((result as any).snapshot.label).toBe('My version')
    expect((result as any).snapshot.isAuto).toBe(false)
  })

  it('falls back to no label when omitted (AC2 default-name UI derives from createdAt)', async () => {
    const result = await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
    })
    expect((result as any).snapshot.label).toBeNull()
  })

  it('VIEWER is denied (AC6)', async () => {
    await expect(
      saveSnapshotHandler(ctxFor(VIEWER_ID), { whiteboardId: WHITEBOARD_ID }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('a nonexistent whiteboard is denied (SEC-ERR-03 masking)', async () => {
    await expect(
      saveSnapshotHandler(ctxFor(EDITOR_ID), {
        whiteboardId: '99999999-9999-9999-9999-999999999999',
      }),
    ).rejects.toThrow(ForbiddenError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// listSnapshotsHandler (AC2, AC6)
// ─────────────────────────────────────────────────────────────────────────────

describe('listSnapshotsHandler', () => {
  it('VIEWER can list snapshots newest-first, without payload (AC2)', async () => {
    await seedDiagram(WHITEBOARD_ID)
    await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
      label: 'v1',
    })
    await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
      label: 'v2',
    })

    const result = await listSnapshotsHandler(ctxFor(VIEWER_ID), {
      whiteboardId: WHITEBOARD_ID,
    })

    const snapshots = (result as any).snapshots
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].label).toBe('v2')
    expect(snapshots[1].label).toBe('v1')
    expect(snapshots[0]).not.toHaveProperty('payload')
    expect(snapshots[0].authorName).toBe('editor')
  })

  it('VIEWER on a nonexistent whiteboard is denied (SEC-ERR-03)', async () => {
    await expect(
      listSnapshotsHandler(ctxFor(VIEWER_ID), {
        whiteboardId: '99999999-9999-9999-9999-999999999999',
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('a user with no project access is denied', async () => {
    const strangerId = makeUser({ username: 'stranger' }).id
    await expect(
      listSnapshotsHandler(ctxFor(strangerId), {
        whiteboardId: WHITEBOARD_ID,
      }),
    ).rejects.toThrow(ForbiddenError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getSnapshotHandler (AC3, AC7 IDOR)
// ─────────────────────────────────────────────────────────────────────────────

describe('getSnapshotHandler', () => {
  it('VIEWER can preview a snapshot shaped for ReactFlowWhiteboard (AC3)', async () => {
    const { t1, t2 } = await seedDiagram(WHITEBOARD_ID)
    const saved = await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
    })
    const snapshotId = (saved as any).snapshot.id

    const result = await getSnapshotHandler(ctxFor(VIEWER_ID), { snapshotId })

    expect((result as any).whiteboardId).toBe(WHITEBOARD_ID)
    expect((result as any).tables).toHaveLength(2)
    const tableIds = (result as any).tables.map((t: any) => t.id)
    expect(tableIds.sort()).toEqual([t1.id, t2.id].sort())
    expect((result as any).relationships).toHaveLength(1)
    expect((result as any).relationships[0].sourceTable.id).toBe(t1.id)
    expect((result as any).relationships[0].targetColumn).toBeDefined()
  })

  it('returns NOT_FOUND for a nonexistent snapshot (no disclosure)', async () => {
    const result = await getSnapshotHandler(ctxFor(VIEWER_ID), {
      snapshotId: '99999999-9999-9999-9999-999999999999',
    })
    expect(result).toMatchObject({ error: 'NOT_FOUND', status: 404 })
  })

  it("IDOR: a user with no access to the snapshot's project is denied (AC7)", async () => {
    const strangerId = makeUser({ username: 'stranger' }).id
    const saved = await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
    })

    await expect(
      getSnapshotHandler(ctxFor(strangerId), {
        snapshotId: (saved as any).snapshot.id,
      }),
    ).rejects.toThrow(ForbiddenError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// restoreSnapshotHandler (AC4, AC5, AC6, AC7)
// ─────────────────────────────────────────────────────────────────────────────

describe('restoreSnapshotHandler', () => {
  it('EDITOR can restore — auto-snapshots current state first (AC4a), then replaces the live diagram preserving ids (AC4/D3)', async () => {
    const { t1, t2 } = await seedDiagram(WHITEBOARD_ID)
    const v1 = await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
      label: 'v1',
    })
    const v1Id = (v1 as any).snapshot.id

    // Mutate live state after v1 was saved.
    await createDiagramTable({
      whiteboardId: WHITEBOARD_ID,
      name: 'extra_table',
    })

    const restoreResult = await restoreSnapshotHandler(ctxFor(EDITOR_ID), {
      snapshotId: v1Id,
    })
    expect(restoreResult).toMatchObject({ success: true })

    // AC4a: an automatic "before restore" snapshot now exists alongside v1.
    const afterList = await listSnapshotsHandler(ctxFor(VIEWER_ID), {
      whiteboardId: WHITEBOARD_ID,
    })
    const snapshots = (afterList as any).snapshots
    expect(snapshots).toHaveLength(2)
    const autoSnap = snapshots.find((s: any) => s.isAuto)
    expect(autoSnap).toBeDefined()
    expect(autoSnap.label).toBe('Auto-saved before restore')

    // Live diagram now equals v1 — extra_table gone, original ids intact.
    const tables = await findDiagramTablesByWhiteboardId(WHITEBOARD_ID)
    expect(tables.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort())
    expect(tables.some((t) => t.name === 'extra_table')).toBe(false)
  })

  it('VIEWER is denied restore (AC6)', async () => {
    const saved = await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
    })

    await expect(
      restoreSnapshotHandler(ctxFor(VIEWER_ID), {
        snapshotId: (saved as any).snapshot.id,
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('returns NOT_FOUND for a nonexistent snapshot', async () => {
    const result = await restoreSnapshotHandler(ctxFor(EDITOR_ID), {
      snapshotId: '99999999-9999-9999-9999-999999999999',
    })
    expect(result).toMatchObject({ error: 'NOT_FOUND', status: 404 })
  })

  it('IDOR: restoring a snapshot never mutates a sibling whiteboard (AC7)', async () => {
    const projectB = makeProject({ name: 'Project B', ownerId: OWNER_ID }).id
    const whiteboardB = makeWhiteboard({
      projectId: projectB,
      name: 'Whiteboard B',
    }).id
    await upsertProjectMember({
      projectId: projectB,
      userId: EDITOR_ID,
      role: 'EDITOR',
    })
    const tableB = await createDiagramTable({
      whiteboardId: whiteboardB,
      name: 'b_table',
    })

    await seedDiagram(WHITEBOARD_ID)
    const savedA = await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
    })

    await restoreSnapshotHandler(ctxFor(EDITOR_ID), {
      snapshotId: (savedA as any).snapshot.id,
    })

    const tablesB = await findDiagramTablesByWhiteboardId(whiteboardB)
    expect(tablesB.map((t) => t.id)).toEqual([tableB.id])
  })

  it("IDOR: a user with no access to the snapshot's project cannot restore it (AC7)", async () => {
    const strangerId = makeUser({ username: 'stranger' }).id
    const saved = await saveSnapshotHandler(ctxFor(EDITOR_ID), {
      whiteboardId: WHITEBOARD_ID,
    })

    await expect(
      restoreSnapshotHandler(ctxFor(strangerId), {
        snapshotId: (saved as any).snapshot.id,
      }),
    ).rejects.toThrow(ForbiddenError)
  })
})
