// src/hooks/use-sql-import.ts
//
// SQL DDL import persistence orchestration — the client-side glue between a
// parsed DiagramAST (from src/lib/parser/sql-ddl-parser.ts) and the
// whiteboard's existing per-item server functions. Reuses astToEntities plus
// the same createTable / createColumnsFn / createRelationshipFn primitives
// every other table/column/relationship creation path in the app already
// goes through (each already enforces RBAC + whatever collab broadcast
// exists) — see the tactical plan's Decision Tree ("client-orchestrated
// reuse... rejected a new bulk importDiagramFn for V1").
//
// Table/column names -> ids are resolved via in-memory maps built as each
// table is created; a relationship whose table or column can't be resolved
// (dangling FK reference not present in the pasted script) is dropped with a
// warning rather than thrown — mirrors the parser's own "never a hard
// failure" behavior.

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { DiagramAST } from '@/lib/parser/ast'
import { astToEntities } from '@/lib/parser/diagram-parser'
import {
  computeAutoLayout,
  createRelationshipFn,
  createTable,
} from '@/lib/server-functions'
import { createColumnsFn } from '@/routes/api/columns'
import { isUnauthorizedError } from '@/lib/auth/errors'

export interface SqlImportSummary {
  tableCount: number
  columnCount: number
  relationshipCount: number
  /** Human-readable notices for relationships that couldn't be resolved
   * (e.g. a FK referencing a table/column not present in the pasted script). */
  skippedRelationships: Array<string>
}

/** Thrown when any persistence step hits an expired session — the caller's
 * existing mutation-error UX (toast + triggerSessionExpired) should handle it. */
export class SqlImportSessionExpiredError extends Error {
  constructor() {
    super('Your session expired while importing — please sign in and retry.')
    this.name = 'SqlImportSessionExpiredError'
  }
}

/** Same auto-layout options the toolbar's Auto Layout button uses. */
function defaultLayoutOptions() {
  return {
    width: window.innerWidth,
    height: window.innerHeight - 160,
    linkDistance: 200,
    chargeStrength: -1000,
    collisionPadding: 50,
    iterations: 300,
    handleClusters: true,
  }
}

export function useSqlImport(whiteboardId: string) {
  const queryClient = useQueryClient()

  const importDiagram = useCallback(
    async (ast: DiagramAST): Promise<SqlImportSummary> => {
      const { tables, relationships } = astToEntities(ast, whiteboardId)

      const tableIdByName = new Map<string, string>()
      const columnIdByKey = new Map<string, string>() // `${tableName}.${columnName}`
      let columnCount = 0

      for (const entry of tables) {
        const createdTable = await createTable({
          data: { ...entry.table, whiteboardId },
        })
        if (isUnauthorizedError(createdTable)) {
          throw new SqlImportSessionExpiredError()
        }
        tableIdByName.set(entry.table.name, createdTable.id)

        if (entry.columns.length > 0) {
          const createdColumns = await createColumnsFn({
            data: entry.columns.map((c) => ({
              ...c,
              tableId: createdTable.id,
            })),
          })
          if (isUnauthorizedError(createdColumns)) {
            throw new SqlImportSessionExpiredError()
          }
          columnCount += createdColumns.length
          for (const col of createdColumns) {
            columnIdByKey.set(`${entry.table.name}.${col.name}`, col.id)
          }
        }
      }

      const skippedRelationships: Array<string> = []
      let relationshipCount = 0

      for (const rel of relationships) {
        const sourceTableId = tableIdByName.get(rel.sourceTable)
        const targetTableId = tableIdByName.get(rel.targetTable)
        const sourceColumnId = columnIdByKey.get(
          `${rel.sourceTable}.${rel.sourceColumn}`,
        )
        const targetColumnId = columnIdByKey.get(
          `${rel.targetTable}.${rel.targetColumn}`,
        )

        if (
          !sourceTableId ||
          !targetTableId ||
          !sourceColumnId ||
          !targetColumnId
        ) {
          skippedRelationships.push(
            `${rel.sourceTable}.${rel.sourceColumn} -> ${rel.targetTable}.${rel.targetColumn} (unresolved reference, skipped)`,
          )
          continue
        }

        const createdRelationship = await createRelationshipFn({
          data: {
            whiteboardId,
            sourceTableId,
            targetTableId,
            sourceColumnId,
            targetColumnId,
            cardinality: rel.cardinality,
            label: rel.label,
          },
        })
        if (isUnauthorizedError(createdRelationship)) {
          throw new SqlImportSessionExpiredError()
        }
        relationshipCount += 1
      }

      // Every query key any whiteboard surface (Konva legacy `whiteboard-page`,
      // the plain React Flow route's `whiteboard`, ReactFlowWhiteboard's
      // `whiteboard`/`relationships`) reads tables/relationships from — extra
      // invalidations for a key a given surface doesn't use are harmless no-ops.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['whiteboard', whiteboardId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['whiteboard-page', whiteboardId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['relationships', whiteboardId],
        }),
      ])

      // Trigger the existing (server-computed) auto-layout pass so imported
      // tables don't overlap the existing diagram — reuses computeAutoLayout,
      // the same primitive the toolbar's Auto Layout button calls.
      // Server-side layout avoids racing this hook's own query invalidation
      // against whichever surface's client-side node state hasn't refetched
      // yet, since it recomputes positions directly from the freshly
      // persisted DB rows rather than from local React state.
      if (tables.length > 0) {
        try {
          const layoutResult = await computeAutoLayout({
            data: { whiteboardId, options: defaultLayoutOptions() },
          })
          if (!isUnauthorizedError(layoutResult)) {
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: ['whiteboard', whiteboardId],
              }),
              queryClient.invalidateQueries({
                queryKey: ['whiteboard-page', whiteboardId],
              }),
            ])
          }
        } catch (error) {
          // Auto-layout failure must never block a successful import — the
          // tables are already persisted; they'll keep astToEntities's grid
          // default positions until Auto Layout is run manually.
          console.error('Auto layout after SQL import failed:', error)
        }
      }

      return {
        tableCount: tables.length,
        columnCount,
        relationshipCount,
        skippedRelationships,
      }
    },
    [whiteboardId, queryClient],
  )

  return { importDiagram }
}
