# Data Model: Collaborative ER Diagram Whiteboard

**Date**: 2025-10-28
**Phase**: 1 - Design & Contracts
**Purpose**: Define database schema, entity relationships, and validation rules

## Overview

This data model supports hierarchical organization (Projects → Folders → Whiteboards), ER diagram representation (Tables, Columns, Relationships), and real-time collaboration (Sessions).

---

## Entity Relationship Diagram

```
Project (1) ──< (N) Folder
Project (1) ──< (N) Whiteboard
Folder (1) ──< (N) Folder (self-referential)
Folder (1) ──< (N) Whiteboard
Whiteboard (1) ──< (N) DiagramTable
Whiteboard (1) ──< (N) CollaborationSession
DiagramTable (1) ──< (N) Column
DiagramTable (1) ──< (N) Relationship (as source)
DiagramTable (1) ──< (N) Relationship (as target)
Column (1) ──< (N) Relationship (as sourceColumn)
Column (1) ──< (N) Relationship (as targetColumn)
```

---

## Entities

### 1. Project

**Purpose**: Top-level organizational container for grouping related whiteboards and folders.

**Fields**:
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (UUID) | PRIMARY KEY | Unique identifier |
| name | String | NOT NULL, max 255 chars | Project display name |
| description | String? | NULL, max 1000 chars | Optional project description |
| createdAt | DateTime | NOT NULL, default: now() | Creation timestamp |
| updatedAt | DateTime | NOT NULL, auto-update | Last modification timestamp |

**Relationships**:

- `folders`: One-to-many to Folder (folders directly under this project)
- `whiteboards`: One-to-many to Whiteboard (whiteboards directly under this project)

**Validation Rules**:

- Name must be 1-255 characters
- Name must be unique per user (future: add userId foreign key)

**Indexes**:

- `id` (primary)
- `createdAt` (for sorting)

---

### 2. Folder

**Purpose**: Hierarchical container for organizing whiteboards and nested folders within a project.

**Fields**:
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (UUID) | PRIMARY KEY | Unique identifier |
| name | String | NOT NULL, max 255 chars | Folder display name |
| projectId | String (UUID) | NOT NULL, FOREIGN KEY | Parent project reference |
| parentFolderId | String (UUID)? | NULL, FOREIGN KEY (self) | Parent folder (NULL if top-level) |
| createdAt | DateTime | NOT NULL, default: now() | Creation timestamp |
| updatedAt | DateTime | NOT NULL, auto-update | Last modification timestamp |

**Relationships**:

- `project`: Many-to-one to Project
- `parentFolder`: Many-to-one to Folder (self-referential)
- `childFolders`: One-to-many to Folder (nested folders)
- `whiteboards`: One-to-many to Whiteboard

**Validation Rules**:

- Name must be 1-255 characters
- Cannot be its own parent (prevent circular references)
- Max nesting depth: 10 levels (application-enforced)

**Indexes**:

- `id` (primary)
- `projectId` (for project tree queries)
- `parentFolderId` (for nested folder lookups)

---

### 3. Whiteboard

**Purpose**: A canvas containing an ER diagram with tables, relationships, and layout metadata.

**Fields**:
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (UUID) | PRIMARY KEY | Unique identifier |
| name | String | NOT NULL, max 255 chars | Whiteboard display name |
| projectId | String (UUID) | NOT NULL, FOREIGN KEY | Parent project reference |
| folderId | String (UUID)? | NULL, FOREIGN KEY | Parent folder (NULL if directly under project) |
| canvasState | JSON | NULL | Canvas viewport state (zoom, pan offset) |
| textSource | String? | NULL, TEXT | Diagram text syntax (Mermaid-like) |
| createdAt | DateTime | NOT NULL, default: now() | Creation timestamp |
| updatedAt | DateTime | NOT NULL, auto-update | Last modification timestamp |

**canvasState JSON Structure**:

```typescript
{
  zoom: number,        // Zoom level (1.0 = 100%)
  offsetX: number,     // Pan offset X
  offsetY: number      // Pan offset Y
}
```

**Relationships**:

- `project`: Many-to-one to Project
- `folder`: Many-to-one to Folder (optional)
- `tables`: One-to-many to DiagramTable
- `sessions`: One-to-many to CollaborationSession

**Validation Rules**:

- Name must be 1-255 characters
- Either folderId OR projectId must be set (but folderId implies projectId)
- canvasState must validate against JSON schema

**Indexes**:

- `id` (primary)
- `projectId` (for project queries)
- `folderId` (for folder queries)
- `updatedAt` (for recently edited sorting)

---

### 4. DiagramTable

**Purpose**: Represents a database table in the ER diagram with position, columns, and metadata.

**Fields**:
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (UUID) | PRIMARY KEY | Unique identifier |
| whiteboardId | String (UUID) | NOT NULL, FOREIGN KEY | Parent whiteboard reference |
| name | String | NOT NULL, max 255 chars | Table name (e.g., "Users") |
| description | String? | NULL, TEXT | Optional table description |
| positionX | Float | NOT NULL | X coordinate on canvas |
| positionY | Float | NOT NULL | Y coordinate on canvas |
| width | Float | NULL, default: auto-calculated | Table visual width |
| height | Float | NULL, default: auto-calculated | Table visual height |
| createdAt | DateTime | NOT NULL, default: now() | Creation timestamp |
| updatedAt | DateTime | NOT NULL, auto-update | Last modification timestamp |

**Relationships**:

- `whiteboard`: Many-to-one to Whiteboard
- `columns`: One-to-many to Column
- `outgoingRelationships`: One-to-many to Relationship (as source)
- `incomingRelationships`: One-to-many to Relationship (as target)

**Validation Rules**:

- Name must be 1-255 characters
- Name must be unique within whiteboard
- positionX, positionY must be finite numbers

**Indexes**:

- `id` (primary)
- `whiteboardId` (for diagram queries)
- Composite `(whiteboardId, name)` (unique constraint)

---

### 5. Column

**Purpose**: Represents a column within a database table, with data type and constraints.

**Fields**:
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (UUID) | PRIMARY KEY | Unique identifier |
| tableId | String (UUID) | NOT NULL, FOREIGN KEY | Parent table reference |
| name | String | NOT NULL, max 255 chars | Column name (e.g., "\_id") |
| dataType | String | NOT NULL, max 50 chars | Data type (int, string, etc.) |
| isPrimaryKey | Boolean | NOT NULL, default: false | Primary key flag |
| isForeignKey | Boolean | NOT NULL, default: false | Foreign key flag |
| isUnique | Boolean | NOT NULL, default: false | Unique constraint flag |
| isNullable | Boolean | NOT NULL, default: true | Nullable flag |
| description | String? | NULL, TEXT | Optional column description |
| order | Int | NOT NULL, default: 0 | Display order within table |
| createdAt | DateTime | NOT NULL, default: now() | Creation timestamp |
| updatedAt | DateTime | NOT NULL, auto-update | Last modification timestamp |

**Relationships**:

- `table`: Many-to-one to DiagramTable
- `sourceRelationships`: One-to-many to Relationship (as sourceColumn)
- `targetRelationships`: One-to-many to Relationship (as targetColumn)

**Validation Rules**:

- Name must be 1-255 characters
- Name must be unique within table
- dataType must be from allowed list (int, string, float, boolean, date, text, uuid, json)
- order must be >= 0

**Indexes**:

- `id` (primary)
- `tableId` (for table column queries)
- Composite `(tableId, name)` (unique constraint)
- `order` (for display ordering)

---

### 6. Relationship

**Purpose**: Represents a relationship (foreign key) between two tables, linking specific columns.

**Fields**:
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (UUID) | PRIMARY KEY | Unique identifier |
| whiteboardId | String (UUID) | NOT NULL, FOREIGN KEY | Parent whiteboard reference |
| sourceTableId | String (UUID) | NOT NULL, FOREIGN KEY | Source table reference |
| targetTableId | String (UUID) | NOT NULL, FOREIGN KEY | Target table reference |
| sourceColumnId | String (UUID) | NOT NULL, FOREIGN KEY | Source column reference |
| targetColumnId | String (UUID) | NOT NULL, FOREIGN KEY | Target column reference |
| cardinality | Enum | NOT NULL | Relationship cardinality (see below) |
| label | String? | NULL, max 255 chars | Optional relationship label |
| routingPoints | JSON? | NULL | Arrow routing waypoints (for manual adjustments) |
| createdAt | DateTime | NOT NULL, default: now() | Creation timestamp |
| updatedAt | DateTime | NOT NULL, auto-update | Last modification timestamp |

**Cardinality Enum**:

- `ONE_TO_ONE`
- `ONE_TO_MANY`
- `MANY_TO_ONE`
- `MANY_TO_MANY`

**routingPoints JSON Structure**:

```typescript
Array<{ x: number; y: number }> // Waypoints for arrow path
```

**Relationships**:

- `whiteboard`: Many-to-one to Whiteboard
- `sourceTable`: Many-to-one to DiagramTable
- `targetTable`: Many-to-one to DiagramTable
- `sourceColumn`: Many-to-one to Column
- `targetColumn`: Many-to-one to Column

**Validation Rules**:

- sourceColumn must belong to sourceTable
- targetColumn must belong to targetTable
- Cannot create relationship to same table (self-referential) - application-enforced
- label max 255 characters
- routingPoints must be valid JSON array

**Indexes**:

- `id` (primary)
- `whiteboardId` (for diagram relationship queries)
- `sourceTableId` (for outgoing relationships)
- `targetTableId` (for incoming relationships)
- Composite `(sourceColumnId, targetColumnId)` (unique constraint - one relationship per column pair)

---

### 7. CollaborationSession

**Purpose**: Tracks active users viewing/editing a whiteboard for real-time collaboration presence.

**Fields**:
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (UUID) | PRIMARY KEY | Unique identifier |
| whiteboardId | String (UUID) | NOT NULL, FOREIGN KEY | Whiteboard being edited |
| userId | String (UUID) | NOT NULL | User identifier (future: FOREIGN KEY to User) |
| socketId | String | NOT NULL | WebSocket connection ID |
| cursor | JSON? | NULL | User cursor position (for presence) |
| lastActivityAt | DateTime | NOT NULL, auto-update | Last activity timestamp |
| createdAt | DateTime | NOT NULL, default: now() | Session start timestamp |

**cursor JSON Structure**:

```typescript
{
  x: number,   // Cursor X position on canvas
  y: number    // Cursor Y position on canvas
}
```

**Relationships**:

- `whiteboard`: Many-to-one to Whiteboard
- (Future: `user`: Many-to-one to User)

**Validation Rules**:

- socketId must be unique
- lastActivityAt auto-updates on any user action
- Sessions expire after 5 minutes of inactivity (application-enforced)

**Indexes**:

- `id` (primary)
- `whiteboardId` (for querying active users)
- `socketId` (unique, for socket lookups)
- `lastActivityAt` (for cleanup of stale sessions)

---

## Prisma Schema

```prisma
// prisma/schema.prisma

model Project {
  id          String      @id @default(uuid())
  name        String      @db.VarChar(255)
  description String?     @db.Text
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  folders     Folder[]
  whiteboards Whiteboard[]

  @@index([createdAt])
}

model Folder {
  id             String   @id @default(uuid())
  name           String   @db.VarChar(255)
  projectId      String
  parentFolderId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  project       Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  parentFolder  Folder?      @relation("FolderHierarchy", fields: [parentFolderId], references: [id], onDelete: Cascade)
  childFolders  Folder[]     @relation("FolderHierarchy")
  whiteboards   Whiteboard[]

  @@index([projectId])
  @@index([parentFolderId])
}

model Whiteboard {
  id          String   @id @default(uuid())
  name        String   @db.VarChar(255)
  projectId   String
  folderId    String?
  canvasState Json?
  textSource  String?  @db.Text
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project  Project               @relation(fields: [projectId], references: [id], onDelete: Cascade)
  folder   Folder?               @relation(fields: [folderId], references: [id], onDelete: Cascade)
  tables   DiagramTable[]
  sessions CollaborationSession[]

  @@index([projectId])
  @@index([folderId])
  @@index([updatedAt])
}

model DiagramTable {
  id           String   @id @default(uuid())
  whiteboardId String
  name         String   @db.VarChar(255)
  description  String?  @db.Text
  positionX    Float
  positionY    Float
  width        Float?
  height       Float?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  whiteboard             Whiteboard     @relation(fields: [whiteboardId], references: [id], onDelete: Cascade)
  columns                Column[]
  outgoingRelationships  Relationship[] @relation("SourceTable")
  incomingRelationships  Relationship[] @relation("TargetTable")

  @@unique([whiteboardId, name])
  @@index([whiteboardId])
}

model Column {
  id              String   @id @default(uuid())
  tableId         String
  name            String   @db.VarChar(255)
  dataType        String   @db.VarChar(50)
  isPrimaryKey    Boolean  @default(false)
  isForeignKey    Boolean  @default(false)
  isUnique        Boolean  @default(false)
  isNullable      Boolean  @default(true)
  description     String?  @db.Text
  order           Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  table               DiagramTable   @relation(fields: [tableId], references: [id], onDelete: Cascade)
  sourceRelationships Relationship[] @relation("SourceColumn")
  targetRelationships Relationship[] @relation("TargetColumn")

  @@unique([tableId, name])
  @@index([tableId])
  @@index([order])
}

enum Cardinality {
  ONE_TO_ONE
  ONE_TO_MANY
  MANY_TO_ONE
  MANY_TO_MANY
}

model Relationship {
  id             String      @id @default(uuid())
  whiteboardId   String
  sourceTableId  String
  targetTableId  String
  sourceColumnId String
  targetColumnId String
  cardinality    Cardinality
  label          String?     @db.VarChar(255)
  routingPoints  Json?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  whiteboard   Whiteboard   @relation(fields: [whiteboardId], references: [id], onDelete: Cascade)
  sourceTable  DiagramTable @relation("SourceTable", fields: [sourceTableId], references: [id], onDelete: Cascade)
  targetTable  DiagramTable @relation("TargetTable", fields: [targetTableId], references: [id], onDelete: Cascade)
  sourceColumn Column       @relation("SourceColumn", fields: [sourceColumnId], references: [id], onDelete: Cascade)
  targetColumn Column       @relation("TargetColumn", fields: [targetColumnId], references: [id], onDelete: Cascade)

  @@unique([sourceColumnId, targetColumnId])
  @@index([whiteboardId])
  @@index([sourceTableId])
  @@index([targetTableId])
}

model CollaborationSession {
  id             String   @id @default(uuid())
  whiteboardId   String
  userId         String   // Future: @db.Uuid reference to User table
  socketId       String   @unique
  cursor         Json?
  lastActivityAt DateTime @updatedAt
  createdAt      DateTime @default(now())

  whiteboard Whiteboard @relation(fields: [whiteboardId], references: [id], onDelete: Cascade)

  @@index([whiteboardId])
  @@index([lastActivityAt])
}
```

---

## Zod Validation Schemas

```typescript
// src/data/schema.ts

import { z } from 'zod'

// Canvas state schema
export const canvasStateSchema = z.object({
  zoom: z.number().min(0.1).max(5),
  offsetX: z.number().finite(),
  offsetY: z.number().finite(),
})

// Routing points schema
export const routingPointsSchema = z.array(
  z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
)

// Cursor position schema
export const cursorSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})

// Cardinality enum
export const cardinalitySchema = z.enum([
  'ONE_TO_ONE',
  'ONE_TO_MANY',
  'MANY_TO_ONE',
  'MANY_TO_MANY',
])

// Project schemas
export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
})

export const updateProjectSchema = createProjectSchema.partial()

// Folder schemas
export const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  projectId: z.string().uuid(),
  parentFolderId: z.string().uuid().optional(),
})

export const updateFolderSchema = createFolderSchema
  .pick({ name: true })
  .partial()

// Whiteboard schemas
export const createWhiteboardSchema = z.object({
  name: z.string().min(1).max(255),
  projectId: z.string().uuid(),
  folderId: z.string().uuid().optional(),
  canvasState: canvasStateSchema.optional(),
  textSource: z.string().optional(),
})

export const updateWhiteboardSchema = createWhiteboardSchema.partial()

// DiagramTable schemas
export const createTableSchema = z.object({
  whiteboardId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
})

export const updateTableSchema = createTableSchema
  .omit({ whiteboardId: true })
  .partial()

// Column schemas
export const dataTypeSchema = z.enum([
  'int',
  'string',
  'float',
  'boolean',
  'date',
  'text',
  'uuid',
  'json',
])

export const createColumnSchema = z.object({
  tableId: z.string().uuid(),
  name: z.string().min(1).max(255),
  dataType: dataTypeSchema,
  isPrimaryKey: z.boolean().default(false),
  isForeignKey: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  isNullable: z.boolean().default(true),
  description: z.string().optional(),
  order: z.number().int().min(0).default(0),
})

export const updateColumnSchema = createColumnSchema
  .omit({ tableId: true })
  .partial()

// Relationship schemas
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

export const updateRelationshipSchema = createRelationshipSchema
  .omit({ whiteboardId: true })
  .partial()

// Collaboration session schemas
export const createSessionSchema = z.object({
  whiteboardId: z.string().uuid(),
  userId: z.string().uuid(),
  socketId: z.string(),
  cursor: cursorSchema.optional(),
})

export const updateSessionSchema = z.object({
  cursor: cursorSchema.optional(),
})
```

---

## State Transitions

### Whiteboard Lifecycle

```
[Created] → [Editing] → [Saved]
           ↓          ↑
         [Collaborating] (multiple users)
           ↓
         [Archived] (soft delete - future)
```

### Collaboration Session Lifecycle

```
[User Connects] → [Active] → [User Disconnects]
                    ↓
                  [Idle] (5 min timeout)
                    ↓
                  [Cleanup]
```

---

## Migration Strategy

1. **Initial Migration**: Create all tables with indexes
2. **Seed Data**: Add sample project/whiteboard for testing
3. **Foreign Key Constraints**: Set up cascading deletes
4. **Indexes**: Add performance indexes for common queries

**Cascade Delete Behavior**:

- Delete Project → cascades to Folders, Whiteboards
- Delete Folder → cascades to child Folders, Whiteboards
- Delete Whiteboard → cascades to DiagramTables, Relationships, CollaborationSessions
- Delete DiagramTable → cascades to Columns, Relationships
- Delete Column → cascades to Relationships (if referenced)

---

## Data Access Patterns

### Common Queries

1. **Load Whiteboard with Full Diagram**:

   ```typescript
   await prisma.whiteboard.findUnique({
     where: { id },
     include: {
       tables: {
         include: {
           columns: { orderBy: { order: 'asc' } },
           outgoingRelationships: true,
         },
       },
     },
   })
   ```

2. **Get Project Tree (Projects → Folders → Whiteboards)**:

   ```typescript
   await prisma.project.findMany({
     include: {
       folders: {
         include: {
           childFolders: true,
           whiteboards: { select: { id: true, name: true } },
         },
       },
       whiteboards: { select: { id: true, name: true } },
     },
   })
   ```

3. **Find Active Collaborators**:
   ```typescript
   await prisma.collaborationSession.findMany({
     where: {
       whiteboardId,
       lastActivityAt: { gte: fiveMinutesAgo },
     },
   })
   ```

---

## Conclusion

Data model complete. Supports all functional requirements from spec, including hierarchical organization, ER diagram representation, and real-time collaboration tracking.
