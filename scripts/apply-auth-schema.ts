import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Applying auth schema changes...')

  // Check if User table already exists
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'User'
  `

  if ((tables as Array<{ tablename: string }>).length > 0) {
    console.log('User table already exists, skipping creation')
    return
  }

  // Create ProjectRole enum
  await prisma.$executeRaw`CREATE TYPE "ProjectRole" AS ENUM ('VIEWER', 'EDITOR', 'ADMIN')`
  console.log('Created ProjectRole enum')

  // Create User table
  await prisma.$executeRaw`
    CREATE TABLE "User" (
      "id" UUID NOT NULL DEFAULT gen_random_uuid(),
      "username" VARCHAR(50) NOT NULL,
      "email" VARCHAR(255) NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
      "lockedUntil" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "User_pkey" PRIMARY KEY ("id")
    )
  `
  console.log('Created User table')

  await prisma.$executeRaw`CREATE UNIQUE INDEX "User_username_key" ON "User"("username")`
  await prisma.$executeRaw`CREATE UNIQUE INDEX "User_email_key" ON "User"("email")`
  await prisma.$executeRaw`CREATE INDEX "User_email_idx" ON "User"("email")`

  // Create Session table
  await prisma.$executeRaw`
    CREATE TABLE "Session" (
      "id" UUID NOT NULL DEFAULT gen_random_uuid(),
      "tokenHash" VARCHAR(64) NOT NULL,
      "userId" UUID NOT NULL,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
    )
  `
  await prisma.$executeRaw`CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash")`
  await prisma.$executeRaw`CREATE INDEX "Session_userId_idx" ON "Session"("userId")`
  await prisma.$executeRaw`ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE`
  console.log('Created Session table')

  // Add ownerId to Project
  await prisma.$executeRaw`ALTER TABLE "Project" ADD COLUMN "ownerId" UUID`
  await prisma.$executeRaw`CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId")`
  await prisma.$executeRaw`ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL`
  console.log('Added ownerId to Project')

  // Create ProjectMember table
  await prisma.$executeRaw`
    CREATE TABLE "ProjectMember" (
      "id" UUID NOT NULL DEFAULT gen_random_uuid(),
      "projectId" UUID NOT NULL,
      "userId" UUID NOT NULL,
      "role" "ProjectRole" NOT NULL DEFAULT 'VIEWER',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
    )
  `
  await prisma.$executeRaw`CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId")`
  await prisma.$executeRaw`ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE`
  await prisma.$executeRaw`ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE`
  console.log('Created ProjectMember table')

  // Update CollaborationSession to add userId FK
  await prisma.$executeRaw`DELETE FROM "CollaborationSession"`
  console.log('Cleared CollaborationSession rows')
  await prisma.$executeRaw`ALTER TABLE "CollaborationSession" ADD COLUMN "userId" UUID NOT NULL DEFAULT gen_random_uuid()`
  await prisma.$executeRaw`ALTER TABLE "CollaborationSession" ALTER COLUMN "userId" DROP DEFAULT`
  await prisma.$executeRaw`CREATE INDEX "CollaborationSession_userId_idx" ON "CollaborationSession"("userId")`
  await prisma.$executeRaw`ALTER TABLE "CollaborationSession" ADD CONSTRAINT "CollaborationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE`
  console.log('Updated CollaborationSession with userId FK')

  console.log('All schema changes applied successfully!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
