# Liam ERD Whiteboard Implementation Guide

This document details how the Liam ERD project (`/home/shotup/programing/react/liam/`) implements its interactive ERD whiteboard using React Flow. Use this as reference for understanding modern ERD whiteboard architecture.

**Source Project:** `/home/shotup/programing/react/liam/frontend/packages/erd-core/`

---

## Table of Contents

1. [Technology Stack](#technology-stack)
2. [Whiteboard Architecture](#whiteboard-architecture)
3. [Component Structure](#component-structure)
4. [Node and Edge Implementation](#node-and-edge-implementation)
5. [Layout System](#layout-system)
6. [Interaction and State Management](#interaction-and-state-management)
7. [Visual Highlighting System](#visual-highlighting-system)
8. [Key Implementation Patterns](#key-implementation-patterns)
9. [Code References](#code-references)

---

## Technology Stack

### Canvas Library: React Flow (@xyflow/react v12.8.6)

**Why React Flow over Konva:**
- **Declarative**: Nodes/edges are React components, not imperative shapes
- **Built-in features**: Pan, zoom, drag, minimap, controls out-of-the-box
- **SVG-based**: Better for diagrams with connections between nodes
- **Graph-oriented**: Designed specifically for node-based UIs and diagrams
- **Automatic edge routing**: Handles connection paths automatically

**React Flow Core Concepts:**
```typescript
// Nodes are positioned boxes with custom content
type Node = {
  id: string
  type: string  // Maps to custom component
  position: { x: number; y: number }
  data: any  // Custom data passed to component
}

// Edges connect nodes via handles
type Edge = {
  id: string
  type: string  // Maps to custom component
  source: string  // Source node ID
  target: string  // Target node ID
  sourceHandle?: string  // Specific connection point
  targetHandle?: string  // Specific connection point
  data?: any
}
```

### Layout Engine: ELK (elkjs v0.10.0)

**Eclipse Layout Kernel** - Automatic graph layout algorithm
- Algorithm: "layered" (hierarchical)
- Handles table positioning automatically
- Minimizes edge crossings
- Configurable spacing and direction

---

## Whiteboard Architecture

### High-Level Flow

```
Schema (tables, constraints)
    ↓
convertSchemaToNodes (relationships → edges)
    ↓
computeAutoLayout (ELK positioning)
    ↓
highlightNodesAndEdges (visual states)
    ↓
ReactFlow Renderer (canvas display)
    ↓
User Interaction (click, hover, drag)
    ↓
State Update → Re-render
```

### File Structure

```
erd-core/src/features/erd/
├── components/
│   ├── ERDRenderer/              # Top-level container
│   │   └── ErdRenderer.tsx       # Main entry point
│   └── ERDContent/               # Canvas container
│       ├── ErdContent.tsx        # ReactFlow wrapper
│       ├── hooks/
│       │   ├── useInitialAutoLayout.ts
│       │   ├── useHighlightNodesAndEdges.ts
│       │   └── useNodeEventHandlers.ts
│       └── components/
│           ├── TableNode/        # Custom node component
│           │   ├── TableNode.tsx
│           │   ├── TableHeader.tsx
│           │   ├── TableColumnList.tsx
│           │   └── TableColumn.tsx
│           ├── RelationshipEdge/ # Custom edge component
│           │   └── RelationshipEdge.tsx
│           └── CardinalityMarkers.tsx  # SVG markers
├── utils/
│   ├── convertSchemaToNodes.ts   # Schema → Nodes/Edges
│   ├── highlightNodesAndEdges.ts # Visual state logic
│   └── computeAutoLayout/
│       ├── getElkLayout.ts       # ELK integration
│       └── computeAutoLayout.ts  # Layout orchestration
└── types.ts                      # TypeScript definitions
```

---

## Component Structure

### 1. ERDRenderer (Root Component)

**File:** `components/ERDRenderer/ErdRenderer.tsx`

```typescript
export const ERDRenderer = () => {
  return (
    <ReactFlowProvider>
      <ResizablePanelGroup direction="horizontal">
        {/* Left sidebar - table list */}
        <LeftPane />

        {/* Main canvas area */}
        <ERDContent />
      </ResizablePanelGroup>

      {/* Detail drawer */}
      <TableDetailDrawer />

      {/* Toolbar */}
      <Toolbar />
    </ReactFlowProvider>
  )
}
```

**Key Responsibilities:**
- Wraps everything in `ReactFlowProvider` (required for React Flow hooks)
- Manages layout panels (sidebar + canvas)
- Provides global toolbar and detail drawer

---

### 2. ERDContent (Canvas Container)

**File:** `components/ERDContent/ErdContent.tsx`

```typescript
const ERDContent = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Custom node/edge types
  const nodeTypes = useMemo(() => ({
    table: TableNode,
    nonRelatedTableGroup: NonRelatedTableGroupNode,
  }), [])

  const edgeTypes = useMemo(() => ({
    relationship: RelationshipEdge,
  }), [])

  // Initialize nodes/edges from schema
  useEffect(() => {
    const { nodes: initialNodes, edges: initialEdges } =
      convertSchemaToNodes(schema)
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [schema])

  // Auto-layout on initial load
  useInitialAutoLayout({ nodes, edges, setNodes })

  // Highlighting system
  useHighlightNodesAndEdges({ nodes, edges, setNodes, setEdges })

  // Event handlers
  const { handleNodeClick, handlePaneClick, handleMouseEnterNode,
          handleMouseLeaveNode, handleDragStopNode } =
    useNodeEventHandlers()

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onPaneClick={handlePaneClick}
      onNodeMouseEnter={handleMouseEnterNode}
      onNodeMouseLeave={handleMouseLeaveNode}
      onNodeDragStop={handleDragStopNode}
      minZoom={0.1}
      maxZoom={2}
      panOnScroll
      panOnDrag={[1, 2]}  // Middle/right mouse button
      deleteKeyCode={null}  // Disable deletion
      nodesConnectable={false}  // Read-only
      colorMode="dark"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={16}
        size={1}
        color="var(--color-gray-600)"
      />
    </ReactFlow>
  )
}
```

**Key Features:**
- `useNodesState`/`useEdgesState`: React Flow built-in hooks for state management
- Custom node/edge types mapped to React components
- Event handlers for user interaction
- Background with dot pattern
- Zoom/pan configuration
- Read-only mode (no connection editing)

---

## Node and Edge Implementation

### 3. TableNode (Custom Node Component)

**File:** `components/ERDContent/components/TableNode/TableNode.tsx`

```typescript
type TableNodeData = {
  table: Table
  isActiveHighlighted: boolean  // Selected state
  isHighlighted: boolean  // Related/hovered state
  isTooltipVisible: boolean
  sourceColumnName: string | undefined
  targetColumnCardinalities?: Record<string, Cardinality>
  showMode?: 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS'
}

const TableNode = ({ data }: NodeProps<TableNodeData>) => {
  const { table, isActiveHighlighted, isHighlighted, showMode } = data

  // Determine visual state
  const highlighted = isActiveHighlighted || isHighlighted

  return (
    <div
      className={cn(
        styles.tableNode,
        highlighted && styles.highlighted,
        isActiveHighlighted && styles.active
      )}
    >
      {/* Table header with name */}
      <TableHeader
        tableName={table.name}
        comment={table.comment}
      />

      {/* Column list (if not TABLE_NAME mode) */}
      {showMode !== 'TABLE_NAME' && (
        <TableColumnList
          table={table}
          showMode={showMode}
          targetColumnCardinalities={data.targetColumnCardinalities}
        />
      )}

      {/* Connection handles for each column */}
      {Object.entries(table.columns).map(([columnName, column]) => (
        <Handle
          key={columnName}
          id={columnHandleId(table.name, columnName)}
          type="source"
          position={Position.Right}
          className={styles.handle}
        />
      ))}
    </div>
  )
}
```

**Key Concepts:**

1. **Handles**: Connection points for edges
   - Each column gets a unique handle ID: `${tableName}__${columnName}`
   - Positioned on the right side of the node
   - Hidden with CSS but functionally active

2. **Show Modes**:
   - `TABLE_NAME`: Only table name (compact)
   - `KEY_ONLY`: Table name + primary/foreign keys
   - `ALL_FIELDS`: All columns

3. **Visual States**:
   - `isActiveHighlighted`: User clicked on this table
   - `isHighlighted`: Related to active table or hovered
   - CSS classes applied conditionally

4. **Column Display**:

**File:** `components/ERDContent/components/TableNode/TableColumn.tsx`

```typescript
const TableColumn = ({
  column,
  isPrimaryKey,
  isForeignKey,
  cardinality
}) => {
  return (
    <div className={styles.column}>
      {/* Primary key indicator */}
      {isPrimaryKey && <KeyIcon />}

      {/* Column name */}
      <span className={styles.columnName}>
        {column.name}
      </span>

      {/* Foreign key cardinality badge */}
      {isForeignKey && cardinality && (
        <Badge variant="outline">
          {cardinality === 'ONE_TO_ONE' ? '1:1' : '1:n'}
        </Badge>
      )}

      {/* Column type */}
      <span className={styles.columnType}>
        {column.type}
      </span>
    </div>
  )
}
```

---

### 4. RelationshipEdge (Custom Edge Component)

**File:** `components/ERDContent/components/RelationshipEdge/RelationshipEdge.tsx`

```typescript
type RelationshipEdgeData = {
  relationship: Relationship
  cardinality: Cardinality
  isHighlighted?: boolean
}

const RelationshipEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  markerStart
}: EdgeProps<RelationshipEdgeData>) => {
  const { relationship, cardinality, isHighlighted } = data

  // Calculate bezier path
  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  return (
    <g className={styles.edge}>
      {/* Main edge path */}
      <path
        id={id}
        className={cn(
          styles.edgePath,
          isHighlighted && styles.highlighted
        )}
        d={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />

      {/* Animated particles when highlighted */}
      {isHighlighted && (
        <>
          {[...Array(6)].map((_, i) => (
            <ellipse
              key={i}
              className={styles.particle}
              rx="2"
              ry="2"
            >
              <animateMotion
                dur="6s"
                repeatCount="indefinite"
                begin={`${i}s`}
              >
                <mpath href={`#${id}`} />
              </animateMotion>
            </ellipse>
          ))}
        </>
      )}

      {/* Cardinality label overlay when highlighted */}
      {isHighlighted && (
        <EdgeLabelRenderer>
          <div className={styles.cardinalityLabel}>
            {cardinality === 'ONE_TO_ONE' ? '1:1' : '1:n'}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  )
}
```

**Key Features:**

1. **SVG Path**: Uses React Flow's `getBezierPath` utility
2. **Markers**: Cardinality indicators (crow's foot, circle with line)
3. **Animation**: Particles flow along path when highlighted
4. **Conditional Rendering**: Show labels only when highlighted

---

### 5. Cardinality Markers (SVG Definitions)

**File:** `components/ERDContent/components/CardinalityMarkers.tsx`

```typescript
export const CardinalityMarkers = () => {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        {/* One-to-one: Circle with line */}
        <marker
          id="zeroOrOneLeft"
          markerWidth="20"
          markerHeight="20"
          refX="10"
          refY="10"
          orient="auto"
        >
          <circle cx="10" cy="10" r="5"
            fill="none"
            stroke="var(--color-edge)"
          />
          <line x1="15" y1="10" x2="20" y2="10"
            stroke="var(--color-edge)"
          />
        </marker>

        {/* One-to-many: Crow's foot */}
        <marker
          id="zeroOrManyLeft"
          markerWidth="20"
          markerHeight="20"
          refX="10"
          refY="10"
          orient="auto"
        >
          <path
            d="M 15,5 L 20,10 L 15,15"
            fill="none"
            stroke="var(--color-edge)"
          />
        </marker>

        {/* Similar markers for right side */}
      </defs>
    </svg>
  )
}
```

**Usage in Edge:**
```typescript
<path
  markerStart="url(#zeroOrOneLeft)"
  markerEnd="url(#zeroOrManyRight)"
/>
```

---

## Layout System

### 6. Schema to Nodes/Edges Conversion

**File:** `utils/convertSchemaToNodes.ts`

```typescript
export const convertSchemaToNodes = (schema: Schema) => {
  const tables = Object.values(schema.tables)

  // 1. Extract relationships from foreign key constraints
  const relationships = extractRelationships(tables)

  // 2. Detect cardinality (ONE_TO_ONE vs ONE_TO_MANY)
  //    Based on UNIQUE constraints on foreign key columns
  const relationshipsWithCardinality =
    detectCardinality(relationships, tables)

  // 3. Create table nodes
  const tableNodes: Node<TableNodeData>[] = tables.map(table => ({
    id: table.name,
    type: 'table',
    position: { x: 0, y: 0 },  // Will be set by layout
    data: {
      table,
      isActiveHighlighted: false,
      isHighlighted: false,
      isTooltipVisible: false,
      sourceColumnName: undefined,
      targetColumnCardinalities: calculateCardinalities(table, relationships),
      showMode: 'ALL_FIELDS',
    },
  }))

  // 4. Create relationship edges
  const edges: Edge<RelationshipEdgeData>[] =
    relationshipsWithCardinality.map(rel => ({
      id: rel.name,
      type: 'relationship',
      source: rel.primaryTableName,
      target: rel.foreignTableName,
      sourceHandle: columnHandleId(rel.primaryTableName, rel.primaryColumnName),
      targetHandle: columnHandleId(rel.foreignTableName, rel.foreignColumnName),
      data: {
        relationship: rel,
        cardinality: rel.cardinality,
      },
      markerStart: getMarkerStart(rel.cardinality),
      markerEnd: getMarkerEnd(rel.cardinality),
    }))

  // 5. Group non-related tables (optional optimization)
  const nonRelatedTables = findNonRelatedTables(tables, relationships)
  if (nonRelatedTables.length > 0) {
    const groupNode = createNonRelatedGroupNode(nonRelatedTables)
    tableNodes.push(groupNode)
  }

  return { nodes: tableNodes, edges }
}

// Helper: Column handle ID format
const columnHandleId = (tableName: string, columnName: string) =>
  `${tableName}__${columnName}`

// Helper: Determine marker based on cardinality
const getMarkerEnd = (cardinality: Cardinality) =>
  cardinality === 'ONE_TO_ONE' ? 'url(#zeroOrOneRight)' : 'url(#zeroOrManyRight)'
```

**Cardinality Detection Logic:**

**File:** `frontend/packages/schema/src/utils/constraintsToRelationships.ts`

```typescript
const detectCardinality = (
  foreignKey: ForeignKeyConstraint,
  table: Table
): Cardinality => {
  const fkColumnNames = new Set(foreignKey.columnNames)

  // Check if there's a UNIQUE constraint covering ALL FK columns
  const hasUniqueConstraint = Object.values(table.constraints).some(c => {
    if (c.type !== 'UNIQUE') return false

    const uniqueColumns = new Set(c.columnNames)

    // All FK columns must be in the UNIQUE constraint
    return [...fkColumnNames].every(col => uniqueColumns.has(col))
  })

  return hasUniqueConstraint ? 'ONE_TO_ONE' : 'ONE_TO_MANY'
}
```

---

### 7. Automatic Layout with ELK

**File:** `utils/computeAutoLayout/getElkLayout.ts`

```typescript
import ELK from 'elkjs/lib/elk.bundled.js'

const elk = new ELK()

export const getElkLayout = async (
  nodes: Node[],
  edges: Edge[]
): Promise<Node[]> => {
  // Filter out hidden nodes
  const visibleNodes = nodes.filter(n => !n.hidden)

  // Convert React Flow format to ELK format
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',  // Left-to-right layout
      'elk.layered.spacing.baseValue': '40',
      'elk.spacing.componentComponent': '80',
      'elk.layered.spacing.edgeNodeBetweenLayers': '120',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
      'elk.layered.mergeEdges': 'true',
      'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
    },
    children: visibleNodes.map(node => ({
      id: node.id,
      width: node.width || 200,
      height: node.height || 100,
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  // Run ELK layout
  const layoutedGraph = await elk.layout(elkGraph)

  // Convert back to React Flow format
  const layoutedNodes = visibleNodes.map(node => {
    const elkNode = layoutedGraph.children?.find(n => n.id === node.id)

    return {
      ...node,
      position: {
        x: elkNode?.x || 0,
        y: elkNode?.y || 0,
      },
    }
  })

  return layoutedNodes
}
```

**Integration Hook:**

**File:** `components/ERDContent/hooks/useInitialAutoLayout.ts`

```typescript
export const useInitialAutoLayout = ({ nodes, edges, setNodes }) => {
  const { fitView } = useReactFlow()
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    if (isInitialized || nodes.length === 0) return

    const runLayout = async () => {
      // Compute layout
      const layoutedNodes = await getElkLayout(nodes, edges)

      // Update nodes with positions
      setNodes(layoutedNodes)

      // Fit view to show all nodes
      setTimeout(() => {
        fitView({
          padding: 0.2,
          duration: 300,
        })
      }, 50)

      setIsInitialized(true)
    }

    runLayout()
  }, [nodes, edges, isInitialized])
}
```

---

## Interaction and State Management

### 8. User Editing Context

**File:** `stores/userEditing/context.ts`

```typescript
type UserEditingContextValue = {
  // Active table (selected)
  activeTableName: string | null
  setActiveTableName: (tableName: string | null) => void

  // Hovered table
  hoveredTableName: string | null
  setHoveredTableName: (tableName: string | null) => void

  // Display mode
  showMode: 'TABLE_NAME' | 'KEY_ONLY' | 'ALL_FIELDS'
  setShowMode: (mode: ShowMode) => void

  // Hidden nodes
  hiddenNodeIds: string[]
  setHiddenNodeIds: (ids: string[]) => void
  toggleHiddenNodeId: (id: string) => void

  // Multi-select
  selectedNodeIds: Set<string>
  updateSelectedNodeIds: (
    nodeId: string,
    mode: 'ctrl' | 'shift' | 'single',
    nodes: Node[]
  ) => void
  resetSelectedNodeIds: () => void
}

export const UserEditingProvider = ({ children }) => {
  const [activeTableName, setActiveTableName] = useState<string | null>(null)
  const [hoveredTableName, setHoveredTableName] = useState<string | null>(null)
  const [showMode, setShowMode] = useState<ShowMode>('ALL_FIELDS')
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>([])
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())

  // URL synchronization
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (activeTableName) {
      params.set('table', activeTableName)
    } else {
      params.delete('table')
    }
    window.history.replaceState({}, '', `?${params}`)
  }, [activeTableName])

  return (
    <UserEditingContext.Provider value={{
      activeTableName, setActiveTableName,
      hoveredTableName, setHoveredTableName,
      showMode, setShowMode,
      hiddenNodeIds, setHiddenNodeIds, toggleHiddenNodeId,
      selectedNodeIds, updateSelectedNodeIds, resetSelectedNodeIds,
    }}>
      {children}
    </UserEditingContext.Provider>
  )
}
```

---

### 9. Event Handlers

**File:** `components/ERDContent/hooks/useNodeEventHandlers.ts`

```typescript
export const useNodeEventHandlers = () => {
  const {
    setActiveTableName,
    setHoveredTableName,
    resetSelectedNodeIds
  } = useUserEditing()

  const handleNodeClick = useCallback((
    event: React.MouseEvent,
    node: Node
  ) => {
    // Set as active table
    setActiveTableName(node.id)

    // Update URL
    const url = new URL(window.location.href)
    url.searchParams.set('table', node.id)
    window.history.pushState({}, '', url)
  }, [setActiveTableName])

  const handlePaneClick = useCallback(() => {
    // Deselect all
    setActiveTableName(null)
    resetSelectedNodeIds()
  }, [setActiveTableName, resetSelectedNodeIds])

  const handleMouseEnterNode = useCallback((
    event: React.MouseEvent,
    node: Node
  ) => {
    setHoveredTableName(node.id)
  }, [setHoveredTableName])

  const handleMouseLeaveNode = useCallback(() => {
    setHoveredTableName(null)
  }, [setHoveredTableName])

  const handleDragStopNode = useCallback((
    event: React.MouseEvent,
    node: Node,
    nodes: Node[]
  ) => {
    // Persist custom positions
    const positions = nodes.reduce((acc, n) => ({
      ...acc,
      [n.id]: n.position,
    }), {})

    localStorage.setItem('node-positions', JSON.stringify(positions))
  }, [])

  return {
    handleNodeClick,
    handlePaneClick,
    handleMouseEnterNode,
    handleMouseLeaveNode,
    handleDragStopNode,
  }
}
```

---

## Visual Highlighting System

### 10. Highlighting Logic

**File:** `utils/highlightNodesAndEdges.ts`

```typescript
export const highlightNodesAndEdges = (
  nodes: Node<TableNodeData>[],
  edges: Edge<RelationshipEdgeData>[],
  activeTableName: string | null,
  hoveredTableName: string | null
): {
  highlightedNodes: Node<TableNodeData>[]
  highlightedEdges: Edge<RelationshipEdgeData>[]
} => {
  // Build edge map for quick lookups
  const edgeMap = new Map<string, Edge[]>()
  edges.forEach(edge => {
    const sourceEdges = edgeMap.get(edge.source) || []
    sourceEdges.push(edge)
    edgeMap.set(edge.source, sourceEdges)

    const targetEdges = edgeMap.get(edge.target) || []
    targetEdges.push(edge)
    edgeMap.set(edge.target, targetEdges)
  })

  // Find related table IDs
  const relatedTableIds = new Set<string>()

  if (activeTableName) {
    relatedTableIds.add(activeTableName)

    // Add all connected tables
    const connectedEdges = edgeMap.get(activeTableName) || []
    connectedEdges.forEach(edge => {
      relatedTableIds.add(edge.source)
      relatedTableIds.add(edge.target)
    })
  }

  if (hoveredTableName) {
    relatedTableIds.add(hoveredTableName)

    const connectedEdges = edgeMap.get(hoveredTableName) || []
    connectedEdges.forEach(edge => {
      relatedTableIds.add(edge.source)
      relatedTableIds.add(edge.target)
    })
  }

  // Update node highlighting
  const highlightedNodes = nodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      isActiveHighlighted: node.id === activeTableName,
      isHighlighted: relatedTableIds.has(node.id) && node.id !== activeTableName,
      isTooltipVisible: node.id === hoveredTableName,
    },
    // Increase z-index for highlighted nodes
    zIndex: relatedTableIds.has(node.id) ? 1000 : 1,
  }))

  // Update edge highlighting
  const highlightedEdges = edges.map(edge => {
    const isConnectedToActive =
      edge.source === activeTableName || edge.target === activeTableName
    const isConnectedToHovered =
      edge.source === hoveredTableName || edge.target === hoveredTableName

    return {
      ...edge,
      data: {
        ...edge.data,
        isHighlighted: isConnectedToActive || isConnectedToHovered,
      },
      // Increase z-index for highlighted edges
      zIndex: (isConnectedToActive || isConnectedToHovered) ? 1000 : 1,
    }
  })

  return {
    highlightedNodes,
    highlightedEdges
  }
}
```

**Integration Hook:**

**File:** `components/ERDContent/hooks/useHighlightNodesAndEdges.ts`

```typescript
export const useHighlightNodesAndEdges = ({
  nodes,
  edges,
  setNodes,
  setEdges
}) => {
  const { activeTableName, hoveredTableName } = useUserEditing()

  useEffect(() => {
    const { highlightedNodes, highlightedEdges } =
      highlightNodesAndEdges(
        nodes,
        edges,
        activeTableName,
        hoveredTableName
      )

    setNodes(highlightedNodes)
    setEdges(highlightedEdges)
  }, [activeTableName, hoveredTableName, nodes.length, edges.length])
}
```

---

## Key Implementation Patterns

### Pattern 1: Custom Node with Handles

```typescript
// Each column gets a connection handle
const TableNode = ({ data }) => {
  const { table } = data

  return (
    <div className="table-node">
      <div className="table-header">{table.name}</div>
      <div className="columns">
        {Object.entries(table.columns).map(([colName, col]) => (
          <div key={colName} className="column">
            {colName}

            {/* Connection handle for this column */}
            <Handle
              id={`${table.name}__${colName}`}
              type="source"
              position={Position.Right}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Pattern 2: Edge with Conditional Animation

```typescript
const RelationshipEdge = ({ data, sourceX, sourceY, targetX, targetY }) => {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY })
  const { isHighlighted } = data

  return (
    <g>
      {/* Main path */}
      <path d={edgePath} stroke={isHighlighted ? 'blue' : 'gray'} />

      {/* Particles only when highlighted */}
      {isHighlighted && (
        <circle r="3" fill="blue">
          <animateMotion dur="2s" repeatCount="indefinite">
            <mpath href={`#${edgePath}`} />
          </animateMotion>
        </circle>
      )}
    </g>
  )
}
```

### Pattern 3: State-Driven Visual Updates

```typescript
// Context changes trigger visual updates
const { activeTableName, hoveredTableName } = useUserEditing()

useEffect(() => {
  // Recalculate which nodes/edges should be highlighted
  const updated = highlightNodesAndEdges(
    nodes,
    edges,
    activeTableName,
    hoveredTableName
  )

  // React Flow will re-render affected components
  setNodes(updated.nodes)
  setEdges(updated.edges)
}, [activeTableName, hoveredTableName])
```

### Pattern 4: Toolbar Actions with React Flow API

```typescript
const Toolbar = () => {
  const { fitView, zoomIn, zoomOut, getViewport } = useReactFlow()

  const handleFitView = () => {
    fitView({ padding: 0.2, duration: 300 })
  }

  const handleAutoLayout = async () => {
    const layouted = await computeAutoLayout(nodes, edges)
    setNodes(layouted)
    setTimeout(() => fitView({ padding: 0.2 }), 100)
  }

  return (
    <div className="toolbar">
      <button onClick={zoomIn}>+</button>
      <button onClick={zoomOut}>-</button>
      <button onClick={handleFitView}>Fit</button>
      <button onClick={handleAutoLayout}>Auto Layout</button>
    </div>
  )
}
```

### Pattern 5: Memoized Node/Edge Types

```typescript
// Prevent unnecessary re-renders
const nodeTypes = useMemo(() => ({
  table: TableNode,
  nonRelatedTableGroup: NonRelatedTableGroupNode,
}), [])

const edgeTypes = useMemo(() => ({
  relationship: RelationshipEdge,
}), [])

return (
  <ReactFlow
    nodeTypes={nodeTypes}
    edgeTypes={edgeTypes}
    // ...
  />
)
```

---

## Code References

### Critical Files to Study

1. **Main Canvas:**
   - `/home/shotup/programing/react/liam/frontend/packages/erd-core/src/features/erd/components/ERDContent/ErdContent.tsx:1`
   - Shows React Flow setup, hooks integration, event handlers

2. **Custom Node:**
   - `/home/shotup/programing/react/liam/frontend/packages/erd-core/src/features/erd/components/ERDContent/components/TableNode/TableNode.tsx:1`
   - Custom node implementation with handles, highlighting

3. **Custom Edge:**
   - `/home/shotup/programing/react/liam/frontend/packages/erd-core/src/features/erd/components/ERDContent/components/RelationshipEdge/RelationshipEdge.tsx:1`
   - Edge with animation, markers, labels

4. **Schema Conversion:**
   - `/home/shotup/programing/react/liam/frontend/packages/erd-core/src/features/erd/utils/convertSchemaToNodes.ts:1`
   - Data transformation logic

5. **Auto Layout:**
   - `/home/shotup/programing/react/liam/frontend/packages/erd-core/src/features/erd/utils/computeAutoLayout/getElkLayout.ts:1`
   - ELK integration

6. **Highlighting:**
   - `/home/shotup/programing/react/liam/frontend/packages/erd-core/src/features/erd/utils/highlightNodesAndEdges.ts:1`
   - Visual state calculation

7. **State Management:**
   - `/home/shotup/programing/react/liam/frontend/packages/erd-core/src/stores/userEditing/context.ts:1`
   - Context-based state with URL sync

---

## Key Takeaways for liz-whiteboard

### Advantages of React Flow Approach

1. **Declarative**: Nodes/edges are React components, easier to reason about
2. **Built-in features**: Pan, zoom, minimap, controls, background
3. **Performance**: Virtualized rendering for large graphs
4. **Accessibility**: Built-in keyboard navigation, ARIA labels
5. **Extensibility**: Custom nodes/edges with full React capabilities

### Differences from Konva

| Feature | React Flow | Konva |
|---------|-----------|-------|
| Paradigm | Declarative | Imperative |
| Node Types | React Components | Shapes (Rect, Text, etc.) |
| Edges | Built-in with routing | Manual path drawing |
| Pan/Zoom | Built-in | Manual implementation |
| Event Handling | React events | Konva events |
| Performance | Virtualized | Canvas-based |
| Use Case | Diagrams, flows | Custom graphics, games |

### Migration Considerations

If migrating from Konva to React Flow:

1. **Node positions** can be migrated directly (x, y coordinates)
2. **Custom rendering** moves from Konva shapes to React components
3. **Edge routing** handled automatically (no more manual path calculation)
4. **State management** can remain the same (TanStack Query, etc.)
5. **Real-time updates** work the same (WebSocket → state → re-render)

### Recommended Approach for liz-whiteboard

**If keeping Konva:**
- Study Liam's highlighting system logic
- Adopt ELK for auto-layout
- Implement similar node/edge state patterns

**If migrating to React Flow:**
- Follow Liam's component structure
- Reuse existing data models (tables, relationships)
- Integrate with existing collaboration (Socket.IO)
- Maintain manual positioning capability alongside auto-layout

---

## Additional Resources

- **React Flow Docs**: https://reactflow.dev/
- **ELK Docs**: https://www.eclipse.org/elk/documentation.html
- **Liam ERD Repo**: https://github.com/liam-hq/liam
- **React Flow Examples**: https://reactflow.dev/examples

---

**Last Updated:** 2025-11-15
**Source Analysis:** Liam ERD @ `/home/shotup/programing/react/liam/frontend/packages/erd-core/`
