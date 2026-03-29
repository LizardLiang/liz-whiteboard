/**
 * ELK Layout Web Worker
 * Runs ELK hierarchical layout algorithm in a separate thread to avoid blocking UI
 */

import ELK from 'elkjs/lib/elk.bundled.js'
import type { ELKNode } from 'elkjs'

// Initialize ELK instance
const elk = new ELK()

/**
 * Message format expected by worker
 */
interface ELKLayoutMessage {
  id: string
  layoutOptions: Record<string, string>
  children: Array<ELKNode>
  edges: Array<{
    id: string
    sources: Array<string>
    targets: Array<string>
  }>
}

/**
 * Listen for layout computation requests
 */
self.onmessage = async (e: MessageEvent<ELKLayoutMessage>) => {
  try {
    const graph = e.data

    // Compute layout using ELK
    const layout = await elk.layout(graph)

    // Send computed layout back to main thread
    self.postMessage({
      success: true,
      layout,
    })
  } catch (error) {
    // Send error back to main thread
    self.postMessage({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

// Export empty object to satisfy TypeScript module requirements
export {}
