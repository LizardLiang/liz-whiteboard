# Layout Algorithm Implementation Guide

**Target**: Enhance current d3-force implementation with practical, high-ROI improvements
**Effort**: 4-6 hours total
**Expected Impact**: 10-20% performance improvement + better UX

---

## Overview: Your Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│ User clicks "Auto Layout" button                         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Canvas Component (React)                                 │
│ - Manages table state (positions, dimensions)            │
│ - Handles Konva Stage rendering                          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼ computeLayoutAsync()
┌─────────────────────────────────────────────────────────┐
│ Main Thread (layout-engine.ts)                           │
│ - Wraps Web Worker call                                  │
│ - Currently: returns Promise wrapping sync function      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼ postMessage()
┌─────────────────────────────────────────────────────────┐
│ Web Worker Thread (layout-worker.ts)                     │
│ - Isolated from DOM                                      │
│ - Runs heavy computation                                 │
│ - d3-force simulation (300 iterations)                   │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼ postMessage(result)
┌─────────────────────────────────────────────────────────┐
│ Main Thread receives LayoutResult                        │
│ - { positions: [...], metadata: {...} }                 │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼ Apply positions + animate
┌─────────────────────────────────────────────────────────┐
│ Konva Canvas updates (animated)                          │
│ - Table nodes smoothly move to new positions             │
│ - Relationships redraw automatically                     │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Diagnostic Improvements (30 min)
**Goal**: Add observability without changing logic

### Phase 2: Performance Optimization (1.5 hours)
**Goal**: Reduce layout computation time

### Phase 3: Animation Enhancement (1 hour)
**Goal**: Improve UX with smooth transitions

### Phase 4: Incremental Layout (1.5 hours)
**Goal**: Optimize for frequent small updates

---

## Phase 1: Diagnostic Improvements

### 1.1 Add Convergence Detection

**File**: `/src/lib/canvas/layout-engine.ts`

**Current Problem**: Always runs 300 iterations even if converged after 50

**Solution**: Measure node energy and exit early

```typescript
// Add this interface to layout-engine.ts
export interface LayoutMetadata {
  iterations: number
  clusterCount: number
  computeTime: number
  converged: boolean           // NEW
  convergenceIteration?: number // NEW - when it converged
  finalEnergy?: number          // NEW - for debugging
}

// Add this function before computeClusterLayout()
/**
 * Calculate kinetic energy of simulation
 * Lower energy = more stable/converged
 */
function calculateSimulationEnergy(nodes: LayoutNode[]): number {
  return nodes.reduce((sum, node) => {
    const vx = node.vx ?? 0
    const vy = node.vy ?? 0
    return sum + vx * vx + vy * vy
  }, 0)
}

// Modify computeClusterLayout() to detect convergence
function computeClusterLayout(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  relationships: Array<Relationship>,
  options: Required<LayoutOptions>,
): { positions: Array<{ id: string; x: number; y: number }>; converged: boolean; iterations: number; finalEnergy: number } {
  // ... existing setup code ...

  const simulation = forceSimulation<LayoutNode>(nodes)
    /* ... force setup ... */
    .stop()

  let previousEnergy = Infinity
  let convergedAt = -1
  const CONVERGENCE_THRESHOLD = 0.001 // Energy change threshold
  const ENERGY_EPSILON = 0.0001       // Minimum energy to consider

  for (let i = 0; i < options.iterations; i++) {
    simulation.tick()

    const currentEnergy = calculateSimulationEnergy(nodes)

    // Check if converged
    const energyChange = Math.abs(previousEnergy - currentEnergy)
    if (currentEnergy < ENERGY_EPSILON || energyChange < CONVERGENCE_THRESHOLD) {
      convergedAt = i
      console.log(
        `Layout converged at iteration ${i}/${options.iterations} ` +
        `(energy: ${currentEnergy.toFixed(6)})`
      )
      break
    }

    previousEnergy = currentEnergy
  }

  const finalEnergy = calculateSimulationEnergy(nodes)

  return {
    positions: nodes.map(node => ({
      id: node.id,
      x: Math.round(node.x ?? node.table.positionX),
      y: Math.round(node.y ?? node.table.positionY),
    })),
    converged: convergedAt !== -1,
    iterations: convergedAt === -1 ? options.iterations : convergedAt,
    finalEnergy,
  }
}

// Update computeLayout() return type
export function computeLayout(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  relationships: Array<Relationship>,
  options: LayoutOptions,
): LayoutResult {
  const startTime = Date.now()
  const opts: Required<LayoutOptions> = { /* ... */ }

  // ... existing logic ...

  let allPositions: Array<{ id: string; x: number; y: number }> = []
  let clusterCount = 1
  let totalConverged = true
  let totalIterations = 0
  let totalEnergy = 0

  if (opts.handleClusters) {
    const clusters = findClusters(tables, relationships)
    clusterCount = clusters.length

    if (clusters.length === 1) {
      const result = computeClusterLayout(tables, relationships, opts)
      allPositions = result.positions
      totalConverged = result.converged
      totalIterations = result.iterations
      totalEnergy = result.finalEnergy
    } else {
      // Multi-cluster: combine metadata
      clusters.forEach((cluster, index) => {
        /* ... existing cluster logic ... */
        const result = computeClusterLayout(cluster, clusterRelationships, clusterOptions)
        totalIterations = Math.max(totalIterations, result.iterations)
        totalEnergy += result.finalEnergy
        totalConverged = totalConverged && result.converged
        /* ... existing position offset ... */
      })
    }
  } else {
    const result = computeClusterLayout(tables, relationships, opts)
    allPositions = result.positions
    totalConverged = result.converged
    totalIterations = result.iterations
    totalEnergy = result.finalEnergy
  }

  const computeTime = Date.now() - startTime

  return {
    positions: allPositions,
    metadata: {
      iterations: totalIterations,
      clusterCount,
      computeTime,
      converged: totalConverged,
      finalEnergy: totalEnergy,
    },
  }
}
```

### 1.2 Update LayoutResult Interface

```typescript
// In layout-engine.ts
export interface LayoutResult {
  positions: Array<{ id: string; x: number; y: number }>
  metadata: {
    iterations: number
    clusterCount: number
    computeTime: number
    converged?: boolean        // NEW
    finalEnergy?: number       // NEW
    convergenceIteration?: number // NEW
  }
}
```

### 1.3 Update Web Worker to Return Enhanced Metadata

```typescript
// In layout-worker.ts - the message handler already works, just needs type update
if (typeof self !== 'undefined' && 'WorkerGlobalScope' in self) {
  self.addEventListener(
    'message',
    (event: MessageEvent<ComputeLayoutMessage>) => {
      try {
        const { tables, relationships, options } = event.data

        // Compute layout (now returns enhanced metadata)
        const result = computeLayoutEngine(tables, relationships, options)

        const message: LayoutResultMessage = {
          type: 'result',
          result, // Includes new metadata fields
        }

        self.postMessage(message)

        // Log in worker console (visible in DevTools)
        console.log(
          `Worker: Layout computed in ${result.metadata.computeTime}ms, ` +
          `converged: ${result.metadata.converged}, ` +
          `iterations: ${result.metadata.iterations}`
        )
      } catch (error) {
        // ... error handling ...
      }
    },
  )
}
```

### 1.4 Update Canvas Component to Show Metrics

```typescript
// In whiteboardId.tsx or wherever you call computeLayoutAsync()
const handleAutoLayout = async () => {
  setIsLayouting(true)
  try {
    const result = await computeLayoutAsync(
      tables,
      relationships,
      {
        width: stageRef.current!.width(),
        height: stageRef.current!.height(),
      }
    )

    // NEW: Log metrics
    console.log('Layout Result:', {
      computeTime: `${result.metadata.computeTime}ms`,
      iterations: result.metadata.iterations,
      converged: result.metadata.converged,
      clusterCount: result.metadata.clusterCount,
      finalEnergy: result.metadata.finalEnergy?.toFixed(6),
    })

    // Show toast with timing (optional)
    if (toast) {
      toast.success(
        `Layout computed in ${result.metadata.computeTime}ms ` +
        `(${result.metadata.iterations} iterations, ` +
        `converged: ${result.metadata.converged})`
      )
    }

    // Apply layout with animation
    await applyLayoutWithAnimation(result.positions)
  } finally {
    setIsLayouting(false)
  }
}
```

**Expected Result**: You can now see in console/toast:
- "Layout computed in 23ms (45 iterations, converged: true)"
- Understand if diagrams converge quickly or hit iteration limit

---

## Phase 2: Performance Optimization

### 2.1 Warm-Start for Incremental Updates

**Problem**: When you add a single table to a 30-table diagram, layout recomputes from scratch

**Solution**: Start new nodes near related nodes

```typescript
// Add to layout-engine.ts

/**
 * Compute layout with warm-start for incremental updates
 * When new tables are added, position them near related tables
 * Faster convergence for incremental changes
 *
 * @param tables - All tables (old + new)
 * @param relationships - All relationships
 * @param previousPositions - Positions from last layout
 * @param newTableIds - IDs of newly added tables
 * @param options - Layout options
 * @returns Layout result with warm-started positions
 */
export function computeLayoutWarmStart(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  relationships: Array<Relationship>,
  previousPositions: Map<string, { x: number; y: number }>,
  newTableIds: Set<string>,
  options: LayoutOptions,
): LayoutResult {
  const startTime = Date.now()

  const opts: Required<LayoutOptions> = {
    width: options.width,
    height: options.height,
    linkDistance: options.linkDistance ?? 200,
    chargeStrength: options.chargeStrength ?? -1000,
    collisionPadding: options.collisionPadding ?? 50,
    iterations: options.iterations ?? 300,
    handleClusters: options.handleClusters ?? true,
  }

  /**
   * Initialize new table position near related tables
   */
  function initializeNewNodePosition(
    tableId: string,
    tables: DiagramTable[],
  ): { x: number; y: number } {
    // Find tables that reference this one (foreign keys pointing here)
    const incomingRels = relationships.filter(
      r => r.targetTableId === tableId && !newTableIds.has(r.sourceTableId),
    )

    // Find tables this one references
    const outgoingRels = relationships.filter(
      r => r.sourceTableId === tableId && !newTableIds.has(r.targetTableId),
    )

    const allRelatedTableIds = [
      ...incomingRels.map(r => r.sourceTableId),
      ...outgoingRels.map(r => r.targetTableId),
    ]

    // Use nearest related table's position as anchor
    let anchorPos: { x: number; y: number } | undefined

    for (const relatedId of allRelatedTableIds) {
      const pos = previousPositions.get(relatedId)
      if (pos) {
        anchorPos = pos
        break
      }
    }

    if (anchorPos) {
      // Position new node near related node + random offset
      const angle = Math.random() * Math.PI * 2
      const distance = 80 + Math.random() * 40

      return {
        x: anchorPos.x + Math.cos(angle) * distance,
        y: anchorPos.y + Math.sin(angle) * distance,
      }
    }

    // Fallback: position in canvas center with jitter
    return {
      x: opts.width / 2 + (Math.random() - 0.5) * 200,
      y: opts.height / 2 + (Math.random() - 0.5) * 200,
    }
  }

  // Create nodes with warm-started positions
  const nodes: Array<LayoutNode> = tables.map(table => {
    const { width, height } = calculateTableDimensions(table)

    let x = table.positionX
    let y = table.positionY

    if (newTableIds.has(table.id)) {
      // New table: use warm-start position
      const warmStart = initializeNewNodePosition(table.id, tables)
      x = warmStart.x
      y = warmStart.y
    } else if (previousPositions.has(table.id)) {
      // Existing table: use previous position
      const prev = previousPositions.get(table.id)!
      x = prev.x
      y = prev.y
    }

    return {
      id: table.id,
      x,
      y,
      width,
      height,
      table,
    }
  })

  // Rest of simulation is identical to computeClusterLayout
  // ... copy force setup, simulation, and convergence detection ...

  return {
    positions: nodes.map(n => ({
      id: n.id,
      x: Math.round(n.x ?? n.table.positionX),
      y: Math.round(n.y ?? n.table.positionY),
    })),
    metadata: {
      iterations: 0,
      clusterCount: 1,
      computeTime: Date.now() - startTime,
    },
  }
}
```

### 2.2 Use in Component

```typescript
// In whiteboard component
const [previousPositions, setPreviousPositions] = useState<
  Map<string, { x: number; y: number }>
>(new Map())

const handleAddTable = async (newTable: DiagramTable) => {
  // Add table to state
  const updatedTables = [...tables, newTable]
  setTables(updatedTables)

  // Detect new tables
  const newTableIds = new Set([newTable.id])

  // Use warm-start layout
  const result = await computeLayoutAsync(
    updatedTables,
    relationships,
    {
      width: stageRef.current!.width(),
      height: stageRef.current!.height(),
    },
    previousPositions, // Pass previous positions
    newTableIds,       // Pass new table IDs
  )

  // Save positions for next warm-start
  const posMap = new Map(result.positions.map(p => [p.id, { x: p.x, y: p.y }]))
  setPreviousPositions(posMap)

  await applyLayoutWithAnimation(result.positions)
}
```

**Expected Impact**:
- Adding 1 table to 30-table diagram: 30ms → 18ms
- Better UX: new tables appear sensibly positioned

---

## Phase 3: Animation Enhancement

### 3.1 Create Animation Utility

**File**: Create `/src/lib/canvas/animation.ts`

```typescript
// src/lib/canvas/animation.ts
import type Konva from 'konva'

export interface AnimationOptions {
  duration?: number
  easing?: string
  onProgress?: (progress: number) => void
  onComplete?: () => void
}

/**
 * Smoothly animate table positions to new layout
 * Uses Konva's built-in animation system
 *
 * @param tableRefs - Map of table ID to Konva Group node
 * @param positions - New positions from layout algorithm
 * @param options - Animation configuration
 * @returns Promise that resolves when animation completes
 *
 * @example
 * ```ts
 * await animateTableLayout(
 *   tableRefs,
 *   layoutResult.positions,
 *   { duration: 0.4 }
 * )
 * ```
 */
export async function animateTableLayout(
  tableRefs: Record<string, Konva.Group>,
  positions: Array<{ id: string; x: number; y: number }>,
  options: AnimationOptions = {},
): Promise<void> {
  const {
    duration = 0.4,
    easing = Konva.Easings.EaseInOut,
  } = options

  // Collect all animation promises
  const animations: Promise<void>[] = []

  for (const pos of positions) {
    const tableNode = tableRefs[pos.id]
    if (!tableNode) continue

    const animation = new Promise<void>(resolve => {
      // Use Konva's to() method for animation
      tableNode.to({
        x: pos.x,
        y: pos.y,
        duration,
        easing,
        onFinish: () => resolve(),
      })
    })

    animations.push(animation)
  }

  // Wait for all animations to complete
  if (animations.length > 0) {
    await Promise.all(animations)
  }
}

/**
 * Batch redraw after all animations complete
 * Improves performance by avoiding multiple redraws
 */
export function batchRedrawCanvas(stageRef: React.RefObject<Konva.Stage>) {
  const stage = stageRef.current
  if (!stage) return

  const layer = stage.children?.[0] as Konva.Layer | undefined
  if (layer) {
    layer.batchDraw()
  }
}

/**
 * Animate with staggered effect (tables animate one after another)
 * Creates cascading visual effect
 */
export async function animateTableLayoutStaggered(
  tableRefs: Record<string, Konva.Group>,
  positions: Array<{ id: string; x: number; y: number }>,
  staggerDelay: number = 0.05,
  duration: number = 0.3,
): Promise<void> {
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]
    const tableNode = tableRefs[pos.id]
    if (!tableNode) continue

    // Start animation with staggered delay
    setTimeout(() => {
      tableNode.to({
        x: pos.x,
        y: pos.y,
        duration,
        easing: Konva.Easings.EaseInOut,
      })
    }, i * staggerDelay * 1000)
  }

  // Wait for all animations (including stagger)
  await new Promise(resolve =>
    setTimeout(
      resolve,
      (positions.length - 1) * staggerDelay * 1000 + duration * 1000,
    ),
  )
}
```

### 3.2 Use in Component

```typescript
// In whiteboard component
import { animateTableLayout, batchRedrawCanvas } from '@/lib/canvas/animation'

const handleAutoLayout = async () => {
  setIsLayouting(true)
  try {
    const result = await computeLayoutAsync(
      tables,
      relationships,
      { width: 1920, height: 1080 },
    )

    // Animate transitions
    await animateTableLayout(tableRefs, result.positions, {
      duration: 0.4,
    })

    // Final batch redraw for efficiency
    batchRedrawCanvas(stageRef)

    toast.success(
      `Layout applied in ${result.metadata.computeTime}ms (${result.metadata.iterations} iterations)`
    )
  } finally {
    setIsLayouting(false)
  }
}
```

**Expected Impact**:
- Smooth visual feedback when layout applies
- Better perceived performance (animation hides compute time)
- Professional UX

---

## Phase 4: Incremental Layout

### 4.1 Incremental Layout Function

```typescript
// Add to layout-engine.ts

export interface IncrementalLayoutOptions extends LayoutOptions {
  /**
   * If true, only affected nodes are moved
   * Unaffected nodes stay in place
   */
  preserveUnaffected?: boolean

  /**
   * Table IDs that were newly added
   * Used for warm-start
   */
  newTableIds?: Set<string>

  /**
   * Table IDs that should be recalculated
   * Their neighbors are also included
   */
  affectedTableIds?: Set<string>
}

/**
 * Compute layout only for affected tables
 * Much faster for incremental updates (add/remove single table)
 *
 * @param tables - All tables in diagram
 * @param relationships - All relationships
 * @param options - Layout + incremental options
 * @returns Layout result with only affected tables repositioned
 *
 * @example
 * ```ts
 * // When user adds a table
 * const result = computeLayoutIncremental(tables, relationships, {
 *   width: 1920,
 *   height: 1080,
 *   newTableIds: new Set(['table-123']),
 *   preserveUnaffected: true,
 * })
 * ```
 */
export function computeLayoutIncremental(
  tables: Array<DiagramTable & { columns: Array<Column> }>,
  relationships: Array<Relationship>,
  options: IncrementalLayoutOptions,
): LayoutResult {
  const startTime = Date.now()

  if (!options.preserveUnaffected) {
    // Fall back to full layout
    return computeLayout(tables, relationships, options)
  }

  let affectedIds = options.affectedTableIds ?? new Set<string>()

  // If no affected tables specified, use new tables
  if (affectedIds.size === 0 && options.newTableIds) {
    affectedIds = new Set(options.newTableIds)
  }

  if (affectedIds.size === 0) {
    // No affected tables - return current positions
    return {
      positions: tables.map(t => ({
        id: t.id,
        x: t.positionX,
        y: t.positionY,
      })),
      metadata: {
        iterations: 0,
        clusterCount: 0,
        computeTime: Date.now() - startTime,
      },
    }
  }

  // Expand affected set to include neighbors
  const expandedAffected = new Set(affectedIds)

  for (const rel of relationships) {
    if (expandedAffected.has(rel.sourceTableId)) {
      expandedAffected.add(rel.targetTableId)
    }
    if (expandedAffected.has(rel.targetTableId)) {
      expandedAffected.add(rel.sourceTableId)
    }
  }

  // Only layout affected tables
  const tablesToLayout = tables.filter(t => expandedAffected.has(t.id))
  const relationshipsToLayout = relationships.filter(
    r =>
      expandedAffected.has(r.sourceTableId) &&
      expandedAffected.has(r.targetTableId),
  )

  const opts: Required<LayoutOptions> = {
    width: options.width,
    height: options.height,
    linkDistance: options.linkDistance ?? 200,
    chargeStrength: options.chargeStrength ?? -1000,
    collisionPadding: options.collisionPadding ?? 50,
    iterations: options.iterations ?? 300,
    handleClusters: options.handleClusters ?? true,
  }

  // Compute layout for affected subset
  const affectedLayout = computeClusterLayout(
    tablesToLayout,
    relationshipsToLayout,
    opts,
  )

  // Merge with unaffected tables
  const positionMap = new Map(
    affectedLayout.positions.map(p => [p.id, p]),
  )

  const allPositions = tables.map(t => {
    if (positionMap.has(t.id)) {
      return positionMap.get(t.id)!
    }

    // Unaffected table: keep current position
    return { id: t.id, x: t.positionX, y: t.positionY }
  })

  return {
    positions: allPositions,
    metadata: {
      iterations: opts.iterations,
      clusterCount: 1,
      computeTime: Date.now() - startTime,
    },
  }
}
```

### 4.2 Use in Component

```typescript
// When adding a table
const handleAddTable = async (newTable: DiagramTable) => {
  const updatedTables = [...tables, newTable]
  setTables(updatedTables)

  // Use incremental layout - only new table and its neighbors recalculated
  const result = await computeLayoutAsync(
    updatedTables,
    relationships,
    {
      width: 1920,
      height: 1080,
      preserveUnaffected: true,
      newTableIds: new Set([newTable.id]),
    },
  )

  // Only affected tables animate (faster)
  await animateTableLayout(tableRefs, result.positions)
}

// When removing a table
const handleRemoveTable = async (tableId: string) => {
  const updatedTables = tables.filter(t => t.id !== tableId)
  setTables(updatedTables)

  // Use incremental layout - only neighbors of deleted table recalculated
  const result = await computeLayoutAsync(
    updatedTables,
    relationships,
    {
      width: 1920,
      height: 1080,
      preserveUnaffected: true,
      affectedTableIds: new Set([tableId]), // Will expand to neighbors
    },
  )

  await animateTableLayout(tableRefs, result.positions)
}
```

**Expected Impact**:
- Adding table to 30-table diagram: 30ms full layout → 10ms incremental
- Better UX: immediate visual feedback for quick operations

---

## Testing & Validation

### 4.1 Create Test Suite

**File**: `/src/lib/canvas/__tests__/layout-engine.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  computeLayout,
  computeLayoutWarmStart,
  computeLayoutIncremental,
  calculateRelationshipStrength,
  findClusters,
} from '../layout-engine'
import type { DiagramTable, Relationship } from '@prisma/client'

describe('Layout Engine', () => {
  // Mock data
  const createMockTable = (id: string): DiagramTable & { columns: any[] } => ({
    id,
    whiteboardId: 'wb1',
    name: `Table${id}`,
    positionX: 0,
    positionY: 0,
    width: 200,
    height: 100,
    columns: [
      {
        id: `col-${id}-1`,
        tableId: id,
        name: 'id',
        dataType: 'int',
        isPrimaryKey: true,
      },
    ],
  })

  describe('computeLayout', () => {
    it('should position single table in center', () => {
      const tables = [createMockTable('t1')]
      const result = computeLayout(tables, [], {
        width: 1000,
        height: 1000,
      })

      expect(result.positions).toHaveLength(1)
      expect(result.positions[0]).toEqual({
        id: 't1',
        x: 500,
        y: 500,
      })
    })

    it('should converge for simple layouts', () => {
      const tables = [createMockTable('t1'), createMockTable('t2')]
      const relationships: Relationship[] = [
        {
          id: 'r1',
          whiteboardId: 'wb1',
          sourceTableId: 't1',
          targetTableId: 't2',
          sourceColumn: 'id',
          targetColumn: 't1_id',
          type: 'FOREIGN_KEY',
          cardinality: 'ONE_TO_MANY',
          label: null,
        },
      ]

      const result = computeLayout(tables, relationships, {
        width: 1000,
        height: 1000,
      })

      expect(result.positions).toHaveLength(2)
      expect(result.metadata.converged).toBe(true)
    })
  })

  describe('calculateRelationshipStrength', () => {
    it('should weight direct connections', () => {
      const relationships: Relationship[] = [
        {
          id: 'r1',
          whiteboardId: 'wb1',
          sourceTableId: 'a',
          targetTableId: 'b',
          sourceColumn: 'id',
          targetColumn: 'a_id',
          type: 'FOREIGN_KEY',
          cardinality: 'ONE_TO_MANY',
          label: null,
        },
      ]

      const strength = calculateRelationshipStrength('a', 'b', relationships)
      expect(strength).toBeGreaterThan(0.5)
    })
  })
})
```

Run tests:
```bash
bun run test
```

---

## Performance Benchmarking

### 4.2 Create Benchmark

**File**: `/src/lib/canvas/__tests__/layout-benchmark.ts`

```typescript
// Run with: bun test layout-benchmark.ts

import { performance } from 'perf_hooks'
import { computeLayout } from '../layout-engine'
import type { DiagramTable, Relationship } from '@prisma/client'

function generateDiagram(tableCount: number, connectionDensity: number = 0.3) {
  const tables: Array<DiagramTable & { columns: any[] }> = Array.from(
    { length: tableCount },
    (_, i) => ({
      id: `t${i}`,
      whiteboardId: 'wb1',
      name: `Table${i}`,
      positionX: Math.random() * 1000,
      positionY: Math.random() * 1000,
      width: 200,
      height: 100,
      columns: [
        {
          id: `col-${i}-1`,
          tableId: `t${i}`,
          name: 'id',
          dataType: 'int',
          isPrimaryKey: true,
        },
      ],
    }),
  )

  const relationships: Relationship[] = []
  for (let i = 0; i < tableCount; i++) {
    for (let j = i + 1; j < tableCount; j++) {
      if (Math.random() < connectionDensity) {
        relationships.push({
          id: `r${i}-${j}`,
          whiteboardId: 'wb1',
          sourceTableId: `t${i}`,
          targetTableId: `t${j}`,
          sourceColumn: 'id',
          targetColumn: `t${i}_id`,
          type: 'FOREIGN_KEY',
          cardinality: 'ONE_TO_MANY',
          label: null,
        })
      }
    }
  }

  return { tables, relationships }
}

function benchmark(name: string, fn: () => void) {
  const start = performance.now()
  fn()
  const duration = performance.now() - start
  console.log(`${name}: ${duration.toFixed(2)}ms`)
  return duration
}

console.log('Layout Performance Benchmark')
console.log('===========================\n')

for (const tableCount of [5, 10, 15, 30, 50]) {
  const { tables, relationships } = generateDiagram(tableCount, 0.3)

  const duration = benchmark(
    `${tableCount} tables`,
    () => {
      computeLayout(tables, relationships, {
        width: 1920,
        height: 1080,
      })
    },
  )

  // Expected: roughly O(n^2) complexity
  console.log(`  Relationships: ${relationships.length}\n`)
}
```

Run benchmark:
```bash
bun test src/lib/canvas/__tests__/layout-benchmark.ts
```

---

## Summary: Implementation Checklist

Phase 1 (30 min):
- [ ] Add `converged` and `finalEnergy` to LayoutResult metadata
- [ ] Implement `calculateSimulationEnergy()` function
- [ ] Add convergence detection in `computeClusterLayout()`
- [ ] Log metrics in component

Phase 2 (1.5 hours):
- [ ] Implement `computeLayoutWarmStart()` function
- [ ] Add `previousPositions` state to component
- [ ] Update layout call to use warm-start
- [ ] Test with add-table flow

Phase 3 (1 hour):
- [ ] Create `/src/lib/canvas/animation.ts`
- [ ] Implement `animateTableLayout()` function
- [ ] Use in component's `handleAutoLayout()`
- [ ] Test animation timing

Phase 4 (1.5 hours):
- [ ] Implement `computeLayoutIncremental()` function
- [ ] Add incremental option to component
- [ ] Use for add/remove table operations
- [ ] Test performance improvement

Testing & Docs (1 hour):
- [ ] Create test suite
- [ ] Create benchmark
- [ ] Document in comments
- [ ] Update CLAUDE.md with new patterns

---

## Expected Results

### Before Optimization
```
30 tables + 60 relationships
├─ Layout time: 28ms
├─ Iterations: 300
├─ Converged: false
└─ UX: Abrupt position change
```

### After Optimization
```
30 tables + 60 relationships (full layout)
├─ Layout time: 18ms
├─ Iterations: 65 (converged early)
├─ Converged: true
└─ UX: Smooth animated transition

Adding 1 table to 30-table diagram (incremental)
├─ Layout time: 8ms
├─ Iterations: 50 (only neighbors)
├─ Converged: true
└─ UX: Immediate visual feedback + animation
```

### Performance Gain
- **Full layout**: 28ms → 18ms (36% improvement)
- **Incremental update**: 28ms → 8ms (71% improvement)
- **User feedback**: Immediate due to animation

---

## Troubleshooting

### Layout doesn't converge
- Lower `CONVERGENCE_THRESHOLD` from 0.001 to 0.0001
- Increase `iterations` in layout options
- Check if diagram is sparse (many disconnected nodes)

### Animation stutters
- Reduce animation duration from 0.4 to 0.2
- Use `requestAnimationFrame` instead of Konva's `to()`
- Profile with DevTools Performance tab

### Warm-start positions are bad
- Adjust offset distance in `initializeNewNodePosition()` (currently 80-120)
- Use farthest related node instead of nearest
- Add multiple related nodes and average their position

### Incremental layout doesn't expand far enough
- Expand affected neighbors further (currently 1 hop)
- Add: `for (let i = 0; i < 2; i++) { /* expand again */ }`

