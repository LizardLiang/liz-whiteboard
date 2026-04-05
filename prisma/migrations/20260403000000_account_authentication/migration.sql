-- Migration: account_authentication
-- Adds User, Session, ProjectMember models, ProjectRole enum.
-- Modifies Project (adds ownerId nullable FK) and CollaborationSession (adds userId FK to User).
--
-- NOTE: This project uses Prisma Accelerate (prisma+postgres:// connection URL)
-- which does not support `prisma migrate dev`. Schema changes are applied via `prisma db push`.
-- This file documents the equivalent DDL for audit and history purposes.
--
-- Migration strategy (executed in this order):
-- 1. Create ProjectRole enum
-- 2. Create User table
-- 3. Create Session table
-- 4. Create ProjectMember table
-- 5. Add ownerId nullable FK to Project
-- 6. Delete all CollaborationSession rows (ephemeral data, safe to drop)
-- 7. Add userId FK on CollaborationSession (now non-nullable, referencing User)

-- Step 1: Create ProjectRole enum
CREATE TYPE "ProjectRole" AS ENUM ('VIEWER', 'EDITOR', 'ADMIN');

-- Step 2: Create User table
CREATE TABLE "User" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "username" VARCHAR(50) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");

-- Step 3: Create Session table
CREATE TABLE "Session" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tokenHash" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 4: Create ProjectMember table
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 5: Add ownerId nullable FK to Project
ALTER TABLE "Project" ADD COLUMN "ownerId" TEXT;
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 6: Delete all CollaborationSession rows (ephemeral data)
DELETE FROM "CollaborationSession";

-- Step 7: Add userId FK on CollaborationSession (non-nullable after row deletion)
ALTER TABLE "CollaborationSession" ADD COLUMN "userId" TEXT NOT NULL;
CREATE INDEX "CollaborationSession_userId_idx" ON "CollaborationSession"("userId");

ALTER TABLE "CollaborationSession" ADD CONSTRAINT "CollaborationSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
