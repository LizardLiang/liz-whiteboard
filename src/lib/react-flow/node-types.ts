/**
 * React Flow Node and Edge Type Registry
 *
 * This file exports the node and edge type mappings for React Flow
 */

import type { EdgeTypes, NodeTypes } from '@xyflow/react'
// Import React Flow components (using .new suffix during migration)
import { TableNode } from '@/components/whiteboard/TableNode.new'
import { RelationshipEdge } from '@/components/whiteboard/RelationshipEdge.new'
import { AreaNode } from '@/components/whiteboard/AreaNode'
import { CommentNode } from '@/components/whiteboard/CommentNode'

/**
 * React Flow node type registry
 * Maps node type string to component
 */
export const nodeTypes: NodeTypes = {
  table: TableNode,
  area: AreaNode,
  comment: CommentNode,
}

/**
 * React Flow edge type registry
 * Maps edge type string to component
 */
export const edgeTypes: EdgeTypes = {
  relationship: RelationshipEdge,
}
