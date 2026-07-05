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
    "expiresAt"  INTEGER NOT NULL,
    "createdAt"  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS "OauthRefreshToken_familyId_idx"  ON "OauthRefreshToken"("familyId");
CREATE INDEX IF NOT EXISTS "OauthRefreshToken_userId_idx"    ON "OauthRefreshToken"("userId");
CREATE INDEX IF NOT EXISTS "OauthRefreshToken_expiresAt_idx" ON "OauthRefreshToken"("expiresAt");

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
`
