// src/lib/canvas/layout-worker.ts
// Web Worker for offloading layout computation to prevent UI blocking

import { computeLayout as computeLayoutEngine } from './layout-engine'
import type { LayoutOptions, LayoutResult } from './layout-engine'
import type { Column, DiagramTable, Relationship } from '@prisma/client'

/**
 * Message sent to worker to compute layout
 */
export interface ComputeLayoutMessage {
  type: 'compute'
  tables: Array<DiagramTable & { columns: Array<Column> }>
  relationships: Array<Relationship>
  options: LayoutOptions
}

/**
 * Message sent from worker with computed layout
 */
export interface LayoutResultMessage {
  type: 'result'
  result: LayoutResult
}

/**
 * Message sent from worker when error occurs
 */
export interface LayoutErrorMessage {
  type: 'error'
  error: string
}

export type WorkerMessage = LayoutResultMessage | LayoutErrorMessage

/**
 * Web Worker message handler
 * This code runs in the worker thread
 */
if (typeof self !== 'undefined' && 'WorkerGlobalScope' in self) {
  self.addEventListener(
    'message',
    (event: MessageEvent<ComputeLayoutMessage>) => {
      try {
        const { tables, relationships, options } = event.data

        // Compute layout synchronously in worker thread
        const result = computeLayoutEngine(tables, relationships, options)

        // Send result back to main thread
        const message: LayoutResultMessage = {
          type: 'result',
          result,
        }

        self.postMessage(message)
      } catch (error) {
        // Send error back to main thread
        const message: LayoutErrorMessage = {
          type: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Unknown layout computation error',
        }

        self.postMessage(message)
      }
    },
  )
}

/**
 * Create and manage a Web Worker for layout computation
 *
 * @example
 * ```ts
 * const worker = createLayoutWorker();
 *
 * const result = await worker.computeLayout(tables, relationships, {
 *   width: 1920,
 *   height: 1080,
 * });
 *
 * worker.terminate();
 * ```
 */
export function createLayoutWorker() {
  // Create worker from this file
  const worker = new Worker(new URL('./layout-worker.ts', import.meta.url), {
    type: 'module',
  })

  /**
   * Compute layout using Web Worker
   *
   * @param tables - All tables in the diagram
   * @param relationships - All relationships in the diagram
   * @param options - Layout configuration
   * @returns Promise that resolves to layout result
   */
  function computeLayout(
    tables: Array<DiagramTable & { columns: Array<Column> }>,
    relationships: Array<Relationship>,
    options: LayoutOptions,
  ): Promise<LayoutResult> {
    return new Promise((resolve, reject) => {
      // Setup one-time message handler
      const handleMessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === 'result') {
          worker.removeEventListener('message', handleMessage)
          resolve(event.data.result)
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        } else if (event.data.type === 'error') {
          worker.removeEventListener('message', handleMessage)
          reject(new Error(event.data.error))
        }
      }

      worker.addEventListener('message', handleMessage)

      // Setup one-time error handler
      const handleError = (error: ErrorEvent) => {
        worker.removeEventListener('error', handleError)
        reject(error)
      }

      worker.addEventListener('error', handleError)

      // Send computation request to worker
      const message: ComputeLayoutMessage = {
        type: 'compute',
        tables,
        relationships,
        options,
      }

      worker.postMessage(message)
    })
  }

  /**
   * Terminate the worker
   */
  function terminate() {
    worker.terminate()
  }

  return {
    computeLayout,
    terminate,
  }
}
