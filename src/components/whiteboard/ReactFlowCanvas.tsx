import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '@/styles/react-flow-theme.css'

import { CardinalityMarkerDefs } from './CardinalityMarkerDefs'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type {
  FitViewOptions,
  Node,
  NodeMouseHandler,
  OnConnect,
  OnEdgesChange,
  OnNodeDrag,
  OnNodesChange,
  OnNodesDelete,
} from '@xyflow/react'
import type {
  AreaNodeType,
  CommentNodeType,
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import { recalculateEdgesForDraggedNodes } from '@/lib/react-flow/edge-routing'
import {
  assignLayersBFS,
  computeEdgeBundleOffsets,
} from '@/lib/auto-layout/d3-force-layout'
import { edgeTypes, nodeTypes } from '@/lib/react-flow/node-types'
import {
  calculateHighlighting,
  filterValidEdges,
} from '@/lib/react-flow/highlighting'
import { VIEWPORT_CONSTRAINTS } from '@/lib/react-flow/viewport'

/**
 * Stable empty default for the `areaNodes` prop. Using `[]` directly as a
 * default parameter value creates a new array identity on every render when
 * the prop is omitted, which defeats the `areaNodes` dependency in the resync
 * effect below and causes an infinite render loop (GH #112). This module-level
 * constant keeps the identity stable across renders.
 */
const EMPTY_AREA_NODES: Array<AreaNodeType> = []

/**
 * Stable empty default for the `commentNodes` prop (GH #110) — same rationale
 * as EMPTY_AREA_NODES above.
 */
const EMPTY_COMMENT_NODES: Array<CommentNodeType> = []

/**
 * ReactFlowCanvas Props
 */
export interface ReactFlowCanvasProps {
  /** Initial nodes (tables) */
  initialNodes?: Array<TableNodeType>
  /** Initial edges (relationships) */
  initialEdges?: Array<RelationshipEdgeType>
  /**
   * Subject-area nodes (GH #106), kept separate from table nodes. Rendered
   * BEHIND tables; their move is persisted via onAreaDragStop and their resize
   * via the node's own `data.onResize`. They never enter the table
   * highlighting / edge-routing pipeline.
   */
  areaNodes?: Array<AreaNodeType>
  /**
   * Persist an area move (drag stop) — receives the area id, its new
   * top-left position, and the member tables that were translated along
   * with it (movable-container grouping, GH #106 bugfix). `movedMembers` is
   * empty when the area has no members.
   */
  onAreaDragStop?: (
    areaId: string,
    positionX: number,
    positionY: number,
    movedMembers: Array<{ id: string; positionX: number; positionY: number }>,
  ) => void
  /**
   * Delete an area (Delete/Backspace on a selected area node, or the ×
   * button). Fired from `onNodesDelete` for deleted nodes of type 'area';
   * table nodes are never included (they are marked `deletable: false` so
   * the native delete flow never bypasses the table confirmation dialog).
   */
  onAreaDelete?: (areaId: string) => void
  /**
   * Free-canvas-point comment pin nodes (GH #110), kept separate from table
   * nodes like areaNodes. Rendered ON TOP of tables (small markers, always
   * clickable); non-draggable/non-deletable — see the node-level flags set
   * where these are built in ReactFlowWhiteboard.
   */
  commentNodes?: Array<CommentNodeType>
  /** Callback when nodes change (position, selection, etc.) */
  onNodesChange?: OnNodesChange<TableNodeType>
  /** Callback when edges change */
  onEdgesChange?: OnEdgesChange<RelationshipEdgeType>
  /** Callback when connection is created */
  onConnect?: OnConnect
  /** Callback when node drag stops (position update) */
  onNodeDragStop?: OnNodeDrag<TableNodeType>
  /** Whether nodes are draggable */
  nodesDraggable?: boolean
  /** Whether canvas panning on drag is enabled */
  panOnDrag?: boolean
  /** Whether to show minimap */
  showMinimap?: boolean
  /** Whether to show controls */
  showControls?: boolean
  /** Whether to show background pattern */
  showBackground?: boolean
  /** Fit view options for initial render */
  fitViewOptions?: FitViewOptions
  /** Additional className */
  className?: string
  /** Callback when a node is clicked — receives the node id */
  onNodeClick?: (nodeId: string) => void
  /**
   * ID of the table whose relations panel is currently open (if any) —
   * threaded into calculateHighlighting so that table's node wrapper gets
   * the top z-index tier (its attached panel must render above every other
   * node/edge, regardless of neighbor hover/selection state).
   */
  relationsPreviewTableId?: string | null
  /**
   * Callback fired when the pane (empty canvas) is clicked. Receives the
   * native mouse event so callers can derive a flow position (e.g.
   * `screenToFlowPosition`) — used by the free-point comment placement tool
   * (GH #110).
   */
  onPaneClick?: (event: ReactMouseEvent) => void
  /**
   * External "select this table" entry point for the Cmd/Ctrl+K search
   * palette. When `focusRequestToken` changes to a positive value, the canvas
   * pans/zooms to `focusRequestTableId` and marks it active-highlighted. The
   * token (rather than the id alone) lets the same table be re-selected.
   */
  focusRequestTableId?: string | null
  /** Monotonic token that triggers a focus request when it increments. */
  focusRequestToken?: number
  /**
   * When true, the minimap renders as an enlarged, centered overlay with a
   * focus ring and a dim backdrop — driven by the `m` shortcut wired in the
   * parent (`ReactFlowWhiteboard`). Sizing/positioning come from the
   * `minimap-focused` CSS class.
   */
  minimapExpanded?: boolean
  /**
   * Called when the focused minimap should collapse — fired by clicking the dim
   * backdrop. Keyboard collapse (`m`/`Escape`) is handled by the parent's hook.
   */
  onMinimapCollapse?: () => void
}

/**
 * ReactFlowCanvas - Main wrapper component for React Flow-based ER diagram rendering
 * Replaces the Konva Canvas component with React Flow
 *
 * @example
 * ```tsx
 * <ReactFlowCanvas
 *   initialNodes={nodes}
 *   initialEdges={edges}
 *   nodesDraggable={true}
 *   showControls={true}
 *   showMinimap={true}
 * />
 * ```
 */
export function ReactFlowCanvas({
  initialNodes = [],
  initialEdges = [],
  areaNodes = EMPTY_AREA_NODES,
  onAreaDragStop,
  onAreaDelete,
  commentNodes = EMPTY_COMMENT_NODES,
  onNodesChange: onNodesChangeProp,
  onEdgesChange: onEdgesChangeProp,
  onConnect,
  onNodeDragStop: onNodeDragStopProp,
  onNodeClick: onNodeClickProp,
  nodesDraggable = true,
  panOnDrag = true,
  showMinimap = false,
  showControls = true,
  showBackground = true,
  fitViewOptions,
  className = '',
  relationsPreviewTableId = null,
  onPaneClick: onPaneClickProp,
  focusRequestTableId = null,
  focusRequestToken = 0,
  minimapExpanded = false,
  onMinimapCollapse,
}: ReactFlowCanvasProps) {
  const [nodes, setNodes, handleNodesChange] =
    useNodesState<TableNodeType>(initialNodes)
  const [edges, setEdges, handleEdgesChange] =
    useEdgesState<RelationshipEdgeType>(initialEdges)

  // Area (subject-area) nodes live in their own state so they never touch the
  // table highlighting / edge-routing pipeline. They are merged into the single
  // <ReactFlow nodes> array (areas FIRST → rendered behind tables).
  const [areaNodesState, setAreaNodesState, handleAreaNodesChange] =
    useNodesState<AreaNodeType>(areaNodes)
  useEffect(() => {
    setAreaNodesState(areaNodes)
  }, [areaNodes, setAreaNodesState])
  const areaIdSet = useMemo(
    () => new Set(areaNodesState.map((a) => a.id)),
    [areaNodesState],
  )

  // Comment pin nodes (GH #110) — same separate-state pattern as areas, but
  // rendered ON TOP of tables (merged last) since they are small clickable
  // markers, not background regions.
  const [commentNodesState, setCommentNodesState, handleCommentNodesChange] =
    useNodesState<CommentNodeType>(commentNodes)
  useEffect(() => {
    setCommentNodesState(commentNodes)
  }, [commentNodes, setCommentNodesState])
  const commentIdSet = useMemo(
    () => new Set(commentNodesState.map((c) => c.id)),
    [commentNodesState],
  )

  // Table nodes are never natively deletable (GH #106 Bug 1 fix) — Delete/
  // Backspace must always route through the table confirmation dialog
  // (useTableDeletion), never React Flow's own removal. Area nodes carry
  // their own `deletable` (== canEdit) from the areaNodes prop. Comment pins
  // are always non-deletable (deletion goes through the popover's own
  // delete action) — see the node-level flags set in ReactFlowWhiteboard.
  const mergedNodes = useMemo(
    () => [
      ...areaNodesState,
      ...nodes.map((n) =>
        n.deletable === false ? n : { ...n, deletable: false },
      ),
      ...commentNodesState,
    ],
    [areaNodesState, nodes, commentNodesState],
  )

  // Selection and hover state for highlighting
  const [activeTableId, setActiveTableId] = useState<string | null>(null)
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null)

  // React Flow instance — used by the search-palette focus request below to
  // pan/zoom the viewport (shares the store with the container's instance).
  const { fitView, setCenter, getZoom } = useReactFlow()

  // Single-click on the minimap recenters the viewport on that point.
  // `position` is already in flow coordinates; drag-to-pan is handled
  // natively by the `pannable` prop below.
  const onMinimapClick = useCallback(
    (_event: ReactMouseEvent, position: { x: number; y: number }) => {
      setCenter(position.x, position.y, { zoom: getZoom(), duration: 200 })
    },
    [setCenter, getZoom],
  )

  // Track drag in progress — ReactFlow fires mouseLeave/mouseEnter when drag
  // starts/stops, which would trigger unnecessary highlighting recalculations.
  const isDraggingRef = useRef(false)

  // Movable-container grouping (GH #106 Bug 2 fix): while an area node is
  // being dragged, its member tables must translate by the same delta. This
  // ref snapshots the area's start position and each member's start position
  // at drag-start, so onNodeDrag/onNodeDragStop can compute `delta` and apply
  // it without compounding across frames.
  const dragAreaMemberStartRef = useRef<{
    areaId: string
    areaStart: { x: number; y: number }
    members: Map<string, { x: number; y: number }>
  } | null>(null)

  // Track whether React Flow has measured all nodes; used for one-shot
  // post-measure edge re-routing inside the overlay (Enhancement 2).
  const nodesInitialized = useNodesInitialized()
  const hasReRoutedAfterMeasureRef = useRef(false)

  // Keep a ref to the latest edges so the highlighting effect can read current
  // edges without adding them to its dependency array (which would cause an
  // infinite loop via setEdges).
  const edgesRef = useRef(edges)
  useEffect(() => {
    edgesRef.current = edges
  })

  // Memoize node and edge types for performance
  const memoizedNodeTypes = useMemo(() => nodeTypes, [])
  const memoizedEdgeTypes = useMemo(() => edgeTypes, [])

  // Update nodes when initialNodes changes
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  // Search palette focus request — when the container bumps focusRequestToken,
  // pan/zoom to the requested table and mark it active-highlighted. Keyed on
  // the token (not the id) so re-selecting the same table re-fires; token 0 is
  // the initial value and never triggers a jump on mount.
  useEffect(() => {
    if (focusRequestToken <= 0 || !focusRequestTableId) return
    void fitView({
      nodes: [{ id: focusRequestTableId }],
      duration: 300,
      maxZoom: 1.2,
    })
    setActiveTableId(focusRequestTableId)
    // Intentionally keyed on focusRequestToken only — fire on token bump only.
  }, [focusRequestToken])

  // Update edges when initialEdges changes — immediately recalculate handles
  // based on the current node positions so edges start pointing the right way.
  useEffect(() => {
    if (initialEdges.length === 0) {
      setEdges(initialEdges)
      return
    }

    // Edges referencing a deleted or stale column are silently excluded to
    // prevent the "[React Flow]: Couldn't create edge for source handle id"
    // warning flood that occurs when handle IDs no longer match any
    // registered handle. Shared with TableFocusOverlay.tsx.
    const validEdges = filterValidEdges(initialNodes, initialEdges)

    const allNodeIds = new Set(initialNodes.map((n) => n.id))
    const recalculated = recalculateEdgesForDraggedNodes(
      validEdges,
      initialNodes,
      allNodeIds,
    )
    // Compute per-edge bundle offsets so parallel edges fan out consistently
    // after a page reload (they are not persisted; derive them from DB data).
    const layoutNodes = initialNodes.map((n) => ({
      id: n.id,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- React Flow's `measured` dimensions are only populated after the node has actually been measured in the DOM; on initial mount (this effect) they are genuinely undefined despite the non-optional type.
      width: n.measured?.width ?? (n.width as number) ?? 250,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above: `measured` is undefined pre-measurement at runtime.
      height: n.measured?.height ?? (n.height as number) ?? 150,
    }))
    const layoutEdges = recalculated.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }))
    const layers = assignLayersBFS(layoutNodes, layoutEdges)
    const bundleOffsets = computeEdgeBundleOffsets(layoutEdges, layers)
    const offsetById = new Map(bundleOffsets.map((o) => [o.id, o]))
    const withOffsets = recalculated.map((e) => {
      const off = offsetById.get(e.id)
      if (!off || (off.handleYOffset === 0 && off.centerXOffset === 0)) return e
      return {
        ...e,
        data: {
          ...e.data!,
          bundleHandleYOffset: off.handleYOffset,
          bundleCenterXOffset: off.centerXOffset,
        },
      }
    })
    setEdges(withOffsets)
  }, [initialEdges, initialNodes, setEdges])

  // Reset the one-shot re-routing guard whenever the node set changes (e.g.
  // overlay re-opened with a different focal table).
  useEffect(() => {
    hasReRoutedAfterMeasureRef.current = false
  }, [initialNodes])

  // One-shot re-route after React Flow measures nodes. The internal `nodes`
  // value carries `measured` widths at this point, giving accurate handle-side
  // choices. On the main canvas this is a harmless no-op (same handles already
  // chosen by drag routing). On the overlay it corrects the initial pass which
  // ran with DEFAULT_NODE_WIDTH fallbacks.
  useEffect(() => {
    if (!nodesInitialized || hasReRoutedAfterMeasureRef.current) return
    hasReRoutedAfterMeasureRef.current = true
    setEdges((prevEdges) => {
      if (prevEdges.length === 0) return prevEdges
      const allIds = new Set(nodes.map((n) => n.id))
      return recalculateEdgesForDraggedNodes(prevEdges, nodes, allIds)
    })
  }, [nodesInitialized, nodes, setEdges])

  // Apply highlighting when selection changes.
  // Uses the functional updater form of setNodes so we always operate on the
  // current node list rather than a stale closure snapshot. edgesRef.current
  // provides the latest edges without adding edges to the dependency array
  // (which would cause an infinite loop via setEdges).
  useEffect(() => {
    setNodes((currentNodes) => {
      const highlighted = calculateHighlighting(
        currentNodes,
        edgesRef.current,
        activeTableId,
        hoveredTableId,
        relationsPreviewTableId,
      )
      if (highlighted.edges !== edgesRef.current) {
        setEdges(highlighted.edges)
      }
      return highlighted.nodes
    })
  }, [
    activeTableId,
    hoveredTableId,
    relationsPreviewTableId,
    setNodes,
    setEdges,
  ])

  // Handle node click (selection + optional external callback). Comment pins
  // (GH #110) manage their own Popover open state internally and stop
  // propagation on their trigger, so this should rarely fire for them — the
  // commentIdSet guard is defense-in-depth against treating a comment's id
  // as a table selection (which would spuriously clear real highlighting).
  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      if (commentIdSet.has(node.id)) return
      setActiveTableId(node.id)
      onNodeClickProp?.(node.id)
    },
    [commentIdSet, onNodeClickProp],
  )

  // Handle pane click (clear selection). Forwards the native event so
  // callers can derive a flow position (comment placement tool, GH #110).
  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      setActiveTableId(null)
      onPaneClickProp?.(event)
    },
    [onPaneClickProp],
  )

  // Handle node mouse enter (hover) — skip during drag (ReactFlow fires this on drag end)
  const onNodeMouseEnter = useCallback<NodeMouseHandler>((_event, node) => {
    if (isDraggingRef.current) return
    setHoveredTableId(node.id)
  }, [])

  // Handle node mouse leave (unhover) — skip during drag (ReactFlow fires this on drag start)
  const onNodeMouseLeave = useCallback<NodeMouseHandler>((_event, _node) => {
    if (isDraggingRef.current) return
    setHoveredTableId(null)
  }, [])

  // Helper: merge dragged node positions into the current nodes array so the
  // recalculation always uses the latest coordinates even if React state is
  // one frame behind.
  const mergeCurrentPositions = useCallback(
    (
      node: TableNodeType,
      draggedNodes: Array<TableNodeType>,
    ): Array<TableNodeType> => {
      // Build a quick lookup of updated positions from the drag event
      const updatedPositions = new Map<string, { x: number; y: number }>()
      updatedPositions.set(node.id, node.position)
      draggedNodes.forEach((n) => updatedPositions.set(n.id, n.position))

      return nodes.map((n) => {
        const updated = updatedPositions.get(n.id)
        return updated ? { ...n, position: updated } : n
      })
    },
    [nodes],
  )

  // Mark drag as started — suppresses hover events that ReactFlow fires on drag begin.
  // When the dragged node is an area, also snapshot its start position and its
  // members' start positions so onNodeDrag/onNodeDragStop can translate them
  // by the live delta (movable-container grouping, GH #106 Bug 2 fix).
  const onNodeDragStart = useCallback<OnNodeDrag<TableNodeType>>(
    (_event, node) => {
      isDraggingRef.current = true

      if (!areaIdSet.has(node.id)) {
        dragAreaMemberStartRef.current = null
        return
      }
      const areaNode = areaNodesState.find((a) => a.id === node.id)
      const memberIds = new Set(areaNode?.data.area.memberTableIds ?? [])
      const members = new Map<string, { x: number; y: number }>()
      nodes.forEach((n) => {
        if (memberIds.has(n.id))
          members.set(n.id, { x: n.position.x, y: n.position.y })
      })
      dragAreaMemberStartRef.current = {
        areaId: node.id,
        areaStart: { x: node.position.x, y: node.position.y },
        members,
      }
    },
    [areaIdSet, areaNodesState, nodes],
  )

  // Recalculate edge handles whenever a node is dragged (live feedback).
  // We merge the dragged node's latest position into the nodes array so the
  // calculation is always based on current coordinates.
  const onNodeDrag = useCallback<OnNodeDrag<TableNodeType>>(
    (_event, node, draggedNodes) => {
      if (areaIdSet.has(node.id)) {
        // Movable-container grouping: translate member tables live by the
        // same delta the area has moved since drag-start.
        const drag = dragAreaMemberStartRef.current
        if (!drag || drag.areaId !== node.id || drag.members.size === 0) return
        const deltaX = node.position.x - drag.areaStart.x
        const deltaY = node.position.y - drag.areaStart.y
        setNodes((prevNodes) =>
          prevNodes.map((n) => {
            const start = drag.members.get(n.id)
            if (!start) return n
            return {
              ...n,
              position: { x: start.x + deltaX, y: start.y + deltaY },
            }
          }),
        )
        const movedIds = new Set(drag.members.keys())
        const currentNodes = nodes.map((n) => {
          const start = drag.members.get(n.id)
          if (!start) return n
          return {
            ...n,
            position: { x: start.x + deltaX, y: start.y + deltaY },
          }
        })
        setEdges((prevEdges) =>
          recalculateEdgesForDraggedNodes(prevEdges, currentNodes, movedIds),
        )
        return
      }
      const draggedIds = new Set(draggedNodes.map((n) => n.id))
      draggedIds.add(node.id)
      const currentNodes = mergeCurrentPositions(node, draggedNodes)
      setEdges((prevEdges) =>
        recalculateEdgesForDraggedNodes(prevEdges, currentNodes, draggedIds),
      )
    },
    [areaIdSet, mergeCurrentPositions, nodes, setEdges, setNodes],
  )

  // Handle node drag stop (position update)
  const onNodeDragStop = useCallback<OnNodeDrag<TableNodeType>>(
    (event, node, draggedNodes) => {
      isDraggingRef.current = false

      // Area nodes: persist the new position (+ any moved members), skip
      // edge routing / hover.
      if (areaIdSet.has(node.id)) {
        const drag = dragAreaMemberStartRef.current
        let movedMembers: Array<{
          id: string
          positionX: number
          positionY: number
        }> = []
        if (drag && drag.areaId === node.id) {
          const deltaX = node.position.x - drag.areaStart.x
          const deltaY = node.position.y - drag.areaStart.y
          movedMembers = Array.from(drag.members.entries()).map(
            ([id, start]) => ({
              id,
              positionX: start.x + deltaX,
              positionY: start.y + deltaY,
            }),
          )
        }
        dragAreaMemberStartRef.current = null
        onAreaDragStop?.(
          node.id,
          node.position.x,
          node.position.y,
          movedMembers,
        )
        return
      }

      // Restore hover on the node we just dropped (ReactFlow fires mouseEnter after
      // dragStop which we suppressed, so manually set it here)
      setHoveredTableId(node.id)

      // Final recalculation with latest positions
      const draggedIds = new Set(draggedNodes.map((n) => n.id))
      draggedIds.add(node.id)
      const currentNodes = mergeCurrentPositions(node, draggedNodes)
      setEdges((prevEdges) =>
        recalculateEdgesForDraggedNodes(prevEdges, currentNodes, draggedIds),
      )
      // Call the prop callback if provided
      onNodeDragStopProp?.(event, node, draggedNodes)
    },
    [
      areaIdSet,
      onAreaDragStop,
      onNodeDragStopProp,
      mergeCurrentPositions,
      setEdges,
    ],
  )

  // Handle nodes change with custom callback. React Flow fires a single
  // onNodesChange for ALL nodes (tables + areas + comment pins), so we
  // partition by id: area changes go to the area state, comment changes to
  // the comment state, table changes to the existing pipeline.
  const onNodesChange: OnNodesChange<TableNodeType> = useCallback(
    (changes) => {
      const areaChanges: typeof changes = []
      const commentChanges: typeof changes = []
      const tableChanges: typeof changes = []
      for (const change of changes) {
        if ('id' in change && areaIdSet.has(change.id)) areaChanges.push(change)
        else if ('id' in change && commentIdSet.has(change.id))
          commentChanges.push(change)
        else tableChanges.push(change)
      }
      if (areaChanges.length > 0) {
        handleAreaNodesChange(areaChanges as any)
      }
      if (commentChanges.length > 0) {
        handleCommentNodesChange(commentChanges as any)
      }
      handleNodesChange(tableChanges)
      onNodesChangeProp?.(tableChanges)
    },
    [
      areaIdSet,
      commentIdSet,
      handleAreaNodesChange,
      handleCommentNodesChange,
      handleNodesChange,
      onNodesChangeProp,
    ],
  )

  // Handle edges change with custom callback
  const onEdgesChange: OnEdgesChange<RelationshipEdgeType> = useCallback(
    (changes) => {
      handleEdgesChange(changes)
      onEdgesChangeProp?.(changes)
    },
    [handleEdgesChange, onEdgesChangeProp],
  )

  // Delete/Backspace on a selected area node (GH #106 Bug 1 fix). Table nodes
  // are marked `deletable: false` above so they never appear here — table
  // deletion always goes through useTableDeletion's confirmation dialog.
  // React Flow's own useKeyPress(deleteKeyCode, { actInsideInputWithModifier:
  // false }) already ignores Delete/Backspace while an input/textarea is
  // focused, so the AreaNode rename field's Backspace keystrokes are safe
  // without an extra guard here.
  const onNodesDelete = useCallback<OnNodesDelete<Node>>(
    (deletedNodes) => {
      for (const deletedNode of deletedNodes) {
        if (areaIdSet.has(deletedNode.id)) {
          onAreaDelete?.(deletedNode.id)
        }
      }
    },
    [areaIdSet, onAreaDelete],
  )

  // Track whether a connection drag is in progress to reveal target handles
  const [isConnecting, setIsConnecting] = useState(false)

  const onConnectStart = useCallback(() => {
    setIsConnecting(true)
  }, [])

  const onConnectEnd = useCallback(() => {
    setIsConnecting(false)
  }, [])

  return (
    <div
      className={`react-flow-wrapper ${isConnecting ? 'is-connecting' : ''} ${className}`}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Global SVG marker definitions for cardinality indicators */}
      <CardinalityMarkerDefs />

      <ReactFlow
        // Area nodes are a different node type merged behind tables; React Flow
        // resolves them at runtime via the `area` entry in nodeTypes. The cast
        // keeps the strongly-typed table handlers (onNodesChange<TableNodeType>)
        // without threading a union node type through the whole canvas.
        nodes={mergedNodes as unknown as typeof nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        deleteKeyCode={['Delete', 'Backspace']}
        nodeTypes={memoizedNodeTypes}
        edgeTypes={memoizedEdgeTypes}
        nodesDraggable={nodesDraggable}
        panOnDrag={panOnDrag}
        nodesConnectable={true}
        elementsSelectable={true}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={VIEWPORT_CONSTRAINTS.minZoom}
        maxZoom={VIEWPORT_CONSTRAINTS.maxZoom}
        panOnScroll={true}
        defaultEdgeOptions={{
          type: 'relationship',
          animated: false,
        }}
      >
        {showControls && <Controls />}
        {showBackground && (
          <Background color="var(--rf-background-pattern)" gap={16} />
        )}
        {showMinimap && minimapExpanded && (
          <div className="minimap-backdrop" onClick={onMinimapCollapse} />
        )}
        {showMinimap && (
          <MiniMap
            nodeColor={() => {
              return 'var(--rf-table-bg)'
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
            pannable
            onClick={onMinimapClick}
            className={minimapExpanded ? 'minimap-focused' : undefined}
          />
        )}
      </ReactFlow>
    </div>
  )
}
