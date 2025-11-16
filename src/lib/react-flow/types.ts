/**
 * React Flow Type Definitions for ERD Whiteboard
 *
 * This file contains all TypeScript types for integrating React Flow
 * with the existing Prisma database schema.
 */

import type { Node, Edge } from '@xyflow/react'
import type { DiagramTable, Column, Relationship, Cardinality } from '@prisma/client'

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
 */
export interface TableNodeData {
  /** The table entity with its columns */
  table: DiagramTable & {
    columns: Column[]
  }

  /** Whether this table is actively selected (clicked) */
  isActiveHighlighted: boolean

  /** Whether this table is highlighted due to relationship with active table */
  isHighlighted: boolean

  /** Whether this table is currently hovered */
  isHovered: boolean

  /** Current display mode */
  showMode: ShowMode

  /** Map of column ID to cardinality for incoming relationships */
  targetColumnCardinalities?: Record<string, Cardinality>
}

/**
 * Complete Table node type for React Flow
 */
export type TableNodeType = Node<TableNodeData, 'table'>

/**
 * Data structure for Relationship edges in React Flow
 */
export interface RelationshipEdgeData {
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
}

/**
 * Complete Relationship edge type for React Flow
 */
export type RelationshipEdgeType = Edge<RelationshipEdgeData, 'relationship'>

/**
 * Canvas viewport state (replaces Konva CanvasViewport)
 */
export interface ReactFlowViewport {
  /** Current zoom level (0.1 to 2.0) */
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
  children: ELKNode[]
  edges: ELKEdge[]
}

/**
 * ELK node representation
 */
export interface ELKNode {
  id: string
  width: number
  height: number
  x?: number  // Set by ELK after layout
  y?: number  // Set by ELK after layout
}

/**
 * ELK edge representation
 */
export interface ELKEdge {
  id: string
  sources: string[]
  targets: string[]
}

/**
 * Result of highlighting calculation
 */
export interface HighlightResult {
  nodes: TableNodeType[]
  edges: RelationshipEdgeType[]
}

/**
 * Edge lookup map (for performance)
 */
export type EdgeMap = Map<string, RelationshipEdgeType[]>

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
 * Z-Index layers
 */
export const Z_INDEX = {
  NODE_DEFAULT: 1,
  NODE_HIGHLIGHTED: 1000,
  EDGE_DEFAULT: 1,
  EDGE_HIGHLIGHTED: 1000,
  EDGE_LABEL: 1001,
} as const
