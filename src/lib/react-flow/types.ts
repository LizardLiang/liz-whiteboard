/**
 * React Flow Type Definitions for ERD Whiteboard
 *
 * This file contains all TypeScript types for integrating React Flow
 * with the existing Prisma database schema.
 */

import type { Edge, Node } from '@xyflow/react'
import type {
  Area,
  Column,
  CommentWithAuthor,
  DiagramTable,
  Relationship,
} from '@/data/models'
import type { Cardinality, UpdateColumn } from '@/data/schema'
import type { CreateColumnPayload } from '@/components/whiteboard/column/types'
import type { Dialect } from '@/lib/ddl-generator'

/**
 * A root comment (GH #110) plus its flat replies — the view-model shape
 * consumed by CommentThreadPopover, the table comment badge, and CommentNode.
 */
export interface CommentThreadVM {
  root: CommentWithAuthor
  replies: Array<CommentWithAuthor>
}

/**
 * Display mode for table nodes
 */
export type ShowMode = 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS'

/**
 * Cardinality type (re-exported from Prisma for convenience)
 */
export type CardinalityType = Cardinality

/**
 * Data structure for Table nodes in React Flow
 * Extends Record<string, unknown> to satisfy React Flow's generic constraint
 */
export interface TableNodeData extends Record<string, unknown> {
  /** The table entity with its columns */
  table: DiagramTable & {
    columns: Array<Column>
  }

  /**
   * True when this table has no position in the DB (positionX/positionY are
   * null). The node is placed off-canvas at {-99999, -99999} so React Flow
   * still renders and measures it via ResizeObserver. Once measured, a
   * useEffect in ReactFlowWhiteboardInner resolves a non-overlapping position
   * and emits table:move with isInit=true to persist it (first-write-wins).
   */
  positionPending?: boolean

  /** Whether this table is actively selected (clicked) */
  isActiveHighlighted: boolean

  /** Whether this table is highlighted due to relationship with active table */
  isHighlighted: boolean

  /**
   * Whether this table's relations panel is currently expanded, driven by
   * the `r` shortcut / context menu — computed centrally in
   * calculateHighlighting.
   */
  isRelationsPreviewOpen: boolean

  /** Current display mode */
  showMode: ShowMode

  /** Map of column ID to cardinality for incoming relationships */
  targetColumnCardinalities?: Record<string, Cardinality>

  /** Callback to create a column — fires WebSocket emit (WebSocket-only persistence) */
  onColumnCreate?: (tableId: string, data: CreateColumnPayload) => void

  /** Callback to update a column — fires WebSocket emit */
  onColumnUpdate?: (
    columnId: string,
    tableId: string,
    data: Partial<UpdateColumn>,
  ) => void

  /** Callback to delete a column — fires WebSocket emit */
  onColumnDelete?: (columnId: string, tableId: string) => void

  /** Callback to duplicate a column — fires WebSocket emit */
  onColumnDuplicate?: (column: Column) => void

  /** Callback to request table deletion — opens the confirmation dialog */
  onRequestTableDelete?: (tableId: string) => void

  /**
   * Subject areas available on this whiteboard (GH #106), for the "Add to area"
   * membership submenu. Lightweight projection — id/name/members only.
   */
  areas?: Array<{ id: string; name: string; memberTableIds: Array<string> }>

  /** Add this table to an area's membership */
  onAddToArea?: (tableId: string, areaId: string) => void

  /** Remove this table from an area's membership */
  onRemoveFromArea?: (tableId: string, areaId: string) => void

  /** Callback to open the Focus view overlay for this table */
  onFocusTable?: (tableId: string) => void

  /** Callback to export this table's CREATE TABLE DDL in the given dialect */
  onExportDdl?: (tableId: string, dialect: Dialect) => void

  /** Callback to toggle the relations panel open/closed for this table */
  onPreviewRelations?: (tableId: string) => void

  /** React Flow edges — passed down for delete confirmation relationship lookup */
  edges?: Array<RelationshipEdgeType>

  /**
   * Edges pre-filtered via filterValidEdges (stale/deleted-column-safe) —
   * used exclusively by the relations panel's relatedEdges computation in
   * TableNode.tsx. Unlike `edges` above (raw, unfiltered, shared with
   * delete-confirmation lookups), a relationship whose sourceColumn/
   * targetColumn snapshot references a column deleted elsewhere must never
   * reach the panel, or it would render a connection line naming a column
   * that no longer exists.
   */
  relationsEdges?: Array<RelationshipEdgeType>

  /** Map of tableId → tableName for FK relationship labels */
  tableNameById?: Map<string, string>

  /** Whether the WebSocket is currently connected */
  isConnected?: boolean

  /** Column reorder: reconcile after a drag drop (SA-H4 single entry-point) */
  onColumnReorder?: (
    params: import('@/hooks/use-column-reorder-mutations').ReconcileAfterDropParams,
  ) => void

  /** Column reorder: emit column:reorder to server */
  emitColumnReorder?: (tableId: string, orderedColumnIds: Array<string>) => void

  /** Column reorder: check if queue is full for this table */
  isQueueFullForTable?: (tableId: string) => boolean

  /** Column reorder: mark table as actively dragging */
  setLocalDragging?: (tableId: string, isDragging: boolean) => void

  /** Column reorder: bump the reorder tick to trigger updateNodeInternals */
  bumpReorderTick?: (tableId: string) => void

  /**
   * Comment threads anchored to this table (GH #110) — each a root comment
   * plus its flat replies. Drives the header comment badge's unresolved
   * count and the popover's thread list.
   */
  commentThreads?: Array<CommentThreadVM>

  /** Whether the current viewer may comment (VIEWER+, independent of canEdit). */
  canComment?: boolean

  /** Current authenticated user id — for author-only edit/delete gating. */
  currentUserId?: string

  /** Whether the current viewer may delete ANY comment (project ADMIN+). */
  canModerateComments?: boolean

  /** Start a new comment thread anchored to this table. */
  onCreateTableComment?: (tableId: string, body: string) => void

  /** Reply to an existing comment thread. */
  onReplyComment?: (parentId: string, body: string) => void

  /** Edit a comment's body (author-only). */
  onEditComment?: (commentId: string, body: string) => void

  /** Delete a comment (author or moderator). */
  onDeleteComment?: (commentId: string) => void

  /** Resolve/reopen a root comment thread. */
  onResolveComment?: (commentId: string, resolved: boolean) => void

  /** Callback to save the table's note — fires table:update WebSocket emit.
   * Named onTableNoteSave (not onTableCommentSave) to disambiguate from the
   * GH #110 threaded-comment callbacks (onCreateTableComment etc.) below. */
  onTableNoteSave?: (tableId: string, description: string) => void
}

/**
 * Complete Table node type for React Flow
 */
export type TableNodeType = Node<TableNodeData, 'table'>

/**
 * Data structure for Relationship edges in React Flow
 * Extends Record<string, unknown> to satisfy React Flow's generic constraint
 */
export interface RelationshipEdgeData extends Record<string, unknown> {
  /** The relationship entity */
  relationship: Relationship & {
    sourceColumn: Column
    targetColumn: Column
  }

  /** Cardinality of the relationship */
  cardinality: Cardinality

  /** Whether this edge is highlighted */
  isHighlighted: boolean

  /** Optional label to display on the edge */
  label?: string

  /** Callback to delete this relationship (fires optimistic removal + WebSocket emit) */
  onDelete?: (relationshipId: string) => void

  /** Callback to update this relationship's label (fires optimistic update + WebSocket emit) */
  onLabelUpdate?: (relationshipId: string, label: string) => void

  /**
   * Per-edge Y offset (px) for source/target handle positions, computed by
   * computeEdgeBundleOffsets() to fan parallel edges in same-table-pair bundles.
   * Applied by RelationshipEdge.tsx to getSmoothStepPath sourceY/targetY
   * and to CardinalityIndicator y position. 0 when edge is not in a bundle.
   */
  bundleHandleYOffset?: number

  /**
   * Per-edge X offset (px) relative to the corridor center, computed by
   * computeEdgeBundleOffsets() to fan parallel edges' vertical step segments.
   * Applied by RelationshipEdge.tsx to getSmoothStepPath centerX. 0 when
   * edge is not in a bundle.
   */
  bundleCenterXOffset?: number
}

/**
 * Complete Relationship edge type for React Flow
 */
export type RelationshipEdgeType = Edge<RelationshipEdgeData, 'relationship'>

/**
 * Data structure for subject-area nodes (GH #106). Area nodes are rendered as
 * background regions BEHIND table nodes and are kept in a separate node array
 * from tables — they never enter the table highlighting/edge/DDL pipeline.
 */
export interface AreaNodeData extends Record<string, unknown> {
  /** The area entity */
  area: Area
  /** Whether the current user may edit (move/resize/rename/recolor/delete) */
  canEdit: boolean
  /** Rename the area (fires optimistic update + WebSocket emit) */
  onRename?: (areaId: string, name: string) => void
  /** Recolor the area to a palette id */
  onRecolor?: (areaId: string, color: string) => void
  /** Persist a resize (new size + top-left position) */
  onResize?: (
    areaId: string,
    bounds: {
      positionX: number
      positionY: number
      width: number
      height: number
    },
  ) => void
  /** Delete the area */
  onDelete?: (areaId: string) => void
}

/**
 * Complete subject-area node type for React Flow
 */
export type AreaNodeType = Node<AreaNodeData, 'area'>

/**
 * Data structure for a free-canvas-point comment pin (GH #110). Each node
 * represents exactly one thread (root + replies) anchored at a flow-space
 * point — unlike table pins, which can hold multiple threads per table.
 * Rendered non-draggable/non-deletable so it never steals drag/select from
 * table nodes; deletion goes through the popover's delete action instead.
 */
export interface CommentNodeData extends Record<string, unknown> {
  thread: CommentThreadVM
  canComment: boolean
  currentUserId: string
  canModerateComments: boolean
  onReply: (parentId: string, body: string) => void
  onEdit: (commentId: string, body: string) => void
  onDelete: (commentId: string) => void
  onResolve: (commentId: string, resolved: boolean) => void
}

/**
 * Complete free-point comment node type for React Flow
 */
export type CommentNodeType = Node<CommentNodeData, 'comment'>

/**
 * Canvas viewport state (replaces Konva CanvasViewport)
 */
export interface ReactFlowViewport {
  /** Current zoom level (0.1 to 5.0) */
  zoom: number

  /** Viewport center X coordinate */
  x: number

  /** Viewport center Y coordinate */
  y: number
}

/**
 * Canvas interaction state
 */
export interface CanvasInteractionState {
  /** ID of actively selected table */
  activeTableId: string | null

  /** ID of currently hovered table */
  hoveredTableId: string | null

  /** Current display mode for all tables */
  showMode: ShowMode

  /** Set of table IDs that are currently hidden */
  hiddenTableIds: Set<string>
}

/**
 * ELK graph structure (input to layout algorithm)
 */
export interface ELKGraph {
  id: string
  layoutOptions: Record<string, string>
  children: Array<ELKNode>
  edges: Array<ELKEdge>
}

/**
 * ELK node representation
 */
export interface ELKNode {
  id: string
  width: number
  height: number
  x?: number // Set by ELK after layout
  y?: number // Set by ELK after layout
}

/**
 * ELK edge representation
 */
export interface ELKEdge {
  id: string
  sources: Array<string>
  targets: Array<string>
}

/**
 * Result of highlighting calculation
 */
export interface HighlightResult {
  nodes: Array<TableNodeType>
  edges: Array<RelationshipEdgeType>
}

/**
 * Edge lookup map (for performance)
 */
export type EdgeMap = Map<string, Array<RelationshipEdgeType>>

/**
 * Zoom constraints
 */
export const ZOOM_CONSTRAINTS = {
  MIN: 0.1,
  MAX: 2,
  DEFAULT: 1,
  STEP: 0.1,
} as const

/**
 * Layout constraints
 */
export const LAYOUT_CONSTRAINTS = {
  NODE_SPACING: 40,
  LAYER_SPACING: 120,
  COMPONENT_SPACING: 80,
  DEFAULT_NODE_WIDTH: 250,
  DEFAULT_NODE_HEIGHT: 150,
} as const

/**
 * Minimum subject-area node dimensions (GH #106). Shared floor between
 * AreaNode's NodeResizer (manual resize, empty areas only) and
 * computeAreaBounds's auto-fit (area-bounds.ts) — kept here rather than in
 * AreaNode.tsx so the lib layer doesn't depend on a React component.
 */
export const MIN_AREA_WIDTH = 160
export const MIN_AREA_HEIGHT = 120

/**
 * Z-Index layers
 */
export const Z_INDEX = {
  NODE_DEFAULT: 1,
  NODE_HIGHLIGHTED: 1000,
  EDGE_DEFAULT: 1,
  EDGE_HIGHLIGHTED: 1000,
  EDGE_LABEL: 1001,
  NODE_RELATIONS_PREVIEW: 2000,
} as const
