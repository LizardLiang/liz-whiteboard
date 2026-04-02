// src/routes/whiteboard/$whiteboardId.tsx
// Whiteboard editor route - loads and renders full ER diagram

import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import type { CanvasViewport } from '@/components/whiteboard/Canvas'
import type {
  CreateColumn,
  CreateRelationship,
  CreateTable,
} from '@/data/schema'
import type { DiagramAST } from '@/lib/parser/ast'
import type { ZoomControls } from '@/components/whiteboard/Toolbar'
import { Canvas, useCanvasControls } from '@/components/whiteboard/Canvas'
import { TableNode } from '@/components/whiteboard/TableNode'
import { RelationshipEdge } from '@/components/whiteboard/RelationshipEdge'
import { ReactFlowWhiteboard } from '@/components/whiteboard/ReactFlowWhiteboard'
import { Toolbar } from '@/components/whiteboard/Toolbar'
import { TextEditor } from '@/components/whiteboard/TextEditor'
import { Minimap } from '@/components/whiteboard/Minimap'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCollaboration } from '@/hooks/use-collaboration'
import { getSessionUserId } from '@/lib/session-user-id'
import { useAutoLayoutPreference } from '@/hooks/use-auto-layout-preference'
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

/**
 * Whiteboard editor page component
 * Loads whiteboard with full diagram and enables real-time collaboration
 */
export const Route = createFileRoute('/whiteboard/$whiteboardId')({
  component: WhiteboardEditor,
})

/**
 * Feature flag: Toggle between Konva (legacy) and React Flow (new)
 */
const USE_REACT_FLOW = import.meta.env.VITE_USE_REACT_FLOW === 'true'

/**
 * Whiteboard Editor component
 */
function WhiteboardEditor() {
  const { whiteboardId } = Route.useParams()
  const queryClient = useQueryClient()

  // Anonymous session-stable user ID. Replace with auth context when auth is implemented.
  const userId = getSessionUserId()

  // State
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<
    string | null
  >(null)
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  })
  const [activeTab, setActiveTab] = useState<'visual' | 'text'>('visual')
  const [textSource, setTextSource] = useState<string>('')
  const [isTextSyncEnabled, setIsTextSyncEnabled] = useState(true)
  const [isAutoLayoutComputing, setIsAutoLayoutComputing] = useState(false)

  // React Flow auto-layout function (set via callback)
  const reactFlowAutoLayoutRef = useRef<(() => Promise<void>) | null>(null)

  // React Flow display mode controls (set via callback)
  const [reactFlowShowMode, setReactFlowShowMode] =
    useState<string>('ALL_FIELDS')
  const reactFlowShowModeRef = useRef<((mode: string) => void) | null>(null)

  // React Flow zoom controls (set via callback from ReactFlowWhiteboard)
  const [reactFlowZoomControls, setReactFlowZoomControls] =
    useState<ZoomControls | null>(null)
  const [reactFlowCurrentZoom, setReactFlowCurrentZoom] = useState<number>(1)

  // Canvas stage ref for programmatic zoom controls
  const stageRef = useRef<Konva.Stage>(null)

  // Debounce timer for canvas state persistence
  const saveCanvasStateTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-layout preference
  const { autoLayoutEnabled, setAutoLayoutEnabled } = useAutoLayoutPreference()

  // Fetch whiteboard data with TanStack Query
  const { data: whiteboardData, isLoading } = useQuery({
    queryKey: ['whiteboard', whiteboardId],
    queryFn: async () => {
      // Fetch whiteboard with tables and relationships
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

  /**
   * Restore canvas state when whiteboard loads
   */
  useEffect(() => {
    if (whiteboardData?.whiteboard?.canvasState) {
      const savedState = whiteboardData.whiteboard.canvasState as {
        zoom: number
        offsetX: number
        offsetY: number
      }

      // Validate saved state
      if (
        typeof savedState.zoom === 'number' &&
        typeof savedState.offsetX === 'number' &&
        typeof savedState.offsetY === 'number'
      ) {
        setCanvasViewport({
          zoom: savedState.zoom,
          offsetX: savedState.offsetX,
          offsetY: savedState.offsetY,
        })
        console.log('Canvas state restored:', savedState)
      }
    }
  }, [whiteboardData?.whiteboard?.canvasState])

  // WebSocket collaboration - MUST be called before any early returns
  const { emit, on, off, connectionState } = useCollaboration(
    whiteboardId,
    userId,
  )

  /**
   * Handle canvas viewport changes with debounced persistence
   * Saves to database after 1 second of inactivity
   */
  const handleCanvasViewportChange = useCallback(
    (viewport: CanvasViewport) => {
      setCanvasViewport(viewport)

      // Clear existing timer
      if (saveCanvasStateTimerRef.current) {
        clearTimeout(saveCanvasStateTimerRef.current)
      }

      // Debounce save for 1 second
      saveCanvasStateTimerRef.current = setTimeout(async () => {
        try {
          await saveCanvasState({
            data: {
              whiteboardId,
              canvasState: {
                zoom: viewport.zoom,
                offsetX: viewport.offsetX,
                offsetY: viewport.offsetY,
              },
            },
          })
          console.log('Canvas state saved:', viewport)
        } catch (error) {
          console.error('Failed to save canvas state:', error)
        }
      }, 1000)
    },
    [whiteboardId],
  )

  // Canvas zoom controls
  const canvasControls = useCanvasControls(stageRef, handleCanvasViewportChange)

  // Mutations
  const createTableMutation = useMutation({
    mutationFn: async (data: CreateTable) => {
      return await createTableFn({ data })
    },
    onMutate: async (newTable: CreateTable) => {
      // Optimistic update
      await queryClient.cancelQueries({
        queryKey: ['whiteboard', whiteboardId],
      })

      const previousData = queryClient.getQueryData([
        'whiteboard',
        whiteboardId,
      ])

      // Optimistically add table to cache
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          whiteboard: {
            ...old.whiteboard,
            tables: [
              ...old.whiteboard.tables,
              {
                id: 'temp-' + Date.now(),
                ...newTable,
                columns: [],
                outgoingRelationships: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        }
      })

      return { previousData }
    },
    onSuccess: (createdTable) => {
      // Emit WebSocket event for other users
      emit('table:create', createdTable)

      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    },
    onError: (err, newTable, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          ['whiteboard', whiteboardId],
          context.previousData,
        )
      }
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
      // Emit WebSocket event for other users
      emit('table:move', {
        tableId: variables.id,
        positionX: variables.positionX,
        positionY: variables.positionY,
      })

      // Update cache without full refetch
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
      // Emit WebSocket event for other users
      emit('relationship:create', createdRelationship)

      // Invalidate and refetch
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
      // Emit WebSocket event for other users
      emit('text:update', {
        textSource: updatedWhiteboard.textSource,
        cursorPosition: 0,
      })
    },
    onError: (err) => {
      console.error('Failed to update text source:', err)
    },
  })

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

  const handleTableDragEnd = useCallback(
    (tableId: string, x: number, y: number) => {
      updateTablePositionMutation.mutate({
        id: tableId,
        positionX: x,
        positionY: y,
      })
    },
    [updateTablePositionMutation],
  )

  /**
   * Handle minimap navigation
   * Updates canvas position when user clicks on minimap
   */
  const handleMinimapNavigate = useCallback(
    (offsetX: number, offsetY: number) => {
      const newViewport = {
        zoom: canvasViewport.zoom,
        offsetX,
        offsetY,
      }
      setCanvasViewport(newViewport)
      handleCanvasViewportChange(newViewport)
    },
    [canvasViewport.zoom, handleCanvasViewportChange],
  )

  /**
   * Cleanup debounce timer on unmount
   */
  useEffect(() => {
    return () => {
      if (saveCanvasStateTimerRef.current) {
        clearTimeout(saveCanvasStateTimerRef.current)
      }
    }
  }, [])

  // Text editor handlers
  const handleTextChange = useCallback(
    (newText: string) => {
      setTextSource(newText)
      updateTextSourceMutation.mutate(newText)
    },
    [updateTextSourceMutation],
  )

  const handleParsedDiagram = useCallback((ast: DiagramAST) => {
    // TODO: Implement validation to prevent destructive changes (T046)
    // For now, we don't automatically apply text changes to canvas
    // User needs to explicitly trigger sync or we apply on tab switch
    console.log('Diagram parsed successfully:', ast)
  }, [])

  /**
   * Handle auto layout computation
   * Uses React Flow ELK layout when enabled, otherwise falls back to d3-force
   */
  const handleAutoLayout = useCallback(async () => {
    if (!whiteboardData?.whiteboard) return

    setIsAutoLayoutComputing(true)

    try {
      // Emit WebSocket event to notify other users
      emit('layout:compute', { userId })

      // Use React Flow auto-layout if available (feature flag enabled)
      if (USE_REACT_FLOW && reactFlowAutoLayoutRef.current) {
        await reactFlowAutoLayoutRef.current()
        console.log('React Flow ELK layout computed')
      } else {
        // Fallback to d3-force layout (Konva)
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

        // Emit computed positions to other users
        emit('layout:computed', {
          positions: result.positions,
          userId,
        })

        // Invalidate query to fetch updated positions
        await queryClient.invalidateQueries({
          queryKey: ['whiteboard', whiteboardId],
        })
      }
    } catch (error) {
      console.error('Failed to compute auto layout:', error)
      alert('Failed to compute layout. Please try again.')
    } finally {
      setIsAutoLayoutComputing(false)
    }
  }, [whiteboardData, whiteboardId, userId, emit, queryClient])

  /**
   * Callback for React Flow to register its auto-layout function
   */
  const handleAutoLayoutReady = useCallback(
    (computeLayout: () => Promise<void>, isComputing: boolean) => {
      reactFlowAutoLayoutRef.current = computeLayout
      setIsAutoLayoutComputing(isComputing)
    },
    [],
  )

  /**
   * Callback for React Flow to register its display mode controls
   */
  const handleDisplayModeReady = useCallback(
    (showMode: string, setShowMode: (mode: string) => void) => {
      setReactFlowShowMode(showMode)
      reactFlowShowModeRef.current = setShowMode
    },
    [],
  )

  /**
   * Callback for React Flow to register its zoom controls
   */
  const handleZoomControlsReady = useCallback((controls: ZoomControls) => {
    setReactFlowZoomControls(controls)
  }, [])

  /**
   * Callback for React Flow to notify parent of viewport zoom changes
   */
  const handleZoomChange = useCallback((zoom: number) => {
    setReactFlowCurrentZoom(zoom)
  }, [])

  /**
   * Handle display mode change from Toolbar
   */
  const handleShowModeChange = useCallback((mode: string) => {
    if (USE_REACT_FLOW && reactFlowShowModeRef.current) {
      reactFlowShowModeRef.current(mode)
      setReactFlowShowMode(mode)
    }
  }, [])

  // Initialize textSource from database or sync from canvas when switching to text mode
  useEffect(() => {
    if (activeTab === 'text' && whiteboardData?.whiteboard) {
      // If whiteboard has stored textSource, use it; otherwise generate from canvas
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
      updatedBy?: string
    }) => {
      // Ignore own moves — already applied via mutation's setQueryData
      if (data.updatedBy === userId) return
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
        // Invalidate query to fetch updated positions with animation
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

  // Early returns AFTER all hooks have been called
  if (isLoading || !whiteboardData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-muted-foreground">Loading whiteboard...</p>
      </div>
    )
  }

  const { whiteboard, relationships } = whiteboardData

  if (!whiteboard) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-muted-foreground">Whiteboard not found</p>
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
            <TabsTrigger value="text">Text Editor</TabsTrigger>
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
            zoomControls={
              USE_REACT_FLOW
                ? (reactFlowZoomControls ?? undefined)
                : canvasControls
            }
            currentZoom={
              USE_REACT_FLOW ? reactFlowCurrentZoom : canvasViewport.zoom
            }
            showMode={USE_REACT_FLOW ? (reactFlowShowMode as any) : undefined}
            onShowModeChange={USE_REACT_FLOW ? handleShowModeChange : undefined}
          />

          {/* Canvas - Toggle between Konva and React Flow */}
          <div className="flex-1 overflow-hidden relative">
            {USE_REACT_FLOW ? (
              /* React Flow Canvas (new) */
              <ReactFlowWhiteboard
                whiteboardId={whiteboardId}
                userId={userId}
                showMinimap={whiteboard.tables.length > 0}
                showControls={true}
                nodesDraggable={true}
                onAutoLayoutReady={handleAutoLayoutReady}
                onDisplayModeReady={handleDisplayModeReady}
                onZoomControlsReady={handleZoomControlsReady}
                onZoomChange={handleZoomChange}
              />
            ) : (
              /* Konva Canvas (legacy) */
              <Canvas
                width={window.innerWidth}
                height={window.innerHeight - 160} // Subtract header, tabs, and toolbar height
                initialViewport={canvasViewport}
                onViewportChange={handleCanvasViewportChange}
                stageRef={stageRef}
              >
                {/* Render all tables */}
                {whiteboard.tables.map((table) => (
                  <TableNode
                    key={table.id}
                    table={table}
                    isSelected={selectedTableId === table.id}
                    onClick={setSelectedTableId}
                    onDragEnd={handleTableDragEnd}
                  />
                ))}

                {/* Render all relationships */}
                {relationships.map((relationship) => {
                  const sourceTable = whiteboard.tables.find(
                    (t) => t.id === relationship.sourceTableId,
                  )
                  const targetTable = whiteboard.tables.find(
                    (t) => t.id === relationship.targetTableId,
                  )

                  if (!sourceTable || !targetTable) {
                    console.warn(
                      'Missing table for relationship:',
                      relationship.id,
                    )
                    return null
                  }

                  return (
                    <RelationshipEdge
                      key={relationship.id}
                      relationship={relationship}
                      sourceTable={sourceTable}
                      targetTable={targetTable}
                      isSelected={selectedRelationshipId === relationship.id}
                      onClick={setSelectedRelationshipId}
                    />
                  )
                })}
              </Canvas>
            )}

            {/* Minimap - only show when there are tables and using Konva */}
            {!USE_REACT_FLOW && whiteboard.tables.length > 0 && (
              <Minimap
                tables={whiteboard.tables}
                viewport={canvasViewport}
                canvasWidth={window.innerWidth}
                canvasHeight={window.innerHeight - 160}
                onNavigate={handleMinimapNavigate}
              />
            )}
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
    </div>
  )
}
