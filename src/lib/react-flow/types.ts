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
  Connector,
  DiagramTable,
  Relationship,
  Shape,
} from '@/data/models'
import type { Cardinality, ShapeStyle, UpdateColumn } from '@/data/schema'
import type { CreateColumnPayload } from '@/components/whiteboard/column/types'
import type { Dialect } from '@/lib/ddl-generator'
import type { ReconcileAfterDropParams } from '@/hooks/use-column-reorder-mutations'

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

  /**
   * GH #138 — Callback to jump the live canvas to a related table (pan +
   * normalized zoom + active-highlight + brief pulse) and re-anchor the
   * relations panel to it, fired from a relations-panel row's click/Enter
   * activation. Distinct from onFocusTable, which opens the read-only Focus
   * modal instead.
   */
  onJumpToTable?: (tableId: string) => void

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
  onColumnReorder?: (params: ReconcileAfterDropParams) => void

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
 * Data structure for a drawn shape node (Phase 1: shapes-and-connectors).
 * Standalone interface, NOT a discriminated union with TableNodeData/
 * AreaNodeData/CommentNodeData (D-7) — there is no existing union to join;
 * each node type is registered by string key and merged via a cast.
 *
 * `canEdit` gates move/resize/connect/label affordances in one field —
 * callers pass `hasMinimumRole(viewerRole, 'EDITOR')`, which is already
 * `false` on the public share-link path (viewerRole is null there) AND for
 * an authenticated VIEWER-role member (Apollo N1) — so this one field is
 * what keeps a read-only viewer from selecting, dragging, resizing, or
 * starting a connection from a shape.
 */
export interface ShapeNodeData extends Record<string, unknown> {
  shape: Shape
  canEdit: boolean
  /** Keyboard-focus ring (FR-019a) — distinct from React Flow's own `selected`. */
  isKeyboardFocused?: boolean
  /**
   * True for an uncommitted text-box draft (FR-012): drawn but not yet
   * `shape:create`d. Renders the dashed placeholder + an immediately
   * focused editor; not draggable/resizable/connectable since it has no
   * server id yet. Commit-with-text creates the row for the first time;
   * commit-empty just removes the draft node — zero rows, zero broadcast.
   */
  isDraft?: boolean
  /**
   * Bumped by the parent to request the label editor open for this node —
   * an edge-triggered token, not a boolean, so the same shape can be
   * re-opened for editing without a round-trip through `false`. Consumed
   * once by ShapeNode via a ref comparison.
   */
  editRequestToken?: number
  /** Persist a resize (NodeResizer onResizeEnd only, mirrors AreaNode/D-10). */
  onResizeEnd?: (
    shapeId: string,
    bounds: {
      positionX: number
      positionY: number
      width: number
      height: number
    },
  ) => void
  /** Persist a style-panel change (fill/stroke/width/dash). */
  onStyleChange?: (shapeId: string, style: Partial<ShapeStyle>) => void
  /** Commit the label editor's text. Empty text on an existing `text` shape
   * deletes it (with connector cascade) through the same path as Delete. */
  onLabelCommit?: (shapeId: string, text: string) => void
  /** Draft-only (isDraft): commit-with-text creates the row for the first
   * time (FR-012). Never called for an already-persisted shape. */
  onDraftCommit?: (draft: Shape, text: string) => void
  /** Draft-only (isDraft): commit-empty removes the draft — zero rows,
   * zero broadcast (FR-012). */
  onDraftCancel?: (draftId: string) => void
  /** Delete this shape (with its connector cascade, FR-018). */
  onDelete?: (shapeId: string) => void
  /** Nudge/resize-by-keyboard (FR-019) — one shape:update per gesture. */
  onNudge?: (shapeId: string, delta: { dx: number; dy: number }) => void
  /**
   * Quick-create: a connect marker was CLICKED rather than dragged, so the
   * caller should create a same-kind shape on that side and connect the two.
   * A drag past DRAW_DRAG_THRESHOLD_PX is React Flow's own connection
   * gesture instead and never reaches this callback.
   */
  onQuickCreate?: (shapeId: string, direction: QuickCreateDirection) => void
  /**
   * Hovering / leaving a quick-create arrow. The parent answers by
   * rendering the ghost outline of the shape a click would create — at the
   * position `quickCreatePlacement` actually resolves, so a collision
   * slide is visible BEFORE committing. `null` clears it.
   */
  onQuickCreateHover?: (
    shapeId: string,
    direction: QuickCreateDirection | null,
  ) => void
  onKeyboardResize?: (
    shapeId: string,
    delta: { dw: number; dh: number },
  ) => void
}

/** Complete shape node type for React Flow. */
export type ShapeNodeType = Node<ShapeNodeData, 'shape'>

/**
 * Data structure for a shape-to-shape connector edge (Phase 1:
 * shapes-and-connectors). Standalone interface (D-7). Geometry is NEVER
 * stored here or anywhere — it is derived at render time from both
 * endpoints' current bounds (FR-031a).
 */
export interface ConnectorEdgeData extends Record<string, unknown> {
  connector: Connector
}

/** Complete connector edge type for React Flow. */
export type ConnectorEdgeType = Edge<ConnectorEdgeData, 'connector'>

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

// ── Shapes and Connectors constants (Phase 1, tech-spec §8) ─────────────────

/** Screen (not flow) pixels — a flow-unit threshold would change meaning
 * with zoom. Below it, a draw gesture is a mis-click: nothing is created. */
export const DRAW_DRAG_THRESHOLD_PX = 4

/** FR-008's floor — enforced by NodeResizer AND clamped at draw-commit. */
export const MIN_SHAPE_WIDTH = 24
export const MIN_SHAPE_HEIGHT = 24

/** Default sizes per kind, applied at draw-commit clamping and keyboard creation. */
export const DEFAULT_SHAPE_SIZE = { width: 160, height: 100 }
export const DEFAULT_TEXT_SIZE = { width: 200, height: 40 }
export const DEFAULT_LINE_SIZE = { width: 160, height: 48 }

/** FR-019's cascade offset for keyboard-created shapes: (n mod wrap) * step, both axes. */
export const KEYBOARD_CASCADE_STEP = 24
/** S5 (Hermes code review): was an inline `% 8` literal beside this constant's sibling. */
export const KEYBOARD_CASCADE_WRAP = 8

/** Arrow-key nudge / Shift+arrow nudge, in flow units per keydown. */
export const NUDGE_STEP = 8
export const NUDGE_STEP_LARGE = 40

/** The invisible hit-stroke width that makes a 1px unfilled outline grabbable. */
export const CONNECT_HIT_STROKE_WIDTH = 12

/**
 * A shape node's connect handle ids (W7, Hermes code review). Previously
 * typed as bare string literals in both ShapeNode.tsx (which renders the
 * `<Handle>` elements) and ReactFlowWhiteboard.tsx (which builds the
 * keyboard-connect edge referencing them by id) — renaming one without the
 * other would silently stop connectors rendering, with no compiler error.
 */
export const SHAPE_HANDLE_IDS = {
  sourceTop: 'shape-src-top',
  sourceRight: 'shape-src-right',
  sourceBottom: 'shape-src-bottom',
  sourceLeft: 'shape-src-left',
  target: 'shape-tgt',
} as const

/**
 * The four sides a quick-create marker can sit on. Same anti-drift motive as
 * SHAPE_HANDLE_IDS above (W7): the marker click handler resolves a direction
 * from the handle it was fired on, and a rename that missed the map below
 * would silently place every new shape on the wrong side, with no compiler
 * error.
 */
export type QuickCreateDirection = 'top' | 'right' | 'bottom' | 'left'

/**
 * A shape node's connect-handle id -> the direction it sits on (quick-create).
 */
export const SHAPE_HANDLE_DIRECTIONS = {
  [SHAPE_HANDLE_IDS.sourceTop]: 'top',
  [SHAPE_HANDLE_IDS.sourceRight]: 'right',
  [SHAPE_HANDLE_IDS.sourceBottom]: 'bottom',
  [SHAPE_HANDLE_IDS.sourceLeft]: 'left',
} as const satisfies Record<string, QuickCreateDirection>

/**
 * Quick-create (click a connect marker -> new connected shape) placement,
 * in FLOW units. `QUICK_CREATE_GAP` is both the source-edge-to-new-shape-edge
 * distance and the step size used to slide past an occupied slot;
 * `QUICK_CREATE_MAX_SLIDE_STEPS` bounds that slide so a pathological board
 * can never spin the solver.
 */
export const QUICK_CREATE_GAP = 48
export const QUICK_CREATE_MAX_SLIDE_STEPS = 40

/**
 * How far a FigJam-style quick-create arrow sits OUTSIDE the shape's edge,
 * in flow units. FigJam floats these clear of the body so they never read
 * as part of the shape, and so a shape's own border stays grabbable for
 * resize. The React Flow <Handle> is positioned by this offset.
 */
export const QUICK_CREATE_ARROW_OFFSET = 18

/** FigJam-style corner rounding for rectangle/text bodies (was a bare 4). */
export const FIGJAM_CORNER_RADIUS = 8

/**
 * SVG `stroke-dasharray` for a shape/connector's `strokeStyle: 'dashed'`
 * (W8, Hermes code review) — was written independently in ShapeNode.tsx
 * and ConnectorEdge.tsx.
 */
export const DASHED_STROKE_PATTERN = '6 4'

/**
 * The draw-preview / draft-shape placeholder border (W8, Hermes code
 * review) — was written independently in ShapeDrawOverlay.tsx (both the
 * rectangle/text and ellipse preview branches) and ShapeNode.tsx (the
 * draft-text-box placeholder).
 */
export const DRAW_PLACEHOLDER_BORDER =
  '1.5px dashed var(--rf-edge-stroke-selected)'

/**
 * Minimum subject-area node dimensions (GH #106). Shared floor between
 * AreaNode's NodeResizer (manual resize, empty areas only) and
 * computeAreaBounds's auto-fit (area-bounds.ts) — kept here rather than in
 * AreaNode.tsx so the lib layer doesn't depend on a React component.
 */
export const MIN_AREA_WIDTH = 160
export const MIN_AREA_HEIGHT = 120

/**
 * Shared "not connected" toast copy (2026-08-31 tactical plan, ERD
 * relationship delete persistence). `useRelationshipMutations` already
 * shows this on a refused write; the connectivity veto in ReactFlowCanvas's
 * `onBeforeDelete` needs the identical copy for a refused Delete-key press.
 * Defined once here — rather than duplicating the literal at the new call
 * site — so the two refusal paths cannot drift apart.
 */
export const NOT_CONNECTED_TOAST_MESSAGE =
  'Not connected. Please wait for reconnection.'

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
