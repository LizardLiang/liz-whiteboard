// src/data/resolve-project.ts
// Shared helpers to resolve projectId from child resources.
// Used by server function files for permission checks.

import { db } from '@/db'

/**
 * Resolve projectId for a whiteboard by ID.
 * Returns null if the whiteboard does not exist.
 */
export async function getWhiteboardProjectId(
  whiteboardId: string,
): Promise<string | null> {
  const wb = db
    .prepare('SELECT "projectId" FROM "Whiteboard" WHERE "id" = ?')
    .get(whiteboardId)
  return (wb?.projectId as string | undefined) ?? null
}

/**
 * Resolve projectId for a folder by ID.
 * Returns null if the folder does not exist.
 */
export async function getFolderProjectId(
  folderId: string,
): Promise<string | null> {
  const folder = db
    .prepare('SELECT "projectId" FROM "Folder" WHERE "id" = ?')
    .get(folderId)
  return (folder?.projectId as string | undefined) ?? null
}

/**
 * Resolve projectId for a table by table ID (via its whiteboard).
 * Returns null if the table does not exist.
 */
export async function getTableProjectId(
  tableId: string,
): Promise<string | null> {
  const row = db
    .prepare(
      `SELECT w."projectId" AS "projectId"
       FROM "DiagramTable" t
       INNER JOIN "Whiteboard" w ON w."id" = t."whiteboardId"
       WHERE t."id" = ?`,
    )
    .get(tableId)
  return (row?.projectId as string | undefined) ?? null
}

/**
 * Resolve projectId for a column by column ID (via its table's whiteboard).
 * Returns null if the column does not exist.
 */
export async function getColumnProjectId(
  columnId: string,
): Promise<string | null> {
  const row = db
    .prepare(
      `SELECT w."projectId" AS "projectId"
       FROM "Column" c
       INNER JOIN "DiagramTable" t ON t."id" = c."tableId"
       INNER JOIN "Whiteboard" w ON w."id" = t."whiteboardId"
       WHERE c."id" = ?`,
    )
    .get(columnId)
  return (row?.projectId as string | undefined) ?? null
}

/**
 * Resolve projectId for a relationship by relationship ID (via its whiteboard).
 * Returns null if the relationship does not exist.
 */
export async function getRelationshipProjectId(
  relationshipId: string,
): Promise<string | null> {
  const row = db
    .prepare(
      `SELECT w."projectId" AS "projectId"
       FROM "Relationship" r
       INNER JOIN "Whiteboard" w ON w."id" = r."whiteboardId"
       WHERE r."id" = ?`,
    )
    .get(relationshipId)
  return (row?.projectId as string | undefined) ?? null
}
