import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  
  MiniMap,
  
  
  
  
  
  
  ReactFlow,
  useEdgesState,
  useNodesState
} from '@xyflow/react'
import type {FitViewOptions, Node, NodeDragHandler, NodeMouseHandler, OnConnect, OnEdgesChange, OnNodesChange} from '@xyflow/react';
import '@xyflow/react/dist/style.css'
import '@/styles/react-flow-theme.css'

import { CardinalityMarkerDefs } from './CardinalityMarkerDefs'
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import { recalculateEdgesForDraggedNodes } from '@/lib/react-flow/edge-routing'
import { edgeTypes, nodeTypes } from '@/lib/react-flow/node-types'
import { calculateHighlighting } from '@/lib/react-flow/highlighting'

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
  nodesDraggable = true,
  showMinimap = false,
  showControls = true,
  showBackground = true,
  fitViewOptions,
  className = '',
}: ReactFlowCanvasProps) {
  const [nodes, setNodes, handleNodesChange] =
    useNodesState<TableNodeType>(initialNodes)
  const [edges, setEdges, handleEdgesChange] =
    useEdgesState<RelationshipEdgeType>(initialEdges)

  // Selection and hover state for highlighting
  const [activeTableId, setActiveTableId] = useState<string | null>(null)
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null)

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

    // Build a set of all column IDs that currently exist across all nodes.
    // Edges referencing a deleted or stale column will be silently excluded
    // to prevent the "[React Flow]: Couldn't create edge for source handle id"
    // warning flood that occurs when handle IDs no longer match any registered handle.
    const existingColumnIds = new Set<string>()
    for (const node of initialNodes) {
      for (const col of node.data.table.columns) {
        existingColumnIds.add(col.id)
      }
    }

    const validEdges = initialEdges.filter((edge) => {
      const rel = edge.data?.relationship
      if (!rel) return false
      return (
        existingColumnIds.has(rel.sourceColumnId) &&
        existingColumnIds.has(rel.targetColumnId)
      )
    })

    const allNodeIds = new Set(initialNodes.map((n) => n.id))
    const recalculated = recalculateEdgesForDraggedNodes(
      validEdges,
      initialNodes,
      allNodeIds,
    )
    setEdges(recalculated)
  }, [initialEdges, initialNodes, setEdges])

  // Apply highlighting when selection changes
  useEffect(() => {
    const highlighted = calculateHighlighting(
      nodes,
      edges,
      activeTableId,
      hoveredTableId,
    )

    // Only update if highlighting state actually changed
    setNodes(highlighted.nodes)
    setEdges(highlighted.edges)
  }, [activeTableId, hoveredTableId]) // Don't include nodes/edges to avoid infinite loop

  // Handle node click (selection)
  const onNodeClick = useCallback<NodeMouseHandler>((event, node) => {
    setActiveTableId(node.id)
  }, [])

  // Handle pane click (clear selection)
  const onPaneClick = useCallback(() => {
    setActiveTableId(null)
  }, [])

  // Handle node mouse enter (hover)
  const onNodeMouseEnter = useCallback<NodeMouseHandler>((event, node) => {
    setHoveredTableId(node.id)
  }, [])

  // Handle node mouse leave (unhover)
  const onNodeMouseLeave = useCallback<NodeMouseHandler>((event, node) => {
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

  return (
    <div
      className={`react-flow-wrapper ${className}`}
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
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={memoizedNodeTypes}
        edgeTypes={memoizedEdgeTypes}
        nodesDraggable={nodesDraggable}
        nodesConnectable={false}
        elementsSelectable={true}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.1}
        maxZoom={2}
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
    </div>
  )
}
