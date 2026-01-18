import { TableNode } from './TableNode'
import { RelationshipEdge } from './RelationshipEdge'
import type { EdgeTypes, NodeTypes } from '@xyflow/react'

/**
 * Custom node types for React Flow
 * Maps node type strings to their corresponding components
 */
export const nodeTypes: NodeTypes = {
  erTable: TableNode,
}

/**
 * Custom edge types for React Flow
 * Maps edge type strings to their corresponding components
 */
export const edgeTypes: EdgeTypes = {
  erRelationship: RelationshipEdge,
}
