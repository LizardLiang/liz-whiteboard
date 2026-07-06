// src/lib/react-flow/multi-drag-commit.ts
// GH #111 — multi-select drag must persist positions + reconcile area
// membership for ALL dragged tables, not just the leader. Pure orchestration
// helper — no React, no side effects — so `ReactFlowWhiteboard`'s
// `handleNodeDragStop` bulk branch can stay a thin wiring layer.
//
// Reuses `reconcileAreaMembership` (area-bounds.ts) per dragged table,
// reading ONE `areas` snapshot for the whole batch — same one-tick-stale
// `areasRef.current` guarantee the existing single-table path already
// relies on (join/leave/refit are mutually exclusive per table by
// construction, so batching table-by-table reconciliation against a single
// snapshot is safe).

import { reconcileAreaMembership } from './area-bounds'
import type { ReconcileArea } from './area-bounds'

/** One dragged table's inputs — caller measures `center` via getNode + fallback. */
export interface DraggedTableInput {
  id: string
  /** Table's dropped center point (position + measured size / 2) — fed to reconcileAreaMembership. */
  center: { x: number; y: number }
  /** Raw drop position — persisted verbatim. */
  position: { x: number; y: number }
}

/** Collapsed final membership for one area, after applying every join/leave
 * this batch produced for it (GH #111 code-review BLOCKER 2 fix). */
export interface AreaMemberUpdate {
  areaId: string
  memberTableIds: Array<string>
}

export interface MultiDragCommit {
  positions: Array<{ id: string; positionX: number; positionY: number }>
  joins: Array<{ tableId: string; areaId: string }>
  leaves: Array<{ tableId: string; areaId: string }>
  /** Deduped union of every area that needs a re-fit (D2) — refit once per area. */
  refitAreaIds: Array<string>
  /**
   * One entry per area whose final member set differs from the input
   * `areas` snapshot, computed by collapsing ALL of this batch's joins/leaves
   * for that area against ONE read of the snapshot (GH #111 code-review
   * BLOCKER 2 — two dragged tables joining/leaving the SAME area in one drop
   * must resolve to a single final member list, not a last-write-wins race
   * from calling the per-table membership handler once per table against the
   * same one-tick-stale snapshot). Areas with no net change are omitted (no
   * redundant `area:update` emit — preserves the R5 churn guard). Callers
   * MUST issue exactly one persist + one refit per entry, using this
   * `memberTableIds` list (not the stale snapshot's).
   */
  areaMemberUpdates: Array<AreaMemberUpdate>
}

/**
 * Plans the full commit for a multi-select drag drop: positions to persist,
 * per-table area join/leave deltas, the deduped set of areas to re-fit, and
 * the collapsed per-area membership deltas.
 *
 * For each dragged table, calls `reconcileAreaMembership(areas, id, center)`
 * against the SAME `areas` snapshot (read once, matching the single-node
 * path's semantics), then collects the results:
 * - `positions`: one entry per dragged table (raw drop position).
 * - `joins`/`leaves`: one entry per table with a non-null join / each leave.
 * - `refitAreaIds`: union of every table's `refit` areaIds, deduped (D2) —
 *   an area with two moved members inside it is re-fit once, not twice.
 * - `areaMemberUpdates`: `joins`/`leaves` collapsed per areaId against the
 *   same snapshot (BLOCKER 2) — the caller applies these instead of calling
 *   a per-table add/remove handler in a loop.
 */
export function planMultiDragCommit(
  dragged: ReadonlyArray<DraggedTableInput>,
  areas: ReadonlyArray<ReconcileArea>,
): MultiDragCommit {
  const positions = dragged.map((table) => ({
    id: table.id,
    positionX: table.position.x,
    positionY: table.position.y,
  }))

  const joins: Array<{ tableId: string; areaId: string }> = []
  const leaves: Array<{ tableId: string; areaId: string }> = []
  const refitAreaIdSet = new Set<string>()

  for (const table of dragged) {
    const { join, leave, refit } = reconcileAreaMembership(
      areas,
      table.id,
      table.center,
    )
    if (join) joins.push({ tableId: table.id, areaId: join })
    for (const areaId of leave) leaves.push({ tableId: table.id, areaId })
    for (const areaId of refit) refitAreaIdSet.add(areaId)
  }

  const touchedAreaIds = new Set<string>([
    ...joins.map((j) => j.areaId),
    ...leaves.map((l) => l.areaId),
  ])
  const areaMemberUpdates: Array<AreaMemberUpdate> = []
  for (const areaId of touchedAreaIds) {
    const area = areas.find((a) => a.id === areaId)
    if (!area) continue

    const toAdd = [...new Set(joins.filter((j) => j.areaId === areaId).map((j) => j.tableId))]
    const toRemove = new Set(
      leaves.filter((l) => l.areaId === areaId).map((l) => l.tableId),
    )

    const nextMemberTableIds = [
      ...area.memberTableIds.filter((id) => !toRemove.has(id)),
      ...toAdd.filter((id) => !area.memberTableIds.includes(id)),
    ]

    const unchanged =
      nextMemberTableIds.length === area.memberTableIds.length &&
      nextMemberTableIds.every((id) => area.memberTableIds.includes(id))
    if (!unchanged) {
      areaMemberUpdates.push({ areaId, memberTableIds: nextMemberTableIds })
    }
  }

  return {
    positions,
    joins,
    leaves,
    refitAreaIds: [...refitAreaIdSet],
    areaMemberUpdates,
  }
}
