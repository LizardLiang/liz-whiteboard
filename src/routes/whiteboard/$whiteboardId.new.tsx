// src/routes/whiteboard/$whiteboardId.new.tsx
// Whiteboard editor route - React Flow version
// This is the migrated version using React Flow instead of Konva

import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Connection, OnEdgesChange, OnNodesChange } from '@xyflow/react'
import type {
  Cardinality,
  CreateColumn,
  CreateRelationship,
  CreateTable,
} from '@/data/schema'
import type { DiagramAST } from '@/lib/parser/ast'
import type { RelationshipEdge, TableNode } from '@/lib/react-flow/types'
import { ReactFlowCanvas } from '@/components/whiteboard/ReactFlowCanvas'
import { Toolbar } from '@/components/whiteboard/Toolbar'
import { TextEditor } from '@/components/whiteboard/TextEditor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useCollaboration } from '@/hooks/use-collaboration'
import { useAuthContext } from '@/components/auth/AuthContext'
import { getSessionUserId } from '@/lib/session-user-id'
import { useAutoLayoutPreference } from '@/hooks/use-auto-layout-preference'
import {
  convertToReactFlowEdges,
  convertToReactFlowNodes,
  extractPositionUpdates,
} from '@/lib/react-flow/converters'
import {
  computeAutoLayout,
  createRelationshipFn,
  createTable as createTableFn,
  getWhiteboardRelationships,
  getWhiteboardWithDiagram,
  saveCanvasState,
  updateTablePosition as updateTablePositionFn,
  updateWhiteboardTextSourceFn,
} from '@/lib/server-functions'
import {
  astToEntities,
  entitiesToText,
  parseDiagram,
} from '@/lib/parser/diagram-parser'
import { parseColumnHandleId } from '@/lib/react-flow/edge-routing'

/** Pending connection data waiting for cardinality selection */
interface PendingConnection {
  sourceTableId: string
  sourceColumnId: string
  targetTableId: string
  targetColumnId: string
}

/** Common cardinality options shown at the top of the picker */
const CARDINALITY_OPTIONS: Array<{ value: Cardinality; label: string }> = [
  { value: 'ONE_TO_ONE', label: 'One to One (1:1)' },
  { value: 'ONE_TO_MANY', label: 'One to Many (1:N)' },
  { value: 'MANY_TO_ONE', label: 'Many to One (N:1)' },
  { value: 'MANY_TO_MANY', label: 'Many to Many (N:N)' },
  { value: 'ZERO_TO_ONE', label: 'Zero to One (0:1)' },
  { value: 'ZERO_TO_MANY', label: 'Zero to Many (0:N)' },
  { value: 'SELF_REFERENCING', label: 'Self Referencing' },
  { value: 'ZERO_OR_ONE_TO_ONE', label: 'Zero or One to One (0..1:1)' },
  { value: 'ZERO_OR_ONE_TO_MANY', label: 'Zero or One to Many (0..1:N)' },
  { value: 'ZERO_OR_MANY_TO_ONE', label: 'Zero or Many to One (0..N:1)' },
  { value: 'ZERO_OR_MANY_TO_MANY', label: 'Zero or Many to Many (0..N:N)' },
  {
    value: 'ZERO_OR_ONE_TO_ZERO_OR_ONE',
    label: 'Zero or One to Zero or One',
  },
  {
    value: 'ZERO_OR_ONE_TO_ZERO_OR_MANY',
    label: 'Zero or One to Zero or Many',
  },
  { value: 'MANY_TO_ZERO_OR_ONE', label: 'Many to Zero or One (N:0..1)' },
  { value: 'MANY_TO_ZERO_OR_MANY', label: 'Many to Zero or Many (N:0..N)' },
  {
    value: 'ZERO_OR_MANY_TO_ZERO_OR_ONE',
    label: 'Zero or Many to Zero or One',
  },
  {
    value: 'ZERO_OR_MANY_TO_ZERO_OR_MANY',
    label: 'Zero or Many to Zero or Many',
  },
]

/**
 * Whiteboard editor page component - React Flow version
 */
export const Route = createFileRoute('/whiteboard/$whiteboardId/new')({
  component: WhiteboardEditor,
})

/**
 * Whiteboard Editor component with React Flow
 */
function WhiteboardEditor() {
  const { whiteboardId } = Route.useParams()
  const queryClient = useQueryClient()

  // Anonymous session-stable user ID. Replace with auth context when auth is implemented.
  const userId = getSessionUserId()
  const { triggerSessionExpired } = useAuthContext()

  // State
  const [selectedNodeIds, setSelectedNodeIds] = useState<Array<string>>([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Array<string>>([])
  const [currentZoom, setCurrentZoom] = useState(1)
  const [activeTab, setActiveTab] = useState<'visual' | 'text'>('visual')
  const [textSource, setTextSource] = useState<string>('')
  const [isTextSyncEnabled, setIsTextSyncEnabled] = useState(true)
  const [isAutoLayoutComputing, setIsAutoLayoutComputing] = useState(false)

  // Cardinality picker dialog state
  const [pendingConnection, setPendingConnection] =
    useState<PendingConnection | null>(null)
  const [selectedCardinality, setSelectedCardinality] =
    useState<Cardinality>('ONE_TO_MANY')

  // Debounce timer for canvas state persistence
  const saveCanvasStateTimerRef = useState<NodeJS.Timeout | null>(null)

  // Auto-layout preference
  const { autoLayoutEnabled, setAutoLayoutEnabled } = useAutoLayoutPreference()

  // Fetch whiteboard data with TanStack Query
  const { data: whiteboardData, isLoading, isError } = useQuery({
    queryKey: ['whiteboard', whiteboardId],
    queryFn: async () => {
      const whiteboard = await getWhiteboardWithDiagram({ data: whiteboardId })
      const relationships = await getWhiteboardRelationships({
        data: whiteboardId,
      })

      return {
        whiteboard,
        relationships,
      }
    },
  })

  // WebSocket collaboration - MUST be called before any early returns
  const { emit, on, off, connectionState } = useCollaboration(
    whiteboardId,
    userId,
    triggerSessionExpired,
  )

  // Convert data to React Flow format
  const nodes = useMemo(() => {
    if (!whiteboardData?.whiteboard?.tables) return []
    return convertToReactFlowNodes(whiteboardData.whiteboard.tables)
  }, [whiteboardData?.whiteboard?.tables])

  const edges = useMemo(() => {
    if (!whiteboardData?.relationships) return []
    return convertToReactFlowEdges(whiteboardData.relationships)
  }, [whiteboardData?.relationships])

  // Mutations
  const createTableMutation = useMutation({
    mutationFn: async (data: CreateTable) => {
      return await createTableFn({ data })
    },
    onSuccess: (createdTable) => {
      emit('table:create', createdTable)
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    },
    onError: (err) => {
      console.error('Failed to create table:', err)
      alert('Failed to create table. Please try again.')
    },
  })

  const updateTablePositionMutation = useMutation({
    mutationFn: async (data: {
      id: string
      positionX: number
      positionY: number
    }) => {
      return await updateTablePositionFn({ data })
    },
    onSuccess: (updatedTable, variables) => {
      emit('table:move', {
        tableId: variables.id,
        positionX: variables.positionX,
        positionY: variables.positionY,
      })

      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          whiteboard: {
            ...old.whiteboard,
            tables: old.whiteboard.tables.map((t: any) =>
              t.id === updatedTable.id
                ? {
                    ...t,
                    positionX: updatedTable.positionX,
                    positionY: updatedTable.positionY,
                  }
                : t,
            ),
          },
        }
      })
    },
    onError: (err) => {
      console.error('Failed to update table position:', err)
    },
  })

  const createRelationshipMutation = useMutation({
    mutationFn: async (data: CreateRelationship) => {
      return await createRelationshipFn({ data })
    },
    onSuccess: (createdRelationship) => {
      emit('relationship:create', createdRelationship)
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    },
    onError: (err) => {
      console.error('Failed to create relationship:', err)
      alert('Failed to create relationship. Please try again.')
    },
  })

  const updateTextSourceMutation = useMutation({
    mutationFn: async (newTextSource: string) => {
      return await updateWhiteboardTextSourceFn({
        data: { whiteboardId, textSource: newTextSource },
      })
    },
    onSuccess: (updatedWhiteboard) => {
      emit('text:update', {
        textSource: updatedWhiteboard.textSource,
        cursorPosition: 0,
      })
    },
    onError: (err) => {
      console.error('Failed to update text source:', err)
    },
  })

  // Handle nodes change (drag, selection, etc.)
  const onNodesChange: OnNodesChange<TableNode> = useCallback(
    (changes) => {
      changes.forEach((change) => {
        // Handle position changes (drag end)
        if (
          change.type === 'position' &&
          change.dragging === false &&
          change.position
        ) {
          updateTablePositionMutation.mutate({
            id: change.id,
            positionX: change.position.x,
            positionY: change.position.y,
          })
        }

        // Handle selection changes
        if (change.type === 'select') {
          setSelectedNodeIds((prev) =>
            change.selected
              ? [...prev, change.id]
              : prev.filter((id) => id !== change.id),
          )
        }
      })
    },
    [updateTablePositionMutation],
  )

  // Handle edges change
  const onEdgesChange: OnEdgesChange<RelationshipEdge> = useCallback(
    (changes) => {
      changes.forEach((change) => {
        if (change.type === 'select') {
          setSelectedEdgeIds((prev) =>
            change.selected
              ? [...prev, change.id]
              : prev.filter((id) => id !== change.id),
          )
        }
      })
    },
    [],
  )

  // Event handlers
  const handleCreateTable = useCallback(
    (data: CreateTable) => {
      createTableMutation.mutate(data)
    },
    [createTableMutation],
  )

  const handleCreateRelationship = useCallback(
    (data: CreateRelationship) => {
      createRelationshipMutation.mutate(data)
    },
    [createRelationshipMutation],
  )

  /**
   * Handle a new connection drag from a column handle.
   * Parses the handle IDs and opens the cardinality picker dialog.
   */
  const onConnect = useCallback((connection: Connection) => {
    const { source, target, sourceHandle, targetHandle } = connection

    if (!source || !target || !sourceHandle || !targetHandle) return

    const parsedSource = parseColumnHandleId(sourceHandle)
    const parsedTarget = parseColumnHandleId(targetHandle)

    if (!parsedSource || !parsedTarget) return

    setPendingConnection({
      sourceTableId: parsedSource.tableId,
      sourceColumnId: parsedSource.columnId,
      targetTableId: parsedTarget.tableId,
      targetColumnId: parsedTarget.columnId,
    })
    setSelectedCardinality('ONE_TO_MANY')
  }, [])

  /**
   * Confirm cardinality selection and create the relationship.
   */
  const handleCardinalityConfirm = useCallback(() => {
    if (!pendingConnection) return

    handleCreateRelationship({
      whiteboardId,
      sourceTableId: pendingConnection.sourceTableId,
      targetTableId: pendingConnection.targetTableId,
      sourceColumnId: pendingConnection.sourceColumnId,
      targetColumnId: pendingConnection.targetColumnId,
      cardinality: selectedCardinality,
    })

    setPendingConnection(null)
  }, [
    pendingConnection,
    selectedCardinality,
    whiteboardId,
    handleCreateRelationship,
  ])

  /**
   * Cancel the pending connection — discard it.
   */
  const handleCardinalityCancel = useCallback(() => {
    setPendingConnection(null)
  }, [])

  /**
   * Handle auto layout computation
   */
  const handleAutoLayout = useCallback(async () => {
    if (!whiteboardData?.whiteboard) return

    setIsAutoLayoutComputing(true)

    try {
      emit('layout:compute', { userId })

      const result = await computeAutoLayout({
        data: {
          whiteboardId,
          options: {
            width: window.innerWidth,
            height: window.innerHeight - 160,
            linkDistance: 200,
            chargeStrength: -1000,
            collisionPadding: 50,
            iterations: 300,
            handleClusters: true,
          },
        },
      })

      console.log('Layout computed:', result.metadata)

      emit('layout:computed', {
        positions: result.positions,
        userId,
      })

      await queryClient.invalidateQueries({
        queryKey: ['whiteboard', whiteboardId],
      })
    } catch (error) {
      console.error('Failed to compute auto layout:', error)
      alert('Failed to compute layout. Please try again.')
    } finally {
      setIsAutoLayoutComputing(false)
    }
  }, [whiteboardData, whiteboardId, userId, emit, queryClient])

  // Text editor handlers
  const handleTextChange = useCallback(
    (newText: string) => {
      setTextSource(newText)
      updateTextSourceMutation.mutate(newText)
    },
    [updateTextSourceMutation],
  )

  const handleParsedDiagram = useCallback((ast: DiagramAST) => {
    console.log('Diagram parsed successfully:', ast)
  }, [])

  // Initialize textSource from database
  useEffect(() => {
    if (activeTab === 'text' && whiteboardData?.whiteboard) {
      if (whiteboardData.whiteboard.textSource && textSource === '') {
        setTextSource(whiteboardData.whiteboard.textSource)
      } else if (isTextSyncEnabled) {
        const currentText = entitiesToText(
          whiteboardData.whiteboard.tables,
          whiteboardData.relationships,
        )
        setTextSource(currentText)
      }
    }
  }, [activeTab, whiteboardData, isTextSyncEnabled, textSource])

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    const handleTableCreated = (table: any) => {
      console.log('Table created by another user:', table)
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    }

    const handleTableMoved = (data: {
      tableId: string
      positionX: number
      positionY: number
    }) => {
      console.log('Table moved by another user:', data)
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          whiteboard: {
            ...old.whiteboard,
            tables: old.whiteboard.tables.map((t: any) =>
              t.id === data.tableId
                ? { ...t, positionX: data.positionX, positionY: data.positionY }
                : t,
            ),
          },
        }
      })
    }

    const handleRelationshipCreated = (relationship: any) => {
      console.log('Relationship created by another user:', relationship)
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    }

    const handleTextUpdated = (data: {
      textSource: string
      updatedBy: string
    }) => {
      console.log('Text updated by another user:', data.updatedBy)
      setTextSource(data.textSource)
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    }

    const handleLayoutCompute = (data: { userId: string }) => {
      console.log('Layout computation started by user:', data.userId)
      if (data.userId !== userId) {
        setIsAutoLayoutComputing(true)
      }
    }

    const handleLayoutComputed = (data: {
      positions: Array<{ id: string; x: number; y: number }>
      userId: string
    }) => {
      console.log('Layout computed by user:', data.userId)
      if (data.userId !== userId) {
        setIsAutoLayoutComputing(false)
        queryClient.invalidateQueries({
          queryKey: ['whiteboard', whiteboardId],
        })
      }
    }

    on('table:created', handleTableCreated)
    on('table:moved', handleTableMoved)
    on('relationship:created', handleRelationshipCreated)
    on('text:updated', handleTextUpdated)
    on('layout:compute', handleLayoutCompute)
    on('layout:computed', handleLayoutComputed)

    return () => {
      off('table:created', handleTableCreated)
      off('table:moved', handleTableMoved)
      off('relationship:created', handleRelationshipCreated)
      off('text:updated', handleTextUpdated)
      off('layout:compute', handleLayoutCompute)
      off('layout:computed', handleLayoutComputed)
    }
  }, [on, off, queryClient, whiteboardId, userId])

  // Early returns AFTER all hooks
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-muted-foreground">Loading whiteboard...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-lg font-semibold">Access denied</p>
        <p className="text-sm text-muted-foreground">
          You don't have access to this whiteboard.
        </p>
        <Link to="/" className="text-sm text-primary underline underline-offset-4">
          Back to dashboard
        </Link>
      </div>
    )
  }

  if (!whiteboardData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-muted-foreground">Loading whiteboard...</p>
      </div>
    )
  }

  const { whiteboard, relationships } = whiteboardData

  if (!whiteboard) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-lg font-semibold">Whiteboard not found</p>
        <p className="text-sm text-muted-foreground">
          This whiteboard does not exist or you don't have access to it.
        </p>
        <Link to="/" className="text-sm text-primary underline underline-offset-4">
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <h1 className="text-xl font-semibold">{whiteboard.name}</h1>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${
              connectionState === 'connected'
                ? 'text-green-600'
                : connectionState === 'connecting'
                  ? 'text-yellow-600'
                  : 'text-red-600'
            }`}
          >
            {connectionState === 'connected'
              ? 'Connected'
              : connectionState === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Mode Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'visual' | 'text')}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="border-b px-4">
          <TabsList>
            <TabsTrigger value="visual">Visual Editor</TabsTrigger>
            {/* Text Editor tab hidden — tab preserved, trigger disabled */}
            {/* <TabsTrigger value="text">Text Editor</TabsTrigger> */}
          </TabsList>
        </div>

        {/* Visual Editor Tab */}
        <TabsContent
          value="visual"
          className="flex-1 flex flex-col overflow-hidden m-0"
        >
          {/* Toolbar */}
          <Toolbar
            whiteboardId={whiteboardId}
            tables={whiteboard.tables}
            onCreateTable={handleCreateTable}
            onCreateRelationship={handleCreateRelationship}
            onAutoLayout={handleAutoLayout}
            isAutoLayoutLoading={isAutoLayoutComputing}
            autoLayoutEnabled={autoLayoutEnabled}
            onAutoLayoutEnabledChange={setAutoLayoutEnabled}
            zoomControls={{
              zoomIn: () => {},
              zoomOut: () => {},
              zoomReset: () => {},
              fitToScreen: () => {},
            }}
            currentZoom={currentZoom}
          />

          {/* React Flow Canvas */}
          <div className="flex-1 overflow-hidden">
            <ReactFlowCanvas
              initialNodes={nodes}
              initialEdges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodesDraggable={true}
              showControls={true}
              showBackground={true}
              showMinimap={false}
            />
          </div>
        </TabsContent>

        {/* Text Editor Tab */}
        <TabsContent value="text" className="flex-1 overflow-hidden m-0">
          <TextEditor
            value={textSource}
            onChange={handleTextChange}
            onParsedDiagram={handleParsedDiagram}
            placeholder="# Enter diagram syntax here..."
          />
        </TabsContent>
      </Tabs>

      {/* Cardinality Picker Dialog — shown when a connection drag completes */}
      <Dialog
        open={pendingConnection !== null}
        onOpenChange={(open) => {
          if (!open) handleCardinalityCancel()
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Relationship Cardinality</DialogTitle>
          </DialogHeader>

          <div className="py-4 space-y-2">
            <Label htmlFor="cardinality-select">Cardinality</Label>
            <Select
              value={selectedCardinality}
              onValueChange={(value) =>
                setSelectedCardinality(value as Cardinality)
              }
            >
              <SelectTrigger id="cardinality-select">
                <SelectValue placeholder="Select cardinality" />
              </SelectTrigger>
              <SelectContent>
                {CARDINALITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCardinalityCancel}>
              Cancel
            </Button>
            <Button onClick={handleCardinalityConfirm}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
