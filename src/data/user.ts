// src/data/user.ts
// Data access layer for User entity

import type { User } from '@/data/models'
import { db, genId, insert, mapUser, nowMs } from '@/db'

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
  const id = genId()
  const ts = nowMs()
  insert('User', {
    id,
    username: data.username,
    email: data.email,
    passwordHash: data.passwordHash,
    createdAt: ts,
    updatedAt: ts,
  })
  return mapUser(db.prepare('SELECT * FROM "User" WHERE "id" = ?').get(id))!
}

/**
 * Find a user by email address
 * @param email - Email address
 * @returns User or null if not found
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  return mapUser(
    db.prepare('SELECT * FROM "User" WHERE "email" = ?').get(email),
  )
}

/**
 * Find a user by username
 * @param username - Username
 * @returns User or null if not found
 */
export async function findUserByUsername(
  username: string,
): Promise<User | null> {
  return mapUser(
    db.prepare('SELECT * FROM "User" WHERE "username" = ?').get(username),
  )
}

/**
 * Find a user by ID
 * @param id - User UUID
 * @returns User or null if not found
 */
export async function findUserById(id: string): Promise<User | null> {
  return mapUser(db.prepare('SELECT * FROM "User" WHERE "id" = ?').get(id))
}

/**
 * Count the total number of users
 * @returns Total user count
 */
export async function countUsers(): Promise<number> {
  const row = db.prepare('SELECT count(*) AS c FROM "User"').get()
  return Number(row!.c)
}
