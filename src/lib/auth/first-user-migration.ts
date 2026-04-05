// src/lib/auth/first-user-migration.ts
// Assigns all ownerless projects to the first registered user.

import { prisma } from '@/db'

/**
 * Assigns all existing ownerless Projects to the given user.
 * Called inside the registration transaction when the user count was 0.
 * Idempotent: only updates Projects where ownerId IS NULL.
 *
 * @param userId - The newly registered user's UUID
 */
export async function migrateDataToFirstUser(userId: string): Promise<void> {
  await prisma.project.updateMany({
    where: { ownerId: null },
    data: { ownerId: userId },
  })
}
