// src/data/column-batch.ts
// The write step of createColumnsFn: one request writes columns for one
// whiteboard, in one transaction.

import { ZodError } from 'zod'
import { createColumns } from './column'
import { getTableWhiteboardId } from './resolve-project'
import type { CreateColumnInput } from './schema'
import type { Column } from './models'
import type { ClientBatch } from '@/lib/schema-changelog/client-batch'
import { userContext, withClientBatch } from '@/lib/schema-changelog'

export const CROSS_BOARD_MESSAGE =
  'All columns in one request must belong to tables on the same whiteboard'

/**
 * Create the columns of `input` for `userId`. Every table must sit on one
 * whiteboard: a request that spans boards is refused before any write, so it
 * cannot commit in part. The caller checked the user's role on each table.
 */
export async function createColumnsOnOneBoard(
  userId: string,
  input: ClientBatch & { columns: Array<CreateColumnInput> },
): Promise<Array<Column>> {
  const boards = new Set<string>()
  for (const tableId of new Set(input.columns.map((c) => c.tableId))) {
    const whiteboardId = await getTableWhiteboardId(tableId)
    if (!whiteboardId) throw new Error('Table not found')
    boards.add(whiteboardId)
  }
  if (boards.size > 1) {
    throw new ZodError([
      { code: 'custom', path: ['columns'], message: CROSS_BOARD_MESSAGE },
    ])
  }
  const [whiteboardId] = boards
  const { rest, ctx } = withClientBatch(
    userContext(whiteboardId, userId),
    input,
  )
  return createColumns(rest.columns, ctx)
}
