import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type FitViewOptions,
  type Node,
  type NodeMouseHandler,
  type NodeDragHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '@/styles/react-flow-theme.css';

import type { TableNodeType, RelationshipEdgeType } from '@/lib/react-flow/types';
import { nodeTypes, edgeTypes } from '@/lib/react-flow/node-types';
import { calculateHighlighting } from '@/lib/react-flow/highlighting';
import { CardinalityMarkerDefs } from './CardinalityMarkerDefs';

/**
 * ReactFlowCanvas Props
 */
export interface ReactFlowCanvasProps {
  /** Initial nodes (tables) */
  initialNodes?: TableNodeType[];
  /** Initial edges (relationships) */
  initialEdges?: RelationshipEdgeType[];
  /** Callback when nodes change (position, selection, etc.) */
  onNodesChange?: OnNodesChange<TableNodeType>;
  /** Callback when edges change */
  onEdgesChange?: OnEdgesChange<RelationshipEdgeType>;
  /** Callback when connection is created */
  onConnect?: OnConnect;
  /** Callback when node drag stops (position update) */
  onNodeDragStop?: NodeDragHandler<TableNodeType>;
  /** Whether nodes are draggable */
  nodesDraggable?: boolean;
  /** Whether to show minimap */
  showMinimap?: boolean;
  /** Whether to show controls */
  showControls?: boolean;
  /** Whether to show background pattern */
  showBackground?: boolean;
  /** Fit view options for initial render */
  fitViewOptions?: FitViewOptions;
  /** Additional className */
  className?: string;
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
  const [nodes, setNodes, handleNodesChange] = useNodesState<TableNodeType>(initialNodes);
  const [edges, setEdges, handleEdgesChange] = useEdgesState<RelationshipEdgeType>(initialEdges);

  // Selection and hover state for highlighting
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);

  // Memoize node and edge types for performance
  const memoizedNodeTypes = useMemo(() => nodeTypes, []);
  const memoizedEdgeTypes = useMemo(() => edgeTypes, []);

  // Update nodes when initialNodes changes
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  // Update edges when initialEdges changes
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Apply highlighting when selection changes
  useEffect(() => {
    const highlighted = calculateHighlighting(
      nodes,
      edges,
      activeTableId,
      hoveredTableId
    );

    // Only update if highlighting state actually changed
    setNodes(highlighted.nodes);
    setEdges(highlighted.edges);
  }, [activeTableId, hoveredTableId]); // Don't include nodes/edges to avoid infinite loop

  // Handle node click (selection)
  const onNodeClick = useCallback<NodeMouseHandler>((event, node) => {
    setActiveTableId(node.id);
  }, []);

  // Handle pane click (clear selection)
  const onPaneClick = useCallback(() => {
    setActiveTableId(null);
  }, []);

  // Handle node mouse enter (hover)
  const onNodeMouseEnter = useCallback<NodeMouseHandler>((event, node) => {
    setHoveredTableId(node.id);
  }, []);

  // Handle node mouse leave (unhover)
  const onNodeMouseLeave = useCallback<NodeMouseHandler>((event, node) => {
    setHoveredTableId(null);
  }, []);

  // Handle node drag stop (position update)
  const onNodeDragStop = useCallback<NodeDragHandler<TableNodeType>>(
    (event, node) => {
      // Call the prop callback if provided
      onNodeDragStopProp?.(event, node);
    },
    [onNodeDragStopProp]
  );

  // Handle nodes change with custom callback
  const onNodesChange: OnNodesChange<TableNodeType> = useCallback(
    (changes) => {
      handleNodesChange(changes);
      onNodesChangeProp?.(changes);
    },
    [handleNodesChange, onNodesChangeProp]
  );

  // Handle edges change with custom callback
  const onEdgesChange: OnEdgesChange<RelationshipEdgeType> = useCallback(
    (changes) => {
      handleEdgesChange(changes);
      onEdgesChangeProp?.(changes);
    },
    [handleEdgesChange, onEdgesChangeProp]
  );

  return (
    <div className={`react-flow-wrapper ${className}`} style={{ width: '100%', height: '100%' }}>
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
        {showBackground && <Background color="var(--rf-background-pattern)" gap={16} />}
        {showMinimap && (
          <MiniMap
            nodeColor={(node) => {
              return 'var(--rf-table-bg)';
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
        )}
      </ReactFlow>
    </div>
  );
}
