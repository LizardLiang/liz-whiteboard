// src/data/user.ts
// Data access layer for User entity

import type { User } from '@prisma/client'
import { prisma } from '@/db'

/**
 * Create a new user
 * @param data - User creation data
 * @returns Created user
 */
export async function createUser(data: {
  username: string
  email: string
  passwordHash: string
}): Promise<User> {
  const user = await prisma.user.create({
    data,
  })
  return user
}

/**
 * Find a user by email address
 * @param email - Email address
 * @returns User or null if not found
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { email },
  })
  return user
}

/**
 * Find a user by username
 * @param username - Username
 * @returns User or null if not found
 */
export async function findUserByUsername(
  username: string,
): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { username },
  })
  return user
}

/**
 * Find a user by ID
 * @param id - User UUID
 * @returns User or null if not found
 */
export async function findUserById(id: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { id },
  })
  return user
}

/**
 * Count the total number of users
 * @returns Total user count
 */
export async function countUsers(): Promise<number> {
  return prisma.user.count()
}
