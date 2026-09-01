// src/data/schema.ts
// Zod validation schemas for all entities in the ER Diagram Whiteboard

import { z } from 'zod'
import { AREA_COLOR_IDS } from '@/lib/area-colors'
import { DEFAULT_ELEMENT_STYLE } from '@/lib/canvas-engine/scene'

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
  positionX: z.number().finite().optional(),
  positionY: z.number().finite().optional(),
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
 * Schema for batch-reordering columns within a table.
 * orderedColumnIds must contain at least 1 UUID (the complete desired order).
 * Max 500 as a sanity cap — tables with more columns are unsupported in V1.
 * All IDs must use .uuid() per project convention (never .cuid()).
 */
export const reorderColumnsSchema = z.object({
  tableId: z.string().uuid(),
  orderedColumnIds: z.array(z.string().uuid()).min(1).max(500),
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
// Area Schemas (subject areas / table grouping, GH #106)
// ============================================================================

/**
 * Area color — a fixed palette id (see src/lib/area-colors.ts), NOT an
 * arbitrary hex. Matches the "small closed set of options" style used by
 * dataTypeSchema/cardinalitySchema.
 */
export const areaColorSchema = z.enum(AREA_COLOR_IDS)

/**
 * Schema for creating a new subject area.
 * memberTableIds defaults to [] so an area can be created empty. All IDs use
 * .uuid() per project convention (never .cuid()).
 */
export const createAreaSchema = z.object({
  whiteboardId: z.string().uuid(),
  name: z.string().min(1).max(255),
  color: areaColorSchema,
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  memberTableIds: z.array(z.string().uuid()).max(1000).default([]),
})

/**
 * Schema for updating an existing area.
 * Defined independently (not `.partial()` of create) so absent fields parse as
 * `undefined` and only explicitly-provided columns are written.
 */
export const updateAreaSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  color: areaColorSchema.optional(),
  positionX: z.number().finite().optional(),
  positionY: z.number().finite().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  memberTableIds: z.array(z.string().uuid()).max(1000).optional(),
})

// ============================================================================
// Comment Schemas (canvas comments / annotations, GH #110)
// ============================================================================

/**
 * Target kind for a root comment. Replies (parentId set) do not carry a
 * client-supplied targetType — the DAL stores the literal 'thread' for them
 * (see src/data/comment.ts) so the DB column stays NOT NULL without asking
 * reply payloads to fabricate a meaningless table/point target.
 */
export const commentTargetTypeSchema = z.enum(['table', 'point'])

/**
 * Schema for creating a comment (root or reply). `whiteboardId` is always
 * injected server-side (socket handler merges it in before parsing) — never
 * trusted from the client body directly for the IDOR-sensitive fields.
 *
 * Root (parentId absent): targetType is required, and must be consistent
 * with the matching target field (table ⇒ targetTableId, point ⇒
 * positionX + positionY).
 * Reply (parentId present): target/position fields are ignored — no
 * consistency requirement — the DAL discards them for reply rows.
 */
export const createCommentSchema = z
  .object({
    whiteboardId: z.string().uuid(),
    parentId: z.string().uuid().nullish(),
    targetType: commentTargetTypeSchema.optional(),
    targetTableId: z.string().uuid().optional(),
    positionX: z.number().finite().optional(),
    positionY: z.number().finite().optional(),
    body: z.string().min(1).max(2000),
  })
  .superRefine((data, ctx) => {
    const isReply = data.parentId != null
    if (isReply) return
    if (!data.targetType) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetType'],
        message: 'targetType is required for a new thread',
      })
      return
    }
    if (data.targetType === 'table' && !data.targetTableId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetTableId'],
        message: 'targetTableId is required when targetType is "table"',
      })
    }
    if (
      data.targetType === 'point' &&
      (data.positionX == null || data.positionY == null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['positionX'],
        message:
          'positionX and positionY are required when targetType is "point"',
      })
    }
  })

/**
 * Schema for editing a comment's body (author-only, enforced by the caller).
 */
export const updateCommentSchema = z.object({
  body: z.string().min(1).max(2000),
})

/**
 * Schema for resolving/reopening a root comment thread.
 */
export const resolveCommentSchema = z.object({
  commentId: z.string().uuid(),
  resolved: z.boolean(),
})

export type CommentTargetType = z.infer<typeof commentTargetTypeSchema>
// Input type (not infer/output): targetType/parentId are optional at the
// call site for replies — the parse+superRefine enforce the actual shape.
export type CreateComment = z.input<typeof createCommentSchema>
export type UpdateComment = z.infer<typeof updateCommentSchema>
export type ResolveComment = z.infer<typeof resolveCommentSchema>

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
/**
 * Pre-parse input shape for createColumnSchema — the `.default()`-backed
 * fields (isPrimaryKey/isForeignKey/isUnique/isNullable/order) are optional
 * here since Zod fills them in during `.parse()`. Callers that construct a
 * column payload by hand (seed script, data-layer callers) should accept
 * this type rather than `CreateColumn`, which describes the post-parse
 * output where those fields are always present.
 */
export type CreateColumnInput = z.input<typeof createColumnSchema>
export type UpdateColumn = z.infer<typeof updateColumnSchema>
export type ReorderColumns = z.infer<typeof reorderColumnsSchema>

export type CreateRelationship = z.infer<typeof createRelationshipSchema>
export type UpdateRelationship = z.infer<typeof updateRelationshipSchema>

export type CreateSession = z.infer<typeof createSessionSchema>
export type UpdateSession = z.infer<typeof updateSessionSchema>

export type AreaColorId = z.infer<typeof areaColorSchema>
// Input type (not infer/output): memberTableIds has a `.default([])`, so it is
// optional for callers of createArea — the parse fills it in.
export type CreateArea = z.input<typeof createAreaSchema>
export type UpdateArea = z.infer<typeof updateAreaSchema>

// ============================================================================
// Auth Schemas
// ============================================================================

/**
 * Schema for user registration input
 */
export const registerInputSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username must be alphanumeric with underscores only',
    ),
  email: z.string().email('Invalid email address').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
})

/**
 * Schema for user login input
 */
export const loginInputSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().default(false),
})

// ============================================================================
// Permission Schemas
// ============================================================================

/**
 * Schema for ProjectRole enum
 */
export const projectRoleSchema = z.enum(['VIEWER', 'EDITOR', 'ADMIN'])

/**
 * Schema for granting a permission (by email)
 */
export const grantPermissionSchema = z.object({
  projectId: z.string().uuid(),
  email: z.string().email(),
  role: projectRoleSchema,
})

/**
 * Schema for updating a permission
 */
export const updatePermissionSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  role: projectRoleSchema,
})

/**
 * Schema for revoking a permission
 */
export const revokePermissionSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
})

// ============================================================================
// Invite Schemas
// ============================================================================

/**
 * Allowed invite-link expiry durations (hours). A fixed closed set — matches
 * the existing "small closed set of options" style used for dataTypeSchema/
 * cardinalitySchema — rather than an arbitrary duration.
 */
export const inviteExpiryHoursSchema = z.union([
  z.literal(1),
  z.literal(24),
  z.literal(24 * 7),
  z.literal(24 * 30),
])

/**
 * Schema for creating a project invite link.
 */
export const createInviteSchema = z.object({
  projectId: z.string().uuid(),
  role: projectRoleSchema,
  expiresInHours: inviteExpiryHoursSchema.default(24 * 7),
})

/**
 * Schema for revoking a project invite link.
 */
export const revokeInviteSchema = z.object({
  projectId: z.string().uuid(),
  inviteId: z.string().uuid(),
})

/**
 * Schema for redeeming a project invite link. `token` is the raw
 * crypto-random bearer token (not a UUID) — validated for non-emptiness
 * only, the hash lookup itself rejects anything that doesn't match.
 */
export const redeemInviteSchema = z.object({
  token: z.string().min(1),
})

// ============================================================================
// Whiteboard Share Link Schemas (read-only public links, GH #109)
// ============================================================================

/**
 * Schema for creating a whiteboard read-only share link.
 * A3: expiry is REQUIRED — reuses the same closed set as
 * inviteExpiryHoursSchema (1h/24h/7d/30d), defaulting to 7 days, matching
 * createInviteSchema's expiresInHours exactly. No never-expires option.
 * A2: multiple links per whiteboard are allowed — no `role`/`maxUses` fields
 * (unlike ProjectInvite), since every link always grants read-only access.
 */
export const createShareLinkSchema = z.object({
  whiteboardId: z.string().uuid(),
  expiresInHours: inviteExpiryHoursSchema.default(24 * 7),
})

/**
 * Schema for revoking a whiteboard read-only share link.
 * A2: multiple links per whiteboard are independently revocable, so the
 * target link is identified by its own id.
 */
export const revokeShareLinkSchema = z.object({
  linkId: z.string().uuid(),
})

export type CreateShareLink = z.infer<typeof createShareLinkSchema>
export type RevokeShareLink = z.infer<typeof revokeShareLinkSchema>

/**
 * Schema for creating a public read-only share link for a CANVAS board.
 *
 * Deliberately a separate schema from `createShareLinkSchema` rather than a
 * union: the id names a different table, and the handler that receives it
 * resolves the project through `getCanvasBoardProjectId`. Reuses
 * `inviteExpiryHoursSchema` and the same one-week default, so the two link
 * kinds cannot drift on expiry policy.
 */
export const createCanvasShareLinkSchema = z.object({
  canvasBoardId: z.string().uuid(),
  expiresInHours: inviteExpiryHoursSchema.default(24 * 7),
})

/** Schema for revoking a canvas board share link, identified by its own id. */
export const revokeCanvasShareLinkSchema = z.object({
  linkId: z.string().uuid(),
})

export type CreateCanvasShareLink = z.infer<typeof createCanvasShareLinkSchema>
export type RevokeCanvasShareLink = z.infer<typeof revokeCanvasShareLinkSchema>

// ============================================================================
// Whiteboard Version History / Snapshot Schemas (GH #107)
// ============================================================================

/**
 * Schema for manually saving a version snapshot of a whiteboard's current
 * diagram state. `label` is optional — the UI falls back to a
 * timestamp-derived default name when omitted (AC2).
 */
export const saveSnapshotSchema = z.object({
  whiteboardId: z.string().uuid(),
  label: z.string().max(120).optional(),
})

/**
 * Schema for restoring a whiteboard to a previously-saved snapshot.
 * `snapshotId` is the only input — the target whiteboard is always resolved
 * from the snapshot row itself, never from a client-supplied whiteboardId
 * (AC7 / IDOR guard).
 */
export const restoreSnapshotSchema = z.object({
  snapshotId: z.string().uuid(),
})

/**
 * Schema for listing every snapshot belonging to a whiteboard.
 */
export const listSnapshotsSchema = z.object({
  whiteboardId: z.string().uuid(),
})

/**
 * Schema for fetching a single snapshot (read-only preview). Only
 * `snapshotId` is accepted — same IDOR rationale as restoreSnapshotSchema.
 */
export const getSnapshotSchema = z.object({
  snapshotId: z.string().uuid(),
})

export type SaveSnapshot = z.infer<typeof saveSnapshotSchema>
export type RestoreSnapshot = z.infer<typeof restoreSnapshotSchema>
export type ListSnapshots = z.infer<typeof listSnapshotsSchema>
export type GetSnapshot = z.infer<typeof getSnapshotSchema>

// Auth type exports
export type RegisterInput = z.infer<typeof registerInputSchema>
export type LoginInput = z.infer<typeof loginInputSchema>
export type ProjectRoleValue = z.infer<typeof projectRoleSchema>
export type GrantPermission = z.infer<typeof grantPermissionSchema>
export type UpdatePermission = z.infer<typeof updatePermissionSchema>
export type RevokePermission = z.infer<typeof revokePermissionSchema>

export type InviteExpiryHours = z.infer<typeof inviteExpiryHoursSchema>
export type CreateInvite = z.infer<typeof createInviteSchema>
export type RevokeInvite = z.infer<typeof revokeInviteSchema>
export type RedeemInvite = z.infer<typeof redeemInviteSchema>

// ============================================================================
// Auto Layout Schemas
// ============================================================================

/**
 * Schema for bulk-updating table positions (used by Auto Layout).
 * - whiteboardId scopes the IDOR guard
 * - positions[] must contain ≥ 1 entry; each id must be a UUID
 * - 500-entry cap as a sanity bound (auto-layout supported size is ≤ 100;
 *   larger payloads suggest a bug or abuse and are rejected client-side)
 */
export const bulkUpdatePositionsSchema = z.object({
  whiteboardId: z.string().uuid(),
  positions: z
    .array(
      z.object({
        id: z.string().uuid(),
        positionX: z.number().finite(),
        positionY: z.number().finite(),
      }),
    )
    .min(1)
    .max(500),
})

export type BulkUpdatePositions = z.infer<typeof bulkUpdatePositionsSchema>

/**
 * Schema for the table:move:bulk socket broadcast payload.
 * Validated server-side before re-broadcasting to all collaborators.
 * - userId must be a UUID (wire format uses userId throughout)
 * - Each position entry must have finite numeric coordinates (rejects NaN / Infinity)
 * - tableId uses the wire-format field name (positionX/positionY), matching
 *   the existing table:moved event convention
 * - 500-entry cap matches bulkUpdatePositionsSchema
 */
export const tableMoveBulkBroadcastSchema = z.object({
  userId: z.string().uuid(),
  positions: z
    .array(
      z.object({
        tableId: z.string().uuid(),
        positionX: z.number().finite(),
        positionY: z.number().finite(),
      }),
    )
    .min(1)
    .max(500),
})

export type TableMoveBulkBroadcast = z.infer<
  typeof tableMoveBulkBroadcastSchema
>

/**
 * Schema for the area:move socket event payload (atomic area + member drag,
 * area-atomic-move fix for collaborator detachment).
 * - areaId must be a UUID
 * - positionX/positionY must be finite (rejects NaN / Infinity)
 * - members MAY be empty (an area can have zero members) — each entry's
 *   tableId is a UUID and positionX/positionY are finite
 * - 500-entry cap on members matches tableMoveBulkBroadcastSchema's cap
 */
export const areaMoveBroadcastSchema = z.object({
  areaId: z.string().uuid(),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  members: z
    .array(
      z.object({
        tableId: z.string().uuid(),
        positionX: z.number().finite(),
        positionY: z.number().finite(),
      }),
    )
    .max(500),
})

// ============================================================================
// OAuth Consent / Connected-Apps Schemas (MCP DCR + consent screen)
// ============================================================================

/**
 * request_id is an opaque `randomBytes(32).toString('hex')` token minted by
 * src/lib/oauth/pending-consent.ts — not a UUID (OAuth client_id/DCR ids
 * aren't UUIDs either), so this deliberately does NOT use `.uuid()`.
 */
export const consentRequestIdSchema = z.object({
  requestId: z.string().min(1),
})

/**
 * clientId here is always an OauthClient DCR row id
 * (`randomBytes(16).toString('hex')`, see src/lib/oauth/clients.ts) — grants
 * only ever exist for untrusted (DCR) clients, never CIMD/first-party ones —
 * so this is intentionally not `.uuid()` either.
 */
export const revokeGrantSchema = z.object({
  clientId: z.string().min(1),
})

export type ConsentRequestId = z.infer<typeof consentRequestIdSchema>
export type RevokeGrant = z.infer<typeof revokeGrantSchema>

export type AreaMoveBroadcast = z.infer<typeof areaMoveBroadcastSchema>

// ============================================================================
// Shape / Connector Schemas (Phase 1 — shapes and connectors)
// ============================================================================

/**
 * Hard magnitude bound on any persisted flow coordinate (tech-spec §3, M7).
 * `.finite()` alone accepts values like `1e300`; with `fitView` enabled
 * (ReactFlowCanvas.tsx), a single shape persisted at an extreme coordinate
 * forces every collaborator's viewport to zoom out until the board is
 * unusable — a board-wide DoS reachable from one ordinary payload. 1e7 flow
 * units is ~10,000 screens wide at 1:1 — far past any real board.
 *
 * This is a deliberate tightening for the NEW shape/connector entities, not
 * an existing repo convention — every pre-existing coordinate schema in this
 * file uses bare `.finite()`. Retrofitting those is out of Phase 1 scope.
 */
export const MAX_BOARD_COORD = 10_000_000

/** FR-038's text cap for a shape's label, enforced here and as `<textarea maxLength>`. */
export const SHAPE_LABEL_MAX_LENGTH = 500

const boardCoordSchema = z
  .number()
  .finite()
  .min(-MAX_BOARD_COORD)
  .max(MAX_BOARD_COORD)

/**
 * A 1|2|4 stroke width — a fixed set, not a free number, per tech-spec §3.
 * Exported (W9, Hermes code review) so `ShapeStyleControls.tsx`'s stroke-
 * width picker derives its options from this schema instead of restating
 * the same three literals independently.
 */
export const SHAPE_STROKE_WIDTHS = [1, 2, 4] as const
const strokeWidthSchema = z.union(
  SHAPE_STROKE_WIDTHS.map((w) => z.literal(w)) as [
    z.ZodLiteral<1>,
    z.ZodLiteral<2>,
    z.ZodLiteral<4>,
  ],
)

export const shapeKindSchema = z.enum([
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'text',
])

/**
 * Shared visual-styling vocabulary for every shape kind (tech-spec §3).
 * `fill` additionally allows `'none'` (unfilled) on top of the Area palette;
 * `textColor` additionally allows `'auto'` (theme foreground token).
 */
export const shapeStyleSchema = z.strictObject({
  // FigJam default: a soft filled body, not an outline. This is a DEFAULT,
  // so it applies to rows whose stored style is `{}` — i.e. shapes nobody
  // ever styled. Once any style control is touched the full object is
  // written (`{...current, ...patch}`), pinning that shape's own choices,
  // including an explicit `'none'`.
  fill: z.enum([...AREA_COLOR_IDS, 'none']).default('blue'),
  stroke: areaColorSchema.default('slate'),
  strokeWidth: strokeWidthSchema.default(2),
  strokeStyle: z.enum(['solid', 'dashed']).default('solid'),
  fontSize: z.union([z.literal(12), z.literal(16), z.literal(24)]).default(16),
  textColor: z.enum([...AREA_COLOR_IDS, 'auto']).default('auto'),
})

/** Connector visual styling — a narrower vocabulary plus arrowhead flags. */
export const connectorStyleSchema = z.strictObject({
  stroke: areaColorSchema.default('slate'),
  strokeWidth: strokeWidthSchema.default(2),
  strokeStyle: z.enum(['solid', 'dashed']).default('solid'),
  arrowStart: z.boolean().default(false),
  arrowEnd: z.boolean().default(true),
})

/** A `line` shape's endpoint fractions are 0..1 of the node's own bounds (FR-031a). */
const lineFractionSchema = z.number().finite().min(0).max(1)

/**
 * Kind-specific payload, a Zod discriminated union on `kind`. Four kinds
 * carry an empty object — deliberate (tech-spec §3): this is the validation
 * dispatch point that lets future kinds (`ink`, `image`) be added with no
 * schema change (FR-032). Do NOT "clean up" the empty-object arms.
 */
export const shapePropsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rectangle') }),
  z.strictObject({ kind: z.literal('ellipse') }),
  z.strictObject({ kind: z.literal('diamond') }),
  z.strictObject({ kind: z.literal('text') }),
  z.strictObject({
    kind: z.literal('line'),
    x1: lineFractionSchema,
    y1: lineFractionSchema,
    x2: lineFractionSchema,
    y2: lineFractionSchema,
    arrowStart: z.boolean(),
    arrowEnd: z.boolean(),
  }),
])

/**
 * Schema for creating a shape. Mirrors `createAreaSchema`'s convention:
 * `update` is defined independently below, not `.partial()` of this.
 */
export const createShapeSchema = z
  .object({
    whiteboardId: z.string().uuid(),
    kind: shapeKindSchema,
    positionX: boardCoordSchema,
    positionY: boardCoordSchema,
    width: z.number().positive().max(100_000),
    height: z.number().positive().max(100_000),
    text: z.string().max(SHAPE_LABEL_MAX_LENGTH).nullable().default(null),
    style: shapeStyleSchema.optional(),
    props: shapePropsSchema,
  })
  // W2 (Hermes code review): `kind` and `props.kind` are validated
  // independently above — `shapePropsSchema` is its own discriminated
  // union with no visibility into the top-level `kind` field. Without
  // this check, `{ kind: 'line', props: { kind: 'text' } }` parses and
  // persists cleanly (ShapeNode.tsx switches on `shape.kind`, not
  // `props.kind`, so a mismatched row renders as its `kind`, but with the
  // WRONG props shape — e.g. a 'line' with no x1/y1/x2/y2 to draw with).
  .refine((data) => data.kind === data.props.kind, {
    message: 'props.kind must match kind',
    path: ['props', 'kind'],
  })

/**
 * Schema for updating an existing shape. Defined independently (not
 * `.partial()` of create) so absent fields parse as `undefined` and only
 * explicitly-provided columns are written — matches `updateAreaSchema`.
 */
export const updateShapeSchema = z.object({
  positionX: boardCoordSchema.optional(),
  positionY: boardCoordSchema.optional(),
  width: z.number().positive().max(100_000).optional(),
  height: z.number().positive().max(100_000).optional(),
  text: z.string().max(SHAPE_LABEL_MAX_LENGTH).nullable().optional(),
  style: shapeStyleSchema.optional(),
  props: shapePropsSchema.optional(),
})

/**
 * Schema for creating a connector. `sourceShapeId === targetShapeId` (a
 * self-connector) is rejected here — FR-016/tech-spec §4 — since a
 * self-referencing arrow has no defined direction. The line/table/cross-
 * whiteboard endpoint rules are enforced server-side against the loaded
 * rows (schema validation alone cannot see `kind` or `whiteboardId`).
 */
export const createConnectorSchema = z
  .object({
    whiteboardId: z.string().uuid(),
    sourceShapeId: z.string().uuid(),
    targetShapeId: z.string().uuid(),
    style: connectorStyleSchema.optional(),
  })
  .refine((data) => data.sourceShapeId !== data.targetShapeId, {
    message: 'A shape cannot be connected to itself',
    path: ['targetShapeId'],
  })

export type ShapeKind = z.infer<typeof shapeKindSchema>
export type ShapeStyle = z.infer<typeof shapeStyleSchema>
export type ShapeProps = z.infer<typeof shapePropsSchema>
export type ConnectorStyle = z.infer<typeof connectorStyleSchema>
export type CreateShape = z.input<typeof createShapeSchema>
export type UpdateShape = z.infer<typeof updateShapeSchema>
export type CreateConnector = z.input<typeof createConnectorSchema>

// ============================================================================
// Canvas Engine Schemas (FigJam-style canvas boards, milestone 1)
// ============================================================================
// A canvas board is a separate board kind from the ER whiteboard: its own
// table, its own route, its own elements. These schemas validate what the
// client is allowed to persist into "CanvasBoard" / "CanvasElement".

/**
 * A canvas text element is a paragraph the user types into, not a shape
 * label, so `SHAPE_LABEL_MAX_LENGTH` (500) would be far too tight. This cap
 * exists to bound a single row, not to express a product rule — it is a
 * documented assumption, not a locked decision.
 */
export const CANVAS_TEXT_MAX_LENGTH = 10_000

/**
 * A CSS colour, as a bounded opaque string.
 *
 * These values reach `ctx.fillStyle` / `ctx.strokeStyle`, never innerHTML —
 * a canvas has no markup, so an unparseable colour is silently ignored by
 * the browser rather than injected. What DOES need bounding is length, so a
 * hostile client cannot store a megabyte per element. Deliberately not a
 * strict colour grammar: the engine's palette is still being designed, and
 * rejecting valid CSS colours would be a worse failure than storing an
 * ineffective one.
 */
const cssColorSchema = z.string().min(1).max(64)

/**
 * Element appearance. Defaults are taken from the ENGINE's own
 * `DEFAULT_ELEMENT_STYLE` rather than restated here, so the value the
 * renderer falls back to and the value the validator fills in can never
 * drift apart.
 */
export const canvasElementStyleSchema = z.strictObject({
  fill: cssColorSchema.default(DEFAULT_ELEMENT_STYLE.fill),
  stroke: cssColorSchema.default(DEFAULT_ELEMENT_STYLE.stroke),
  strokeWidth: z
    .number()
    .finite()
    .min(0)
    .max(64)
    .default(DEFAULT_ELEMENT_STYLE.strokeWidth),
  fontSize: z
    .number()
    .finite()
    .min(1)
    .max(512)
    .default(DEFAULT_ELEMENT_STYLE.fontSize),
  color: cssColorSchema.default(DEFAULT_ELEMENT_STYLE.color),
  /**
   * Corner rounding in world units — see `CanvasElementStyle.cornerRadius`.
   *
   * `.default()` rather than `.optional()`, which is what lets every row
   * written before rounded corners existed keep validating unchanged: the key
   * is simply absent and parses to 0. That is the whole migration; there is
   * no ALTER to run because the style is one JSON column.
   *
   * Capped well above anything the toolbar offers, because the value is
   * clamped to the shape at draw time anyway and a stored radius larger than
   * the box is a legitimate way to say "as round as this can get".
   */
  cornerRadius: z
    .number()
    .finite()
    .min(0)
    .max(512)
    .default(DEFAULT_ELEMENT_STYLE.cornerRadius),
  /**
   * Text alignment — see `CanvasElementStyle.textAlign` / `.verticalAlign`.
   *
   * `.default()` rather than `.optional()`, the same migration-free move
   * `cornerRadius` above documents: the key is simply absent on every row
   * written before alignment existed and parses to the top-left the renderer
   * already drew. There is no ALTER to run, because the style is one JSON
   * column.
   *
   * The defaults are read from `DEFAULT_ELEMENT_STYLE` rather than restated,
   * so the value the renderer falls back to and the value the validator fills
   * in can never drift apart.
   */
  textAlign: z
    .enum(['left', 'center', 'right'])
    .default(DEFAULT_ELEMENT_STYLE.textAlign),
  verticalAlign: z
    .enum(['top', 'middle', 'bottom'])
    .default(DEFAULT_ELEMENT_STYLE.verticalAlign),
})

/**
 * The element kinds the engine renders (see canvas-engine/scene.ts).
 *
 * `rectangle`, `ellipse`, `diamond` and `triangle` are the SHAPE kinds — one
 * world rect drawn four ways. They are deliberately four enum members rather
 * than one `shape` kind with a discriminating prop: `kind` is a real column
 * that every query, broadcast and undo snapshot already carries, and an
 * element's kind never changes, so a shape's identity belongs there and not
 * behind a second lookup into `props`.
 */
export const canvasElementKindSchema = z.enum([
  'rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'text',
  'connector',
  'group',
])

/**
 * How a connector is drawn between its two endpoints — FigJam's three line
 * types, chosen per connector by the user (canvas quick-create-handles
 * tactical plan, decision F3).
 *
 * All three are DERIVED shapes: none of them stores a path. They differ only
 * in how `canvas-engine/connector-geometry.ts` turns the two endpoints' live
 * bounds into points, so switching routing is a props write and nothing else.
 */
export const canvasConnectorRoutingSchema = z.enum([
  'straight',
  'elbow',
  'curved',
])

/**
 * Which SIDE of an element a connector end is tied to — the four sides the
 * creation handles sit on. Mirrors `ConnectorAnchor` in
 * src/lib/canvas-engine/scene.ts, which the engine declares independently
 * because it cannot import Zod.
 */
/**
 * A normalised position on an element's border: 0..1 across its own box, with
 * at least one component pinned to an edge. Not a world coordinate — that
 * would slide off the shape the moment it was resized.
 */
export const canvasConnectorAttachSchema = z.strictObject({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
})

/** A free connector end's own coordinate, held to the board's range. */
export const canvasConnectorPointSchema = z.strictObject({
  x: boardCoordSchema,
  y: boardCoordSchema,
})

/** Exactly one of "attached to an element" / "a free point" must be set. */
function hasExactlyOneEnd(
  elementId: string | null,
  point: { x: number; y: number } | undefined,
): boolean {
  return (elementId !== null) !== (point !== undefined)
}

export const canvasConnectorAnchorSchema = z.enum([
  'top',
  'right',
  'bottom',
  'left',
])

/**
 * Kind-specific payload, a discriminated union on `kind`. Every shape arm and
 * the `text` arm are empty objects, and that is deliberate — exactly as
 * `shapePropsSchema` documents. This union is the dispatch point that let
 * `ellipse`, `diamond` and `triangle` be added with no table change, and that
 * will do the same for `ink` or `image`. Do NOT "clean up" the empty arms
 * into a plain enum.
 *
 * The `connector` arm is the first one carrying real content, and it is why
 * routing lives HERE and not in `canvasElementStyleSchema`: that schema is a
 * `z.strictObject` shared by every kind, so a `routing` field added there
 * would fail validation for every rectangle and text row already stored.
 */
export const canvasElementPropsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rectangle') }),
  z.strictObject({ kind: z.literal('ellipse') }),
  z.strictObject({ kind: z.literal('diamond') }),
  z.strictObject({ kind: z.literal('triangle') }),
  z.strictObject({ kind: z.literal('text') }),
  z
    .strictObject({
      kind: z.literal('connector'),
      // NULLABLE since connector ends became draggable: an end dropped on
      // empty board detaches and stores its own point instead. The pairing is
      // enforced by the two `.refine`s below — exactly one of id / point per
      // end. Stored FLAT rather than as a nested union so every row written
      // before free ends existed still validates unchanged; the engine's own
      // `ConnectorEndpoint` IS a union, and `canvas-element-adapter.ts` is the
      // one place the two shapes meet.
      sourceElementId: z.string().uuid().nullable(),
      targetElementId: z.string().uuid().nullable(),
      sourcePoint: canvasConnectorPointSchema.optional(),
      targetPoint: canvasConnectorPointSchema.optional(),
      routing: canvasConnectorRoutingSchema,
      // OPTIONAL, and it has to stay that way: connectors written before
      // anchoring existed carry neither, and a required field here would make
      // every one of those rows fail validation on its next update — the row
      // would become uneditable rather than merely un-anchored. The geometry
      // falls back to centre-derived border points per end when absent.
      // WHERE on the border each end is tied, as a fraction of the element's
      // box — continuous, so an end can sit anywhere along an edge rather than
      // only at one of four midpoints.
      sourceAttach: canvasConnectorAttachSchema.optional(),
      targetAttach: canvasConnectorAttachSchema.optional(),
      // LEGACY, read-only: rows written when an end could only be one of four
      // sides. `canvas-element-adapter.ts` reads these as that side's midpoint
      // and writes `*Attach` from then on. Kept in the schema so an old row
      // still validates on its next update instead of becoming uneditable.
      sourceAnchor: canvasConnectorAnchorSchema.optional(),
      targetAnchor: canvasConnectorAnchorSchema.optional(),
      // HOW FAR the line is bowed by hand, as a signed fraction of the
      // straight chord between its two ends — the perpendicular distance the
      // middle of the curve sits off that chord, divided by the chord's
      // length. Positive is the LEFT-hand side of the source -> target
      // direction as seen on screen; see `CanvasConnector.curvature`, which
      // owns the full definition.
      //
      // OPTIONAL for exactly the reason `sourceAttach` above is: every
      // connector row already in the database was written before bending
      // existed and carries none, and a required field here would make each
      // of those rows fail validation on its NEXT update — the row would
      // become uneditable rather than merely un-bowed. Absent and 0 both mean
      // "no hand-applied bow", and both redraw the pre-curvature path
      // unchanged.
      //
      // NOT range-checked here, deliberately, even though the geometry holds
      // it to `CURVATURE_LIMIT`. A row carrying an out-of-range value — hand
      // edited, seeded, imported — is drawable (the clamp is in
      // `connector-geometry.ts`, which every render and hit-test goes
      // through) and so must stay editable; rejecting it at the schema would
      // strand the one row a user most needs to be able to grab and fix.
      curvature: z.number().optional(),
    })
    // Each end is EITHER attached to an element OR a free point — never
    // both, never neither. The engine models this as a discriminated union;
    // this is the same invariant stated where the flat storage shape can be
    // checked.
    .refine(
      (props) => hasExactlyOneEnd(props.sourceElementId, props.sourcePoint),
      {
        message:
          'A connector end must be either attached to an element or a free point',
        path: ['sourceElementId'],
      },
    )
    .refine(
      (props) => hasExactlyOneEnd(props.targetElementId, props.targetPoint),
      {
        message:
          'A connector end must be either attached to an element or a free point',
        path: ['targetElementId'],
      },
    )
    // A self-connector has no drawable path — its two endpoint rects are the
    // same rect, so `connectorPath` returns null and the row would persist as
    // permanently invisible and unselectable. Rejected at the schema so no
    // write path can produce one, rather than left for each renderer to
    // tolerate.
    //
    // Guarded on both ids being PRESENT: two free ends are both `null`, and a
    // plain `!==` would read that as "joined to itself" and reject a perfectly
    // ordinary floating line.
    .refine(
      (props) =>
        props.sourceElementId === null ||
        props.targetElementId === null ||
        props.sourceElementId !== props.targetElementId,
      {
        message: 'A connector cannot join an element to itself',
        path: ['targetElementId'],
      },
    ),
  // A group's membership list — its direct member ids only (canvas-element-
  // grouping tactical plan, Wave 1). No `.refine` here: cascade/cycle
  // integrity (PRD FR-018) is a SCENE-level concern, checked where the whole
  // board's relationships are visible, not a per-write shape concern this
  // single element's schema can see — exactly how the connector arm's own
  // `.refine`s above check only ITS shape, never cross-element integrity.
  z.strictObject({
    kind: z.literal('group'),
    childIds: z.array(z.string().uuid()),
  }),
])

/**
 * Paint order bounds. Exported so `nextCanvasZIndex` (canvas-element.ts) can
 * clamp its own computed `MAX(zIndex) + 1` to the same ceiling this schema
 * enforces — without it, one element already sitting at the max would make
 * every subsequent `element:create` on that board fail schema validation
 * with no way to recover (Hermes review, suggestion).
 */
export const CANVAS_ZINDEX_MIN = -1_000_000
export const CANVAS_ZINDEX_MAX = 1_000_000

/**
 * Paint order. Bounded because it is written straight into an INTEGER
 * column and compared on every render; an unbounded client value could
 * make every subsequent `nextZIndex` overflow into Infinity.
 */
const canvasZIndexSchema = z
  .number()
  .int()
  .min(CANVAS_ZINDEX_MIN)
  .max(CANVAS_ZINDEX_MAX)

/**
 * Schema for creating a canvas element. Follows `createShapeSchema`'s
 * convention exactly, including the cross-validation below; `update` is
 * defined independently rather than as `.partial()` of this.
 *
 * `rotation` is absent on purpose: the column exists so rotation needs no
 * schema change later, but milestone 1 does not let anyone set it, so the
 * data layer writes 0 — the same thing `createShape` does.
 */
export const createCanvasElementSchema = z
  .object({
    // Optional and validated like any other field — NOT a second, laxer
    // write path. Absent for an ordinary draw (the data layer generates one);
    // supplied only when undo restores a deleted element, so the restored
    // row keeps the identifier every other client still has cached (board-
    // undo tactical plan, Wave 1, step 3).
    id: z.string().uuid().optional(),
    boardId: z.string().uuid(),
    kind: canvasElementKindSchema,
    positionX: boardCoordSchema,
    positionY: boardCoordSchema,
    // A CONNECTOR has no geometry of its own: its path is derived from its two
    // endpoints' live bounds on every frame (canvas-engine/connector-
    // geometry.ts), so anything stored here would go stale the moment a
    // collaborator moved either end. These four columns are NOT NULL and
    // `.positive()`, so a connector writes a degenerate 1x1 placeholder at its
    // source's centre and NOTHING ever reads it back. Do not "fix" a
    // connector's stored bounds — deriving them is the point.
    width: z.number().positive().max(100_000),
    height: z.number().positive().max(100_000),
    zIndex: canvasZIndexSchema.default(0),
    // Optional, validated, and honoured server-side ONLY alongside an
    // explicit `id` (see handlers.ts) — same restore-only gating as `id`
    // itself. Undo's restore-a-deleted-element path uses this to seed the
    // new row's revision ABOVE whatever the deleted row last held, closing
    // an ABA hole: without it, every restore starts back at revision 1, so
    // a stale undo/redo entry recorded against the ORIGINAL row can match a
    // RESTORED row's revision by coincidence and apply against content it
    // never actually saw (Hermes review, W-C).
    //
    // `.nonnegative()`, not `.positive()`: a row that was created and never
    // subsequently updated legitimately holds revision 0 (the schema's own
    // `DEFAULT 0`, and `createCanvasElement`'s own "every fresh row starts
    // at 1" note only describes an ORDINARY create — a row inserted by any
    // OTHER path, such as this project's own e2e seed scripts writing
    // straight SQL with no `revision` column, keeps the column default).
    // Deleting that row and undoing the delete sends its actual pre-delete
    // revision, 0, straight through as `minRevision` — `.positive()` (>0)
    // rejected exactly that value with a VALIDATION_ERROR, which this
    // hook's own generic-refusal fallback then reported as a false
    // "changed since your edit" — a real, reachable bug (not merely a
    // theoretical one), found by canvas-undo.spec.ts's own "undo a delete"
    // e2e case (board-undo tactical plan, Wave 5).
    minRevision: z.number().int().nonnegative().optional(),
    text: z.string().max(CANVAS_TEXT_MAX_LENGTH).nullable().default(null),
    style: canvasElementStyleSchema.optional(),
    props: canvasElementPropsSchema,
  })
  // The W2 fix, carried over verbatim in intent: `kind` and `props.kind` are
  // validated independently above, and a discriminated union has no
  // visibility into a sibling top-level field. Without this,
  // `{ kind: 'text', props: { kind: 'rectangle' } }` persists cleanly and
  // then renders as text with rectangle props — a mismatch no reader of the
  // row can detect.
  .refine((data) => data.kind === data.props.kind, {
    message: 'props.kind must match kind',
    path: ['props', 'kind'],
  })

/**
 * Schema for updating a canvas element. Defined independently (not
 * `.partial()` of create) so absent fields parse as `undefined` and only
 * explicitly-provided columns are written. `kind` is absent: an element's
 * kind never changes.
 */
export const updateCanvasElementSchema = z.object({
  positionX: boardCoordSchema.optional(),
  positionY: boardCoordSchema.optional(),
  width: z.number().positive().max(100_000).optional(),
  height: z.number().positive().max(100_000).optional(),
  zIndex: canvasZIndexSchema.optional(),
  text: z.string().max(CANVAS_TEXT_MAX_LENGTH).nullable().optional(),
  style: canvasElementStyleSchema.optional(),
  props: canvasElementPropsSchema.optional(),
})

/**
 * Schema for creating a canvas board. Mirrors `createWhiteboardSchema` —
 * same name bounds, same optional `folderId` — because the two board kinds
 * are meant to sit side by side in the navigator.
 */
export const createCanvasBoardSchema = z.object({
  name: z.string().min(1).max(255),
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
})

/** Schema for renaming / re-filing a canvas board. */
export const updateCanvasBoardSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  folderId: z.string().uuid().nullable().optional(),
})

export type CanvasElementKind = z.infer<typeof canvasElementKindSchema>
export type CanvasElementStyle = z.infer<typeof canvasElementStyleSchema>
export type CanvasElementProps = z.infer<typeof canvasElementPropsSchema>
export type CanvasConnectorRouting = z.infer<
  typeof canvasConnectorRoutingSchema
>
export type CreateCanvasElement = z.input<typeof createCanvasElementSchema>
export type UpdateCanvasElement = z.infer<typeof updateCanvasElementSchema>
export type CreateCanvasBoard = z.input<typeof createCanvasBoardSchema>
export type UpdateCanvasBoard = z.infer<typeof updateCanvasBoardSchema>
