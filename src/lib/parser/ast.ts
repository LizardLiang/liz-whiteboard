// src/lib/parser/ast.ts
// AST (Abstract Syntax Tree) types for diagram parser
// Represents the parsed structure of text-based ER diagram syntax

/**
 * Position information for error reporting
 */
export interface Position {
  line: number
  column: number
  offset: number
}

/**
 * Base node with position information
 */
export interface BaseNode {
  position?: Position
}

/**
 * Column definition within a table
 * Example: "id uuid pk"
 */
export interface ColumnNode extends BaseNode {
  type: 'column'
  name: string
  dataType:
    | 'int'
    | 'string'
    | 'float'
    | 'boolean'
    | 'date'
    | 'text'
    | 'uuid'
    | 'json'
  isPrimaryKey: boolean
  isForeignKey: boolean
  isUnique: boolean
  isNullable: boolean
  description?: string
}

/**
 * Table definition with columns
 * Example:
 * table Users {
 *   id uuid pk
 *   name string
 * }
 */
export interface TableNode extends BaseNode {
  type: 'table'
  name: string
  description?: string
  columns: Array<ColumnNode>
}

/**
 * Relationship cardinality
 */
export type Cardinality =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many'

/**
 * Relationship definition between two tables
 * Example: "Users.id -> Orders.userId (one-to-many)"
 */
export interface RelationshipNode extends BaseNode {
  type: 'relationship'
  sourceTable: string
  sourceColumn: string
  targetTable: string
  targetColumn: string
  cardinality: Cardinality
  label?: string
}

/**
 * Root AST node containing all diagram elements
 */
export interface DiagramAST {
  tables: Array<TableNode>
  relationships: Array<RelationshipNode>
}

/**
 * Parse error with position information
 */
export interface ParseError {
  message: string
  line: number
  column: number
  offset: number
  length?: number
}

/**
 * Parse result containing either AST or errors
 */
export interface ParseResult {
  success: boolean
  ast?: DiagramAST
  errors: Array<ParseError>
}
