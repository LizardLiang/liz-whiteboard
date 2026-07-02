import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
} from '@xyflow/react'
import type {
  FitViewOptions,
  Node,
  NodeDragHandler,
  NodeMouseHandler,
  OnConnect,
  OnEdgesChange,
  OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '@/styles/react-flow-theme.css'

import { CardinalityMarkerDefs } from './CardinalityMarkerDefs'
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import { recalculateEdgesForDraggedNodes } from '@/lib/react-flow/edge-routing'
import { assignLayersBFS, computeEdgeBundleOffsets } from '@/lib/auto-layout/d3-force-layout'
import { edgeTypes, nodeTypes } from '@/lib/react-flow/node-types'
import {
  calculateHighlighting,
  filterValidEdges,
  getDirectlyRelatedTableIds,
} from '@/lib/react-flow/highlighting'
import { VIEWPORT_CONSTRAINTS } from '@/lib/react-flow/viewport'
import { TableHoverPreview } from './TableHoverPreview'

/** Delay (ms) a table must be hovered before the preview card appears. */
const HOVER_PREVIEW_DELAY_MS = 450

/**
 * ReactFlowCanvas Props
 */
export interface ReactFlowCanvasProps {
  /** Initial nodes (tables) */
  initialNodes?: Array<TableNodeType>
  /** Initial edges (relationships) */
  initialEdges?: Array<RelationshipEdgeType>
  /** Callback when nodes change (position, selection, etc.) */
  onNodesChange?: OnNodesChange<TableNodeType>
  /** Callback when edges change */
  onEdgesChange?: OnEdgesChange<RelationshipEdgeType>
  /** Callback when connection is created */
  onConnect?: OnConnect
  /** Callback when node drag stops (position update) */
  onNodeDragStop?: NodeDragHandler<TableNodeType>
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
   * True while a modal/dialog such as TableFocusOverlay is open, to prevent
   * the hover preview card from appearing behind/alongside it.
   */
  suppressHoverPreview?: boolean
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
  suppressHoverPreview = false,
}: ReactFlowCanvasProps) {
  const [nodes, setNodes, handleNodesChange] =
    useNodesState<TableNodeType>(initialNodes)
  const [edges, setEdges, handleEdgesChange] =
    useEdgesState<RelationshipEdgeType>(initialEdges)

  // Selection and hover state for highlighting
  const [activeTableId, setActiveTableId] = useState<string | null>(null)
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null)

  // Hover-preview card state: which table's preview to show (if any) and
  // where to anchor it, driven by a debounce timer separate from
  // hoveredTableId (which sets/clears immediately for highlighting).
  const [hoverPreviewTableId, setHoverPreviewTableId] = useState<
    string | null
  >(null)
  const [hoverPreviewAnchor, setHoverPreviewAnchor] = useState<{
    x: number
    y: number
  } | null>(null)
  const hoverPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  // Track drag in progress — ReactFlow fires mouseLeave/mouseEnter when drag
  // starts/stops, which would trigger unnecessary highlighting recalculations.
  const isDraggingRef = useRef(false)

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
      width: (n.measured?.width ?? (n.width as number)) ?? 250,
      height: (n.measured?.height ?? (n.height as number)) ?? 150,
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
      )
      if (highlighted.edges !== edgesRef.current) {
        setEdges(highlighted.edges)
      }
      return highlighted.nodes
    })
  }, [activeTableId, hoveredTableId, setNodes, setEdges])

  // Handle node click (selection + optional external callback)
  const onNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    setActiveTableId(node.id)
    onNodeClickProp?.(node.id)
  }, [onNodeClickProp])

  // Handle pane click (clear selection)
  const onPaneClick = useCallback(() => {
    setActiveTableId(null)
  }, [])

  // Handle node mouse enter (hover) — skip during drag (ReactFlow fires this on drag end)
  const onNodeMouseEnter = useCallback<NodeMouseHandler>(
    (event, node) => {
      if (isDraggingRef.current) return
      setHoveredTableId(node.id)

      if (suppressHoverPreview) return
      if (hoverPreviewTimerRef.current) {
        clearTimeout(hoverPreviewTimerRef.current)
      }
      const anchorX = event.clientX
      const anchorY = event.clientY
      hoverPreviewTimerRef.current = setTimeout(() => {
        setHoverPreviewTableId(node.id)
        setHoverPreviewAnchor({ x: anchorX, y: anchorY })
      }, HOVER_PREVIEW_DELAY_MS)
    },
    [suppressHoverPreview],
  )

  // Handle node mouse leave (unhover) — skip during drag (ReactFlow fires this on drag start)
  const onNodeMouseLeave = useCallback<NodeMouseHandler>((_event, _node) => {
    if (hoverPreviewTimerRef.current) {
      clearTimeout(hoverPreviewTimerRef.current)
      hoverPreviewTimerRef.current = null
    }
    // A stale preview card must not survive a mouse-leave even if the
    // drag-suppression guard below skips the hoveredTableId reset.
    setHoverPreviewTableId(null)
    setHoverPreviewAnchor(null)

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

  // Mark drag as started — suppresses hover events that ReactFlow fires on drag begin
  const onNodeDragStart = useCallback(() => {
    isDraggingRef.current = true
    // A dragged table must never show a stale preview card following the cursor.
    if (hoverPreviewTimerRef.current) {
      clearTimeout(hoverPreviewTimerRef.current)
      hoverPreviewTimerRef.current = null
    }
    setHoverPreviewTableId(null)
    setHoverPreviewAnchor(null)
  }, [])

  // Clear any pending hover-preview timer on unmount.
  useEffect(() => {
    return () => {
      if (hoverPreviewTimerRef.current) {
        clearTimeout(hoverPreviewTimerRef.current)
      }
    }
  }, [])

  // When suppression turns on (e.g. TableFocusOverlay opens) while a hover
  // timer is pending or a preview is already showing, cancel/clear both.
  // Without this, a timer started just before suppression can still fire
  // mid-suppression and set hoverPreviewTableId/anchor; when suppression
  // later lifts, the card would reappear at a stale anchor with no hover.
  useEffect(() => {
    if (!suppressHoverPreview) return
    if (hoverPreviewTimerRef.current) {
      clearTimeout(hoverPreviewTimerRef.current)
      hoverPreviewTimerRef.current = null
    }
    setHoverPreviewTableId(null)
    setHoverPreviewAnchor(null)
  }, [suppressHoverPreview])

  // Resolve the hover-preview card's data from the current hover target.
  // Re-checks suppressHoverPreview at render time (not just at timer-start
  // time) in case the Focus Overlay opens via a different interaction path
  // while a preview is already showing.
  const hoverPreviewData = useMemo(() => {
    if (!hoverPreviewTableId || suppressHoverPreview) return null
    return getDirectlyRelatedTableIds(hoverPreviewTableId, edges)
  }, [hoverPreviewTableId, suppressHoverPreview, edges])

  const hoverPreviewTable = useMemo(() => {
    if (!hoverPreviewTableId) return undefined
    return nodes.find((n) => n.id === hoverPreviewTableId)
  }, [hoverPreviewTableId, nodes])

  const allNodesById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes],
  )

  // Recalculate edge handles whenever a node is dragged (live feedback).
  // We merge the dragged node's latest position into the nodes array so the
  // calculation is always based on current coordinates.
  const onNodeDrag = useCallback<NodeDragHandler<TableNodeType>>(
    (_event, node, draggedNodes) => {
      const draggedIds = new Set(draggedNodes.map((n) => n.id))
      draggedIds.add(node.id)
      const currentNodes = mergeCurrentPositions(node, draggedNodes)
      setEdges((prevEdges) =>
        recalculateEdgesForDraggedNodes(prevEdges, currentNodes, draggedIds),
      )
    },
    [mergeCurrentPositions, setEdges],
  )

  // Handle node drag stop (position update)
  const onNodeDragStop = useCallback<NodeDragHandler<TableNodeType>>(
    (event, node, draggedNodes) => {
      isDraggingRef.current = false
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
      onNodeDragStopProp?.(event, node)
    },
    [onNodeDragStopProp, mergeCurrentPositions, setEdges],
  )

  // Handle nodes change with custom callback
  const onNodesChange: OnNodesChange<TableNodeType> = useCallback(
    (changes) => {
      handleNodesChange(changes)
      onNodesChangeProp?.(changes)
    },
    [handleNodesChange, onNodesChangeProp],
  )

  // Handle edges change with custom callback
  const onEdgesChange: OnEdgesChange<RelationshipEdgeType> = useCallback(
    (changes) => {
      handleEdgesChange(changes)
      onEdgesChangeProp?.(changes)
    },
    [handleEdgesChange, onEdgesChangeProp],
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
        nodes={nodes}
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
        {showMinimap && (
          <MiniMap
            nodeColor={(node) => {
              return 'var(--rf-table-bg)'
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
        )}
      </ReactFlow>
      {hoverPreviewTable && hoverPreviewAnchor && hoverPreviewData && (
        <TableHoverPreview
          table={hoverPreviewTable}
          relatedEdges={hoverPreviewData.relatedEdges}
          allNodesById={allNodesById}
          anchorPosition={hoverPreviewAnchor}
        />
      )}
    </div>
  )
}
