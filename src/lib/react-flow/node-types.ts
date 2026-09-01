/**
 * React Flow Node and Edge Type Registry
 *
 * This file exports the node and edge type mappings for React Flow
 */

import type { EdgeTypes, NodeTypes } from '@xyflow/react'
// Import React Flow components (using .new suffix during migration)
import { TableNode } from '@/components/whiteboard/TableNode'
import { RelationshipEdge } from '@/components/whiteboard/RelationshipEdge'
import { AreaNode } from '@/components/whiteboard/AreaNode'
import { CommentNode } from '@/components/whiteboard/CommentNode'
import { ShapeNode } from '@/components/whiteboard/ShapeNode'
import { ConnectorEdge } from '@/components/whiteboard/ConnectorEdge'
import { QuickCreateGhostNode } from '@/components/whiteboard/QuickCreateGhostNode'

/**
 * React Flow node type registry
 * Maps node type string to component
 */
export const nodeTypes: NodeTypes = {
  table: TableNode,
  area: AreaNode,
  comment: CommentNode,
  shape: ShapeNode,
  quickCreateGhost: QuickCreateGhostNode,
}

/**
 * React Flow edge type registry
 * Maps edge type string to component
 */
export const edgeTypes: EdgeTypes = {
  relationship: RelationshipEdge,
  connector: ConnectorEdge,
}
