// src/data/schema.ts
// Zod validation schemas for all entities in the ER Diagram Whiteboard

import { z } from 'zod'

// ============================================================================
// JSON Sub-Schemas (for nested JSON fields)
// ============================================================================

/**
 * Canvas viewport state schema
 * Used in Whiteboard.canvasState
 */
export const canvasStateSchema = z.object({
  zoom: z.number().min(0.1).max(5),
  offsetX: z.number().finite(),
  offsetY: z.number().finite(),
})

/**
 * Routing points for relationship arrows
 * Used in Relationship.routingPoints
 */
export const routingPointsSchema = z.array(
  z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
)

/**
 * Cursor position for collaboration
 * Used in CollaborationSession.cursor
 */
export const cursorSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})

// ============================================================================
// Enum Schemas
// ============================================================================

/**
 * Cardinality for relationships between tables
 */
export const cardinalitySchema = z.enum([
  'ONE_TO_ONE',
  'ONE_TO_MANY',
  'MANY_TO_ONE',
  'MANY_TO_MANY',
  'ZERO_TO_ONE',
  'ZERO_TO_MANY',
  'SELF_REFERENCING',
  'MANY_TO_ZERO_OR_ONE',
  'MANY_TO_ZERO_OR_MANY',
  'ZERO_OR_ONE_TO_ONE',
  'ZERO_OR_ONE_TO_MANY',
  'ZERO_OR_ONE_TO_ZERO_OR_ONE',
  'ZERO_OR_ONE_TO_ZERO_OR_MANY',
  'ZERO_OR_MANY_TO_ONE',
  'ZERO_OR_MANY_TO_MANY',
  'ZERO_OR_MANY_TO_ZERO_OR_ONE',
  'ZERO_OR_MANY_TO_ZERO_OR_MANY',
])

/**
 * Allowed data types for columns
 */
export const dataTypeSchema = z.enum([
  // Numeric
  'int',
  'bigint',
  'smallint',
  'float',
  'double',
  'decimal',
  'serial',
  'money',
  // String
  'string',
  'char',
  'varchar',
  'text',
  // Boolean
  'boolean',
  'bit',
  // Date/Time
  'date',
  'datetime',
  'timestamp',
  'time',
  // Binary
  'binary',
  'blob',
  // Structured
  'json',
  'xml',
  'array',
  'enum',
  // Identity
  'uuid',
])

// ============================================================================
// Project Schemas
// ============================================================================

/**
 * Schema for creating a new project
 */
export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
})

/**
 * Schema for updating an existing project
 */
export const updateProjectSchema = createProjectSchema.partial()

// ============================================================================
// Folder Schemas
// ============================================================================

/**
 * Schema for creating a new folder
 */
export const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  projectId: z.string().uuid(),
  parentFolderId: z.string().uuid().optional(),
})

/**
 * Schema for updating an existing folder
 */
export const updateFolderSchema = createFolderSchema
  .pick({ name: true })
  .partial()

// ============================================================================
// Whiteboard Schemas
// ============================================================================

/**
 * Schema for creating a new whiteboard
 */
export const createWhiteboardSchema = z.object({
  name: z.string().min(1).max(255),
  projectId: z.string().uuid(),
  folderId: z.string().uuid().optional(),
  canvasState: canvasStateSchema.optional(),
  textSource: z.string().optional(),
})

/**
 * Schema for updating an existing whiteboard
 */
export const updateWhiteboardSchema = createWhiteboardSchema.partial()

// ============================================================================
// DiagramTable Schemas
// ============================================================================

/**
 * Schema for creating a new table
 */
export const createTableSchema = z.object({
  whiteboardId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
})

/**
 * Schema for updating an existing table
 */
export const updateTableSchema = createTableSchema
  .omit({ whiteboardId: true })
  .partial()

// ============================================================================
// Column Schemas
// ============================================================================

/**
 * Schema for creating a new column
 */
export const createColumnSchema = z.object({
  tableId: z.string().uuid(),
  name: z.string().min(1).max(255),
  dataType: dataTypeSchema,
  isPrimaryKey: z.boolean().default(false),
  isForeignKey: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  isNullable: z.boolean().default(false),
  description: z.string().optional(),
  order: z.number().int().min(0).default(0),
})

/**
 * Schema for updating an existing column
 *
 * Defined independently (without basing on createColumnSchema) so that absent
 * fields parse as `undefined` rather than inheriting the `.default()` values
 * from createColumnSchema. This ensures only explicitly-provided fields are
 * passed to Prisma, preventing silent overwrites (e.g. resetting isPrimaryKey
 * to false when only isNullable was changed).
 */
export const updateColumnSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  dataType: dataTypeSchema.optional(),
  isPrimaryKey: z.boolean().optional(),
  isForeignKey: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  isNullable: z.boolean().optional(),
  description: z.string().optional(),
})

// ============================================================================
// Relationship Schemas
// ============================================================================

/**
 * Schema for creating a new relationship
 */
export const createRelationshipSchema = z.object({
  whiteboardId: z.string().uuid(),
  sourceTableId: z.string().uuid(),
  targetTableId: z.string().uuid(),
  sourceColumnId: z.string().uuid(),
  targetColumnId: z.string().uuid(),
  cardinality: cardinalitySchema,
  label: z.string().max(255).optional(),
  routingPoints: routingPointsSchema.optional(),
})

/**
 * Schema for updating an existing relationship
 */
export const updateRelationshipSchema = createRelationshipSchema
  .omit({ whiteboardId: true })
  .partial()

// ============================================================================
// CollaborationSession Schemas
// ============================================================================

/**
 * Schema for creating a new collaboration session
 */
export const createSessionSchema = z.object({
  whiteboardId: z.string().uuid(),
  userId: z.string().uuid(),
  socketId: z.string(),
  cursor: cursorSchema.optional(),
})

/**
 * Schema for updating an existing collaboration session
 */
export const updateSessionSchema = z.object({
  cursor: cursorSchema.optional(),
})

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

export type CanvasState = z.infer<typeof canvasStateSchema>
export type RoutingPoints = z.infer<typeof routingPointsSchema>
export type CursorPosition = z.infer<typeof cursorSchema>
export type Cardinality = z.infer<typeof cardinalitySchema>
export type DataType = z.infer<typeof dataTypeSchema>

export type CreateProject = z.infer<typeof createProjectSchema>
export type UpdateProject = z.infer<typeof updateProjectSchema>

export type CreateFolder = z.infer<typeof createFolderSchema>
export type UpdateFolder = z.infer<typeof updateFolderSchema>

export type CreateWhiteboard = z.infer<typeof createWhiteboardSchema>
export type UpdateWhiteboard = z.infer<typeof updateWhiteboardSchema>

export type CreateTable = z.infer<typeof createTableSchema>
export type UpdateTable = z.infer<typeof updateTableSchema>

export type CreateColumn = z.infer<typeof createColumnSchema>
export type UpdateColumn = z.infer<typeof updateColumnSchema>

export type CreateRelationship = z.infer<typeof createRelationshipSchema>
export type UpdateRelationship = z.infer<typeof updateRelationshipSchema>

export type CreateSession = z.infer<typeof createSessionSchema>
export type UpdateSession = z.infer<typeof updateSessionSchema>
