// src/data/schema-sql.ts
// Canonical SQLite schema (replaces prisma/schema.prisma + `prisma db push`).
//
// Reproduces the exact DDL Prisma generated for the SQLite datasource so an
// existing prisma-created dev.db keeps working unchanged. `IF NOT EXISTS` makes
// running this idempotent on every startup (see src/db.ts) and lets a fresh
// container build its database from scratch.
//
// Storage formats (matched by the row-mappers in src/db.ts):
//   - BOOLEAN  -> 0/1 INTEGER
//   - DATETIME -> unix-ms INTEGER
//   - JSONB    -> TEXT containing JSON

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT,
    CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Folder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folder_parentFolderId_fkey" FOREIGN KEY ("parentFolderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Whiteboard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "folderId" TEXT,
    "canvasState" JSONB,
    "textSource" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Whiteboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Whiteboard_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "DiagramTable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "whiteboardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "positionX" REAL,
    "positionY" REAL,
    "width" REAL,
    "height" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiagramTable_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Column" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "isPrimaryKey" BOOLEAN NOT NULL DEFAULT false,
    "isForeignKey" BOOLEAN NOT NULL DEFAULT false,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "isNullable" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Column_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiagramTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Relationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "whiteboardId" TEXT NOT NULL,
    "sourceTableId" TEXT NOT NULL,
    "targetTableId" TEXT NOT NULL,
    "sourceColumnId" TEXT NOT NULL,
    "targetColumnId" TEXT NOT NULL,
    "cardinality" TEXT NOT NULL,
    "label" TEXT,
    "routingPoints" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Relationship_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Relationship_sourceTableId_fkey" FOREIGN KEY ("sourceTableId") REFERENCES "DiagramTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Relationship_targetTableId_fkey" FOREIGN KEY ("targetTableId") REFERENCES "DiagramTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Relationship_sourceColumnId_fkey" FOREIGN KEY ("sourceColumnId") REFERENCES "Column" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Relationship_targetColumnId_fkey" FOREIGN KEY ("targetColumnId") REFERENCES "Column" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CollaborationSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "whiteboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "socketId" TEXT NOT NULL,
    "cursor" JSONB,
    "lastActivityAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollaborationSession_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollaborationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX IF NOT EXISTS "Project_createdAt_idx" ON "Project"("createdAt");
CREATE INDEX IF NOT EXISTS "Project_ownerId_idx" ON "Project"("ownerId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");
CREATE INDEX IF NOT EXISTS "ProjectMember_userId_idx" ON "ProjectMember"("userId");
CREATE INDEX IF NOT EXISTS "Folder_projectId_idx" ON "Folder"("projectId");
CREATE INDEX IF NOT EXISTS "Folder_parentFolderId_idx" ON "Folder"("parentFolderId");
CREATE INDEX IF NOT EXISTS "Whiteboard_projectId_idx" ON "Whiteboard"("projectId");
CREATE INDEX IF NOT EXISTS "Whiteboard_folderId_idx" ON "Whiteboard"("folderId");
CREATE INDEX IF NOT EXISTS "Whiteboard_updatedAt_idx" ON "Whiteboard"("updatedAt");
CREATE INDEX IF NOT EXISTS "DiagramTable_whiteboardId_idx" ON "DiagramTable"("whiteboardId");
CREATE UNIQUE INDEX IF NOT EXISTS "DiagramTable_whiteboardId_name_key" ON "DiagramTable"("whiteboardId", "name");
CREATE INDEX IF NOT EXISTS "Column_tableId_idx" ON "Column"("tableId");
CREATE INDEX IF NOT EXISTS "Column_order_idx" ON "Column"("order");
CREATE UNIQUE INDEX IF NOT EXISTS "Column_tableId_name_key" ON "Column"("tableId", "name");
CREATE INDEX IF NOT EXISTS "Relationship_whiteboardId_idx" ON "Relationship"("whiteboardId");
CREATE INDEX IF NOT EXISTS "Relationship_sourceTableId_idx" ON "Relationship"("sourceTableId");
CREATE INDEX IF NOT EXISTS "Relationship_targetTableId_idx" ON "Relationship"("targetTableId");
CREATE UNIQUE INDEX IF NOT EXISTS "Relationship_sourceColumnId_targetColumnId_key" ON "Relationship"("sourceColumnId", "targetColumnId");
CREATE INDEX IF NOT EXISTS "CollaborationSession_whiteboardId_idx" ON "CollaborationSession"("whiteboardId");
CREATE INDEX IF NOT EXISTS "CollaborationSession_userId_idx" ON "CollaborationSession"("userId");
CREATE INDEX IF NOT EXISTS "CollaborationSession_socketId_key" ON "CollaborationSession"("socketId");
CREATE UNIQUE INDEX IF NOT EXISTS "CollaborationSession_socketId_unique" ON "CollaborationSession"("socketId");
CREATE INDEX IF NOT EXISTS "CollaborationSession_lastActivityAt_idx" ON "CollaborationSession"("lastActivityAt");

CREATE TABLE IF NOT EXISTS "OauthRefreshToken" (
    "tokenHash"  TEXT    NOT NULL PRIMARY KEY,
    "familyId"   TEXT    NOT NULL,
    "userId"     TEXT    NOT NULL,
    "clientId"   TEXT    NOT NULL,
    "scope"      TEXT    NOT NULL,
    "resource"   TEXT    NOT NULL,
    "rotated"    INTEGER NOT NULL DEFAULT 0,
    -- Set the moment the rotated flag flips to 1. Nullable: live (rotated=0)
    -- rows never have this set. Drives the idempotent-replay grace window in
    -- rotateRefreshToken() (oauth-refresh-rotation-race) - see src/lib/oauth/tokens.ts.
    "rotatedAt"  INTEGER,
    "expiresAt"  INTEGER NOT NULL,
    "createdAt"  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS "OauthRefreshToken_familyId_idx"  ON "OauthRefreshToken"("familyId");
CREATE INDEX IF NOT EXISTS "OauthRefreshToken_userId_idx"    ON "OauthRefreshToken"("userId");
CREATE INDEX IF NOT EXISTS "OauthRefreshToken_expiresAt_idx" ON "OauthRefreshToken"("expiresAt");

CREATE TABLE IF NOT EXISTS "OauthClient" (
    "clientId"                 TEXT    NOT NULL PRIMARY KEY,
    "redirectUris"             TEXT    NOT NULL,           -- JSON array
    "clientName"               TEXT,
    "grantTypes"               TEXT    NOT NULL,           -- JSON array
    "responseTypes"            TEXT    NOT NULL,           -- JSON array
    "scope"                    TEXT,
    "tokenEndpointAuthMethod"  TEXT    NOT NULL DEFAULT 'none',
    "softwareId"               TEXT,
    "trusted"                  INTEGER NOT NULL DEFAULT 0,     -- DCR rows are always untrusted; see clients.ts registerClient
    "lastAuthorizedAt"         INTEGER,                    -- null until first /authorize (orphan GC)
    "createdAt"                INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);
CREATE INDEX IF NOT EXISTS "OauthClient_createdAt_idx"        ON "OauthClient"("createdAt");
CREATE INDEX IF NOT EXISTS "OauthClient_lastAuthorizedAt_idx" ON "OauthClient"("lastAuthorizedAt");

-- Persisted per-user consent grants for untrusted (DCR-registered) OAuth
-- clients (mcp-oauth-dcr-consent). A row here means the user approved this
-- client for the given scope on the consent screen (src/routes/oauth/consent.tsx)
-- — /authorize skips re-prompting while the requested scope is covered by
-- "scope" below (src/lib/oauth/grants.ts). Revoking (src/routes/settings/connections.tsx)
-- deletes this row AND the matching OauthRefreshToken rows so access stops at
-- the next refresh. Trusted/first-party and CIMD clients never get a row here
-- — they auto-approve and never reach the consent branch.
CREATE TABLE IF NOT EXISTS "OauthGrant" (
    "userId"     TEXT    NOT NULL,
    -- Grant key: a CIMD document ORIGIN, or a static/DCR client id verbatim.
    -- See src/lib/oauth/grants.ts (grantKeyFor).
    "clientId"   TEXT    NOT NULL,
    "scope"      TEXT    NOT NULL,
    "grantedAt"  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    -- Display name captured at consent time so /settings/connections renders
    -- without any outbound request. Nullable: rows written before
    -- mcp-oauth-open-cimd have none. Existing databases get this column via
    -- the additive migration in src/db.ts.
    "clientName" TEXT,
    PRIMARY KEY ("userId", "clientId")
);
CREATE INDEX IF NOT EXISTS "OauthGrant_userId_idx" ON "OauthGrant"("userId");

CREATE TABLE IF NOT EXISTS "ProjectInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" INTEGER NOT NULL,
    "revokedAt" INTEGER,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    CONSTRAINT "ProjectInvite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectInvite_tokenHash_key" ON "ProjectInvite"("tokenHash");
CREATE INDEX IF NOT EXISTS "ProjectInvite_projectId_idx" ON "ProjectInvite"("projectId");
CREATE INDEX IF NOT EXISTS "ProjectInvite_expiresAt_idx" ON "ProjectInvite"("expiresAt");

CREATE TABLE IF NOT EXISTS "WhiteboardShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "whiteboardId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" INTEGER,
    "revokedAt" INTEGER,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    CONSTRAINT "WhiteboardShareLink_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhiteboardShareLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhiteboardShareLink_tokenHash_key" ON "WhiteboardShareLink"("tokenHash");
CREATE INDEX IF NOT EXISTS "WhiteboardShareLink_whiteboardId_idx" ON "WhiteboardShareLink"("whiteboardId");
CREATE INDEX IF NOT EXISTS "WhiteboardShareLink_expiresAt_idx" ON "WhiteboardShareLink"("expiresAt");

CREATE TABLE IF NOT EXISTS "Area" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "whiteboardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "positionX" REAL NOT NULL,
    "positionY" REAL NOT NULL,
    "width" REAL NOT NULL,
    "height" REAL NOT NULL,
    "memberTableIds" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Area_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Area_whiteboardId_idx" ON "Area"("whiteboardId");

-- Shapes and Connectors (Phase 1: shapes-and-connectors feature). Five shape
-- kinds are stored as one polymorphic row: generic geometry in real columns,
-- kind-specific data in a validated JSON "props" blob, styling in "style".
-- Future kinds (ink, image) are new "kind" values, never new columns.
CREATE TABLE IF NOT EXISTS "Shape" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "whiteboardId" TEXT NOT NULL,
    "kind"         TEXT NOT NULL,
    "positionX"    REAL NOT NULL,
    "positionY"    REAL NOT NULL,
    "width"        REAL NOT NULL,
    "height"       REAL NOT NULL,
    "rotation"     REAL NOT NULL DEFAULT 0,
    "zIndex"       INTEGER NOT NULL DEFAULT 0,
    "text"         TEXT,
    "style"        JSONB,
    "props"        JSONB,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL,
    CONSTRAINT "Shape_whiteboardId_fkey" FOREIGN KEY ("whiteboardId")
        REFERENCES "Whiteboard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Shape_whiteboardId_idx" ON "Shape"("whiteboardId");

-- Connectors are their own table with dedicated indexed endpoint COLUMNS
-- (FR-031) — never inside a JSON blob. No stored path: geometry is derived
-- at render time from both endpoints' bounds (FR-031a).
CREATE TABLE IF NOT EXISTS "Connector" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "whiteboardId"  TEXT NOT NULL,
    "sourceShapeId" TEXT NOT NULL,
    "targetShapeId" TEXT NOT NULL,
    "style"         JSONB,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     DATETIME NOT NULL,
    CONSTRAINT "Connector_whiteboardId_fkey" FOREIGN KEY ("whiteboardId")
        REFERENCES "Whiteboard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Connector_sourceShapeId_fkey" FOREIGN KEY ("sourceShapeId")
        REFERENCES "Shape" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Connector_targetShapeId_fkey" FOREIGN KEY ("targetShapeId")
        REFERENCES "Shape" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Connector_whiteboardId_idx"  ON "Connector"("whiteboardId");
CREATE INDEX IF NOT EXISTS "Connector_sourceShapeId_idx" ON "Connector"("sourceShapeId");
CREATE INDEX IF NOT EXISTS "Connector_targetShapeId_idx" ON "Connector"("targetShapeId");
-- A second A->B connector would render exactly on top of the first
-- (invisible, unselectable); B->A remains allowed (a different, meaningful
-- arrow). Documented assumption, not a locked user decision — dropping this
-- index later is a one-line change with no data impact.
CREATE UNIQUE INDEX IF NOT EXISTS "Connector_source_target_key"
    ON "Connector"("sourceShapeId", "targetShapeId");

CREATE TABLE IF NOT EXISTS "WhiteboardSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "whiteboardId" TEXT NOT NULL,
    "label" TEXT,
    "payload" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "isAuto" INTEGER NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    CONSTRAINT "WhiteboardSnapshot_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhiteboardSnapshot_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "WhiteboardSnapshot_whiteboardId_idx" ON "WhiteboardSnapshot"("whiteboardId");
CREATE INDEX IF NOT EXISTS "WhiteboardSnapshot_whiteboardId_createdAt_idx" ON "WhiteboardSnapshot"("whiteboardId", "createdAt");

CREATE TABLE IF NOT EXISTS "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "whiteboardId" TEXT NOT NULL,
    "parentId" TEXT,                 -- NULL = root/thread anchor; set = reply
    "targetType" TEXT NOT NULL,      -- 'table' | 'point' (root only; replies copy 'thread')
    "targetTableId" TEXT,            -- set when targetType='table'
    "positionX" REAL,                -- flow coords; set when targetType='point'
    "positionY" REAL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolved" INTEGER NOT NULL DEFAULT 0,   -- root only
    "resolvedBy" TEXT,
    "resolvedAt" INTEGER,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    "updatedAt" INTEGER NOT NULL,
    CONSTRAINT "Comment_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_parentId_fkey"     FOREIGN KEY ("parentId")     REFERENCES "Comment"("id")    ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_targetTableId_fkey" FOREIGN KEY ("targetTableId") REFERENCES "DiagramTable"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Comment_whiteboardId_idx"  ON "Comment"("whiteboardId");
CREATE INDEX IF NOT EXISTS "Comment_parentId_idx"      ON "Comment"("parentId");
CREATE INDEX IF NOT EXISTS "Comment_targetTableId_idx" ON "Comment"("targetTableId");

-- ── Canvas engine (FigJam-style, milestone 1) ───────────────────────────────
-- A canvas board is a DELIBERATELY separate board kind from "Whiteboard".
-- The canvas engine (src/lib/canvas-engine/) draws every pixel itself and
-- stores its own generic elements, so it shares no rows with the ER diagram
-- and touches neither "Shape" nor "Connector". "folderId" mirrors
-- "Whiteboard" so the existing navigator can list and create canvas boards
-- later without a schema change.
CREATE TABLE IF NOT EXISTS "CanvasBoard" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "name"      TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "folderId"  TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CanvasBoard_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CanvasBoard_folderId_fkey" FOREIGN KEY ("folderId")
        REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CanvasBoard_projectId_idx" ON "CanvasBoard"("projectId");
CREATE INDEX IF NOT EXISTS "CanvasBoard_folderId_idx"  ON "CanvasBoard"("folderId");
CREATE INDEX IF NOT EXISTS "CanvasBoard_updatedAt_idx" ON "CanvasBoard"("updatedAt");

-- One generic element row for every canvas element kind: geometry in real
-- columns, kind-specific data in a validated JSON "props" blob, appearance in
-- "style". Same polymorphic storage decision as "Shape" — a new kind
-- (ellipse, ink, image) is a new "kind" value plus one Zod union arm, never
-- a new column and never a migration.
--
-- Coordinates are named positionX/positionY to match every other table in
-- this schema. The engine's own element type calls them x/y; the row-mapper
-- in src/db.ts is the ONE place those two vocabularies meet.
CREATE TABLE IF NOT EXISTS "CanvasElement" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "boardId"   TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "positionX" REAL NOT NULL,
    "positionY" REAL NOT NULL,
    "width"     REAL NOT NULL,
    "height"    REAL NOT NULL,
    "rotation"  REAL NOT NULL DEFAULT 0,
    "zIndex"    INTEGER NOT NULL DEFAULT 0,
    "text"      TEXT,
    "style"     JSONB,
    "props"     JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    -- Monotonic write counter (board-undo tactical plan, Wave 1). A wall-clock
    -- timestamp cannot tell two writes in the same millisecond apart, which
    -- would make a contested undo read as uncontested — see
    -- .claude/feature/2026-08-25-board-undo/spec-delta/canvas-undo.md,
    -- "Canvas Element Writes Carry A Monotonic Revision".
    "revision"  INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CanvasElement_boardId_fkey" FOREIGN KEY ("boardId")
        REFERENCES "CanvasBoard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CanvasElement_boardId_idx" ON "CanvasElement"("boardId");
-- Elements are always read back in paint order, so the board+z pair is the
-- index the list query actually uses.
CREATE INDEX IF NOT EXISTS "CanvasElement_boardId_zIndex_idx" ON "CanvasElement"("boardId", "zIndex");

-- Public read-only share links for canvas boards.
--
-- A SEPARATE table from "WhiteboardShareLink" rather than a generalisation of
-- it. That table's foreign key points at "Whiteboard"("id"), and a canvas
-- board id is not a whiteboard id -- widening it would mean either dropping
-- the foreign key (losing the cascade that stops links outliving their board)
-- or a nullable-pair column design where exactly one of two ids must be set,
-- which SQLite cannot express as a constraint worth trusting. The column
-- shape is otherwise identical on purpose, so the two data layers read the
-- same way side by side.
--
-- Only the SHA-256 hash of the token is ever stored; the raw token exists
-- once, in the create response.
CREATE TABLE IF NOT EXISTS "CanvasBoardShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canvasBoardId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" INTEGER,
    "revokedAt" INTEGER,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    CONSTRAINT "CanvasBoardShareLink_canvasBoardId_fkey" FOREIGN KEY ("canvasBoardId")
        REFERENCES "CanvasBoard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CanvasBoardShareLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId")
        REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CanvasBoardShareLink_tokenHash_key" ON "CanvasBoardShareLink"("tokenHash");
CREATE INDEX IF NOT EXISTS "CanvasBoardShareLink_canvasBoardId_idx" ON "CanvasBoardShareLink"("canvasBoardId");
CREATE INDEX IF NOT EXISTS "CanvasBoardShareLink_expiresAt_idx" ON "CanvasBoardShareLink"("expiresAt");
`
