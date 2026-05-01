// src/lib/auto-layout/index.ts
// Barrel re-exports for the auto-layout module.

export {
  computeD3ForceLayout,
  enforceGapPostPass,
  simulateChunked,
} from './d3-force-layout'

export type {
  LayoutInputEdge,
  LayoutInputNode,
  LayoutOutputPosition,
} from './d3-force-layout'
